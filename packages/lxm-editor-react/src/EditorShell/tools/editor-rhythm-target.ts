import {
  calculateRhythmTicks,
  createNumberedTrackRhythmContext,
  NUMBERED_CONTINUATION_RHYTHM_REASON,
  numberedRhythmForTicks,
  numberedRhythmForBlockedInputPreference,
  tabInputRhythmFromNumbered,
  type ILXMDocument,
  type ILXMMeasure,
  type ILXMNumberedTarget,
  type ILXMRhythm,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import { deriveEditorToolState } from "./editor-tool-state";
import { numberedTargetKey, resolveNumberedEditorTarget } from "../numbered/numbered-editor-target";
import type { NumberedAutoAdvance } from "../../stores/editor-store";

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

/** 跳转标记只适用于同一虚拟空格。精确时值优先，无法表示时保留原窗口回退逻辑。 */
export const numberedAutoAdvanceRhythm = (
  target: ILXMNumberedTarget | null,
  preference: ILXMRhythm,
  advance: NumberedAutoAdvance | null,
) => {
  if (!advance || target?.kind !== "numberedTime") return undefined;
  const previous = advance.target;
  if (target.trackId !== previous.trackId || target.measureId !== previous.measureId ||
    target.tick !== previous.tick || target.endTick !== previous.endTick)
    return undefined;
  // 顶部工具栏可重选与上格相同的时值；新偏好仍是显式指令，覆盖目标格默认值。
  return advance.previousPreference === preference
    ? { rhythm: numberedRhythmForTicks(target.endTick - target.tick), explicit: false }
    : { rhythm: undefined, explicit: true };
};

/** 三个编辑入口共享同一默认值；过长旧偏好让位后，正文使用逐格规划而非固定时值批量覆盖。 */
export function resolveNumberedInputDefault(
  measure: ILXMMeasure | undefined,
  target: ILXMNumberedTarget | null,
  preference: ILXMRhythm,
  explicit: boolean,
  advance: NumberedAutoAdvance | null,
  preferenceTarget: ILXMNumberedTarget | null,
) {
  if (!measure || target?.kind !== "numberedTime") return undefined;
  const arrival = numberedAutoAdvanceRhythm(target, preference, advance);
  const chosenHere = arrival?.explicit === true ||
    (preferenceTarget !== null && numberedTargetKey(target) === numberedTargetKey(preferenceTarget));
  const slotRhythm = arrival?.rhythm ?? (!chosenHere && explicit
    ? numberedRhythmForBlockedInputPreference(measure, target.tick, target.endTick, preference)
    : undefined);
  return { rhythm: slotRhythm, chosenHere };
}

/** 活动对象优先；歌词和和弦不能借用残留 TAB 选区修改时值。 */
export const resolveEditorRhythmTarget = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  active: MusicTextTarget | null,
  preference: ILXMRhythm,
  explicit: boolean,
  tabInputRhythmOverrides: readonly string[] = [],
  numberedAutoAdvance: NumberedAutoAdvance | null = null,
  preferenceTarget: ILXMNumberedTarget | null = null,
) => {
  if (active?.kind === "numbered") {
    const target = resolveNumberedEditorTarget(document, active);
    const track = document.score.tracks.find((track) => track.id === target?.trackId);
    const measure = track?.measures.find((item) => item.id === target?.measureId);
    const event =
      target?.kind === "numberedEvent"
        ? measure?.numberedVoice.events.find(
            (item) => item.id === target.eventId,
          )
        : null;
    const rhythm =
      event?.rhythm ??
      (target?.kind === "numberedTime"
        ? resolveNumberedInputDefault(measure, target, preference, explicit, numberedAutoAdvance, preferenceTarget)?.rhythm ?? numberedInputRhythmForWindow(
            preference,
            explicit,
            target.endTick - target.tick,
            numberedInputRhythmFromTab(measure, target.tick, target.endTick - target.tick),
          )
        : null);
    const numberedRhythm = track && createNumberedTrackRhythmContext(track);
    const occupied =
      target?.kind === "numberedTime" &&
      numberedRhythm &&
      measure &&
      measure.numberedVoice.events.some((event) => {
        const duration = numberedRhythm.getEventDurationTicks(event);
        return (
          !duration.ok ||
          (event.tick < target.endTick &&
            event.tick + duration.ticks > target.tick)
        );
      });
    // 工具带与侧栏共享此目标，旧谱延音仍显示原节奏，但不开放时值或附点操作。
    const continuation = event?.kind === "continuation";
    return {
      kind: "numbered" as const,
      target,
      rhythm,
      enabled: !!target && !occupied && !continuation,
      reason: continuation ? NUMBERED_CONTINUATION_RHYTHM_REASON : target && !occupied ? "" : "当前简谱目标已失效。",
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
