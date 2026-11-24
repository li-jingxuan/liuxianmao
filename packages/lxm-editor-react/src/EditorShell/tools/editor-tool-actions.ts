import {
  LXMScoreCommandEnum as C,
  LXM_EDITABLE_TIME_SIGNATURES,
  tabInputRhythmFromNumbered,
  type ILXMBarlineType,
  type ILXMDocument,
  type ILXMRhythm,
  type ILXMScoreCommand,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { deriveEditorToolState } from "./editor-tool-state";
import { resolveQuickTechnique, type QuickTechnique } from "./editor-technique-target";
import type { NumberedArcKind } from "./editor-tie-target";
export type MeasureToolTarget = { trackId: string; measureId: string };
export type MeasureCopyDestination = { kind: "start" } | { kind: "end" } | { kind: "after"; measureId: string };
export type EditorToolbarAction =
  | {
      type:
        | "undo"
        | "redo"
        | "muted"
        | "removeNotes"
        | "rest"
        | "restore"
        | "restToggle"
        | "sustain"
        | "continuation";
    }
  | {
      type: "insertMeasure" | "removeMeasure" | "startRepeat";
      target?: MeasureToolTarget;
    }
  | { type: "copyMeasures"; target?: MeasureToolTarget; destination?: MeasureCopyDestination; isCurrent?: () => boolean }
  | { type: "rhythm"; base: ILXMRhythm["base"] }
  | { type: "dots"; dots: 0 | 1 | 2 }
  | { type: "quickTechnique"; technique: QuickTechnique }
  | { type: "numberedArc"; kind: NumberedArcKind }
  | { type: "numberedTuplet"; operation: "add" | "remove" }
  | { type: "signature"; value: string; target?: MeasureToolTarget }
  | { type: "measureDuration"; durationTicks: number; target?: MeasureToolTarget }
  | { type: "barline"; value: ILXMBarlineType; target?: MeasureToolTarget };
export type ToolActionHandler = (
  action: EditorToolbarAction,
) => Promise<boolean>;

/** 只翻译稳定目标与动作，合法性由 resolver 和最终核心命令判定。 */
export const buildEditorToolCommand = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  action: EditorToolbarAction,
  tabInputRhythmOverrides: readonly string[] = [],
  selectedTraversalIds: readonly string[] = [],
): ILXMScoreCommand | null => {
  // 简谱弧线与连音由会话的简谱选区解析，不能使用保留的 TAB 拍点。
  if (action.type === "numberedArc" || action.type === "numberedTuplet") return null;
  const tools = deriveEditorToolState(document, selection, selectedTraversalIds);
  if (action.type === "quickTechnique") {
    const result = resolveQuickTechnique(document, selection, action.technique);
    return result.ok ? result.command : null;
  }
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
    const { destination } = action;
    // 曲首由命令省略锚点表示。曲末和指定小节后绑定当前轨道的 ID；旧调用仍紧接源范围。
    const afterMeasureId = destination?.kind === "start" ? undefined
      : destination?.kind === "end" ? track.measures.at(-1)?.id
      : destination?.kind === "after" ? destination.measureId : measures.at(-1)!.id;
    if (afterMeasureId !== undefined && !track.measures.some((item) => item.id === afterMeasureId)) return null;
    return {
      type: C.CopyMeasureRange,
      trackId: track.id,
      sourceStartMeasureId: measures[0]!.id,
      sourceEndMeasureId: measures.at(-1)!.id,
      ...(afterMeasureId === undefined ? {} : { afterMeasureId }),
    };
  }
  if (
    action.type === "signature" ||
    action.type === "measureDuration" ||
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
    if (action.type === "measureDuration")
      return {
        type: C.SetMeasureDuration,
        trackId: track.id,
        measureId: measure.id,
        durationTicks: action.durationTicks,
      };
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
  if (action.type === "sustain") {
    if (!tools.sustain.enabled || !tools.sustainBeatId) return null;
    return {
      type: C.ExtendBeat,
      trackId: focus.track.id,
      measureId: focus.measure.id,
      beatId: tools.sustainBeatId,
    };
  }
  if (action.type === "rhythm" || action.type === "dots") {
    if (!tools.rhythm.enabled) return null;
    const beat = focus.measure.beats.find(
      (item) => item.id === selection.focus.beatId,
    );
    const rhythm = beat && (tabInputRhythmOverrides.includes(beat.id) ? beat.rhythm : tabInputRhythmFromNumbered(focus.track, focus.measure, beat.id) ?? beat.rhythm);
    return beat && rhythm
      ? {
          type: C.SetBeatRhythm,
          ...selection.focus,
          rhythm:
            action.type === "rhythm"
              ? { ...rhythm, base: action.base }
              : { ...rhythm, dots: action.dots },
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
  if (action.type === "continuation")
    return { type: C.SetTabContinuation, range };
  if (action.type === "removeNotes")
    return { type: C.RemoveNotesInRect, range };
  const kind = action.type === "restToggle" ? (tools.restState === "all" ? "notes" : "rest") : action.type === "rest" ? "rest" : "notes";
  // 锚点只是活动记号的定位；离散选区不能用首尾拍生成连续范围。
  if (tools.discreteRestBeatIds.length)
    return { type: C.SetBeatKindForBeats, trackId: focus.track.id, beatIds: tools.discreteRestBeatIds, kind };
  return {
    type: C.SetBeatKindRange,
    range,
    kind,
  };
};
