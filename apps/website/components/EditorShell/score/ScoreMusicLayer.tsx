import { memo } from "react";
import type { ScorePrimitive, ScoreScene } from "@liuxianmao/lxm-editor";

/** SVG 与 Canvas 消费同一显式图元，焦点仅在编辑 SVG 中改变颜色。 */
export const SceneItems = ({
  items,
  selectedTechniqueId,
  selectedNumberedMarkId,
  selectedNumberedEventId,
}: {
  items: ScorePrimitive[];
  selectedTechniqueId?: string | null;
  selectedNumberedMarkId?: string | null;
  selectedNumberedEventId?: string | null;
}) => (
  <>
    {items.map((p, index) => {
      const selected =
        (!!p.techniqueId && p.techniqueId === selectedTechniqueId) ||
        (!!p.numberedMarkId && p.numberedMarkId === selectedNumberedMarkId) ||
        (!!p.numberedEventId && p.numberedEventId === selectedNumberedEventId);
      const style = {
        "data-numbered-mark": p.numberedMarkId,
        "data-numbered-event": p.numberedEventId,
        fill: selected && p.fill && p.fill !== "none" ? "#2864e3" : p.fill,
        stroke:
          selected && p.stroke && p.stroke !== "#fff" ? "#2864e3" : p.stroke,
        strokeWidth: p.strokeWidth,
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
}: {
  scene: ScoreScene;
  selectedTechniqueId?: string | null;
  selectedNumberedMarkId?: string | null;
  selectedNumberedEventId?: string | null;
}) {
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
          />
        </g>
      ))}
    </g>
  );
});
