import { memo } from "react";
import type { ILXMLayout } from "@liuxianmao/lxm-editor";

interface JumpMarkInteractionLayerProps {
  layout: ILXMLayout;
  draftMeasureId?: string;
  activeMarkId?: string;
  onEditMark?: (measureId: string, markId: string) => void;
}

/** 编辑层使用共享布局的命中框，移动草稿只描边，不更改谱面或试听所见的已应用记号。 */
export const JumpMarkInteractionLayer = memo(function JumpMarkInteractionLayer({
  layout, draftMeasureId, activeMarkId, onEditMark,
}: JumpMarkInteractionLayerProps) {
  if (!draftMeasureId && !onEditMark) return null;
  return (
    <g data-layer="jump-mark-interaction" pointerEvents="none">
      <style>{`
        [data-layer="jump-mark-interaction"] [data-jump-mark-target]:hover,
        [data-layer="jump-mark-interaction"] [data-jump-mark-target]:focus-visible,
        [data-layer="jump-mark-interaction"] [data-jump-mark-target][data-active="true"] {
          stroke: #a9c7f1;
        }
      `}</style>
      {layout.systems.flatMap((system) => system.measures.map((measure) => {
        const isDraft = measure.id === draftMeasureId;
        const marks = onEditMark ? measure.jumpMarks : undefined;
        if (!isDraft && !marks?.length) return null;
        return <g key={measure.id}>
          {isDraft && (
            <rect
              data-jump-mark-draft={measure.id}
              x={measure.x + 0.5}
              y={system.y + 0.5}
              width={Math.max(0, measure.width - 1)}
              height={Math.max(0, system.height - 1)}
              fill="none"
              stroke="#739acc"
              strokeDasharray="4 3"
              aria-hidden="true"
            />
          )}
          {onEditMark && marks?.map((mark) => (
            <rect
              key={mark.id}
              {...mark.bounds}
              rx={4}
              data-jump-mark-target={mark.id}
              data-measure-id={measure.id}
              data-active={mark.id === activeMarkId ? "true" : undefined}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: "pointer" }}
              tabIndex={0}
              role="button"
              aria-label={`编辑第 ${measure.index + 1} 小节的 ${mark.label} 记号`}
              onPointerDown={(event) => {
                // 左键留给记号按钮，右键仍可触发谱面的上下文菜单。
                if (event.button === 0) event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onEditMark(measure.id, mark.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) onEditMark(measure.id, mark.id);
              }}
            />
          ))}
        </g>;
      }))}
    </g>
  );
});
