import type {
  ILXMDocument,
  ILXMDurationMarkLayout,
  ILXMLayout,
  ILXMLayoutPoint,
  ILXMTechniqueArrowHeadLayout,
} from "@liuxianmao/lxm-editor";

// 与扫弦交互层的 5 单位圆头描边一致。
const OVERLAY_HIT_RADIUS = 2.5;

interface MarqueeBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function intersectsArpeggioTip(
  { points, direction }: ILXMTechniqueArrowHeadLayout,
  { left, right, top, bottom }: MarqueeBounds,
): boolean {
  const [tip, base] = points;
  if (!tip || !base) return false;
  const [tipX, tipY] = tip;
  const up = direction === "up";
  if (up ? top > tipY : bottom < tipY) return false;

  // SVG 三角形描边的斜接尖角会伸出琶音的底层 bounds。
  const slope = Math.abs((base[0] - tipX) / (base[1] - tipY));
  const outwardY = Math.max(up ? tipY - bottom : top - tipY, 0);
  const halfWidth = OVERLAY_HIT_RADIUS * Math.hypot(1, slope) - outwardY * slope;
  return Math.max(left - tipX, tipX - right, 0) <= halfWidth;
}

/** 输入为最终谱面坐标，返回按谱面拍点顺序排列的技巧 ID。 */
export function getTraversalMarqueeIds(
  layout: ILXMLayout,
  document: ILXMDocument,
  start: ILXMLayoutPoint,
  end: ILXMLayoutPoint,
): string[] {
  const track = document.score.tracks.find(({ id }) => id === layout.trackId);
  if (!track) return [];

  const traversalBeats = new Map<string, string>();
  for (const technique of track.techniques) {
    if (technique.type === "strum" || technique.type === "arpeggio") {
      traversalBeats.set(technique.id, technique.beatId);
    }
  }
  if (!traversalBeats.size) return [];

  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const marquee = { left, right, top, bottom };
  const beatOrder = new Map<string, number>();
  const stems = new Map<string, ILXMDurationMarkLayout>();
  for (const system of layout.systems) {
    for (const measure of system.measures) {
      for (const beat of measure.beats) beatOrder.set(beat.id, beatOrder.size);
      for (const mark of measure.durationMarks) {
        if (mark.stemVisible) stems.set(mark.beatId, mark);
      }
    }
  }

  const hits = new Map<string, number>();
  for (const system of layout.systems) {
    for (const { techniqueId, path, bounds, arrowHead } of system.techniques) {
      const beatId = traversalBeats.get(techniqueId);
      if (beatId === undefined || !path || hits.has(techniqueId)) continue;
      const order = beatOrder.get(beatId);
      if (order === undefined) continue;

      // 箭头和波纹沿用底层点选的范围，符干用所属拍点的独立热区。
      const onTechnique = bounds.x <= right && bounds.x + bounds.width >= left &&
        bounds.y <= bottom && bounds.y + bounds.height >= top;
      if (onTechnique || (arrowHead && intersectsArpeggioTip(arrowHead, marquee))) {
        hits.set(techniqueId, order);
        continue;
      }

      const stem = stems.get(beatId);
      if (!stem) continue;
      const dx = Math.max(left - stem.stemX, stem.stemX - right, 0);
      const dy = Math.max(
        top - Math.max(stem.stemY1, stem.stemY2),
        Math.min(stem.stemY1, stem.stemY2) - bottom,
        0,
      );
      if (dx * dx + dy * dy <= OVERLAY_HIT_RADIUS ** 2) hits.set(techniqueId, order);
    }
  }

  return [...hits].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}
