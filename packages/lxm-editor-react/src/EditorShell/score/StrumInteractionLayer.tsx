import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { getArpeggioWavePath, hitTestTechniqueTarget, LXM_DURATION_STEM_STROKE_WIDTH } from "@liuxianmao/lxm-editor";
import type { ILXMLayout, ScorePrimitive } from "@liuxianmao/lxm-editor";
import styles from "./score-interaction.module.scss";

export type StrumEndpoint = "minString" | "maxString";
export type StrumRangeTechniqueType = "strum" | "arpeggio";
export interface StrumEndpointPreview {
  endpoint: StrumEndpoint;
  string: number;
  techniqueType: StrumRangeTechniqueType;
}

export interface ScoreStrumInteraction {
  layout: ILXMLayout;
  selectedIds: readonly string[];
  /** Alt 框选临时命中的 ID 只用于高亮，松手提交前与正式选区各自维护。 */
  previewIds?: readonly string[];
  activeId: string | null;
  onSelect: (techniqueId: string, toggle: boolean) => void;
  onCommit: (endpoint: StrumEndpoint, string: number, techniqueType: StrumRangeTechniqueType) => void;
  onPreview?: (preview: StrumEndpointPreview | null) => void;
}

const endpoints: readonly StrumEndpoint[] = ["minString", "maxString"];

export const getStrumHighlight = (active: boolean) => active
  ? { color: "#2864e3", extraWidth: 0.8 }
  : { color: "#407cc4", extraWidth: 0.5 };

export const traversalPreviewHighlight = { color: "#205fb9", extraWidth: 0.5 };

function indexTraversalGeometry(layout?: ILXMLayout) {
  return new Map(layout?.systems.flatMap((system) => {
    const measuresByBeat = new Map(system.measures.flatMap((measure) =>
      measure.beats.map((beat) => [beat.id, measure] as const),
    ));
    return system.techniques.flatMap(({ techniqueId, type, strum, arpeggio, focusEndpoints, path, arrowHead }) => {
      if (type !== "strum" && type !== "arpeggio") return [];
      // 两种记号共用相同的弦位索引。扫弦沿用路径 marker 的三角形，琶音使用独立三角形，
      // 保留波线原路径供可点击描边使用，箭头底边用于拖动时重新生成波线。
      const range = type === "strum" ? strum : arpeggio;
      const arrowPoints = type === "strum" ? path?.arrowPoints : arrowHead?.points;
      const measure = range && measuresByBeat.get(range.beatId);
      if (!range || !measure || !focusEndpoints || !path || !arrowPoints) return [];
      const { start, end } = focusEndpoints;
      return [[techniqueId, {
        type,
        range,
        strings: measure.strings,
        systemIndex: system.index,
        start,
        end,
        arrowPoints,
        path: path.d,
        stem: measure.durationMarks.find((mark) => mark.beatId === range.beatId && mark.stemVisible),
      }] as const];
    });
  }));
}

type TraversalGeometry = ReturnType<typeof indexTraversalGeometry> extends Map<string, infer Geometry> ? Geometry : never;

function stringY(traversal: TraversalGeometry, string: number) {
  return traversal.strings.find((line) => line.index === string)!.y1;
}

function previewArrow(primitive: ScorePrimitive, traversal: TraversalGeometry, preview: StrumEndpointPreview): ScorePrimitive {
  const delta = stringY(traversal, preview.string) - stringY(traversal, traversal.range[preview.endpoint]);
  if (delta === 0) return primitive;
  // 上、下行的起笔端相反。每个记号按自己的方向定位被拖端，保留对端的版面位置和弦线外的留白。
  const { start, end } = traversal;
  const moveStart = (start.y < end.y) === (preview.endpoint === "minString");
  const startY = start.y + (moveStart ? delta : 0);
  const endDelta = moveStart ? 0 : delta;
  if (primitive.kind === "path") {
    // 琶音的箭点顺序为 [尖点, 底边点, 底边点]。以移动后的底边为波线终点，复用布局算法，
    // 让伸缩后的波峰数按长度调整，且波线始终与箭头相接。扫弦仍绘制原样式的直线。
    const d = traversal.type === "arpeggio"
      ? getArpeggioWavePath(start.x, startY, traversal.arrowPoints[1]![1] + endDelta)
      : `M ${start.x} ${startY} L ${end.x} ${end.y + endDelta}`;
    return { ...primitive, d };
  }
  if (primitive.kind === "polygon" && !moveStart) {
    return { ...primitive, points: primitive.points.map(([x, y]) => [x, y + endDelta]) };
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
  traversal: TraversalGeometry;
  capture: SVGGElement;
  preview: StrumEndpointPreview | null;
  onPreview: ScoreStrumInteraction["onPreview"];
}

function getPreview(drag: Drag, y: number): StrumEndpointPreview | null {
  const target = y - drag.offset;
  const nearest = drag.traversal.strings.reduce((a, b) =>
    Math.abs(b.y1 - target) < Math.abs(a.y1 - target) ? b : a,
  ).index;
  const previous = drag.traversal.range[drag.endpoint];
  // 点按手柄或拖回活动记号的原弦位时，保留其他批量对象原本各异的端点。
  if (nearest === previous) return null;
  const string = Math.max(drag.min, Math.min(drag.max, nearest));
  return string === previous ? null : { endpoint: drag.endpoint, string, techniqueType: drag.traversal.type };
}

export function useScoreStrumInteraction(interaction?: ScoreStrumInteraction) {
  const geometry = useMemo(() => indexTraversalGeometry(interaction?.layout), [interaction?.layout]);
  const selected = useMemo(() => new Set(interaction?.selectedIds), [interaction?.selectedIds]);
  const previewIds = useMemo(() => new Set(interaction?.previewIds), [interaction?.previewIds]);
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
    if (next && isCurrent(drag)) interaction?.onCommit(next.endpoint, next.string, next.techniqueType);
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
    const opposite = endpoint === "minString" ? "maxString" : "minString";
    // 离散选区可混选扫弦和琶音。手柄由活动记号的类型决定，取同类型已选记号的合法弦号交集。
    // 每个记号保留自身对端，严格相差至少一弦；框选预览的 ID 此时仍没有编辑资格。
    const otherStrings = [...selected].flatMap((selectedId) => {
      const traversal = geometry.get(selectedId);
      return traversal?.type === active.type ? [traversal.range[opposite]] : [];
    });
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
      traversal: active,
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
    previewIds,
    activeId,
    geometry,
    previewPrimitive: (primitive: ScorePrimitive) => {
      if (!validPreview || !primitive.techniqueId || !selected.has(primitive.techniqueId)) return primitive;
      const traversal = geometry.get(primitive.techniqueId);
      return traversal?.type === validPreview.techniqueType ? previewArrow(primitive, traversal, validPreview) : primitive;
    },
    overlay: interaction && (
      <g data-layer="strum-interaction" className={styles.strumInteraction}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel} onLostPointerCapture={onPointerCancel}>
        {[...geometry].map(([id, traversal]) => {
          // 两种记号共用既有 data-strum-* 命中协议；普通精确选端仍交给谱面父层的布局命中，
          // 这里补充符干与透明描边的点选区域，并给 Alt 框选统一的标识。
          const hit = { "data-strum-hit": "arrow", "data-strum-id": id, "data-strum-type": traversal.type };
          const { end, start, arrowPoints, stem } = traversal;
          return (
            <g key={id} aria-hidden="true">
              {traversal.type === "arpeggio" ? <path {...hit} d={traversal.path} />
                : <line {...hit} x1={start.x} x2={end.x} y1={start.y} y2={end.y} />}
              <polygon {...hit} points={arrowPoints.map((point) => point.join(",")).join(" ")} />
              {stem && <TraversalStem id={id} type={traversal.type} stem={stem} selected={selected.has(id)}
                active={id === activeId} preview={previewIds.has(id) && !selected.has(id)} />}
            </g>
          );
        })}
        {activeString && <line className={styles.strumSnapLine} data-strum-snap-line
          x1={activeString.x1} x2={activeString.x2} y1={activeString.y1} y2={activeString.y1} />}
        {active && endpoints.map((endpoint) => {
          const string = validPreview?.endpoint === endpoint ? validPreview.string : active.range[endpoint];
          const y = stringY(active, string);
          return <g key={endpoint} className={styles.strumHandle}>
            <line x1={activeX} x2={knobX} y1={y} y2={y} />
            <circle cx={knobX} cy={y} r={4} data-strum-handle={endpoint} data-strum-id={activeId}
              data-strum-type={active.type} data-strum-string={string} data-strum-preview={validPreview?.endpoint === endpoint || undefined} />
          </g>;
        })}
      </g>
    ),
  };
}

function TraversalStem({ id, type, stem, selected, active, preview }: {
  id: string;
  type: StrumRangeTechniqueType;
  stem: NonNullable<TraversalGeometry["stem"]>;
  selected: boolean;
  active: boolean;
  preview: boolean;
}) {
  const { color, extraWidth } = preview ? traversalPreviewHighlight : getStrumHighlight(active);
  const points = { x1: stem.stemX, x2: stem.stemX, y1: stem.stemY1, y2: stem.stemY2 };
  return <>
    {(selected || preview) && <line {...points} pointerEvents="none" data-strum-id={id} data-strum-type={type}
      data-strum-selected={selected || undefined} data-strum-active={selected && active || undefined}
      data-traversal-preview={preview || undefined}
      stroke={color} strokeWidth={LXM_DURATION_STEM_STROKE_WIDTH + extraWidth} />}
    <line {...points} data-strum-hit="stem" data-strum-id={id} data-strum-type={type} />
  </>;
}
