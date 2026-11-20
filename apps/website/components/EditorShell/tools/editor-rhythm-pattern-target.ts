import {
  createMeasureRhythmContext,
  resolveMusicTextRange,
  resolveTabCellSelection,
  type ILXMDocument,
  type ILXMNumberedTarget,
  type ILXMTabCellSelection,
  type MusicTextRange,
  type RhythmPatternTarget,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import {
  numberedTargetWindow,
  resolveNumberedEditorTarget,
} from "../numbered/numbered-editor-target";

export type EditorRhythmPatternTargetResult =
  | { ok: true; target: RhythmPatternTarget }
  | { ok: false; message: string };

/** 按活动谱层解析稳定 ID；点击事件只定位一个点，不把长音时值扩展成多拍选区。 */
export const resolveEditorRhythmPatternTarget = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  range: MusicTextRange | null | undefined,
  active: MusicTextTarget | null,
  numberedSelection?: ILXMNumberedTarget | null,
): EditorRhythmPatternTargetResult => {
  const fail = (message: string): EditorRhythmPatternTargetResult => ({ ok: false, message });
  if (active && active.kind !== "numbered" || range?.kind === "lyric")
    return fail("请先在简谱或六线谱选择音符或拍位置。");

  if (range?.kind === "numbered") {
    const resolved = resolveMusicTextRange(document, range);
    if (!resolved.ok) return fail(resolved.message);
    const first = resolved.slots[0], last = resolved.slots.at(-1);
    if (!first || !last) return fail("简谱选区已失效，请重新选择。");
    const focus = resolved.slots.find(slot => slot.measureId === range.focus.measureId && (range.focus.eventId
      ? slot.eventId === range.focus.eventId
      : slot.tick === range.focus.tick && slot.endTick === range.focus.endTick));
    if (!focus) return fail("简谱焦点已失效，请重新选择。");
    return { ok: true, target: {
      layer: "numbered", trackId: range.trackId, measureId: first.measureId,
      ...(first.measureId !== last.measureId ? { endMeasureId: last.measureId, focusMeasureId: focus.measureId } : {}),
      startTick: first.tick, endTick: resolved.slots.length === 1 ? first.tick : last.endTick,
      focusTick: focus.tick,
    } };
  }
  const numbered = active?.kind === "numbered" ? active : numberedSelection;
  if (numbered) {
    const target = resolveNumberedEditorTarget(document, numbered);
    if (!target) return fail("简谱目标已失效，请重新选择音符或空位。");
    const window = numberedTargetWindow(document, target);
    if (window.end <= window.start) return fail("该位置没有有效时值，请重新选择。");
    return { ok: true, target: {
      layer: "numbered", trackId: target.trackId, measureId: target.measureId,
      startTick: window.start, endTick: window.start, focusTick: window.start,
    } };
  }
  if (!selection) return fail("请先在当前谱层选择音符或连续选区。");
  const resolved = resolveTabCellSelection(document, selection);
  if (!resolved.ok) return fail(resolved.message);
  const track = document.score.tracks.find(item => item.id === resolved.range.trackId)!;
  const firstRef = resolved.range.beats[0], lastRef = resolved.range.beats.at(-1);
  if (!firstRef || !lastRef) return fail("六线谱选区已失效，请重新选择。");
  const firstMeasure = track.measures.find(measure => measure.id === firstRef.measureId)!;
  const lastMeasure = track.measures.find(measure => measure.id === lastRef.measureId)!;
  const focusMeasure = track.measures.find(measure => measure.id === selection.focus.measureId)!;
  const first = firstMeasure.beats.find(beat => beat.id === firstRef.beatId)!;
  const last = lastMeasure.beats.find(beat => beat.id === lastRef.beatId)!;
  const focus = focusMeasure.beats.find(beat => beat.id === selection.focus.beatId)!;
  const duration = createMeasureRhythmContext(lastMeasure).getBeatDurationTicks(last);
  if (!duration.ok) return fail("选区时值无效，请重新选择。");
  return { ok: true, target: {
    layer: "tab", trackId: track.id, measureId: firstMeasure.id,
    ...(firstMeasure !== lastMeasure ? { endMeasureId: lastMeasure.id, focusMeasureId: focusMeasure.id } : {}),
    startTick: first.tick, endTick: resolved.range.beats.length === 1 ? first.tick : last.tick + duration.ticks,
    focusTick: focus.tick,
  } };
};
