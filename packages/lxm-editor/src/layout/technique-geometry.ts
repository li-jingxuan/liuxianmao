/** 技巧几何的包围框与平移工具；不读取 DOM，不重新生成技巧模板。 */
import {
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
  LXM_FRET_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_HALO_WIDTH,
  LXM_TECHNIQUE_ARROW_HEIGHT,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_COLLISION_PADDING,
  LXM_TECHNIQUE_HIT_PADDING,
  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
} from "./layout-constants";
import type {
  ILXMNoteLayout,
  ILXMTechniqueSegmentLayout,
  ILXMTextLayout,
} from "./layout-types";

type Rect = ILXMTechniqueSegmentLayout["bounds"];

/** 保守估算粗体等宽数字和技巧文字；字体度量可在此统一替换。 */
export const getTextBounds = (text: ILXMTextLayout, halo = 0): Rect => {
  const width = text.text.length * text.fontSize * 0.65;
  const left =
    text.textAnchor === "middle"
      ? width / 2
      : text.textAnchor === "end"
        ? width
        : 0;
  return {
    x: text.x - left - halo,
    y: text.y - text.fontSize - halo,
    width: width + halo * 2,
    height: text.fontSize * 1.25 + halo * 2,
  };
};

/** 品位文字完整视觉范围包含基线偏移与白色描边。 */
export const getFretTextBounds = (note: ILXMNoteLayout): Rect =>
  getTextBounds(
    {
      text: note.fretText,
      x: note.x,
      y: note.y + LXM_FRET_TEXT_BASELINE_OFFSET_Y,
      fontSize: LXM_FRET_TEXT_FONT_SIZE,
      textAnchor: "middle",
    },
    LXM_FRET_TEXT_HALO_WIDTH,
  );

export const padBounds = (bounds: Rect, padding: number): Rect => ({
  x: bounds.x - padding,
  y: bounds.y - padding,
  width: bounds.width + padding * 2,
  height: bounds.height + padding * 2,
});

export const boundsIntersect = (left: Rect, right: Rect): boolean =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

/** 核心技巧模板只输出绝对 M/L/Q；控制点凸包完整覆盖二次曲线。 */
const pathTokens = (d: string): string[] =>
  d.match(/[MLQ]|-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? [];

const getPathPoints = (d: string): [number, number][] => {
  const values = pathTokens(d)
    .filter((token) => !/^[MLQ]$/i.test(token))
    .map(Number);
  const points: [number, number][] = [];
  for (let index = 0; index < values.length; index += 2) {
    points.push([values[index]!, values[index + 1]!]);
  }
  return points;
};

/** 只平移已生成路径中的 Y，避免扩高后重新执行模板而产生不同锚点。 */
const translatePath = (d: string, dy: number): string => {
  let coordinateIndex = 0;
  return pathTokens(d)
    .map((token) => {
      if (/^[MLQ]$/i.test(token)) return token;
      const isY = coordinateIndex++ % 2 === 1;
      return isY ? String(Number(token) + dy) : token;
    })
    .join(" ");
};

const pointsBounds = (points: readonly (readonly [number, number])[]): Rect => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/** 一次汇总模板图元，后续 lane、扩高、命中只消费和平移同一套 bounds。 */
export const getTechniqueVisualBounds = (
  path: ILXMTechniqueSegmentLayout["path"],
  texts: ILXMTextLayout[],
  arrowHead: ILXMTechniqueSegmentLayout["arrowHead"],
): Rect => {
  const rects = texts.map((label) =>
    getTextBounds(label, LXM_TECHNIQUE_TEXT_HALO_WIDTH),
  );
  if (path) {
    const points = getPathPoints(path.d);
    rects.push(padBounds(pointsBounds(points), path.strokeWidth / 2));
    if (path.markerEnd) {
      // marker 使用 userSpaceOnUse；保守覆盖任意切线方向的完整箭头外延。
      const [x, y] = points.at(-1)!;
      const radius = Math.max(
        LXM_TECHNIQUE_ARROW_WIDTH,
        LXM_TECHNIQUE_ARROW_HEIGHT,
      );
      rects.push({
        x: x - radius,
        y: y - radius,
        width: radius * 2,
        height: radius * 2,
      });
    }
  }
  if (arrowHead) rects.push(pointsBounds(arrowHead.points));
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return pointsBounds(
    rects.flatMap((rect): [number, number][] => [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y + rect.height],
    ]),
  );
};

export const withTechniqueBounds = (
  segment: Omit<
    ILXMTechniqueSegmentLayout,
    "bounds" | "visualBounds" | "collisionBounds"
  >,
): ILXMTechniqueSegmentLayout => {
  const visualBounds = getTechniqueVisualBounds(
    segment.path,
    segment.texts,
    segment.arrowHead,
  );
  return {
    ...segment,
    visualBounds,
    collisionBounds: padBounds(visualBounds, LXM_TECHNIQUE_COLLISION_PADDING),
    bounds: padBounds(visualBounds, LXM_TECHNIQUE_HIT_PADDING),
  };
};

/** 整体平移图元、端点和三类 bounds，保证渲染与命中始终一致。 */
export const translateTechniqueSegment = (
  segment: ILXMTechniqueSegmentLayout,
  dy: number,
): ILXMTechniqueSegmentLayout => {
  if (dy === 0) return segment;
  const moveRect = (rect: Rect): Rect => ({ ...rect, y: rect.y + dy });
  return {
    ...segment,
    path: segment.path
      ? { ...segment.path, d: translatePath(segment.path.d, dy) }
      : null,
    texts: segment.texts.map((label) => ({ ...label, y: label.y + dy })),
    ...(segment.arrowHead
      ? {
          arrowHead: {
            ...segment.arrowHead,
            points: segment.arrowHead.points.map(([x, y]): [number, number] => [
              x,
              y + dy,
            ]),
          },
        }
      : {}),
    ...(segment.focusEndpoints
      ? {
          focusEndpoints: {
            start: {
              ...segment.focusEndpoints.start,
              y: segment.focusEndpoints.start.y + dy,
            },
            end: {
              ...segment.focusEndpoints.end,
              y: segment.focusEndpoints.end.y + dy,
            },
          },
        }
      : {}),
    visualBounds: moveRect(segment.visualBounds),
    collisionBounds: moveRect(segment.collisionBounds),
    bounds: moveRect(segment.bounds),
  };
};
