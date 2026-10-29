import {
  calculateRhythmTicks,
  createNumberedRhythmContext,
  numberedRhythmForTicks,
  type ILXMDocument,
  type ILXMRhythm,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
import { deriveEditorToolState } from "./editor-tool-state";
import { resolveNumberedEditorTarget } from "./numbered-editor-target";

/** 会话初值可以适应短空位；显式选择永远保留，由核心提示容量不足。 */
export const numberedInputRhythmForWindow = (
  preference: ILXMRhythm,
  explicit: boolean,
  ticks: number,
): ILXMRhythm => {
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
    rhythm: beat?.rhythm ?? null,
    enabled: !!beat,
    reason: tools.rhythm.reason,
  };
};
