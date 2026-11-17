import type { ILXMLayout, RhythmPatternTarget } from "@liuxianmao/lxm-editor";

/** Paint the resolved time interval on the active lane using the score's own time anchors. */
export const rhythmPatternScopeRect = (layout: ILXMLayout, target: RhythmPatternTarget) => {
  if (layout.trackId !== target.trackId) return null;
  const system = layout.systems.find(row => row.measures.some(measure => measure.id === target.measureId));
  const measure = system?.measures.find(item => item.id === target.measureId);
  if (!system || !measure || target.endTick <= target.startTick) return null;
  const anchors = measure.timeAnchors;
  const xAt = (tick: number) => {
    const exact = anchors.find(anchor => anchor.tick === tick);
    if (exact) return exact.x;
    const previous = anchors.filter(anchor => anchor.tick < tick).at(-1);
    const next = anchors.find(anchor => anchor.tick > tick);
    if (previous && next) return previous.x + (next.x - previous.x) * (tick - previous.tick) / (next.tick - previous.tick);
    return previous ? measure.x + measure.width - 6 : next?.x ?? measure.x + 12;
  };
  const left = Math.max(measure.x, xAt(target.startTick) - 12);
  const right = Math.min(measure.x + measure.width, xAt(target.endTick) - 2);
  if (target.layer === "numbered") {
    const row = system.numberedRow;
    if (!row) return null;
    return { x: left, y: row.y - 4, width: Math.max(24, right - left), height: row.height + 8 };
  }
  const first = measure.strings[0], last = measure.strings.at(-1);
  if (!first || !last) return null;
  return { x: left, y: first.y1 - 8, width: Math.max(24, right - left), height: last.y1 - first.y1 + 16 };
};
