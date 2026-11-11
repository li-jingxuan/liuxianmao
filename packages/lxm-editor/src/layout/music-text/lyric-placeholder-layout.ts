import {
  MUSIC_TEXT_PLACEHOLDER_WIDTH,
  type MusicTextRect,
} from "./music-text-metrics";

/** 显示框以音符为中心，命中单元格仍保留完整范围；窄格由渲染层画短标记。 */
export const layoutLyricPlaceholder = (
  cell: MusicTextRect,
  anchorX: number,
): MusicTextRect => {
  const available =
    2 * Math.min(anchorX - cell.x, cell.x + cell.width - anchorX);
  const width = Math.min(
    MUSIC_TEXT_PLACEHOLDER_WIDTH,
    Math.max(0, available - 4),
  );
  return { x: anchorX - width / 2, y: cell.y, width, height: cell.height };
};
