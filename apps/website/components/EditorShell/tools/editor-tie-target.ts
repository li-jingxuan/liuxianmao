import {
  areAdjacentNumberedEvents,
  buildNumberedIndex,
  resolveMusicTextRange,
  sameNumberedPitch,
  validateNumberedMarks,
  type ILXMDocument,
  type ILXMScoreCommand,
  type MusicTextRange,
} from "@liuxianmao/lxm-editor";

export const NUMBERED_TIE_SELECTION_REASON = "请选择两个相邻简谱音符";
const NUMBERED_SLUR_SELECTION_REASON = "请选择至少两个连续简谱音符";

export type NumberedArcKind = "tie" | "slur";
type ArcCommand =
  | { ok: true; command: ILXMScoreCommand; pressed: boolean }
  | { ok: false; message: string };
export type NumberedArcOptions = { tie: ArcCommand; slur: ArcCommand; recommended: NumberedArcKind | null };

/** 两类弧线独立校验并生成命令。推荐只影响提示，用户始终可选择另一条合法命令。 */
export const resolveNumberedArcOptions = (
  document: ILXMDocument,
  range: MusicTextRange | null | undefined,
): NumberedArcOptions => {
  const fail = (message: string): ArcCommand => ({ ok: false, message });
  const unavailable = (message?: string): NumberedArcOptions => ({
    tie: fail(message ?? NUMBERED_TIE_SELECTION_REASON),
    slur: fail(message ?? NUMBERED_SLUR_SELECTION_REASON),
    recommended: null,
  });
  if (range?.kind !== "numbered") return unavailable();
  const resolved = resolveMusicTextRange(document, range);
  if (!resolved.ok) return unavailable("选区已失效，请重新选择");
  if (resolved.slots.length < 2) return unavailable();
  const track = document.score.tracks.find((item) => item.id === range.trackId);
  if (!track) return unavailable();
  const index = buildNumberedIndex(track);
  // 选区已按时间排列。连音组、跨小节和隐式空位一律按核心索引的实际时值判断。
  const events = resolved.slots.map((slot) => index.events.get(slot.eventId ?? ""));
  const from = events[0], to = events.at(-1);
  if (!from || !to) return unavailable("选区含空位");
  const invalidRange = events.some((entry) => entry?.event.kind === "rest") ? "选区含休止符"
    : events.some((entry) => !entry || entry.event.kind === "gap") ? "选区含空位"
    : events.some((entry) => entry?.event.kind !== "notes" || entry.event.items.length !== 1) ? "请选择连续的简谱单音"
    : events.some((entry, i) => i > 0 && !areAdjacentNumberedEvents(events[i - 1]!, entry!)) ? "选区在时间上必须连续" : null;
  type ArcMark = Extract<ILXMScoreCommand, { type: "numbered.mark.add" }>["mark"];
  const remove = (markId: string): ArcCommand => ({
    ok: true, pressed: true, command: { type: "numbered.mark.remove", trackId: track.id, markId },
  });
  const add = (mark: ArcMark): ArcCommand => {
    // 沿用核心对反复边界、交叉弧线及重复记号的校验，解释与真正提交结果保持一致。
    const message = validateNumberedMarks({ ...track, numberedMarks: [...track.numberedMarks, { ...mark, id: "numbered-arc-preview" }] }, index);
    return message ? fail(message) : { ok: true, pressed: false, command: { type: "numbered.mark.add", trackId: track.id, mark } };
  };
  const fromItem = from.event.items[0], toItem = to.event.items[0];
  let tie = fail(invalidRange ?? "需要两个相邻同音");
  if (!invalidRange && events.length === 2 && fromItem && toItem && sameNumberedPitch(fromItem.token, toItem.token)) {
    const existing = track.numberedMarks.find((mark) => mark.type === "tie" && mark.fromItemId === fromItem.id && mark.toItemId === toItem.id);
    tie = existing ? remove(existing.id) : add({ type: "tie", fromItemId: fromItem.id, toItemId: toItem.id });
  }
  // 旧谱可能已有横跨休止或和弦的圆滑线。允许按原端点移除，新增才受本入口的选区规则约束。
  const existingSlur = track.numberedMarks.find((mark) => mark.type === "slur" && mark.fromEventId === from.event.id && mark.toEventId === to.event.id);
  const slur = existingSlur ? remove(existingSlur.id) : invalidRange ? fail(invalidRange)
    : add({ type: "slur", fromEventId: from.event.id, toEventId: to.event.id });
  return { tie, slur, recommended: tie.ok ? "tie" : slur.ok ? "slur" : null };
};
