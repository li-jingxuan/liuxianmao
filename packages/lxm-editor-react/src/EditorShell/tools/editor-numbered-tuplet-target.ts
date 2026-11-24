import { previewNumberedTupletEdit, type ILXMDocument, type ILXMNumberedTarget, type ILXMNumberedTupletCommand, type MusicTextRange } from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../music-text/music-text-draft";

/** 按稳定事件 ID 定位端点。连音改变起点后，原选区仍能定位同一组音符。 */
export const resolveNumberedTupletTarget = (
  document: ILXMDocument,
  range: MusicTextRange | null,
  active: MusicTextTarget | null,
  selection: ILXMNumberedTarget | null,
): { ok: true; command: ILXMNumberedTupletCommand } | { ok: false; message: string } => {
  const fail = (message: string) => ({ ok: false as const, message });
  const chooseThree = "请选择同一小节内三个连续、时值相同的简谱音符。";
  if (range && (range.kind !== "numbered" || range.anchor.measureId !== range.focus.measureId))
    return fail(chooseThree);
  const focus = range ? { ...range.focus, trackId: range.trackId }
    : active ? active.kind === "numbered" ? active : null : selection;
  if (!focus || !("eventId" in focus) || !focus.eventId) return fail(chooseThree);
  const { trackId, measureId, eventId } = focus;
  const track = document.score.tracks.find((track) => track.id === trackId);
  const voice = track?.measures.find((measure) => measure.id === measureId)?.numberedVoice;
  const last = voice?.events.find((event) => event.id === eventId);
  const first = range ? voice?.events.find((event) => event.id === range.anchor.eventId) : last;
  if (!track || !voice || !first || !last) return fail(chooseThree);
  const start = Math.min(first.tick, last.tick), end = Math.max(first.tick, last.tick);
  const events = voice.events.filter((event) => event.tick >= start && event.tick <= end);
  const eventIds = events.map((event) => event.id);
  const group = voice.tuplets.find(({ eventIds: members }) =>
    eventIds.every((id) => members.includes(id)) && (eventIds.length === 1 || eventIds.length === members.length));
  if (!group && events.length !== 3) return fail(chooseThree);
  const command: ILXMNumberedTupletCommand = group
    ? { type: "numbered.tuplet.remove", trackId, measureId, tupletId: group.id }
    : { type: "numbered.tuplet.add", trackId, measureId, eventIds };
  // 由核心判断实际时值、组外音符和连接记号，让禁用原因与最终保存一致。
  const preview = previewNumberedTupletEdit(track, command);
  return preview.ok ? { ok: true, command } : preview;
};
