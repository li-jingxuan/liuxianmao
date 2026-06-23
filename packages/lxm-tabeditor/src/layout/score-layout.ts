import { GUITAR_STRING_COUNT } from "../core/constants";
import type { Measure, Score, TimeSignature } from "../core/schema";
import {
  FIXED_MEASURES_PER_SYSTEM,
  FIXED_SCORE_LAYOUT_WIDTH,
  SYSTEM_GAP,
  SYSTEM_HEADER_WIDTH,
  SYSTEM_HEIGHT,
} from "./layout-constants";
import { clamp, containsPoint } from "./layout-helpers";
import { layoutMeasure } from "./measure-layout";
import type {
  LaidOutBeat,
  LaidOutSystem,
  LayoutHitIndex,
  ScoreLayout,
  ScoreLayoutHit,
  ScoreLayoutOptions,
} from "./layout-types";

export * from "./layout-constants";
export * from "./layout-types";
export { layoutMeasure } from "./measure-layout";

/**
 * 六线谱只读排版模块门面。
 *
 * 这个文件现在只保留“跨小节/跨 system 的流程编排”和对外导出：
 * - 组织整行 system 布局
 * - 组织整首谱的系统切分
 * - 对 layout 结果做命中测试
 *
 * 小节内部几何、时值专属排版和基础辅助函数已经下沉到各自子模块中，
 * 这样调用方依然只需要导入 `score-layout.ts`，但内部职责边界会清楚得多。
 */

/**
 * 排版一个 system，也就是一行六线谱。
 *
 * system 层负责把当前行内的小节按固定宽度均分，并维护拍号的继承关系。
 * 单个小节可以声明 timeSignature；未声明时沿用前一个有效拍号。
 */
export const layoutSystem = (
  measures: Measure[],
  context: {
    index: number;
    startMeasureIndex: number;
    x: number;
    y: number;
    width: number;
    initialTimeSignature: TimeSignature;
    previousTimeSignature: TimeSignature;
    hitIndex: LayoutHitIndex;
  },
): LaidOutSystem => {
  let effectiveTimeSignature = context.previousTimeSignature;

  /**
   * 当前 MVP 采用行内小节等宽分配。
   * 可用宽度先扣掉 system 行头，再按本行实际小节数均分。
   */
  const measureWidth =
    (context.width - SYSTEM_HEADER_WIDTH) / Math.max(1, measures.length);

  const laidOutMeasures = measures.map((measure, offset) => {
    const nextTimeSignature = measure.timeSignature ?? effectiveTimeSignature;
    /**
     * 拍号显示规则：
     * - 全谱第一小节必须显示；
     * - 当前小节声明了不同于前一有效拍号的拍号时显示；
     * - 首个小节显式拍号与 score.meta 不一致时也显示，避免元信息和小节信息冲突不可见。
     */
    const showTimeSignature =
      context.startMeasureIndex + offset === 0 ||
      nextTimeSignature.numerator !== effectiveTimeSignature.numerator ||
      nextTimeSignature.denominator !== effectiveTimeSignature.denominator ||
      (context.index === 0 &&
        offset === 0 &&
        (nextTimeSignature.numerator !==
          context.initialTimeSignature.numerator ||
          nextTimeSignature.denominator !==
            context.initialTimeSignature.denominator));

    const laidOutMeasure = layoutMeasure(measure, {
      index: context.startMeasureIndex + offset,
      x: context.x + SYSTEM_HEADER_WIDTH + measureWidth * offset,
      y: context.y,
      width: measureWidth,
      timeSignature: nextTimeSignature,
      showTimeSignature,
      hitIndex: context.hitIndex,
    });
    /** 当前小节排完后更新有效拍号，供下一小节继承。 */
    effectiveTimeSignature = nextTimeSignature;
    return laidOutMeasure;
  });

  return {
    index: context.index,
    x: context.x,
    y: context.y,
    width: context.width,
    height: SYSTEM_HEIGHT,
    measures: laidOutMeasures,
  };
};

/**
 * 排版完整 score。
 *
 * 当前 MVP 只读取第一条 track。算法步骤：
 * 1. 使用固定 SVG 内部坐标宽度；
 * 2. 使用固定每行小节数切片生成多个 system；
 * 3. 在切换 system 时携带上一行结束后的有效拍号，保证跨行拍号继承正确。
 */
export const layoutScore = (
  score: Score,
  options: ScoreLayoutOptions = {},
): ScoreLayout => {
  const track = score.tracks[0];
  const zoom = clamp(options.zoom ?? 1, 0.5, 2);

  /**
   * viewBox 使用未缩放坐标，实际 DOM width/height 再乘 zoom。
   * 宽度不再跟随容器变化，避免 MVP 阶段引入响应式排版分支。
   */
  const width = options.width ?? FIXED_SCORE_LAYOUT_WIDTH;

  /**
   * 每行小节数固定为 4。
   * 测试可通过 measuresPerSystem 覆盖，但产品运行时不根据容器宽度动态改变。
   */
  const measureSlots = Math.max(
    1,
    Math.floor(options.measuresPerSystem ?? FIXED_MEASURES_PER_SYSTEM),
  );
  const hitIndex: LayoutHitIndex = { measures: {}, beats: {}, notes: {} };
  if (!track) {
    return {
      width,
      height: 0,
      zoom,
      tempo: score.meta.tempo,
      systems: [],
      hitIndex,
    };
  }

  let effectiveTimeSignature = score.meta.timeSignature;
  const systems: LaidOutSystem[] = [];

  /** 按 measureSlots 对小节数组分段，每段生成一个 system。 */
  for (
    let startMeasureIndex = 0;
    startMeasureIndex < track.measures.length;
    startMeasureIndex += measureSlots
  ) {
    const systemMeasures = track.measures.slice(
      startMeasureIndex,
      startMeasureIndex + measureSlots,
    );
    const system = layoutSystem(systemMeasures, {
      index: systems.length,
      startMeasureIndex,
      x: 0,
      y: systems.length * (SYSTEM_HEIGHT + SYSTEM_GAP),
      width,
      initialTimeSignature: score.meta.timeSignature,
      previousTimeSignature: effectiveTimeSignature,
      hitIndex,
    });
    systems.push(system);
    const lastMeasure = systemMeasures.at(-1);
    /** 下一行的初始拍号必须继承上一行最后一个显式拍号。 */
    if (lastMeasure?.timeSignature) {
      effectiveTimeSignature = lastMeasure.timeSignature;
    }
  }

  return {
    width,
    height:
      systems.length * SYSTEM_HEIGHT +
      Math.max(0, systems.length - 1) * SYSTEM_GAP,
    zoom,
    tempo: score.meta.tempo,
    systems,
    hitIndex,
  };
};

/**
 * 将 SVG 坐标命中到最近的拍点和弦线。
 *
 * 交互层不直接读取 DOM 元素 id，而是把指针坐标转换到 layout 坐标系后调用这里。
 * x 方向选择当前小节中距离最近的 beat，y 方向按弦距四舍五入到 1..6 弦。
 */
export const hitTestScoreLayout = (
  layout: ScoreLayout,
  point: { x: number; y: number },
): ScoreLayoutHit | null => {
  for (const system of layout.systems) {
    for (const measure of system.measures) {
      const measureBounds = layout.hitIndex.measures[measure.id];
      if (!measureBounds || !containsPoint(measureBounds, point.x, point.y)) {
        continue;
      }

      const beat = measure.beats.reduce<LaidOutBeat | null>((closest, item) => {
        if (!closest) return item;
        return Math.abs(item.x - point.x) < Math.abs(closest.x - point.x)
          ? item
          : closest;
      }, null);
      if (!beat) return null;

      const rawString =
        (point.y - measure.y - measure.staffTop) / measure.stringSpacing + 1;
      return {
        measureId: measure.id,
        beatId: beat.id,
        tick: beat.tick,
        string: clamp(Math.round(rawString), 1, GUITAR_STRING_COUNT),
      };
    }
  }

  return null;
};
