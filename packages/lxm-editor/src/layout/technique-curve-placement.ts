/** 弧线只调整局部轮廓和标签，任何避让都不得把真实端点整体移到另一根弦。 */
import {
  LXM_TECHNIQUE_CURVE_HEIGHT,
  LXM_TECHNIQUE_CURVE_INK_GAP,
  LXM_TECHNIQUE_INLINE_TEXT_FONT_SIZE,
  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
} from "./layout-constants";
import type { ILXMTechniqueSegmentLayout } from "./layout-types";
import {
  boundsIntersect,
  getTechniqueInkBounds,
  getTextBounds,
  withTechniqueBounds,
} from "./technique-geometry";

type Rect = ILXMTechniqueSegmentLayout["bounds"];

/** 三类连接弧线的端点必须始终表达原音符所在弦。 */
export const isAnchoredCurve = (
  segment: Pick<ILXMTechniqueSegmentLayout, "type">,
): boolean =>
  segment.type === "tie" ||
  segment.type === "hammerOn" ||
  segment.type === "pullOff";

/** 连接技巧允许在同弦共享端点，不能将正常接续当成相交后反复改变弧形。 */
const curveEndpoints = (
  segment: ILXMTechniqueSegmentLayout,
): [number, number][] => {
  if (!isAnchoredCurve(segment) || !segment.path) return [];
  const values = segment.path.d
    .match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)!
    .map(Number);
  return [
    [values[0]!, values[1]!],
    [values.at(-2)!, values.at(-1)!],
  ];
};

/** 仅在含弧线时细分图元；其它技巧继续保留既有留白契约。 */
export const techniqueInkIntersects = (
  a: ILXMTechniqueSegmentLayout,
  b: ILXMTechniqueSegmentLayout,
): boolean => {
  if (!boundsIntersect(a.collisionBounds, b.collisionBounds)) return false;
  if (!isAnchoredCurve(a) && !isAnchoredCurve(b)) return true;
  const shared = curveEndpoints(a).filter(([x, y]) =>
    curveEndpoints(b).some(
      ([bx, by]) => Math.abs(x - bx) < 1e-8 && Math.abs(y - by) < 1e-8,
    ),
  );
  const rightPieces = getTechniqueInkBounds(b);
  return getTechniqueInkBounds(a).some((left) =>
    rightPieces.some((right) => {
      if (!boundsIntersect(left, right)) return false;
      const x1 = Math.max(left.x, right.x),
        x2 = Math.min(left.x + left.width, right.x + right.width);
      const y1 = Math.max(left.y, right.y),
        y2 = Math.min(left.y + left.height, right.y + right.height);
      const radius =
        Math.max(a.path?.strokeWidth ?? 0, b.path?.strokeWidth ?? 0) * 2;
      return !shared.some(
        ([x, y]) =>
          x1 >= x - radius &&
          x2 <= x + radius &&
          y1 >= y - radius &&
          y2 <= y + radius,
      );
    }),
  );
};

/** 二次曲线的局部区间仍是二次曲线，用解析控制点截取，内嵌文字不会盖掉弧顶。 */
const curvePart = (
  x1: number,
  x2: number,
  y: number,
  height: number,
  a: number,
  b: number,
): string => {
  const at = (t: number) => ({
    x: x1 + (x2 - x1) * t,
    y: y - 2 * height * t * (1 - t),
  });
  const start = at(a),
    end = at(b),
    mid = at((a + b) / 2);
  return `M ${start.x} ${start.y} Q ${2 * mid.x - (start.x + end.x) / 2} ${2 * mid.y - (start.y + end.y) / 2} ${end.x} ${end.y}`;
};

/** 在固定端点高度内选择局部轮廓，标签不能再驱动整条弧线跨弦平移。 */
export const placeAnchoredCurve = (
  natural: ILXMTechniqueSegmentLayout,
  noteObstacles: readonly Rect[],
  placed: readonly ILXMTechniqueSegmentLayout[],
): ILXMTechniqueSegmentLayout => {
  if (!natural.path) return natural;
  const collides = (segment: ILXMTechniqueSegmentLayout) =>
    getTechniqueInkBounds(segment).some((piece) =>
      noteObstacles.some((note) => boundsIntersect(piece, note)),
    ) || placed.some((other) => techniqueInkIntersects(segment, other));
  if (!collides(natural)) return natural;
  const values = natural.path.d
    .match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)!
    .map(Number);
  const [startX, y, , , endX] = values as [
    number,
    number,
    number,
    number,
    number,
  ];
  const stroke = natural.path.strokeWidth / 2;
  // 上方弦的字形可能覆盖中心端点；只在横向把端点收进两音间的空隙，Y 保持原弦。
  const nearArc = noteObstacles.filter(
    (rect) => rect.y < y + stroke && rect.y + rect.height > y - stroke,
  );
  const x1 =
    natural.continuation === "fromPrevious" || natural.continuation === "both"
      ? startX
      : Math.max(
          startX,
          ...nearArc
            .filter((r) => r.x <= startX && r.x + r.width >= startX)
            .map((r) => r.x + r.width + stroke + LXM_TECHNIQUE_CURVE_INK_GAP),
        );
  const x2 =
    natural.continuation === "toNext" || natural.continuation === "both"
      ? endX
      : Math.min(
          endX,
          ...nearArc
            .filter((r) => r.x <= endX && r.x + r.width >= endX)
            .map((r) => r.x - stroke - LXM_TECHNIQUE_CURVE_INK_GAP),
        );
  if (x2 <= x1) return natural;
  const make = (
    height: number,
    inline: boolean,
  ): ILXMTechniqueSegmentLayout => {
    const texts = natural.texts.map((label) => ({
      ...label,
      x: (x1 + x2) / 2,
      y: inline
        ? y - height / 2 + LXM_TECHNIQUE_CURVE_HEIGHT / 2
        : label.y - (height - LXM_TECHNIQUE_CURVE_HEIGHT),
      ...(inline ? { fontSize: LXM_TECHNIQUE_INLINE_TEXT_FONT_SIZE } : {}),
    }));
    const halfGap =
      inline && texts[0]
        ? (getTextBounds(texts[0], LXM_TECHNIQUE_TEXT_HALO_WIDTH).width / 2 +
            LXM_TECHNIQUE_CURVE_INK_GAP) /
          (x2 - x1)
        : 0;
    const d =
      halfGap > 0 && halfGap < 0.5
        ? `${curvePart(x1, x2, y, height, 0, 0.5 - halfGap)} ${curvePart(x1, x2, y, height, 0.5 + halfGap, 1)}`
        : curvePart(x1, x2, y, height, 0, 1);
    return withTechniqueBounds({
      ...natural,
      lane: 0,
      texts,
      path: { ...natural.path!, d },
    });
  };
  // 隔弦双位品位只需略微降低弧高；优先保留低矮局部弧线，再考虑长跨度抬高弧顶。
  const heights = [
    LXM_TECHNIQUE_CURVE_HEIGHT,
    4,
    ...Array.from({ length: 15 }, (_, i) => (i + 2) * 6),
  ];
  for (const height of heights) {
    for (const inline of natural.texts.length ? [false, true] : [false]) {
      const candidate = make(height, inline);
      if (!collides(candidate)) return candidate;
    }
  }
  // 极端长跨度无法完全避让时仍保留目标弦定位，不再通过跨弦平移隐藏冲突。
  return make(LXM_TECHNIQUE_CURVE_HEIGHT, natural.texts.length > 0);
};
