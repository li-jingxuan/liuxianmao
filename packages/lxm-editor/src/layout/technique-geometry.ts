/** 技巧几何的包围框与平移工具；不读取 DOM，不重新生成技巧模板。 */
import {
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
  LXM_FRET_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_HALO_WIDTH,
  LXM_TECHNIQUE_ARROW_HEIGHT,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_COLLISION_PADDING,
  LXM_TECHNIQUE_CURVE_LABEL_GAP,
  LXM_TECHNIQUE_HIT_PADDING,
  LXM_TECHNIQUE_RANGE_INK_GAP,
  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
} from "./layout-constants";
import type {
  ILXMNoteLayout,
  ILXMTechniqueSegmentLayout,
  ILXMTextLayout,
} from "./layout-types";

type Rect = ILXMTechniqueSegmentLayout["bounds"];

/**
 * Arial 墨迹边界，不使用含行距的字体行框。Chrome canvas 实测：8px 的数字
 * ascent=5.75、最大 descent=.1015625（数字 3）；6px H/P ascent=4.294921875。
 * 普通文字仍保守覆盖大小写上缘，含 g/j/p/q/y 时保留 descender；未知字形
 * 回退到完整行框。横向维持既有保守宽度，所有白色描边另行计入。
 */
export const getTextBounds = (text: ILXMTextLayout, halo = 0): Rect => {
  const width = text.text.length * text.fontSize * 0.65;
  const digits = /^[\d<>]+$/.test(text.text);
  const capitals = /^[HP]+$/.test(text.text);
  const latin = /^[\x20-\x7e]*$/.test(text.text);
  const ascent = digits ? 5.75 / 8 : capitals ? 4.294921875 / 6 : latin ? 0.75 : 1;
  const descent = digits
    ? 0.1015625 / 8
    : capitals ? 0 : latin ? (/[gjpqy]/.test(text.text) ? 0.25 : 0.02) : 0.25;
  const left =
    text.textAnchor === "middle"
      ? width / 2
      : text.textAnchor === "end"
        ? width
        : 0;
  return {
    x: text.x - left - halo,
    y: text.y - text.fontSize * ascent - halo,
    width: width + halo * 2,
    height: text.fontSize * (ascent + descent) + halo * 2,
  };
};

/** 以真实弧顶而非控制点定位 H/P，字形和白色描边均不接触弧线。 */
export const placeCurveLabelAboveApex = (
  label: ILXMTextLayout,
  apexY: number,
  strokeWidth: number,
): ILXMTextLayout => {
  const bounds = getTextBounds(label, LXM_TECHNIQUE_TEXT_HALO_WIDTH);
  return {
    ...label,
    y: label.y + apexY - strokeWidth / 2 - LXM_TECHNIQUE_CURVE_LABEL_GAP -
      (bounds.y + bounds.height),
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
  // 整行扩高／平移后，相切边缘可能出现约 1e-13 的舍入差；不将其视为墨迹重叠。
  left.x < right.x + right.width - 1e-9 &&
  left.x + left.width > right.x + 1e-9 &&
  left.y < right.y + right.height - 1e-9 &&
  left.y + left.height > right.y + 1e-9;

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

/** 弧线逐段使用子曲线控制点凸包，避免把控制点和标签间的空白算成墨迹。 */
export const getTechniqueInkBounds = (
  segment: Pick<ILXMTechniqueSegmentLayout, "path" | "texts" | "arrowHead">,
): Rect[] => {
  const rects = segment.texts.map((label) =>
    getTextBounds(label, LXM_TECHNIQUE_TEXT_HALO_WIDTH),
  );
  if (!segment.path) {
    if (segment.arrowHead) rects.push(pointsBounds(segment.arrowHead.points));
    return rects;
  }
  if (segment.path.markerEnd || segment.arrowHead) {
    rects.push(getTechniqueVisualBounds(segment.path, [], segment.arrowHead));
    return rects;
  }
  const tokens = pathTokens(segment.path.d);
  let point: [number, number] = [0, 0];
  for (let i = 0; i < tokens.length; ) {
    const command = tokens[i++]!;
    const end: [number, number] = [Number(tokens[i++]), Number(tokens[i++])];
    if (command === "Q") {
      const control = end;
      const last: [number, number] = [Number(tokens[i++]), Number(tokens[i++])];
      const at = (t: number): [number, number] => [
        (1 - t) ** 2 * point[0] +
          2 * t * (1 - t) * control[0] +
          t * t * last[0],
        (1 - t) ** 2 * point[1] +
          2 * t * (1 - t) * control[1] +
          t * t * last[1],
      ];
      for (let step = 0; step < 16; step++) {
        const t0 = step / 16,
          t1 = (step + 1) / 16;
        const a = at(t0),
          b = at(t1),
          middle = at((t0 + t1) / 2);
        const c: [number, number] = [
          2 * middle[0] - (a[0] + b[0]) / 2,
          2 * middle[1] - (a[1] + b[1]) / 2,
        ];
        rects.push(
          padBounds(pointsBounds([a, c, b]), segment.path.strokeWidth / 2),
        );
      }
      point = last;
    } else {
      if (command === "L")
        rects.push(
          padBounds(pointsBounds([point, end]), segment.path.strokeWidth / 2),
        );
      point = end;
    }
  }
  return rects;
};

/** 区间标记只在原有上方通道内下移，逐图元检查整个范围，不能越过其它技巧。 */
export const compactRangeTechnique = (
  segment: ILXMTechniqueSegmentLayout,
  maxDown: number,
  obstacles: readonly Rect[],
): ILXMTechniqueSegmentLayout => {
  let down = maxDown;
  for (const piece of getTechniqueInkBounds(segment)) {
    for (const obstacle of obstacles) {
      if (piece.x >= obstacle.x + obstacle.width ||
          piece.x + piece.width <= obstacle.x ||
          obstacle.y + obstacle.height <= piece.y) continue;
      down = Math.min(down, Math.max(0,
        obstacle.y - piece.y - piece.height - LXM_TECHNIQUE_RANGE_INK_GAP));
    }
  }
  return down > 0 ? translateTechniqueSegment(segment, down) : segment;
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
  // 末端切线由核心模板最后两个点确定；保留旧 marker 契约供其他宿主兼容。
  if (segment.path?.markerEnd && !segment.path.arrowPoints) {
    const points = getPathPoints(segment.path.d);
    const end = points.at(-1)!;
    const previous = points.at(-2)!;
    const angle = Math.atan2(end[1] - previous[1], end[0] - previous[0]);
    const scale =
      Math.min(LXM_TECHNIQUE_ARROW_WIDTH, LXM_TECHNIQUE_ARROW_HEIGHT) / 10;
    segment = {
      ...segment,
      path: {
        ...segment.path,
        arrowPoints: [
          [0, 0],
          [10, 5],
          [0, 10],
        ].map(([x, y]): [number, number] => {
          const dx = (x! - 8) * scale,
            dy = (y! - 5) * scale;
          return [
            end[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
            end[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
          ];
        }),
      },
    };
  }
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
      ? {
          ...segment.path,
          d: translatePath(segment.path.d, dy),
          ...(segment.path.arrowPoints
            ? {
                arrowPoints: segment.path.arrowPoints.map(
                  ([x, y]): [number, number] => [x, y + dy],
                ),
              }
            : {}),
        }
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
