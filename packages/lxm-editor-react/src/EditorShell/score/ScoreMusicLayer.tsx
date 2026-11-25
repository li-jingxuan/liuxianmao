import { memo } from "react";
import type { ScorePrimitive, ScoreScene } from "@liuxianmao/lxm-editor";
import { getStrumHighlight, traversalPreviewHighlight, useScoreStrumInteraction } from "./StrumInteractionLayer";
import type { ScoreStrumInteraction } from "./StrumInteractionLayer";

/** SVG 与 Canvas 消费同一显式图元，焦点仅在编辑 SVG 中改变颜色。 */
export const SceneItems = ({
  items,
  selectedTechniqueId,
  selectedNumberedMarkId,
  selectedNumberedEventId,
  strums,
}: {
  items: ScorePrimitive[];
  selectedTechniqueId?: string | null;
  selectedNumberedMarkId?: string | null;
  selectedNumberedEventId?: string | null;
  strums?: Pick<ReturnType<typeof useScoreStrumInteraction>, "selected" | "previewIds" | "activeId" | "geometry" | "previewPrimitive">;
}) => (
  <>
    {items.map((item, index) => {
      const p = strums?.previewPrimitive(item) ?? item;
      const traversal = p.techniqueId ? strums?.geometry.get(p.techniqueId) : undefined;
      const strumId = traversal ? p.techniqueId : undefined;
      const strumSelected = !!strumId && strums?.selected.has(strumId);
      const strumActive = strumSelected && strumId === strums?.activeId;
      const traversalSelected = !!p.techniqueId && strums?.selected.has(p.techniqueId);
      const selected =
        traversalSelected ||
        (!!p.techniqueId && p.techniqueId === selectedTechniqueId) ||
        (!!p.numberedMarkId && p.numberedMarkId === selectedNumberedMarkId) ||
        (!!p.numberedEventId && p.numberedEventId === selectedNumberedEventId);
      // Alt 框选候选沿用同一图元高亮，已有选中项保留正式高亮，不写入选中或端点预览标记。
      const traversalPreview = !!strumId && !selected && strums?.previewIds.has(strumId);
      const highlighted = selected || traversalPreview;
      const { color, extraWidth } = traversalPreview ? traversalPreviewHighlight : getStrumHighlight(strumSelected ? !!strumActive : true);
      const style = {
        "data-jump-mark": p.jumpMarkId,
        "data-measure-repeat": p.measureRepeatId,
        "data-numbered-mark": p.numberedMarkId,
        "data-numbered-event": p.numberedEventId,
        "data-strum-id": strumId,
        "data-strum-type": traversal?.type,
        "data-strum-selected": strumSelected || undefined,
        "data-strum-active": strumActive || undefined,
        "data-strum-preview": p !== item || undefined,
        "data-traversal-preview": traversalPreview || undefined,
        fill: highlighted && p.fill && p.fill !== "none" ? color : p.fill,
        stroke:
          highlighted && p.stroke && p.stroke !== "#fff" ? color : p.stroke,
        strokeWidth: (strumSelected || traversalPreview) && p.strokeWidth ? p.strokeWidth + extraWidth : p.strokeWidth,
        strokeDasharray: p.dash,
        strokeLinecap: p.lineCap,
        strokeLinejoin: "round" as const,
      };
      switch (p.kind) {
        case "line":
          return (
            <line
              key={index}
              x1={p.x1}
              y1={p.y1}
              x2={p.x2}
              y2={p.y2}
              {...style}
            />
          );
        case "circle":
          return <circle key={index} cx={p.cx} cy={p.cy} r={p.r} {...style} />;
        case "rect":
          return (
            <rect
              key={index}
              x={p.x}
              y={p.y}
              width={p.width}
              height={p.height}
              rx={p.rx}
              {...style}
            />
          );
        case "path":
          return <path key={index} d={p.d} {...style} />;
        case "polygon":
          return (
            <polygon
              key={index}
              points={p.points.map((point) => point.join(",")).join(" ")}
              {...style}
            />
          );
        case "text":
          return (
            <text
              key={index}
              x={p.x}
              y={p.y}
              fontSize={p.fontSize}
              fontFamily={p.fontFamily}
              fontWeight={p.fontWeight}
              fontStyle={p.fontStyle}
              textAnchor={p.textAnchor}
              dominantBaseline="alphabetic"
              style={{ whiteSpace: "pre", paintOrder: "stroke fill" }}
              {...style}
            >
              {p.text}
            </text>
          );
      }
    })}
  </>
);
// 悬停与面板状态不改变场景或选中身份时，跳过整谱图元的重新创建。
export const ScoreMusicLayer = memo(function ScoreMusicLayer({
  scene,
  selectedTechniqueId,
  selectedNumberedMarkId,
  selectedNumberedEventId,
  strumInteraction,
}: {
  scene: ScoreScene;
  selectedTechniqueId?: string | null;
  selectedNumberedMarkId?: string | null;
  selectedNumberedEventId?: string | null;
  strumInteraction?: ScoreStrumInteraction;
}) {
  const strums = useScoreStrumInteraction(strumInteraction);
  return (
    <g data-layer="score-music">
      <SceneItems items={scene.header} />
      {scene.systems.map((s) => (
        <g key={s.index} data-system-index={s.index}>
          <SceneItems
            items={s.items}
            selectedTechniqueId={selectedTechniqueId}
            selectedNumberedMarkId={selectedNumberedMarkId}
            selectedNumberedEventId={selectedNumberedEventId}
            strums={strums}
          />
        </g>
      ))}
      {strums.overlay}
    </g>
  );
});
