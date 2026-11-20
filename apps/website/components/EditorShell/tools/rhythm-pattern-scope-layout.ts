import type { ILXMLayout, ILXMMeasureLayout, ILXMSystemLayout, RhythmPatternTarget } from "@liuxianmao/lxm-editor";

/** Paint the resolved time interval on the active lane using the score's own time anchors. */
const scopeRect = (system: ILXMSystemLayout, measure: ILXMMeasureLayout, layer: RhythmPatternTarget["layer"], startTick: number, endTick: number) => {
  if (endTick <= startTick) return null;
  const anchors = measure.timeAnchors;
  const xAt = (tick: number) => {
    const exact = anchors.find(anchor => anchor.tick === tick);
    if (exact) return exact.x;
    const previous = anchors.filter(anchor => anchor.tick < tick).at(-1);
    const next = anchors.find(anchor => anchor.tick > tick);
    if (previous && next) return previous.x + (next.x - previous.x) * (tick - previous.tick) / (next.tick - previous.tick);
    return previous ? measure.x + measure.width - 6 : next?.x ?? measure.x + 12;
  };
  const left = Math.max(measure.x, xAt(startTick) - 12);
  const right = Math.min(measure.x + measure.width, xAt(endTick) - 2);
  if (layer === "numbered") {
    const row = system.numberedRow;
    if (!row) return null;
    return { x: left, y: row.y - 4, width: Math.max(24, right - left), height: row.height + 8 };
  }
  const first = measure.strings[0], last = measure.strings.at(-1);
  if (!first || !last) return null;
  return { x: left, y: first.y1 - 8, width: Math.max(24, right - left), height: last.y1 - first.y1 + 16 };
};

export const rhythmPatternScopeRect = (layout: ILXMLayout, target: RhythmPatternTarget) => {
  if (layout.trackId !== target.trackId) return null;
  for (const system of layout.systems) {
    const measure = system.measures.find(item => item.id === target.measureId);
    if (measure) return scopeRect(system, measure, target.layer, target.startTick, target.endTick);
  }
  return null;
};

export const rhythmPatternScopeRects = (layout: ILXMLayout, target: RhythmPatternTarget) => {
  if (layout.trackId !== target.trackId) return [];
  const measures = layout.systems.flatMap(system => system.measures.map(measure => ({ system, measure })));
  const first = measures.findIndex(({ measure }) => measure.id === target.measureId);
  const last = measures.findIndex(({ measure }) => measure.id === (target.endMeasureId ?? target.measureId));
  if (first < 0 || last < first) return [];
  return measures.slice(first, last + 1).flatMap(({ system, measure }, index) => {
    const startTick = index === 0 ? target.startTick : 0;
    const endTick = first + index === last ? target.endTick : Infinity;
    const rect = scopeRect(system, measure, target.layer, startTick, endTick);
    return rect ? [{ ...rect, measureId: measure.id }] : [];
  });
};
