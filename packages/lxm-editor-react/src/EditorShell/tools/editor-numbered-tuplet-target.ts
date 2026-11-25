import { buildNumberedIndex, createNumberedTrackRhythmContext, LXM_TUPLET_RATIOS, previewNumberedTupletEdit, resolveMusicTextRange, TICKS_PER_QUARTER, type ILXMDocument, type ILXMNumberedTarget, type ILXMNumberedTupletCommand, type ILXMTrack, type ILXMTupletRatio, type MusicTextRange } from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import { numberedTargetWindow, resolveNumberedEditorTarget } from "../numbered/numbered-editor-target";

type TupletUnavailable = { ok: false; message: string };
type TupletCommandTarget = { ok: true; command: ILXMNumberedTupletCommand } | TupletUnavailable;
export type NumberedTupletTarget = {
  ok: true;
  ratios: { ratio: ILXMTupletRatio; target: TupletCommandTarget }[];
  remove: TupletCommandTarget;
  currentRatio?: ILXMTupletRatio;
} | TupletUnavailable;
type BeatTupletCommand = Extract<ILXMNumberedTupletCommand, { type: "numbered.tuplet.createInBeat" }>;
export type NumberedBeatTupletTarget = {
  ok: true;
  command: BeatTupletCommand;
  measureNumber: number;
  beatNumber: number;
  revision: number;
  slots: (string | null)[];
} | TupletUnavailable;

const unavailable = (message: string): TupletUnavailable => ({ ok: false, message });
const checkTupletCommand = (track: ILXMTrack, command: ILXMNumberedTupletCommand): TupletCommandTarget => {
  const preview = previewNumberedTupletEdit(track, command);
  return preview.ok ? { ok: true, command } : preview;
};

export const sameTupletRatio = (a: ILXMTupletRatio, b: ILXMTupletRatio | undefined) =>
  a.actual === b?.actual && a.normal === b?.normal;

/** 按稳定事件 ID 定位端点。连音改变起点后，原选区仍能定位同一组音符。 */
export const resolveNumberedTupletTarget = (
  document: ILXMDocument,
  range: MusicTextRange | null,
  active: MusicTextTarget | null,
  selection: ILXMNumberedTarget | null,
): NumberedTupletTarget => {
  const chooseNotes = unavailable("请选择时间连续、时值相同的简谱音符。");
  if (range && range.kind !== "numbered") return chooseNotes;
  const focus = range ? { ...range.focus, trackId: range.trackId }
    : active ? active.kind === "numbered" ? active : null : selection;
  if (!focus || !("eventId" in focus) || !focus.eventId) return chooseNotes;
  const { trackId, eventId } = focus;
  const track = document.score.tracks.find((track) => track.id === trackId);
  if (!track) return chooseNotes;
  // 文档按事件 ID 定位选区首尾。压缩或展开跨小节连音后，原焦点事件可能已迁移到另一小节。
  const { events } = buildNumberedIndex(track);
  const from = events.get(range?.anchor.eventId ?? eventId);
  const to = events.get(eventId);
  if (!from || !to || (range && !range.anchor.eventId)) return chooseNotes;
  const first = from.order <= to.order ? from : to;
  const endOrder = Math.max(from.order, to.order);
  const selected = [...events.values()].filter((entry) => entry.order >= first.order && entry.order <= endOrder);
  const eventIds = selected.map(({ event }) => event.id);
  const group = createNumberedTrackRhythmContext(track).tupletByEventId.get(first.event.id);
  const completeGroup = group && eventIds.every((id) => group.eventIds.includes(id)) &&
    (eventIds.length === 1 || eventIds.length === group.eventIds.length);
  const measureId = first.measureId;
  if (!completeGroup && (!LXM_TUPLET_RATIOS.some(ratio => ratio.actual === eventIds.length) ||
      selected.some(({ event }) => event.kind !== "notes"))) return chooseNotes;
  const ratios = LXM_TUPLET_RATIOS.map((ratio) => {
    // 与最终写入共享时值、容量和记号校验。用完整比例区分两个五连音选项。
    const target = completeGroup ? unavailable("已应用连音组，可在下方删除。")
      : ratio.actual !== eventIds.length ? unavailable(`需要选择 ${ratio.actual} 个音，当前选中 ${eventIds.length} 个。`)
      : checkTupletCommand(track, { type: "numbered.tuplet.add", trackId, measureId, eventIds, ratio });
    return { ratio, target };
  });
  // 同小节的有效数量可查看禁用原因（例如二连音空位不足）。跨线继续沿用仅可选中有效三连音的入口规则。
  if (!completeGroup && from.measureId !== to.measureId && !ratios.some(({ target }) => target.ok))
    return unavailable("跨小节请选择三个时间连续、时值相同的简谱音符。");
  const remove = completeGroup
    ? checkTupletCommand(track, { type: "numbered.tuplet.remove", trackId, measureId, tupletId: group.id })
    : unavailable("请选择可定位的已有连音组。");
  return { ok: true, ratios, remove, currentRatio: completeGroup ? group.ratio : undefined };
};

/** 单音定位其所在拍；连续框选必须完全落在同一拍，以免按末端误改选区外的拍位。 */
export const resolveNumberedBeatTupletTarget = (
  document: ILXMDocument,
  range: MusicTextRange | null,
  active: MusicTextTarget | null,
  selection: ILXMNumberedTarget | null,
): NumberedBeatTupletTarget => {
  const invalid = { ok: false, message: "请在简谱中选择同一拍内的音符。" } as const;
  if ((range && range.kind !== "numbered") || (active && active.kind !== "numbered")) return invalid;
  let position: { trackId: string; measureId: string; tick: number; rangeEnd?: number };
  if (range) {
    const resolved = resolveMusicTextRange(document, range);
    if (!resolved.ok) return resolved;
    const first = resolved.slots[0], last = resolved.slots.at(-1);
    if (!first || !last || first.measureId !== last.measureId) return invalid;
    position = { trackId: range.trackId, measureId: first.measureId, tick: first.tick, rangeEnd: last.endTick };
  } else {
    const target = resolveNumberedEditorTarget(document, active ?? selection);
    if (!target) return invalid;
    position = { ...target, tick: numberedTargetWindow(document, target).start };
  }

  const { trackId, measureId, tick, rangeEnd } = position;
  const track = document.score.tracks.find((item) => item.id === trackId);
  const measureNumber = (track?.measures.findIndex((item) => item.id === measureId) ?? -1) + 1;
  const measure = track?.measures[measureNumber - 1];
  if (!track || !measure) return invalid;
  const beatIndex = Math.floor(tick / TICKS_PER_QUARTER);
  const startTick = beatIndex * TICKS_PER_QUARTER;
  const endTick = startTick + TICKS_PER_QUARTER;
  if (rangeEnd !== undefined && rangeEnd > endTick) return invalid;

  // 与提交使用同一个核心预检。预览仅读取原音的显示内容，核心命令负责时值和歌词锚点。
  const command: BeatTupletCommand = { type: "numbered.tuplet.createInBeat", trackId, measureId, startTick };
  const preview = previewNumberedTupletEdit(track, command);
  if (!preview.ok) return preview;
  const slots: (string | null)[] = measure.numberedVoice.events
    .filter((event) => event.tick >= startTick && event.tick < endTick && event.kind === "notes")
    .map((event) => event.items.map((item) => item.token).join(" "));
  return { ok: true, command, measureNumber, beatNumber: beatIndex + 1, revision: document.documentRevision, slots: slots.length === 2 ? [...slots, null] : slots };
};
