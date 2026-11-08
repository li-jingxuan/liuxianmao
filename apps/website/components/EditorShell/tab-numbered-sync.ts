import {
  createMeasureRhythmContext,
  createNumberedRhythmContext,
  resolveTabCellSelection,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { formatNumberedBeatPosition } from "./numbered-editor-target";

export type TabNumberedSyncMode = "align" | "split";
export type TabNumberedSyncCommand = Extract<ILXMScoreCommand, {
  type: "numbered.range.alignToTab" | "beat.splitAndAlignNumbered";
}>;
export const isTabNumberedSyncCommand = (command: ILXMScoreCommand): command is TabNumberedSyncCommand =>
  command.type === "numbered.range.alignToTab" || command.type === "beat.splitAndAlignNumbered";

/** TAB 选择按 beat 去重，范围只取当前小节的有效时间，不按弦数推断。 */
export const buildTabNumberedSyncCommand = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  mode: TabNumberedSyncMode,
): { ok: true; command: TabNumberedSyncCommand } | { ok: false; message: string } => {
  const invalid = { ok: false as const, message: "请选择同一小节内连续的 TAB 拍点" };
  const resolved = selection && resolveTabCellSelection(document, selection);
  if (!resolved?.ok || !resolved.range.beats.length) return invalid;
  const { trackId } = resolved.range;
  const references = [...new Map(resolved.range.beats.map((beat) => [beat.beatId, beat])).values()];
  const measureId = references[0]!.measureId;
  if (references.some((beat) => beat.measureId !== measureId)) return invalid;
  const measure = document.score.tracks.find((track) => track.id === trackId)
    ?.measures.find((item) => item.id === measureId);
  if (!measure) return invalid;
  const ordered = [...measure.beats].sort((a, b) => a.tick - b.tick);
  const ids = new Set(references.map((beat) => beat.beatId));
  const beats = ordered.filter((beat) => ids.has(beat.id));
  if (beats.length !== ids.size || ordered.indexOf(beats.at(-1)!) - ordered.indexOf(beats[0]!) + 1 !== beats.length)
    return invalid;
  if (mode === "split" && beats.length !== 1)
    return { ok: false, message: "TAB 拆分并同步需要选择单个拍点，可同时选择多根弦。" };
  const context = createMeasureRhythmContext(measure);
  for (let index = 0; index < beats.length; index++) {
    const duration = context.getBeatDurationTicks(beats[index]!);
    if (!duration.ok || (beats[index + 1] && beats[index]!.tick + duration.ticks !== beats[index + 1]!.tick)) return invalid;
  }
  const last = beats.at(-1)!;
  const duration = context.getBeatDurationTicks(last);
  if (!duration.ok) return invalid;
  const target = { trackId, measureId, expectedRevision: document.documentRevision };
  return { ok: true, command: mode === "split"
    ? { type: "beat.splitAndAlignNumbered", ...target, beatId: beats[0]!.id }
    : { type: "numbered.range.alignToTab", ...target, startTick: beats[0]!.tick, endTick: last.tick + duration.ticks } };
};

const rhythmName = (rhythm: { base: string; dots: number }) =>
  `${rhythm.dots === 1 ? "附点" : rhythm.dots === 2 ? "双附点" : ""}${({ whole: "全音符", half: "二分音符", quarter: "四分音符", eighth: "八分音符", sixteenth: "十六分音符", thirtySecond: "三十二分音符" } as Record<string, string>)[rhythm.base]}`;

/** 只比较核心候选结果，不在 UI 重写分段算法，也不使用预览 ID 作为后续锚点。 */
export const describeTabNumberedSyncPreview = (
  before: ILXMDocument,
  after: ILXMDocument,
  command: TabNumberedSyncCommand,
) => {
  const track = before.score.tracks.find((item) => item.id === command.trackId)!;
  const updatedTrack = after.score.tracks.find((item) => item.id === command.trackId)!;
  const measureIndex = track.measures.findIndex((item) => item.id === command.measureId);
  const measure = track.measures[measureIndex]!;
  const updated = updatedTrack.measures.find((item) => item.id === command.measureId)!;
  const beat = command.type === "beat.splitAndAlignNumbered" ? measure.beats.find((item) => item.id === command.beatId)! : null;
  const duration = beat && createMeasureRhythmContext(measure).getBeatDurationTicks(beat);
  const start = command.type === "numbered.range.alignToTab" ? command.startTick : beat!.tick;
  const end = command.type === "numbered.range.alignToTab" ? command.endTick : beat!.tick + (duration && duration.ok ? duration.ticks : 0);
  const original = measure.numberedVoice.events.filter((event) => event.tick >= start && event.tick < end);
  const nextById = new Map(updated.numberedVoice.events.map((event) => [event.id, event]));
  const originalIds = new Set(measure.numberedVoice.events.map((event) => event.id));
  const oldRhythm = createNumberedRhythmContext(measure.numberedVoice);
  const nextRhythm = createNumberedRhythmContext(updated.numberedVoice);
  const shortened = original.filter((event) => {
    const next = nextById.get(event.id);
    const previousDuration = oldRhythm.getEventDurationTicks(event);
    const nextDuration = next && nextRhythm.getEventDurationTicks(next);
    return previousDuration.ok && nextDuration?.ok && nextDuration.ticks < previousDuration.ticks;
  }).length;
  const gaps = updated.numberedVoice.events.filter((event) => !originalIds.has(event.id) && event.kind === "gap");
  const retainedNotes = original.filter((event) => event.kind === "notes" && nextById.has(event.id)).length;
  const scopedIds = new Set(original.map((event) => event.id));
  const retainedLyrics = measure.lyrics.filter((lyric) => scopedIds.has(lyric.eventId) &&
    updated.lyrics.some((next) => JSON.stringify(next) === JSON.stringify(lyric))).length;
  const removedMarks = track.numberedMarks.filter((mark) => !updatedTrack.numberedMarks.some((next) => next.id === mark.id)).length;
  const changedMarks = track.numberedMarks.filter((mark) => updatedTrack.numberedMarks.some((next) => next.id === mark.id && JSON.stringify(next) !== JSON.stringify(mark))).length;
  const position = (tick: number) => formatNumberedBeatPosition(tick, measure.timeSignature.denominator);
  const rhythms = updated.numberedVoice.events.filter((event) => event.tick >= start && event.tick < end)
    .map((event) => `${position(event.tick)}：${rhythmName(event.rhythm)}${event.kind === "gap" ? "空位" : ""}`).join("；");
  return `作用范围：第 ${measureIndex + 1} 小节，${position(start)}至${position(end)}。\n` +
    `缩短 ${shortened} 个原简谱位置，新增 ${gaps.length} 个空位；保留 ${retainedNotes} 个已有音、${retainedLyrics} 处原词（包括各段歌词）。原音与原词只留在各自首段，新空位不复制音高或歌词；后续位置不移动。\n` +
    (rhythms ? `细分后简谱：${rhythms}。\n` : "此范围为真实空窗，输入位置随 TAB 节奏自动显示。\n") +
    `简谱连接记号：删除 ${removedMarks} 个，调整 ${changedMarks} 个。\n` +
    (command.type === "beat.splitAndAlignNumbered"
      ? "TAB 拍点等分，原音以延音线连接、保持原持续音；已有演奏记号随拆分位置调整。简谱只保留首段原内容，新增后半段留空，不自动建立简谱延音线。确认后两层一起提交、一次撤销。"
      : "本次按当前 TAB 边界细分简谱，确认后可一次撤销。");
};
