/**
 * 单小节拍号修改与容量协调模块。
 *
 * 拍号不是一段可以孤立修改的显示文字：它决定小节应精确覆盖多少 tick。若只把
 * 4/4 改成 3/4 而保留原来的四拍时间轴，文档会立即违反语义校验。这个深 Module
 * 把“拍号值变化”和“Beat 时间轴恢复合法”封装成一个纯规划动作，页面与 Store
 * 都不需要理解休止符分解或真实内容保护规则。
 */
import { createMeasureRestBeats, createRestBeats } from "./rest-beats";
import { calculateRhythmTicks, getMeasureCapacityTicks } from "./rhythm";
import type { ILXMBeat, ILXMMeasure, ILXMTimeSignature } from "./types";

export type MeasureTimeSignatureChangeErrorCode =
  | "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE"
  | "CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE"
  | "RHYTHM_NOT_REPRESENTABLE";

export type MeasureTimeSignatureChangeResult =
  | { ok: true; measure: ILXMMeasure }
  | { ok: false; code: MeasureTimeSignatureChangeErrorCode };

/**
 * 尾部连续休止承担“填满剩余容量”的结构职责，因此可以整体替换。
 *
 * 中间休止不能跨越：例如“音符、休止、音符、尾部休止”中的中间休止属于用户已经
 * 编排的节奏前缀。只有从数组末尾连续向前遇到的 rest 才是容量缓冲。
 */
const findFirstTrailingRestIndex = (beats: ILXMBeat[]): number => {
  let index = beats.length;
  while (index > 0 && beats[index - 1]?.kind === "rest") index -= 1;
  return index;
};

/**
 * 从 rhythm 重新计算固定前缀长度，不信任旧 tick 的偶然值。
 *
 * 正常文档的旧 tick 已通过语义校验；仍以 rhythm 累加，是为了让本模块只有一个
 * 时间来源，也避免未来调用方传入候选 measure 时把旧偏移继续传播。
 */
const sumBeatDurationTicks = (beats: ILXMBeat[]): number | null => {
  let total = 0;
  for (const beat of beats) {
    const duration = calculateRhythmTicks(beat.rhythm);
    if (!duration.ok) return null;
    total += duration.ticks;
  }
  return total;
};

/** 重新从 0 累计 tick；未发生位置变化的 Beat 继续保留原对象引用。 */
const reflowBeatTicks = (beats: ILXMBeat[]): ILXMBeat[] | null => {
  let tick = 0;
  const result: ILXMBeat[] = [];
  for (const beat of beats) {
    const duration = calculateRhythmTicks(beat.rhythm);
    if (!duration.ok) return null;
    result.push(beat.tick === tick ? beat : { ...beat, tick });
    tick += duration.ticks;
  }
  return result;
};

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

  // 和弦标记属于明确的音乐内容。缩容后若落在小节之外，不能静默移动或删除。
  if (
    measure.chordSymbols.some(
      (symbol) => symbol.tick < 0 || symbol.tick >= capacityTicks,
    )
  )
    return { ok: false, code: "CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE" };

  const isAllRest = measure.beats.every((beat) => beat.kind === "rest");
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

  const firstTrailingRestIndex = findFirstTrailingRestIndex(measure.beats);
  const fixedPrefix = measure.beats.slice(0, firstTrailingRestIndex);
  const fixedEndTick = sumBeatDurationTicks(fixedPrefix);
  if (fixedEndTick === null)
    return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
  if (fixedEndTick > capacityTicks)
    return {
      ok: false,
      code: "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE",
    };

  const reflowedPrefix = reflowBeatTicks(fixedPrefix);
  if (!reflowedPrefix) return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };

  const trailingRests = createRestBeats(
    fixedEndTick,
    capacityTicks - fixedEndTick,
    createBeatId,
  );
  if (!trailingRests) return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };

  return {
    ok: true,
    measure: {
      ...measure,
      timeSignature: { ...timeSignature },
      beats: [...reflowedPrefix, ...trailingRests],
    },
  };
};
