import type { ScorePrimitive, ScoreScene } from "./score-scene";

/** SVG 与 Canvas 消费同一显式图元，焦点仅在编辑 SVG 中改变颜色。 */
export const SceneItems = ({
  items,
  selectedTechniqueId,
}: {
  items: ScorePrimitive[];
  selectedTechniqueId?: string | null;
}) => (
  <>
    {items.map((p, index) => {
      const selected = !!p.techniqueId && p.techniqueId === selectedTechniqueId;
      const style = {
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
export const ScoreMusicLayer = ({
  scene,
  selectedTechniqueId,
}: {
  scene: ScoreScene;
  selectedTechniqueId?: string | null;
}) => (
  <g data-layer="score-music">
    <SceneItems items={scene.header} />
    {scene.systems.map((s) => (
      <g key={s.index} data-system-index={s.index}>
        <SceneItems items={s.items} selectedTechniqueId={selectedTechniqueId} />
      </g>
    ))}
  </g>
);
