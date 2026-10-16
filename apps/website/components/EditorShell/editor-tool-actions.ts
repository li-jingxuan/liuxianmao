import {
  LXMScoreCommandEnum as C,
  LXM_EDITABLE_TIME_SIGNATURES,
  type ILXMBarlineType,
  type ILXMDocument,
  type ILXMRhythm,
  type ILXMScoreCommand,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { deriveEditorToolState } from "./editor-tool-state";
export type MeasureToolTarget = { trackId: string; measureId: string };
export type EditorToolbarAction =
  | { type: "undo" | "redo" | "muted" | "removeNotes" | "rest" | "restore" }
  | {
      type: "insertMeasure" | "copyMeasures" | "removeMeasure" | "startRepeat";
      target?: MeasureToolTarget;
    }
  | { type: "rhythm"; base: ILXMRhythm["base"] }
  | { type: "dots"; dots: 0 | 1 | 2 }
  | { type: "signature"; value: string; target?: MeasureToolTarget }
  | { type: "barline"; value: ILXMBarlineType; target?: MeasureToolTarget };
export type ToolActionHandler = (
  action: EditorToolbarAction,
) => Promise<boolean>;

/** 只翻译稳定目标与动作，合法性由 resolver 和最终核心命令判定。 */
export const buildEditorToolCommand = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  action: EditorToolbarAction,
): ILXMScoreCommand | null => {
  const tools = deriveEditorToolState(document, selection);
  const explicit = "target" in action ? action.target : undefined;
  const track = explicit
    ? document.score.tracks.find((item) => item.id === explicit.trackId)
    : tools.focused?.track;
  const measure = explicit
    ? track?.measures.find((item) => item.id === explicit.measureId)
    : tools.focused?.measure;
  const focus = tools.focused;
  if (action.type === "undo" || action.type === "redo") return null;
  if (action.type === "insertMeasure" || action.type === "removeMeasure") {
    if (!track || !measure || (!explicit && !tools.singleMeasure.enabled))
      return null;
    return action.type === "insertMeasure"
      ? { type: C.InsertMeasure, trackId: track.id, afterMeasureId: measure.id }
      : { type: C.RemoveMeasure, trackId: track.id, measureId: measure.id };
  }
  if (action.type === "copyMeasures") {
    if (!track || (!explicit && !tools.copyMeasures.enabled)) return null;
    const ids = new Set(tools.range?.beats.map((beat) => beat.measureId));
    const measures = explicit
      ? track.measures.filter((item) => item.id === explicit.measureId)
      : track.measures.filter((item) => ids.has(item.id));
    if (!measures.length) return null;
    return {
      type: C.CopyMeasureRange,
      trackId: track.id,
      sourceStartMeasureId: measures[0]!.id,
      sourceEndMeasureId: measures.at(-1)!.id,
      afterMeasureId: measures.at(-1)!.id,
    };
  }
  if (
    action.type === "signature" ||
    action.type === "barline" ||
    action.type === "startRepeat"
  ) {
    if (!track || !measure) return null;
    if (action.type === "signature") {
      const timeSignature = LXM_EDITABLE_TIME_SIGNATURES.find(
        (item) => `${item.numerator}/${item.denominator}` === action.value,
      );
      return timeSignature
        ? {
            type: C.SetTimeSignature,
            trackId: track.id,
            measureId: measure.id,
            timeSignature: { ...timeSignature },
            scope: "untilNextChange",
          }
        : null;
    }
    if (action.type === "barline")
      return {
        type: C.SetBarlineBoundary,
        trackId: track.id,
        boundary: { kind: "afterMeasure", measureId: measure.id },
        barline: action.value,
      };
    return track.measures[0]?.id === measure.id
      ? {
          type: C.SetBarlineBoundary,
          trackId: track.id,
          boundary: { kind: "trackStart" },
          barline:
            track.startBarline === "repeatStart" ? "none" : "repeatStart",
        }
      : null;
  }
  if (!selection || !tools.range || !focus) return null;
  if (action.type === "rhythm" || action.type === "dots") {
    if (!tools.rhythm.enabled) return null;
    const beat = focus.measure.beats.find(
      (item) => item.id === selection.focus.beatId,
    );
    return beat
      ? {
          type: C.SetBeatRhythm,
          ...selection.focus,
          rhythm:
            action.type === "rhythm"
              ? { ...beat.rhythm, base: action.base }
              : { ...beat.rhythm, dots: action.dots },
        }
      : null;
  }
  const range = {
    trackId: selection.anchor.trackId,
    anchor: selection.anchor,
    focus: selection.focus,
  };
  if (action.type === "muted")
    return { type: C.SetNotesInRect, range, fret: "x" };
  if (action.type === "removeNotes")
    return { type: C.RemoveNotesInRect, range };
  return {
    type: C.SetBeatKindRange,
    range,
    kind: action.type === "rest" ? "rest" : "notes",
  };
};
