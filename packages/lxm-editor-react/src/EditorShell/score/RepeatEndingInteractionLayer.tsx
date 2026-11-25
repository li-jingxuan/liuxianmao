import { memo } from "react";
import { repeatEndingPrimitives, type ILXMLayout } from "@liuxianmao/lxm-editor";

interface RepeatEndingInteractionLayerProps {
  layout: ILXMLayout;
  selectedEndingId?: string;
  onEditEnding: (startMeasureId: string, endMeasureId: string, endingId: string, trigger: SVGGElement) => void;
}

/** 反复房子跨行后各段共用稳定 ID，正式图元、选框、焦点和草稿分别绘制。 */
export const RepeatEndingInteractionLayer = memo(function RepeatEndingInteractionLayer({
  layout, selectedEndingId, onEditEnding,
}: RepeatEndingInteractionLayerProps) {
  return <g data-layer="repeat-ending-interaction" pointerEvents="none">
    <style>{`
      [data-repeat-ending-target] { outline: none; }
      [data-repeat-ending-target]:hover:not([aria-pressed="true"]) [data-repeat-ending-hit] { fill: #dde8ff50; }
      [data-repeat-ending-focus] { visibility: hidden; }
      [data-repeat-ending-target]:focus-visible [data-repeat-ending-focus] { visibility: visible; }
    `}</style>
    {layout.systems.map((system) => <g key={system.index}>
      {/* 组草稿按共享段/结尾区分色带。它只覆盖当前行实际小节范围，
          不参与命中，也不改变正式括线和导出场景。 */}
      {system.repeatEndingGroupPreview?.map((preview, index) => (
        <rect key={`group-preview:${index}`} data-repeat-ending-group-preview={preview.kind}
          {...preview.bounds} fill={preview.kind === "shared" ? "#6f9cff" : "#8fb4ff"}
          fillOpacity={0.12} pointerEvents="none" />
      ))}
      {system.repeatEndingPreview?.map((segment, index) => <g key={`preview:${segment.id}:${index}`}
        data-repeat-ending-preview aria-hidden="true">
        {repeatEndingPrimitives(segment).map((item, index) => item.kind === "line" ? (
          <line key={index} x1={item.x1} x2={item.x2} y1={item.y1} y2={item.y2} stroke="#2457d7"
            strokeWidth={item.strokeWidth} strokeDasharray="5 3" />
        ) : item.kind === "text" ? (
          <text key={index} x={item.x} y={item.y} fontSize={item.fontSize} fontFamily={item.fontFamily} fill="#2457d7">{item.text}</text>
        ) : null)}
      </g>)}
      {system.repeatEndings?.map((segment) => {
        const selected = segment.id === selectedEndingId;
        const { x, y, width, height } = segment.bounds;
        return <g key={segment.id} data-repeat-ending-target={segment.id} role="button" tabIndex={0}
          aria-pressed={selected} aria-label={`编辑反复房子 ${segment.label}`}
          onPointerDown={(event) => { if (event.button === 0) event.stopPropagation(); }}
          onClick={(event) => { event.stopPropagation(); onEditEnding(segment.startMeasureId, segment.endMeasureId, segment.id, event.currentTarget); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) onEditEnding(segment.startMeasureId, segment.endMeasureId, segment.id, event.currentTarget);
          }}>
          {/* 命中覆盖标签和括线上下的空白，并沿小节边界截断，邻接房子不会抢同一点击。 */}
          <rect data-repeat-ending-hit x={x} y={y - 5} width={width} height={height + 7} rx={2}
            fill="transparent" pointerEvents="all" style={{ cursor: "pointer" }} />
          {selected && <rect data-repeat-ending-selected x={x} y={y - 1} width={width} height={height + 1}
            rx={2} fill="none" stroke="#2457d7" strokeWidth={1} />}
          {/* 焦点框只跟随当前 Tab 停靠段，可与跨行选框同时显示。 */}
          <rect data-repeat-ending-focus x={x - 2} y={y - 4} width={width + 4} height={height + 6}
            rx={3} fill="none" stroke="#28467d" strokeWidth={1} strokeDasharray="1 2.5" strokeLinecap="round" />
        </g>;
      })}
    </g>)}
  </g>;
});
