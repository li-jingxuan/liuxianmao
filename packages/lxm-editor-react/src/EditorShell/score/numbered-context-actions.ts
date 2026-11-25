import {
  applyScoreCommand,
  createNumberedClipboard,
  createNumberedTrackRhythmContext,
  getMeasureDurationTicks,
  LXMScoreCommandEnum,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMTrack,
  type MusicTextRange,
  type MusicTextRangeSlot,
  type NumberedClipboard,
  resolveMusicTextRange,
} from "@liuxianmao/lxm-editor";
import { formatNumberedBeatPosition } from "../numbered/numbered-editor-target";

type Unavailable = { ok: false; message: string };
const unavailable = (message: string): Unavailable => ({ ok: false, message });

/** 用领域解析后的时间顺序显示范围，即使从后向前选中或两个端点跨小节。 */
export const formatNumberedContextScope = (track: ILXMTrack, first: Pick<MusicTextRangeSlot, "measureId" | "tick">, last = first) => {
  const position = ({ measureId, tick }: typeof first) => {
    const index = track.measures.findIndex((measure) => measure.id === measureId);
    return { measure: `第 ${index + 1} 小节`, beat: formatNumberedBeatPosition(tick, track.measures[index]!.timeSignature.denominator) };
  };
  const start = position(first);
  const end = position(last);
  if (first.measureId !== last.measureId) return `${start.measure} · ${start.beat} ～ ${end.measure} · ${end.beat}`;
  return `${start.measure} · ${start.beat}${first.tick === last.tick ? "" : ` ～ ${end.beat}`}`;
};

type PasteCommand = Extract<ILXMScoreCommand, { type: "numbered.range.paste" }>;
type ClearCommand = Extract<ILXMScoreCommand, { type: LXMScoreCommandEnum.ReplaceMusicTextRange }>;

/** 影响提示只是中间结果。预检确认后的候选仍须通过语义校验，才允许进入确认弹窗。 */
const previewNumberedChange = (document: ILXMDocument, command: PasteCommand | ClearCommand) => {
  const preview = applyScoreCommand(document, command);
  if (preview.ok || preview.code !== "NUMBERED_IMPACT_REQUIRED") return { result: preview, impacts: false };
  const result = applyScoreCommand(document, {
    ...command, expectedRevision: document.documentRevision,
    confirmedRemovedMarkIds: preview.removedMarkIds ?? [], confirmedChangedMarkIds: preview.changedMarkIds ?? [],
  });
  return { result, impacts: true };
};

export function resolveNumberedContextActions(document: ILXMDocument, range: MusicTextRange, clipboard: NumberedClipboard | null) {
  const resolved = resolveMusicTextRange(document, range);
  if (!resolved.ok) return resolved;
  const { slots } = resolved;
  const first = slots[0]!, last = slots.at(-1)!;
  const track = document.score.tracks.find((item) => item.id === range.trackId)!;
  const measure = track.measures.find((item) => item.id === first.measureId)!;
  const scope = formatNumberedContextScope(track, first, last);
  const copy = () => {
    if (first.measureId !== last.measureId) return unavailable("请选择同一小节内的简谱内容。");
    const candidate = createNumberedClipboard(document, {
      trackId: range.trackId, measureId: first.measureId, startTick: first.tick, endTick: last.endTick,
    });
    if (!candidate.ok) return candidate;
    if (!candidate.clipboard.voice.events.some((event) => event.kind !== "gap")) return unavailable("所选范围没有可复制的简谱内容。");
    // 空槽和实际时值由剪贴板窗口及声部保留，歌词只属于来源曲谱。
    return { ok: true as const, clipboard: { ...candidate.clipboard, lyrics: [] } };
  };
  const paste = (): Unavailable | { ok: true; command: PasteCommand; overwriteScope?: string } => {
    if (!clipboard) return unavailable("请先复制一段简谱。");
    if (first.measureId !== last.measureId) return unavailable("请选择同一小节内的粘贴位置或范围。");
    const endTick = first.tick + clipboard.totalTicks;
    // 单点按小节容量写入；多点只使用从最早位置起的剪贴板时长，保留其余选区。
    if (slots.length > 1 && endTick > last.endTick)
      return unavailable("剪贴板内容超出当前选区，请扩大选区或选择一个位置。");
    const command: PasteCommand = {
      type: "numbered.range.paste", trackId: range.trackId, measureId: first.measureId, startTick: first.tick,
      mode: "overwrite", allowOverwrite: true, clipboard, numberedOnly: true,
    };
    const { result, impacts } = previewNumberedChange(document, command);
    if (!result.ok) return result;
    // 使用目标声部的实际时值检测覆盖，连音组的空成员也参与结构保护。
    const context = createNumberedTrackRhythmContext(track);
    const overwrites = measure.numberedVoice.events.some((event) => {
      const duration = context.getEventDurationTicks(event);
      return duration.ok && event.tick < endTick && event.tick + duration.ticks > first.tick &&
        (event.kind !== "gap" || context.tupletByEventId.has(event.id));
    });
    // 终点用实际写入的半开区间边界，覆盖提示可区分只写半拍和写到小节末尾。
    const end = endTick === getMeasureDurationTicks(measure) ? "小节末尾" : `${formatNumberedBeatPosition(endTick, measure.timeSignature.denominator)}前`;
    const overwriteScope = overwrites || impacts
      ? `${formatNumberedContextScope(track, first)}起，至${end}`
      : undefined;
    return { ok: true, command, overwriteScope };
  };
  const clear = (): Unavailable | { ok: true; command: ClearCommand } => {
    const command: ClearCommand = { type: LXMScoreCommandEnum.ReplaceMusicTextRange, range, text: "", preserveNumberedRow: true };
    // 和范围编辑器清空使用同一命令，空输入会保留已有事件的 ID、时值和歌词锚点。
    const { result } = previewNumberedChange(document, command);
    if (!result.ok) return result;
    if (!result.changed) return unavailable("所选范围已经是空位。");
    return { ok: true, command };
  };
  return { ok: true as const, scope, copy: copy(), paste: paste(), clear: clear() };
}
