import type { ILXMLayout } from "@liuxianmao/lxm-editor";
import type { resolveParagraphFocus } from "./music-text-focus";
import styles from "./index.module.scss";

type ParagraphFocus = NonNullable<ReturnType<typeof resolveParagraphFocus>>;

/** 窄拍位仅提示录入位置；最小编辑宽度由核心焦点计算统一提供。 */
const PLACEHOLDER_BOX_MIN_WIDTH = 24;
const PLACEHOLDER_INSET = 2;
const PLACEHOLDER_MARK_HEIGHT = 10;

/** 只绘制临时提示，不扩展核心单元格，也不参与指针命中或图片导出。 */
export const MusicTextEditingHints = ({
  layout,
  activeFocus,
  hoverFocus,
}: {
  layout: ILXMLayout;
  activeFocus: ParagraphFocus | null;
  hoverFocus: ParagraphFocus | null;
}) => (
  <g className={styles.musicTextEditingHints} pointerEvents="none">
    {layout.systems.flatMap((system) => {
      const beatX = new Map(
        system.measures.flatMap((measure) =>
          measure.beats.map((beat) => [beat.id, beat.x] as const),
        ),
      );
      return (system.musicTextCells ?? [])
        .filter((cell) => cell.empty)
        .map((cell) => {
          const width = Math.max(0, cell.width - PLACEHOLDER_INSET * 2);
          // 展开的定位框附近降低空占位对比度，防止密集拍点出现多重边框。
          const nearFocus = [activeFocus, hoverFocus].some(
            (focus) =>
              focus &&
              focus.kind === cell.kind &&
              focus.x < cell.x + cell.width &&
              focus.x + focus.width > cell.x &&
              focus.y < cell.y + cell.height &&
              focus.y + focus.height > cell.y,
          );
          const props = {
            "data-paragraph-cell": `${cell.kind}/${cell.measureId}/${cell.beatId}/${cell.verse ?? ""}`,
            className: styles.musicTextPlaceholder,
            opacity: nearFocus ? 0.15 : 1,
          };
          const key = props["data-paragraph-cell"];
          if (width < PLACEHOLDER_BOX_MIN_WIDTH) {
            // 中点划分的单元格可能不对称，短标记必须落在真实音符锚点上。
            const x = beatX.get(cell.beatId)!;
            const middleY = cell.y + cell.height / 2;
            const halfHeight =
              Math.min(PLACEHOLDER_MARK_HEIGHT, cell.height) / 2;
            return (
              <line
                key={key}
                {...props}
                data-paragraph-placeholder="marker"
                x1={x}
                x2={x}
                y1={middleY - halfHeight}
                y2={middleY + halfHeight}
                strokeLinecap="round"
              />
            );
          }
          return (
            <rect
              key={key}
              {...props}
              data-paragraph-placeholder="box"
              x={cell.x + PLACEHOLDER_INSET}
              y={cell.y}
              width={width}
              height={cell.height}
              strokeDasharray="3 3"
              rx={3}
            />
          );
        });
    })}
    {layout.systems.flatMap((system) =>
      system.measures.flatMap((measure) =>
        (measure.numberedInputSlots ?? []).map((slot) => {
          const nearFocus = [activeFocus, hoverFocus].some(
            (f) =>
              f?.kind === "numbered" &&
              f.x < slot.x + slot.width &&
              f.x + f.width > slot.x &&
              f.y < slot.y + slot.height &&
              f.y + f.height > slot.y,
          );
          const props = {
            "data-paragraph-cell": `numbered/${slot.key}`,
            className: styles.musicTextPlaceholder,
            opacity: nearFocus ? 0.15 : 1,
          };
          // 窄简谱时间槽沿用歌词短标记，中心始终落在真实可录入起点。
          return slot.width < PLACEHOLDER_BOX_MIN_WIDTH ? (
            <line
              key={slot.key}
              {...props}
              data-paragraph-placeholder="marker"
              x1={slot.anchorX}
              x2={slot.anchorX}
              y1={slot.y + slot.height / 2 - 5}
              y2={slot.y + slot.height / 2 + 5}
              strokeLinecap="round"
            />
          ) : (
            <rect
              key={slot.key}
              {...props}
              data-paragraph-placeholder="box"
              x={slot.x}
              y={slot.y}
              width={slot.width}
              height={slot.height}
              strokeDasharray="3 3"
              rx={3}
            />
          );
        }),
      ),
    )}
    {hoverFocus && (
      <rect
        data-paragraph-hover={hoverFocus.kind}
        className={styles.musicTextHover}
        x={hoverFocus.x}
        y={hoverFocus.y}
        width={hoverFocus.width}
        height={hoverFocus.height}
        rx={3}
      />
    )}
  </g>
);
