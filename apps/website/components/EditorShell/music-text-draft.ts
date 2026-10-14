import type {
  ILXMDocument,
  ILXMTabCellReference,
  ILXMTabCellSelection,
  ILXMLyricVerse,
} from "@liuxianmao/lxm-editor";
import type { ChordDraft } from "./ChordEditor";

export type MusicTextTarget =
  | (ILXMTabCellReference & {
      kind: "lyric" | "chord";
      verse?: ILXMLyricVerse;
      eventId?: never;
      itemId?: never;
      tick?: never;
      endTick?: never;
    })
  | {
      kind: "numbered";
      trackId: string;
      measureId: string;
      eventId?: string;
      itemId?: string;
      tick?: number;
      endTick?: number;
      beatId?: string;
      string?: number;
      verse?: never;
    };
export interface MusicTextDraft {
  target: Extract<MusicTextTarget, { kind: "lyric" | "chord" }>;
  text: string;
  chord: ChordDraft;
  lyricMode: "single" | "sequence";
  allowOverwrite: boolean;
  initial: string;
}
export type SidebarTab = "score" | "lyric" | "chord" | "numbered";
export type SidebarAction =
  | { type: "numberedMode"; mode: "single" | "sequence" }
  | {
      type: "selection";
      selection: ILXMTabCellSelection | null;
      techniqueId?: string;
    }
  | { type: "mode"; mode: MusicTextDraft["lyricMode"] }
  | { type: "close" }
  | {
      type: "target";
      target: MusicTextTarget;
      focus?: "score" | "input";
      numberedMarkId?: string;
    }
  | { type: "tab"; kind: SidebarTab; focus?: "main" | "paragraph" };

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
  guards: {
    numberedTarget?: MusicTextTarget | null;
    numberedDirty?: boolean;
    settingsDirty?: boolean;
  } = {},
): "ignore" | "confirm" | "execute" => {
  // 仅相同文字业务对象可重复激活；同拍六线谱选择也必须经过草稿保护。
  const current = draft?.target ?? guards.numberedTarget;
  if (current && action.type === "target") {
    const b = action.target;
    if (
      current.trackId === b.trackId &&
      current.measureId === b.measureId &&
      current.beatId === b.beatId &&
      current.eventId === b.eventId &&
      current.itemId === b.itemId &&
      current.tick === b.tick &&
      current.endTick === b.endTick &&
      current.kind === b.kind &&
      (current.kind !== "lyric" || (current.verse ?? 1) === (b.verse ?? 1))
    )
      return "ignore";
  }
  if (draft && action.type === "mode" && action.mode === draft.lyricMode)
    return "ignore";
  if (draft && action.type === "tab" && action.kind === draft.target.kind)
    return "ignore";
  return (draft && musicTextDraftValue(draft) !== draft.initial) ||
    guards.numberedDirty ||
    guards.settingsDirty
    ? "confirm"
    : "execute";
};

/** 每次从当前快照读取独立值对象，换拍后不携带上一拍的和弦或歌词。 */
export const readMusicTextDraft = (
  document: ILXMDocument | null,
  target: MusicTextTarget,
  lyricMode: MusicTextDraft["lyricMode"] = "sequence",
): MusicTextDraft | null => {
  const measure = document?.score.tracks
    .find((t) => t.id === target.trackId)
    ?.measures.find((m) => m.id === target.measureId);
  if (
    target.kind === "numbered" ||
    !measure?.beats.some((b) => b.id === target.beatId)
  )
    return null;
  const verse = target.verse ?? 1;
  const lyric = measure.lyrics.find(
    (l) => l.beatId === target.beatId && l.verse === verse,
  );
  const chord = measure.chordSymbols.find((c) => c.beatId === target.beatId);
  const value = {
    target: { ...target, verse },
    lyricMode,
    // 新歌词草稿默认允许覆盖，实际写入仍需点击应用。
    allowOverwrite: target.kind === "lyric",
    text: lyricMode === "sequence" ? "" : (lyric?.text ?? ""),
    chord: chord
      ? structuredClone({ display: chord.display, chord: chord.chord })
      : { display: "name" as const, chord: { name: "", diagram: null } },
  };
  return { ...value, initial: musicTextDraftValue(value) };
};
