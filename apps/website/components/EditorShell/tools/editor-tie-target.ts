import {
  resolveMusicTextRange,
  validateNumberedMarks,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMTabCellSelection,
  type MusicTextRange,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import { resolveQuickTechnique } from "./editor-technique-target";

export const NUMBERED_TIE_SELECTION_REASON = "请选择两个相邻同音简谱音符";

/** A score range survives returnToScore; the store's single numbered target may be stale. */
export const isNumberedTieTarget = (
  range: MusicTextRange | null | undefined,
  active: MusicTextTarget | null,
): boolean => range?.kind === "numbered" || active?.kind === "numbered";

type TieTarget = { kind: "numbered" | "tab" } & (
  | { ok: true; command: ILXMScoreCommand; pressed: boolean }
  | { ok: false; message: string }
);

/** Numbered ties require two explicit events; TAB keeps its existing next-note behavior. */
export const resolveEditorTieTarget = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  range: MusicTextRange | null | undefined,
  active: MusicTextTarget | null,
): TieTarget => {
  if (!isNumberedTieTarget(range, active))
    return { kind: "tab", ...resolveQuickTechnique(document, selection, "tie") };
  const fail = (message = NUMBERED_TIE_SELECTION_REASON): TieTarget => ({ kind: "numbered", ok: false, message });
  if (range?.kind !== "numbered") return fail();
  const resolved = resolveMusicTextRange(document, range);
  if (!resolved.ok) return fail(resolved.message);
  if (resolved.slots.length !== 2) return fail();
  const track = document.score.tracks.find((item) => item.id === range.trackId);
  if (!track) return fail();
  const events = resolved.slots.map((slot) => track.measures
    .find((measure) => measure.id === slot.measureId)?.numberedVoice.events
    .find((event) => event.id === slot.eventId));
  // Range points identify events, not chord members. Never guess either endpoint's item.
  if (events.some((event) => event?.kind !== "notes" || event.items.length !== 1))
    return fail();
  const fromItemId = events[0]!.items[0]!.id;
  const toItemId = events[1]!.items[0]!.id;
  const existing = track.numberedMarks.find((mark) => mark.type === "tie" &&
    mark.fromItemId === fromItemId && mark.toItemId === toItemId);
  if (existing) return {
    kind: "numbered", ok: true, pressed: true,
    command: { type: "numbered.mark.remove", trackId: track.id, markId: existing.id },
  };
  const mark = { type: "tie" as const, fromItemId, toItemId };
  const message = validateNumberedMarks({
    ...track,
    numberedMarks: [...track.numberedMarks, { ...mark, id: "numbered-tie-preview" }],
  });
  return message ? fail(message) : {
    kind: "numbered", ok: true, pressed: false,
    command: { type: "numbered.mark.add", trackId: track.id, mark },
  };
};
