import {
  calculateRhythmTicks,
  createNumberedRhythmContext,
  numberedRhythmForTicks,
  tabInputRhythmFromNumbered,
  type ILXMDocument,
  type ILXMMeasure,
  type ILXMRhythm,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
import { deriveEditorToolState } from "./editor-tool-state";
import { resolveNumberedEditorTarget } from "./numbered-editor-target";

/** 仅为新建空位借用同起点的普通 TAB 节奏，不能脱离连音组复制成员时值。 */
export const numberedInputRhythmFromTab = (
  measure: ILXMMeasure | undefined,
  tick: number,
  ticks: number,
): ILXMRhythm | undefined => {
  const beat = measure?.beats.find((item) => item.tick === tick);
  if (!beat || measure?.tuplets.some((group) => group.beatIds.includes(beat.id))) return;
  const duration = calculateRhythmTicks(beat.rhythm);
  return duration.ok && duration.ticks <= ticks ? beat.rhythm : undefined;
};

/** 显式选择优先，其次是对侧节奏，再适应空位容量。 */
export const numberedInputRhythmForWindow = (
  preference: ILXMRhythm,
  explicit: boolean,
  ticks: number,
  inherited?: ILXMRhythm,
): ILXMRhythm => {
  if (!explicit && inherited) return inherited;
  const duration = calculateRhythmTicks(preference);
  return !explicit && duration.ok && duration.ticks > ticks
    ? (numberedRhythmForTicks(ticks) ?? preference)
    : preference;
};

/** 活动对象优先；歌词和和弦不能借用残留 TAB 选区修改时值。 */
export const resolveEditorRhythmTarget = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  active: MusicTextTarget | null,
  preference: ILXMRhythm,
  explicit: boolean,
  tabInputRhythmOverrides: readonly string[] = [],
) => {
  if (active?.kind === "numbered") {
    const target = resolveNumberedEditorTarget(document, active);
    const measure = document.score.tracks
      .find((track) => track.id === target?.trackId)
      ?.measures.find((item) => item.id === target?.measureId);
    const event =
      target?.kind === "numberedEvent"
        ? measure?.numberedVoice.events.find(
            (item) => item.id === target.eventId,
          )
        : null;
    const rhythm =
      event?.rhythm ??
      (target?.kind === "numberedTime"
        ? numberedInputRhythmForWindow(
            preference,
            explicit,
            target.endTick - target.tick,
            numberedInputRhythmFromTab(measure, target.tick, target.endTick - target.tick),
          )
        : null);
    const occupied =
      target?.kind === "numberedTime" &&
      measure &&
      measure.numberedVoice.events.some((event) => {
        const duration = createNumberedRhythmContext(
          measure.numberedVoice,
        ).getEventDurationTicks(event);
        return (
          !duration.ok ||
          (event.tick < target.endTick &&
            event.tick + duration.ticks > target.tick)
        );
      });
    return {
      kind: "numbered" as const,
      target,
      rhythm,
      enabled: !!target && !occupied,
      reason: target && !occupied ? "" : "当前简谱目标已失效。",
    };
  }
  if (active)
    return {
      kind: "none" as const,
      rhythm: null,
      enabled: false,
      reason: "请先选择简谱音符、占位或六线谱拍点。",
    };
  const tools = deriveEditorToolState(document, selection);
  const beat = tools.rhythm.enabled
    ? tools.focused?.measure.beats.find(
        (item) => item.id === selection?.focus.beatId,
      )
    : null;
  return {
    kind: "tab" as const,
    rhythm: beat
      ? (tabInputRhythmOverrides.includes(beat.id)
        ? beat.rhythm
        : tabInputRhythmFromNumbered(tools.focused!.track, tools.focused!.measure, beat.id) ?? beat.rhythm)
      : null,
    enabled: !!beat,
    reason: tools.rhythm.reason,
  };
};
