import type { ToolNavigation } from "./editor-tool-catalog";
import type { MeasureToolTarget } from "./editor-tool-actions";
import type {
  ILXMDocument,
  ILXMTabCellReference,
  ILXMTabCellSelection,
  ILXMLyricVerse,
} from "@liuxianmao/lxm-editor";
import type { ChordDraft } from "./ChordEditor";
import { resolveLyricPosition } from "@liuxianmao/lxm-editor";

export type MusicTextTarget =
  | (ILXMTabCellReference & {
      kind: "chord";
      verse?: ILXMLyricVerse;
      eventId?: never;
      itemId?: never;
      tick?: never;
      endTick?: never;
    })
  | {
      kind: "lyric";
      trackId: string;
      measureId: string;
      eventId?: string;
      verse?: ILXMLyricVerse;
      string?: number;
      beatId?: never;
      itemId?: never;
      tick?: number;
      endTick?: number;
    }
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
  | {
      type: "tool";
      kind: "score";
      destination: ToolNavigation;
      target?: MeasureToolTarget;
      sessionId: number;
      sessionVersion: number;
    }
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
      keepFloatingPosition?: boolean;
    }
  | {
      type: "tab";
      kind: SidebarTab;
      focus?: "main" | "paragraph";
      propertyTab?: "selection" | "paragraph" | "chord" | "song";
    };

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
  // 简谱事件之间允许立即切换；未应用输入由侧栏按事件暂存。
  if (
    current?.kind === "numbered" &&
    action.type === "target" &&
    action.target.kind === "numbered" &&
    !guards.settingsDirty
  )
    return "execute";
  return (draft && musicTextDraftValue(draft) !== draft.initial) ||
    guards.numberedDirty ||
    guards.settingsDirty
    ? "confirm"
    : "execute";
};

/** 每次从当前快照读取独立值对象，歌词只按事件读取，TAB 选区不改变起点。 */
export const readMusicTextDraft = (
  document: ILXMDocument | null,
  target: MusicTextTarget,
  lyricMode: MusicTextDraft["lyricMode"] = "sequence",
  selection?: ILXMTabCellSelection | null,
): MusicTextDraft | null => {
  void selection;
  const track = document?.score.tracks.find((t) => t.id === target.trackId);
  const measure = track?.measures.find((m) => m.id === target.measureId);
  if (
    target.kind === "numbered" ||
    !measure ||
    (target.kind === "lyric"
      ? !resolveLyricPosition(measure, target)
      : !measure.beats.some((beat) => beat.id === target.beatId))
  )
    return null;
  const verse = target.verse ?? 1;
  const position =
    target.kind === "lyric" ? resolveLyricPosition(measure, target) : undefined;
  if (target.kind === "lyric" && position?.eventId)
    target = {
      ...target,
      eventId: position.eventId,
      tick: undefined,
      endTick: undefined,
    };
  const lyric = measure.lyrics.find(
    (l) => l.eventId === target.eventId && l.verse === verse,
  );
  const chord = measure.chordSymbols.find((c) => c.beatId === target.beatId);
  const value = {
    target: {
      ...target,
      verse,
    },
    lyricMode,
    // 新歌词草稿默认允许覆盖，实际写入仍需点击应用。
    allowOverwrite: target.kind === "lyric",
    text: lyric?.text ?? "",
    chord: chord
      ? structuredClone({ display: chord.display, chord: chord.chord })
      : { display: "name" as const, chord: { name: "", diagram: null } },
  };
  return { ...value, initial: musicTextDraftValue(value) };
};
