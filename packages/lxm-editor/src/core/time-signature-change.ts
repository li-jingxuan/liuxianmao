import { createMeasureRhythmContext } from "./tuplet";
/**
 * 单小节拍号修改与容量协调模块。
 *
 * 拍号不是一段可以孤立修改的显示文字：它决定小节应精确覆盖多少 tick。若只把
 * 4/4 改成 3/4 而保留原来的四拍时间轴，文档会立即违反语义校验。这个深 Module
 * 把“拍号值变化”和“Beat 时间轴恢复合法”封装成一个纯规划动作，页面与 Store
 * 都不需要理解休止符分解或真实内容保护规则。
 */
import { collectMusicTextBeatIds } from "./music-text";
import { getFixedPrefixLength } from "./measure-timeline";
import { createMeasureRestBeats } from "./rest-beats";
import { getMeasureCapacityTicks } from "./rhythm";
import type { ILXMMeasure, ILXMTimeSignature } from "./types";

export type MeasureTimeSignatureChangeErrorCode =
  | "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE"
  | "CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE"
  | "MUSIC_TEXT_BLOCKS_TIME_SIGNATURE"
  | "RHYTHM_NOT_REPRESENTABLE";

export type MeasureTimeSignatureChangeResult =
  | { ok: true; measure: ILXMMeasure }
  | { ok: false; code: MeasureTimeSignatureChangeErrorCode };

import { reconcileMeasureTimeline } from "./measure-timeline";

/**
 * 将一个小节安全地改为新拍号。
 *
 * 成功时只生成新的 measure 与被替换的尾部 rest，真实 Beat、Note、和弦、小节线
 * 和稳定 ID 均保持不变。失败时不暴露任何部分结果；createBeatId 即使在文档级
 * 多小节规划中被调用，也来自一次性的局部 ID factory，整个命令失败后不会写回。
 */
export const changeMeasureTimeSignature = (
  measure: ILXMMeasure,
  timeSignature: ILXMTimeSignature,
  createBeatId: () => string,
): MeasureTimeSignatureChangeResult => {
  const capacityTicks = getMeasureCapacityTicks(timeSignature);

  const isAllRest =
    measure.tuplets.length === 0 &&
    collectMusicTextBeatIds(measure).size === 0 &&
    measure.beats.every((beat) => beat.kind === "rest");
  if (isAllRest) {
    // 空白小节按拍号的单位拍重新拼写：3/4 得到三个四分休止，6/8 得到六个八分
    // 休止，而不是仅按总容量贪心生成一个较长休止符。
    const rests = createMeasureRestBeats(timeSignature, createBeatId);
    return rests
      ? {
          ok: true,
          measure: {
            ...measure,
            timeSignature: { ...timeSignature },
            beats: rests,
          },
        }
      : { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
  }

  const result = reconcileMeasureTimeline(
    { ...measure, timeSignature: { ...timeSignature } },
    { createBeatId },
  );
  if (!result.ok) {
    // 区分真正内容超容与文本锚点阻挡，不自动删除文本来容纳新拍号。
    const ordinary = { ...measure, lyrics: [], chordSymbols: [] };
    const prefix = getFixedPrefixLength(ordinary);
    const context = createMeasureRhythmContext(ordinary);
    const ordinaryTicks = ordinary.beats
      .slice(0, prefix)
      .reduce((sum, beat) => {
        const duration = context.getBeatDurationTicks(beat);
        return sum + (duration.ok ? duration.ticks : Infinity);
      }, 0);
    return {
      ok: false,
      code:
        result.code === "MEASURE_OVERFLOW"
          ? collectMusicTextBeatIds(measure).size > 0 &&
            ordinaryTicks <= capacityTicks
            ? "MUSIC_TEXT_BLOCKS_TIME_SIGNATURE"
            : "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE"
          : result.code,
    };
  }
  return result;
};
