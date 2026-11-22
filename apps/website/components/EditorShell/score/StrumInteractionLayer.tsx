import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { hitTestTechniqueTarget, LXM_DURATION_STEM_STROKE_WIDTH } from "@liuxianmao/lxm-editor";
import type { ILXMLayout, ScorePrimitive } from "@liuxianmao/lxm-editor";
import styles from "./score-interaction.module.scss";

export type StrumEndpoint = "minString" | "maxString";
export interface StrumEndpointPreview {
  endpoint: StrumEndpoint;
  string: number;
}

export interface ScoreStrumInteraction {
  layout: ILXMLayout;
  selectedIds: readonly string[];
  activeId: string | null;
  onSelect: (techniqueId: string, toggle: boolean) => void;
  onCommit: (endpoint: StrumEndpoint, string: number) => void;
  onPreview?: (preview: StrumEndpointPreview | null) => void;
}

const endpoints: readonly StrumEndpoint[] = ["minString", "maxString"];

export const getStrumHighlight = (active: boolean) => active
  ? { color: "#2864e3", extraWidth: 0.8 }
  : { color: "#407cc4", extraWidth: 0.5 };

function indexStrums(layout?: ILXMLayout) {
  return new Map(layout?.systems.flatMap((system) => {
    const measuresByBeat = new Map(system.measures.flatMap((measure) =>
      measure.beats.map((beat) => [beat.id, measure] as const),
    ));
    return system.techniques.flatMap(({ techniqueId, strum, focusEndpoints, path }) => {
      const measure = strum && measuresByBeat.get(strum.beatId);
      if (!strum || !measure || !focusEndpoints || !path?.arrowPoints) return [];
      const { start, end } = focusEndpoints;
      return [[techniqueId, {
        range: strum,
        strings: measure.strings,
        systemIndex: system.index,
        start,
        end,
        arrowPoints: path.arrowPoints,
        stem: measure.durationMarks.find((mark) => mark.beatId === strum.beatId && mark.stemVisible),
      }] as const];
    });
  }));
}

type StrumGeometry = ReturnType<typeof indexStrums> extends Map<string, infer Geometry> ? Geometry : never;

function stringY(strum: StrumGeometry, string: number) {
  return strum.strings.find((line) => line.index === string)!.y1;
}

function previewArrow(primitive: ScorePrimitive, strum: StrumGeometry, preview: StrumEndpointPreview): ScorePrimitive {
  // 上、下扫的箭头朝向相反；只平移被拖动的一端，箭头尖随终点移动，另一端沿用原版面位置。
  const delta = stringY(strum, preview.string) - stringY(strum, strum.range[preview.endpoint]);
  if (delta === 0) return primitive;
  const moveStart = (strum.start.y < strum.end.y) === (preview.endpoint === "minString");
  if (primitive.kind === "path") {
    const { start, end } = strum;
    return { ...primitive, d: `M ${start.x} ${start.y + (moveStart ? delta : 0)} L ${end.x} ${end.y + (moveStart ? 0 : delta)}` };
  }
  if (primitive.kind === "polygon" && !moveStart) {
    return { ...primitive, points: primitive.points.map(([x, y]) => [x, y + delta]) };
  }
  return primitive;
}

function layoutPoint(svg: SVGSVGElement, { clientX, clientY }: { clientX: number; clientY: number }) {
  const matrix = svg.getScreenCTM();
  return matrix && new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
}

interface Drag {
  layout: ILXMLayout;
  selectedIds: ReadonlySet<string>;
  activeId: string;
  endpoint: StrumEndpoint;
  pointerId: number;
  offset: number;
  min: number;
  max: number;
  strum: StrumGeometry;
  capture: SVGGElement;
  preview: StrumEndpointPreview | null;
  onPreview: ScoreStrumInteraction["onPreview"];
}

function getPreview(drag: Drag, y: number): StrumEndpointPreview | null {
  const target = y - drag.offset;
  const nearest = drag.strum.strings.reduce((a, b) =>
    Math.abs(b.y1 - target) < Math.abs(a.y1 - target) ? b : a,
  ).index;
  const previous = drag.strum.range[drag.endpoint];
  if (nearest === previous) return null;
  const string = Math.max(drag.min, Math.min(drag.max, nearest));
  return string === previous ? null : { endpoint: drag.endpoint, string };
}

export function useScoreStrumInteraction(interaction?: ScoreStrumInteraction) {
  const geometry = useMemo(() => indexStrums(interaction?.layout), [interaction?.layout]);
  const selected = useMemo(() => new Set(interaction?.selectedIds), [interaction?.selectedIds]);
  const dragRef = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<{ drag: Drag; preview: StrumEndpointPreview | null } | null>(null);
  const activeId = interaction?.activeId;
  const active = activeId && selected.has(activeId) ? geometry.get(activeId) : undefined;

  function isCurrent(drag: Drag) {
    return drag.layout === interaction?.layout && drag.activeId === activeId &&
      drag.selectedIds.size === selected.size && [...drag.selectedIds].every((id) => selected.has(id));
  }

  function finishDrag(next: StrumEndpointPreview | null) {
    const drag = dragRef.current;
    if (!drag) return;
    // 先结束手势再释放捕获，避免 lostpointercapture 重入提交。取消操作只清预览。
    dragRef.current = null;
    if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
    setDraft(null);
    if (drag.preview) drag.onPreview?.(null);
    if (next && isCurrent(drag)) interaction?.onCommit(next.endpoint, next.string);
  }

  useEffect(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!isCurrent(drag)) return finishDrag(null);
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      finishDrag(null);
    };
    const cancelOnBlur = () => finishDrag(null);
    window.addEventListener("keydown", cancelOnEscape, true);
    window.addEventListener("blur", cancelOnBlur);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape, true);
      window.removeEventListener("blur", cancelOnBlur);
    };
  });

  const readPreview = (event: PointerEvent<SVGGElement>, drag: Drag) => {
    const svg = event.currentTarget.ownerSVGElement;
    const point = svg && layoutPoint(svg, event);
    return point ? getPreview(drag, point.y) : null;
  };

  const onPointerMove = (event: PointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!isCurrent(drag)) return finishDrag(null);
    const next = readPreview(event, drag);
    if (next?.string === drag.preview?.string) return;
    drag.preview = next;
    setDraft({ drag, preview: next });
    drag.onPreview?.(next);
  };

  const onPointerUp = (event: PointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finishDrag(readPreview(event, drag));
  };

  const onPointerCancel = (event: PointerEvent<SVGGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finishDrag(null);
  };

  const onPointerDown = (event: PointerEvent<SVGGElement>) => {
    const target = event.target;
    if (!interaction || event.button !== 0 || !(target instanceof Element)) return;
    const id = target.getAttribute("data-strum-id");
    const surface = target.getAttribute("data-strum-hit");
    const endpoint = endpoints.find((key) => key === target.getAttribute("data-strum-handle"));
    if (!id || (!surface && !endpoint)) return;
    if (dragRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.shiftKey && !event.altKey && !endpoint) return;
    const svg = event.currentTarget.ownerSVGElement;
    const point = svg && layoutPoint(svg, event);
    if (!event.altKey && surface === "arrow" && point &&
      hitTestTechniqueTarget(interaction.layout, point)?.techniqueId === id) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.altKey || !endpoint) {
      interaction.onSelect(id, event.altKey);
      return;
    }
    if (!active || id !== activeId || !point) return;
    const ranges = [...selected].flatMap((selectedId) => geometry.get(selectedId)?.range ?? []);
    if (ranges.length !== selected.size) return;
    const opposite = endpoint === "minString" ? "maxString" : "minString";
    const otherStrings = ranges.map((range) => range[opposite]);
    // 所有箭头共享新端点，但保留各自的对端。吸附区间取所有合法弦号的交集。
    const capture = event.currentTarget;
    capture.setPointerCapture(event.pointerId);
    const drag: Drag = {
      layout: interaction.layout,
      selectedIds: selected,
      activeId: id,
      endpoint,
      pointerId: event.pointerId,
      offset: point.y - stringY(active, active.range[endpoint]),
      min: endpoint === "minString" ? active.strings[0]!.index : Math.max(...otherStrings) + 1,
      max: endpoint === "maxString" ? active.strings.at(-1)!.index : Math.min(...otherStrings) - 1,
      strum: active,
      capture,
      preview: null,
      onPreview: interaction.onPreview,
    };
    dragRef.current = drag;
    setDraft({ drag, preview: null });
    svg?.focus({ preventScroll: true });
  };

  const validPreview = draft && isCurrent(draft.drag) ? draft.preview : null;
  const activeString = active && validPreview && active.strings.find((line) => line.index === validPreview.string);
  const activeX = active?.start.x ?? 0;
  const neighbors = active ? [...geometry.values()].filter((s) => s.systemIndex === active.systemIndex) : [];
  const closestRight = Math.min(...neighbors.filter((s) => s.start.x > activeX).map((s) => s.start.x - activeX));
  const closestLeft = Math.min(...neighbors.filter((s) => s.start.x < activeX).map((s) => activeX - s.start.x));
  const knobX = activeX + (closestRight < 20 && closestRight < closestLeft ? -8 : 8);

  return {
    selected,
    activeId,
    geometry,
    previewPrimitive: (primitive: ScorePrimitive) => {
      if (!validPreview || !primitive.techniqueId || !selected.has(primitive.techniqueId)) return primitive;
      const strum = geometry.get(primitive.techniqueId);
      return strum ? previewArrow(primitive, strum, validPreview) : primitive;
    },
    overlay: interaction && (
      <g data-layer="strum-interaction" className={styles.strumInteraction}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel} onLostPointerCapture={onPointerCancel}>
        {[...geometry].map(([id, strum]) => (
          <g key={id} aria-hidden="true">
            <line data-strum-hit="arrow" data-strum-id={id} x1={strum.start.x} x2={strum.end.x}
              y1={strum.start.y} y2={strum.end.y} />
            <polygon data-strum-hit="arrow" data-strum-id={id}
              points={strum.arrowPoints.map((point) => point.join(",")).join(" ")} />
            {strum.stem && <StrumStem id={id} stem={strum.stem} selected={selected.has(id)} active={id === activeId} />}
          </g>
        ))}
        {activeString && <line className={styles.strumSnapLine} data-strum-snap-line
          x1={activeString.x1} x2={activeString.x2} y1={activeString.y1} y2={activeString.y1} />}
        {active && endpoints.map((endpoint) => {
          const string = validPreview?.endpoint === endpoint ? validPreview.string : active.range[endpoint];
          const y = stringY(active, string);
          return <g key={endpoint} className={styles.strumHandle}>
            <line x1={activeX} x2={knobX} y1={y} y2={y} />
            <circle cx={knobX} cy={y} r={4} data-strum-handle={endpoint} data-strum-id={activeId}
              data-strum-string={string} data-strum-preview={validPreview?.endpoint === endpoint || undefined} />
          </g>;
        })}
      </g>
    ),
  };
}

function StrumStem({ id, stem, selected, active }: {
  id: string;
  stem: NonNullable<StrumGeometry["stem"]>;
  selected: boolean;
  active: boolean;
}) {
  const { color, extraWidth } = getStrumHighlight(active);
  const points = { x1: stem.stemX, x2: stem.stemX, y1: stem.stemY1, y2: stem.stemY2 };
  return <>
    {selected && <line {...points} pointerEvents="none" data-strum-id={id}
      data-strum-selected="true" data-strum-active={active || undefined}
      stroke={color} strokeWidth={LXM_DURATION_STEM_STROKE_WIDTH + extraWidth} />}
    <line {...points} data-strum-hit="stem" data-strum-id={id} />
  </>;
}
