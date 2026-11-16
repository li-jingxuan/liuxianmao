import {
  createMeasureRhythmContext,
  resolveMusicTextRange,
  resolveTabCellSelection,
  type ILXMDocument,
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
): EditorRhythmPatternTargetResult => {
  const fail = (message: string): EditorRhythmPatternTargetResult => ({ ok: false, message });
  if (active && active.kind !== "numbered" || range?.kind === "lyric")
    return fail("请先在简谱或六线谱选择音符或拍位置。");

  if (range?.kind === "numbered") {
    if (range.anchor.measureId !== range.focus.measureId)
      return fail("选区跨越小节，请选择同一小节内的连续范围。");
    const resolved = resolveMusicTextRange(document, range);
    if (!resolved.ok) return fail(resolved.message);
    const first = resolved.slots[0], last = resolved.slots.at(-1);
    if (!first || !last) return fail("简谱选区已失效，请重新选择。");
    const focus = resolved.slots.find(slot => range.focus.eventId
      ? slot.eventId === range.focus.eventId
      : slot.tick === range.focus.tick && slot.endTick === range.focus.endTick);
    if (!focus) return fail("简谱焦点已失效，请重新选择。");
    return { ok: true, target: {
      layer: "numbered", trackId: range.trackId, measureId: first.measureId,
      startTick: first.tick, endTick: resolved.slots.length === 1 ? first.tick : last.endTick,
      focusTick: focus.tick,
    } };
  }
  if (active?.kind === "numbered") {
    const target = resolveNumberedEditorTarget(document, active);
    if (!target) return fail("简谱目标已失效，请重新选择音符或空位。");
    const window = numberedTargetWindow(document, target);
    if (window.end <= window.start) return fail("该位置没有有效时值，请重新选择。");
    return { ok: true, target: {
      layer: "numbered", trackId: target.trackId, measureId: target.measureId,
      startTick: window.start, endTick: window.start, focusTick: window.start,
    } };
  }
  if (!selection) return fail("请先在当前谱层选择音符或连续选区。");
  if (selection.anchor.measureId !== selection.focus.measureId)
    return fail("选区跨越小节，请选择同一小节内的连续范围。");
  const resolved = resolveTabCellSelection(document, selection);
  if (!resolved.ok) return fail(resolved.message);
  const track = document.score.tracks.find(item => item.id === resolved.range.trackId)!;
  const measure = track.measures.find(item => item.id === selection.focus.measureId)!;
  const ids = new Set(resolved.range.beats.map(item => item.beatId));
  const beats = measure.beats.filter(beat => ids.has(beat.id)).sort((a, b) => a.tick - b.tick);
  const first = beats[0], last = beats.at(-1);
  const focus = beats.find(beat => beat.id === selection.focus.beatId);
  if (!first || !last || !focus) return fail("六线谱选区已失效，请重新选择。");
  const duration = createMeasureRhythmContext(measure).getBeatDurationTicks(last);
  if (!duration.ok) return fail("选区时值无效，请重新选择。");
  return { ok: true, target: {
    layer: "tab", trackId: track.id, measureId: measure.id,
    startTick: first.tick, endTick: beats.length === 1 ? first.tick : last.tick + duration.ticks,
    focusTick: focus.tick,
  } };
};
