import { memo } from "react";
import { repeatEndingPrimitives, type ILXMLayout } from "@liuxianmao/lxm-editor";

interface RepeatEndingInteractionLayerProps {
  layout: ILXMLayout;
  onEditEnding: (startMeasureId: string, endMeasureId: string, endingId: string) => void;
}

/** 任一跨行续段均指向同一房子。草稿以蓝色虚线另画，只供编辑态查看。 */
export const RepeatEndingInteractionLayer = memo(function RepeatEndingInteractionLayer({
  layout, onEditEnding,
}: RepeatEndingInteractionLayerProps) {
  return <g data-layer="repeat-ending-interaction" pointerEvents="none">
    <style>{`
      [data-repeat-ending-target]:hover,
      [data-repeat-ending-target]:focus-visible { stroke: #739acc; }
    `}</style>
    {layout.systems.map((system) => <g key={system.index}>
      {system.repeatEndingPreview?.map((segment) => <g key={segment.id} data-repeat-ending-preview aria-hidden="true">
        {repeatEndingPrimitives(segment).map((item, index) => item.kind === "line" ? (
          <line key={index} x1={item.x1} x2={item.x2} y1={item.y1} y2={item.y2} stroke="#2457d7" strokeDasharray="4 3" />
        ) : item.kind === "text" ? (
          <text key={index} x={item.x} y={item.y} fontSize={item.fontSize} fontFamily={item.fontFamily} fill="#2457d7">{item.text}</text>
        ) : null)}
      </g>)}
      {system.repeatEndings?.map((segment) => {
        const select = () => onEditEnding(segment.startMeasureId, segment.endMeasureId, segment.id);
        return <rect key={segment.id} data-repeat-ending-target={segment.id} {...segment.bounds}
          fill="transparent" pointerEvents="all" role="button" tabIndex={0}
          style={{ cursor: "pointer" }} aria-label={`编辑反复房子 ${segment.label}`}
          onPointerDown={(event) => { if (event.button === 0) event.stopPropagation(); }}
          onClick={(event) => { event.stopPropagation(); select(); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) select();
          }} />;
      })}
    </g>)}
  </g>;
});
