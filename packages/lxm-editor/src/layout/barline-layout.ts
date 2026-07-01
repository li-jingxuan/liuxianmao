import type { ILXMBarlineType } from "../core/types";
import {
  LXM_BARLINE_LINE_GAP,
  LXM_BARLINE_REPEAT_DOT_OFFSET_X,
  LXM_BARLINE_REPEAT_DOT_RADIUS,
  LXM_BARLINE_REPEAT_LOWER_DOT_OFFSET_Y,
  LXM_BARLINE_REPEAT_UPPER_DOT_OFFSET_Y,
  LXM_BARLINE_THICK_STROKE_WIDTH,
  LXM_BARLINE_THIN_STROKE_WIDTH,
} from "./layout-constants";
import type {
  ILXMBarlineLayout,
  ILXMBarlinePartLayout,
  ILXMStringLineLayout,
} from "./layout-types";

interface ILXMBarlineLinePatternPart {
  kind: "line";
  // 相对小节右边界的横向偏移；0 表示贴在小节最右侧。
  offsetX: number;
  // pattern 直接保存最终线宽，避免再引入 role 这类中间语义。
  strokeWidth: number;
}

interface ILXMBarlineDotPatternPart {
  kind: "dot";
  // 相对小节右边界的横向偏移。
  offsetX: number;
  // 相对第一根弦的纵向偏移。
  offsetY: number;
  // 反复点半径，渲染层可直接消费。
  radius: number;
}

type ILXMBarlinePatternPart =
  | ILXMBarlineLinePatternPart
  | ILXMBarlineDotPatternPart;

interface ILXMBarlinePattern {
  // 小节线的相对几何模板；layout 阶段会把它展开成绝对坐标。
  parts: ILXMBarlinePatternPart[];
}

// 复合小节线默认把“视觉主体”对齐到小节右边界，其他部件向左或向右偏移。
const LXM_BARLINE_LEFT_THIN_OFFSET_X = -LXM_BARLINE_LINE_GAP;
const LXM_BARLINE_LEFT_THICK_OFFSET_X = -LXM_BARLINE_LINE_GAP;
const LXM_BARLINE_LEFT_DOT_OFFSET_X = -LXM_BARLINE_REPEAT_DOT_OFFSET_X;
const LXM_BARLINE_RIGHT_DOT_OFFSET_X = LXM_BARLINE_REPEAT_DOT_OFFSET_X;

/** 构建一组反复点模板；点的 x 由调用方决定，y 使用固定弦间距偏移。 */
const buildRepeatDots = (offsetX: number): ILXMBarlineDotPatternPart[] => [
  // 上方反复点：使用相对几何偏移，layout 阶段再换算为绝对坐标。
  {
    kind: "dot",
    offsetX,
    offsetY: LXM_BARLINE_REPEAT_UPPER_DOT_OFFSET_Y,
    radius: LXM_BARLINE_REPEAT_DOT_RADIUS,
  },
  // 下方反复点：和上方点共享 x，只改变纵向偏移。
  {
    kind: "dot",
    offsetX,
    offsetY: LXM_BARLINE_REPEAT_LOWER_DOT_OFFSET_Y,
    radius: LXM_BARLINE_REPEAT_DOT_RADIUS,
  },
];

/**
 * 小节线相对几何模板。
 *
 * 这里不存最终 x/y，而是存相对小节右边界的 offset。这样同一套模板可以复用到
 * 任意小节宽度，layoutBarline 只需要结合 strings 算出真实坐标。
 */
const LXM_BARLINE_LAYOUT_PATTERN = {
  // 普通单小节线：一根细竖线。
  single: {
    parts: [
      {
        kind: "line",
        offsetX: 0,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
    ],
  },
  // 双小节线：两根细竖线，左侧线向小节内部偏移。
  double: {
    parts: [
      {
        kind: "line",
        offsetX: LXM_BARLINE_LEFT_THIN_OFFSET_X,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
      {
        kind: "line",
        offsetX: 0,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
    ],
  },
  // 终止线：左细右粗，粗线贴齐小节右边界。
  final: {
    parts: [
      {
        kind: "line",
        offsetX: LXM_BARLINE_LEFT_THIN_OFFSET_X,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
      {
        kind: "line",
        offsetX: 0,
        strokeWidth: LXM_BARLINE_THICK_STROKE_WIDTH,
      },
    ],
  },
  // 起始反复线：左粗右细，反复点在右侧。
  repeatStart: {
    parts: [
      {
        kind: "line",
        offsetX: LXM_BARLINE_LEFT_THICK_OFFSET_X,
        strokeWidth: LXM_BARLINE_THICK_STROKE_WIDTH,
      },
      {
        kind: "line",
        offsetX: 0,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
      ...buildRepeatDots(LXM_BARLINE_RIGHT_DOT_OFFSET_X),
    ],
  },
  // 结束反复线：反复点在左侧，右侧为左细右粗。
  repeatEnd: {
    parts: [
      ...buildRepeatDots(LXM_BARLINE_LEFT_DOT_OFFSET_X),
      {
        kind: "line",
        offsetX: LXM_BARLINE_LEFT_THIN_OFFSET_X,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
      {
        kind: "line",
        offsetX: 0,
        strokeWidth: LXM_BARLINE_THICK_STROKE_WIDTH,
      },
    ],
  },
  // 双向反复线：左侧结束反复点 + 中间线组 + 右侧起始反复点。
  repeatBoth: {
    parts: [
      ...buildRepeatDots(LXM_BARLINE_LEFT_DOT_OFFSET_X),
      {
        kind: "line",
        offsetX: LXM_BARLINE_LEFT_THICK_OFFSET_X,
        strokeWidth: LXM_BARLINE_THICK_STROKE_WIDTH,
      },
      {
        kind: "line",
        offsetX: 0,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
      ...buildRepeatDots(LXM_BARLINE_RIGHT_DOT_OFFSET_X),
    ],
  },
} satisfies Record<ILXMBarlineType, ILXMBarlinePattern>;

/** 获取最上方弦线；不假设 strings 一定按 index 排好序。 */
const getFirstStringLine = (
  strings: ILXMStringLineLayout[],
): ILXMStringLineLayout | undefined =>
  strings.reduce<ILXMStringLineLayout | undefined>(
    (firstString, string) =>
      !firstString || string.index < firstString.index ? string : firstString,
    undefined,
  );

/** 获取最下方弦线；用于决定小节线竖线的结束 y。 */
const getLastStringLine = (
  strings: ILXMStringLineLayout[],
): ILXMStringLineLayout | undefined =>
  strings.reduce<ILXMStringLineLayout | undefined>(
    (lastString, string) =>
      !lastString || string.index > lastString.index ? string : lastString,
    undefined,
  );

/** 把单个 pattern part 从相对几何转换为渲染层可直接使用的绝对坐标。 */
const layoutBarlinePart = (
  part: ILXMBarlinePatternPart,
  context: {
    baseX: number;
    topY: number;
    bottomY: number;
  },
): ILXMBarlinePartLayout => {
  const { baseX, topY, bottomY } = context;

  if (part.kind === "line") {
    return {
      kind: "line",
      x: baseX + part.offsetX,
      // 竖线只覆盖六线谱区域，从第一根弦连到最后一根弦。
      y1: topY,
      y2: bottomY,
      strokeWidth: part.strokeWidth,
    };
  }

  return {
    kind: "dot",
    cx: baseX + part.offsetX,
    cy: topY + part.offsetY,
    radius: part.radius,
  };
};

/** 根据弦线几何和小节线类型，展开最终可渲染的小节线 parts。 */
export const layoutBarline = (
  barline: ILXMBarlineType,
  strings: ILXMStringLineLayout[],
): ILXMBarlineLayout => {
  const firstString = getFirstStringLine(strings);
  const lastString = getLastStringLine(strings);

  if (!firstString || !lastString) {
    return { type: barline, parts: [] };
  }

  const pattern = LXM_BARLINE_LAYOUT_PATTERN[barline];
  const context = {
    // 小节线默认以小节右边界作为横向基准点。
    baseX: firstString.x2,
    // 反复点的 offsetY 也以第一根弦 y 为纵向基准。
    topY: firstString.y1,
    bottomY: lastString.y1,
  };

  return {
    type: barline,
    parts: pattern.parts.map((part) => layoutBarlinePart(part, context)),
  };
};
