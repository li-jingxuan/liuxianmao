import {
  calculateRhythmTicks,
  createNumberedRhythmContext,
  planLyricPositions,
  planNumberedInputRanges,
  type ILXMDocument,
  type ILXMNumberedVoiceCommand,
  type ILXMTrack,
  type LyricSequenceTarget,
  type NumberedCandidate,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";

/** 以已消费范围的右边界为起点，只在同轨向后搜索，谱尾无需回绕或新建小节。 */
function findFollowingSlot<T>(
  track: ILXMTrack,
  measureId: string,
  endTick: number,
  find: (measure: ILXMTrack["measures"][number], minTick: number) => T | undefined,
) {
  const start = track.measures.findIndex((measure) => measure.id === measureId);
  if (start < 0) return;
  for (const [offset, measure] of track.measures.slice(start).entries()) {
    const slot = find(measure, offset === 0 ? endTick : 0);
    if (slot !== undefined) return { measureId: measure.id, slot };
  }
}

/** 使用已确认的规划取得实际末项时值，跳过项也消费位置。单纯清除、跳过或修改属性不触发前进。 */
export function nextNumberedTextInput(
  before: ILXMTrack,
  after: ILXMTrack,
  command: ILXMNumberedVoiceCommand,
  candidate: Extract<NumberedCandidate, { ok: true }>,
): MusicTextTarget | undefined {
  let boundary: { measureId: string; endTick: number } | undefined;
  if (command.type === "numbered.sequence.overwrite" || command.type === "numbered.sequence.set") {
    boundary = candidate.sequenceTargets?.at(-1);
    if (!candidate.sequenceTargets?.some((target) => target.item.kind === "set" && target.item.tokens.length > 0 &&
      changedNumberedTokens(before, target.measureId, target.startTick, target.item.tokens))) return;
  } else if (command.type === "numbered.range.replace" || command.type === "numbered.sequence.insert") {
    let tick = command.startTick;
    let wroteText = false;
    const savedEvents = after.measures.find((measure) => measure.id === command.measureId)?.numberedVoice.events;
    for (const [index, item] of command.items.entries()) {
      if (item.kind === "set" && item.tokens.length && changedNumberedTokens(before, command.measureId, tick, item.tokens)) wroteText = true;
      // 延音录入固定占拍号分母单位，前进按实际已保存的时值，避免使用被覆盖的模板值。
      const continuation = item.kind === "set" && item.tokens[0] === "-"
        ? savedEvents?.find((event) => event.tick === tick && event.kind === "continuation")
        : undefined;
      const duration = calculateRhythmTicks(continuation?.rhythm ?? command.rhythms[index]!);
      if (!duration.ok) return;
      const ratio = command.type === "numbered.range.replace" && command.ratio;
      tick += ratio ? duration.ticks * ratio.normal / ratio.actual : duration.ticks;
    }
    if (!wroteText) return;
    boundary = { measureId: command.measureId, endTick: tick };
  } else if (command.type === "numbered.event.set" || command.type === "numbered.event.setRhythm") {
    if (!command.tokens?.length || (command.type === "numbered.event.set" && command.itemId)) return;
    const measure = after.measures.find((item) => item.id === command.measureId);
    const event = measure?.numberedVoice.events.find((item) => item.id === command.eventId);
    if (!event || !measure || !changedNumberedTokens(before, command.measureId, event.tick, command.tokens)) return;
    const duration = createNumberedRhythmContext(measure.numberedVoice).getEventDurationTicks(event);
    if (duration.ok) boundary = { measureId: command.measureId, endTick: event.tick + duration.ticks };
  }
  if (!boundary) return;
  // 提交可能拆分虚拟空位。按保存后的真实空位重新规划，既支持已有 gap，也支持虚拟时间窗。
  const next = findFollowingSlot(after, boundary.measureId, boundary.endTick, (measure, minTick) =>
    planNumberedInputRanges(measure).find((slot) => slot.startTick >= minTick));
  if (next) return { kind: "numbered", trackId: after.id, measureId: next.measureId, ...(next.slot.eventId
    ? { eventId: next.slot.eventId }
    : { tick: next.slot.startTick, endTick: next.slot.endTick }) };
}

function changedNumberedTokens(track: ILXMTrack, measureId: string, tick: number, tokens: string[]) {
  const previous = track.measures.find((measure) => measure.id === measureId)?.numberedVoice.events.find((event) => event.tick === tick)?.items;
  return previous?.length !== tokens.length || tokens.some((token, index) => token !== previous[index]?.token);
}

/** 同一简谱事件在其他歌词段已有文字时，当前段仍可使用该空位。 */
export function nextLyricTextInput(document: ILXMDocument, last: LyricSequenceTarget, endTick: number): MusicTextTarget | undefined {
  const track = document.score.tracks.find((item) => item.id === last.trackId);
  if (!track) return;
  const next = findFollowingSlot(track, last.measureId, endTick, (measure, minTick) =>
    planLyricPositions(measure).find((position) => position.tick >= minTick &&
      !measure.lyrics.some((lyric) => lyric.eventId === position.eventId && lyric.verse === last.verse)));
  if (next) return { kind: "lyric", trackId: track.id, measureId: next.measureId, verse: last.verse, ...(next.slot.eventId
    ? { eventId: next.slot.eventId }
    : { tick: next.slot.tick, endTick: next.slot.endTick }) };
}
