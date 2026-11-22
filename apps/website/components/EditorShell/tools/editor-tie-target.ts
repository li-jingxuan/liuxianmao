import {
  areAdjacentNumberedEvents,
  buildNumberedIndex,
  resolveMusicTextRange,
  sameNumberedPitch,
  validateNumberedMarks,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMTabCellSelection,
  type MusicTextRange,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import { resolveQuickTechnique } from "./editor-technique-target";

export const NUMBERED_TIE_SELECTION_REASON = "请选择两个相邻简谱音符";

/** A score range survives returnToScore; the store's single numbered target may be stale. */
export const isNumberedTieTarget = (
  range: MusicTextRange | null | undefined,
  active: MusicTextTarget | null,
): boolean => range?.kind === "numbered" || active?.kind === "numbered";

type NumberedArcLabel = "简谱延音线" | "简谱圆滑线";
type TieTarget = ({ kind: "numbered"; label: NumberedArcLabel } | { kind: "tab" }) & (
  | { ok: true; command: ILXMScoreCommand; pressed: boolean }
  | { ok: false; message: string }
);

/** 简谱弧线按所选单音的音高切换延音线或圆滑线，TAB 沿用原有快捷技巧规则。 */
export const resolveEditorTieTarget = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  range: MusicTextRange | null | undefined,
  active: MusicTextTarget | null,
): TieTarget => {
  if (!isNumberedTieTarget(range, active))
    return { kind: "tab", ...resolveQuickTechnique(document, selection, "tie") };
  const fail = (message = NUMBERED_TIE_SELECTION_REASON, label: NumberedArcLabel = "简谱延音线"): TieTarget =>
    ({ kind: "numbered", label, ok: false, message });
  if (range?.kind !== "numbered") return fail();
  const resolved = resolveMusicTextRange(document, range);
  if (!resolved.ok) return fail(resolved.message);
  if (resolved.slots.length !== 2) return fail();
  const track = document.score.tracks.find((item) => item.id === range.trackId);
  if (!track) return fail();
  const index = buildNumberedIndex(track);
  const from = index.events.get(resolved.slots[0]!.eventId ?? "");
  const to = index.events.get(resolved.slots[1]!.eventId ?? "");
  // 选区按事件定位，只有两个单音事件才能唯一确定端点；和弦、休止和空位均不适用。
  if (from?.event.kind !== "notes" || to?.event.kind !== "notes" ||
    from.event.items.length !== 1 || to.event.items.length !== 1)
    return fail();
  const [fromItem, toItem] = [from.event.items[0]!, to.event.items[0]!];
  const matchingPitch = sameNumberedPitch(fromItem.token, toItem.token);
  const label = matchingPitch ? "简谱延音线" : "简谱圆滑线";
  // 文档允许更长的圆滑线，快捷入口仅允许时间连续的相邻音，包括跨普通小节线的音符。
  if (!areAdjacentNumberedEvents(from, to)) return fail(`${label}需要时间连续的相邻音`, label);
  // 延音线绑定音高成员，圆滑线绑定事件；再次点击只移除同类型、同端点的记号。
  const mark = matchingPitch
    ? { type: "tie" as const, fromItemId: fromItem.id, toItemId: toItem.id }
    : { type: "slur" as const, fromEventId: from.event.id, toEventId: to.event.id };
  const existing = track.numberedMarks.find((candidate) => mark.type === "tie"
    ? candidate.type === "tie" && candidate.fromItemId === mark.fromItemId && candidate.toItemId === mark.toItemId
    : candidate.type === "slur" && candidate.fromEventId === mark.fromEventId && candidate.toEventId === mark.toEventId);
  if (existing) return {
    kind: "numbered", label, ok: true, pressed: true,
    command: { type: "numbered.mark.remove", trackId: track.id, markId: existing.id },
  };
  // 复用核心校验，确保快捷入口与命令对反复、终止边界和圆滑线范围的处理一致。
  const message = validateNumberedMarks({
    ...track,
    numberedMarks: [...track.numberedMarks, { ...mark, id: "numbered-arc-preview" }],
  }, index);
  return message ? fail(message, label) : {
    kind: "numbered", label, ok: true, pressed: false,
    command: { type: "numbered.mark.add", trackId: track.id, mark },
  };
};
