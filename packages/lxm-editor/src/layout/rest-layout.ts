/** 休止符布局：将已验证的 rest beat 转换为 SVG 可直接消费的字形与坐标。 */
import type { ILXMBeat } from "../core/types";
import type {
  ILXMBeatLayout,
  ILXMRestLayout,
  ILXMStringLineLayout,
} from "./layout-types";

/** Bravura 对应的常用 SMuFL rest glyph；附点由布局结果附加普通圆点。 */
const REST_GLYPHS: Record<ILXMBeat["rhythm"]["base"], string> = {
  whole: "\uE4E3",
  half: "\uE4E4",
  quarter: "\uE4E5",
  eighth: "\uE4E6",
  sixteenth: "\uE4E7",
  thirtySecond: "\uE4E8",
};

/**
 * 休止符放置在六线谱垂直中部，并与音符共享 beat slot 的时间锚点。
 *
 * `id` 复用 beat ID 是安全的：每个 beat 最多生成一个休止图形，且页面渲染 key
 * 在同一 measure 内稳定，不需要创建额外的持久化实体。
 */
export const layoutRests = (
  measureId: string,
  beats: ILXMBeat[],
  slotsByBeatId: Record<string, ILXMBeatLayout>,
  strings: ILXMStringLineLayout[],
): ILXMRestLayout[] => {
  const firstString = strings[0];
  const lastString = strings[strings.length - 1];
  if (!firstString || !lastString) return [];
  const centerY = (firstString.y1 + lastString.y1) / 2;
  return beats.flatMap((beat) => {
    if (beat.kind !== "rest") return [];
    const slot = slotsByBeatId[beat.id];
    if (!slot) return [];
    return [
      {
        id: beat.id,
        beatId: beat.id,
        measureId,
        rhythm: beat.rhythm,
        x: slot.x,
        y: centerY,
        // 普通圆点由字体渲染；点数已受语义校验限制为 0–2。
        glyph: `${REST_GLYPHS[beat.rhythm.base]}${".".repeat(beat.rhythm.dots)}`,
      },
    ];
  });
};
