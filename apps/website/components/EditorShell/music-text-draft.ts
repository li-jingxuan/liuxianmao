import type {
  ILXMDocument,
  ILXMTabCellReference,
  ILXMLyricVerse,
} from "@liuxianmao/lxm-editor";
import type { ChordDraft } from "./ChordEditor";

export interface MusicTextTarget extends ILXMTabCellReference {
  kind: "lyric" | "chord";
  verse?: ILXMLyricVerse;
}
export interface MusicTextDraft {
  target: MusicTextTarget;
  text: string;
  chord: ChordDraft;
  lyricMode: "single" | "sequence";
  allowOverwrite: boolean;
  initial: string;
}
export type SidebarAction =
  | { type: "mode"; mode: MusicTextDraft["lyricMode"] }
  | { type: "close" }
  | { type: "target"; target: MusicTextTarget }
  | { type: "tab"; kind: MusicTextTarget["kind"] };

/** 只比较正在编辑的字段；谱面弦号不改变音乐文本的业务目标。 */
export const musicTextDraftValue = (
  draft: Omit<MusicTextDraft, "initial">,
): string =>
  JSON.stringify(
    draft.target.kind === "lyric"
      ? {
          text: draft.text,
          mode: draft.lyricMode,
          allowOverwrite: draft.allowOverwrite,
        }
      : draft.chord.chord,
  );

/** 同一目标重复点击保持草稿；非法草稿也必须经过切换保护。 */
export const resolveSidebarRequest = (
  draft: MusicTextDraft | null,
  action: SidebarAction,
): "ignore" | "confirm" | "execute" => {
  if (draft && action.type === "target") {
    const a = draft.target;
    const b = action.target;
    if (
      a.trackId === b.trackId &&
      a.measureId === b.measureId &&
      a.beatId === b.beatId &&
      a.kind === b.kind &&
      (a.kind !== "lyric" || (a.verse ?? 1) === (b.verse ?? 1))
    )
      return "ignore";
  }
  if (draft && action.type === "mode" && action.mode === draft.lyricMode)
    return "ignore";
  if (draft && action.type === "tab" && action.kind === draft.target.kind)
    return "ignore";
  return draft && musicTextDraftValue(draft) !== draft.initial
    ? "confirm"
    : "execute";
};

/** 每次从当前快照读取独立值对象，换拍后不携带上一拍的和弦或歌词。 */
export const readMusicTextDraft = (
  document: ILXMDocument | null,
  target: MusicTextTarget,
  lyricMode: MusicTextDraft["lyricMode"] = "single",
): MusicTextDraft | null => {
  const measure = document?.score.tracks
    .find((t) => t.id === target.trackId)
    ?.measures.find((m) => m.id === target.measureId);
  if (!measure?.beats.some((b) => b.id === target.beatId)) return null;
  const verse = target.verse ?? 1;
  const lyric = measure.lyrics.find(
    (l) => l.beatId === target.beatId && l.verse === verse,
  );
  const chord = measure.chordSymbols.find((c) => c.beatId === target.beatId);
  const value = {
    target: { ...target, verse },
    lyricMode,
    allowOverwrite: false,
    text: lyricMode === "sequence" ? "" : (lyric?.text ?? ""),
    chord: chord
      ? structuredClone({ display: chord.display, chord: chord.chord })
      : { display: "name" as const, chord: { name: "", diagram: null } },
  };
  return { ...value, initial: musicTextDraftValue(value) };
};
