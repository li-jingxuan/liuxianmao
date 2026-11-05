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
import { resolveNumberedEditorTarget } from "./numbered-editor-target";
import { sameMusicTextTarget } from "./music-text-hover";

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
      : draft.chord,
  );

/** 仅规范化业务身份，不读取或重置正在输入的值。 */
export const normalizeMusicTextTarget = (
  document: ILXMDocument | null,
  target: MusicTextTarget,
): MusicTextTarget | null => {
  if (!document) return null;
  const measure = document.score.tracks.find((track) => track.id === target.trackId)
    ?.measures.find((item) => item.id === target.measureId);
  if (!measure) return null;
  const base = { trackId: target.trackId, measureId: target.measureId };
  if (target.kind === "numbered") {
    const resolved = resolveNumberedEditorTarget(document, target);
    if (!resolved) return null;
    return resolved.kind === "numberedEvent"
      ? { ...base, kind: "numbered", eventId: resolved.eventId, itemId: resolved.itemId }
      : { ...base, kind: "numbered", tick: resolved.tick, endTick: resolved.endTick };
  }
  if (target.kind === "chord") return measure.beats.some((beat) => beat.id === target.beatId)
    ? { ...base, kind: "chord", beatId: target.beatId, string: 1 } : null;
  const position = resolveLyricPosition(measure, target);
  if (!position) return null;
  return position.eventId
    ? { ...base, kind: "lyric", eventId: position.eventId, verse: target.verse ?? 1 }
    : { ...base, kind: "lyric", tick: position.tick, endTick: position.endTick, verse: target.verse ?? 1 };
};

/** 重复激活保留当前输入；离开和弦、歌词或简谱时直接丢弃未应用修改。 */
export const resolveSidebarRequest = (
  draft: MusicTextDraft | null,
  action: SidebarAction,
  guards: {
    numberedTarget?: MusicTextTarget | null;
    numberedDirty?: boolean;
    settingsDirty?: boolean;
    visibleTaskChanged?: boolean;
  } = {},
): "ignore" | "confirm" | "execute" => {
  // 仅相同文字业务对象可重复激活，不以 TAB 拍合并不同目标。
  const current = draft?.target ?? guards.numberedTarget;
  if (current && action.type === "target") {
    if (sameMusicTextTarget(current, action.target))
      return "ignore";
  }
  if (draft && action.type === "mode" && action.mode === draft.lyricMode)
    return "ignore";
  if (draft && action.type === "tab" && action.kind === draft.target.kind && !guards.visibleTaskChanged)
    return "ignore";
  if (current && !guards.settingsDirty)
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
    allowOverwrite: false,
    text: lyric?.text ?? "",
    chord: chord
      ? structuredClone({ display: chord.display, chord: chord.chord })
      : { display: "name" as const, chord: { name: "", diagram: null } },
  };
  return { ...value, initial: musicTextDraftValue(value) };
};
