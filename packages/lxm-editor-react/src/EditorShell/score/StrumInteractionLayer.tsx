import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent } from "react";
import { getArpeggioWavePath, getTraversalEndpointBounds, hitTestTechniqueTarget, LXM_DURATION_STEM_STROKE_WIDTH } from "@liuxianmao/lxm-editor";
import type { ILXMLayout, LXMTraversalEndpoint, ScorePrimitive } from "@liuxianmao/lxm-editor";
import styles from "./score-interaction.module.scss";

export type StrumEndpoint = LXMTraversalEndpoint;
export type StrumRangeTechniqueType = "strum" | "arpeggio";
export interface StrumEndpointPreview {
  endpoint: StrumEndpoint;
  string: number;
}

export interface ScoreStrumInteraction {
  layout: ILXMLayout;
  selectedRanges: readonly { id: string; minString: number; maxString: number }[];
  /** Alt 框选临时命中的 ID 只用于高亮，松手提交前与正式选区各自维护。 */
  previewIds?: readonly string[];
  activeId: string | null;
  onSelect: (techniqueId: string, toggle: boolean) => void;
  onCommit: (endpoint: StrumEndpoint, string: number) => void;
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
  activeId: string | null;
  endpoint: StrumEndpoint;
  pointerId: number;
  offset: number;
  min: number;
  max: number;
  selectedRanges: ScoreStrumInteraction["selectedRanges"];
  traversal: TraversalGeometry;
  capture: SVGGElement;
  preview: StrumEndpointPreview | null;
  onPreview: ScoreStrumInteraction["onPreview"];
}

function getPreview(drag: Drag, y: number): StrumEndpointPreview | null {
  const target = y - drag.offset;
  const [first, second] = drag.traversal.strings;
  if (!first || !second) return null;
  // 六线谱弦距固定。先算未吸附的弦号，拖过最外弦也能与单纯点按外侧手柄区分开。
  const nearest = first.index + Math.round((target - first.y1) / (second.y1 - first.y1));
  const previous = drag.traversal.range[drag.endpoint];
  // 点按手柄或拖回起拖记号的原弦位时，保留整组原有端点。若越界后的吸附位置碰巧等于起点，
  // 仍可能需要对齐组内其他记号，此时必须显示并提交同一个目标弦号。
  if (nearest === previous) return null;
  const string = Math.max(drag.min, Math.min(drag.max, nearest));
  return drag.selectedRanges.some((range) => range[drag.endpoint] !== string) ? { endpoint: drag.endpoint, string } : null;
}

export function useScoreStrumInteraction(interaction?: ScoreStrumInteraction) {
  const geometry = useMemo(() => indexTraversalGeometry(interaction?.layout), [interaction?.layout]);
  const selected = useMemo(() => new Set(interaction?.selectedRanges.map(({ id }) => id)), [interaction?.selectedRanges]);
  const selectedGeometry = useMemo(() => {
    const xBySystem = new Map<number, number[]>();
    for (const { systemIndex, start } of geometry.values()) {
      const positions = xBySystem.get(systemIndex) ?? [];
      positions.push(start.x);
      xBySystem.set(systemIndex, positions);
    }
    // 手柄尽量伸向较空的一侧。邻居只比较同谱行，拖动预览只更新纵坐标。
    return [...geometry].filter(([id]) => selected.has(id)).map(([id, traversal]) => {
      const x = traversal.start.x;
      const neighbors = xBySystem.get(traversal.systemIndex)!;
      const closestRight = Math.min(...neighbors.filter((position) => position > x).map((position) => position - x));
      const closestLeft = Math.min(...neighbors.filter((position) => position < x).map((position) => x - position));
      const knobX = x + (closestRight < 20 && closestRight < closestLeft ? -8 : 8);
      return { id, traversal, knobX };
    });
  }, [geometry, selected]);
  const previewIds = useMemo(() => new Set(interaction?.previewIds), [interaction?.previewIds]);
  const dragRef = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<{ drag: Drag; preview: StrumEndpointPreview | null } | null>(null);
  const activeId = interaction?.activeId;

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
    const traversal = geometry.get(id);
    if (!selected.has(id) || !traversal || !point) return;
    // 起拖记号只负责把指针坐标换算为弦号。共同边界取所有正式选中记号的对端，包含跨行和两种方向。
    const { selectedRanges } = interaction;
    const { min, max } = getTraversalEndpointBounds(selectedRanges, endpoint, traversal.strings.length);
    const capture = event.currentTarget;
    capture.setPointerCapture(event.pointerId);
    const drag: Drag = {
      layout: interaction.layout,
      selectedIds: selected,
      activeId: interaction.activeId,
      endpoint,
      pointerId: event.pointerId,
      offset: point.y - stringY(traversal, traversal.range[endpoint]),
      min,
      max,
      selectedRanges,
      traversal,
      capture,
      preview: null,
      onPreview: interaction.onPreview,
    };
    dragRef.current = drag;
    setDraft({ drag, preview: null });
    svg?.focus({ preventScroll: true });
  };

  const onHandleKeyDown = (event: ReactKeyboardEvent<SVGCircleElement>, traversal: TraversalGeometry, endpoint: StrumEndpoint) => {
    if (!interaction || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    if (dragRef.current) return;
    // 键盘以当前聚焦的手柄为起点，调整的仍是整组的谱面同一端。
    const { min, max } = getTraversalEndpointBounds(interaction.selectedRanges, endpoint, traversal.strings.length);
    const requested = traversal.range[endpoint] + (event.key === "ArrowUp" ? -1 : 1);
    const string = Math.max(min, Math.min(max, requested));
    if (interaction.selectedRanges.some((range) => range[endpoint] !== string)) interaction.onCommit(endpoint, string);
  };

  const validPreview = draft && isCurrent(draft.drag) ? draft.preview : null;
  // 每个受影响小节显示一条吸附线，同小节的多个记号共用同一根线，跨谱行按各自坐标绘制。
  const snapLines = new Set(validPreview ? selectedGeometry.flatMap(({ traversal }) =>
    traversal.strings.filter((line) => line.index === validPreview.string)) : []);

  return {
    selected,
    previewIds,
    activeId,
    geometry,
    previewPrimitive: (primitive: ScorePrimitive) => {
      if (!validPreview || !primitive.techniqueId || !selected.has(primitive.techniqueId)) return primitive;
      const traversal = geometry.get(primitive.techniqueId);
      return traversal ? previewArrow(primitive, traversal, validPreview) : primitive;
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
        {[...snapLines].map((line) => <line key={`${line.x1}:${line.y1}`} className={styles.strumSnapLine} data-strum-snap-line
          x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y1} />)}
        {selectedGeometry.map(({ id, traversal, knobX }) => {
          const x = traversal.start.x;
          return <g key={id}>
            {endpoints.map((endpoint) => {
              const previewing = validPreview?.endpoint === endpoint;
              const string = previewing ? validPreview.string : traversal.range[endpoint];
              const y = stringY(traversal, string);
              const { min, max } = getTraversalEndpointBounds(interaction.selectedRanges, endpoint, traversal.strings.length);
              return <g key={endpoint} className={styles.strumHandle}>
                <line x1={x} x2={knobX} y1={y} y2={y} />
                <circle cx={knobX} cy={y} r={4} data-strum-handle={endpoint} data-strum-id={id}
                  data-strum-type={traversal.type} data-strum-string={string} data-strum-preview={previewing || undefined}
                  tabIndex={0} role="slider" aria-orientation="vertical" aria-label={`${traversal.type === "strum" ? "扫弦" : "琶音"}${endpoint === "minString" ? "上端弦" : "下端弦"}`}
                  aria-valuemin={Math.min(min, string)} aria-valuemax={Math.max(max, string)} aria-valuenow={string}
                  onKeyDown={(event) => onHandleKeyDown(event, traversal, endpoint)} />
              </g>;
            })}
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
