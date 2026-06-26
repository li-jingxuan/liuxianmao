import { GUITAR_STRING_COUNT } from "../core/constants";
import type { Measure, Score, TimeSignature } from "../core/schema";
import {
  FIXED_SCORE_LAYOUT_WIDTH,
  HIT_PADDING,
  SYSTEM_GAP,
  SYSTEM_HEADER_WIDTH,
  SYSTEM_HEIGHT,
} from "./layout-constants";
import { clamp, containsPoint } from "./layout-helpers";
import { layoutMeasure } from "./measure-layout";
import { summarizeMeasureSpacingWidth } from "./measure-spacing";
import {
  createSystemBreaks,
  type MeasureBreakSummary,
} from "./system-breaking";
import type {
  LaidOutBeat,
  LaidOutNote,
  LaidOutSystem,
  LaidOutTie,
  LaidOutTieSegment,
  LayoutHitIndex,
  ScoreLayout,
  ScoreLayoutHit,
  ScoreLayoutOptions,
} from "./layout-types";

export * from "./layout-constants";
export * from "./layout-types";
export { layoutMeasure } from "./measure-layout";

const TIE_SYSTEM_PADDING = 12;

interface TieAnchor {
  note: LaidOutNote;
  systemIndex: number;
  systemX: number;
  systemWidth: number;
}

interface TieSystemBounds {
  x: number;
  width: number;
}

interface MeasureWidthSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
}

const containsEditGridSlotPoint = (
  context: { x: number; width: number; y: number; height: number },
  point: { x: number; y: number },
): boolean =>
  point.x >= context.x &&
  point.x < context.x + context.width &&
  point.y >= context.y &&
  point.y <= context.y + context.height;

const allocateMeasureWidths = (
  summaries: MeasureWidthSummary[],
  availableWidth: number,
): number[] => {
  if (summaries.length === 0) return [];

  const totalMinWidth = summaries.reduce(
    (total, summary) => total + summary.minWidth,
    0,
  );
  const totalIdealWidth = summaries.reduce(
    (total, summary) => total + summary.idealWidth,
    0,
  );

  if (availableWidth <= totalMinWidth) {
    return summaries.map((summary) => summary.minWidth);
  }

  if (availableWidth >= totalIdealWidth) {
    return summaries.map((summary) => summary.idealWidth);
  }

  /**
   * system 宽度介于最小宽度和理想宽度之间时，按每个小节可压缩空间等比例压缩。
   * 如果理想宽度没有占满整行，则不会把剩余空间强行塞回小节，而是留在行尾。
   */
  const compressibleWidth = totalIdealWidth - totalMinWidth;
  const targetCompression = totalIdealWidth - availableWidth;

  return summaries.map((summary) => {
    const compression =
      compressibleWidth > 0
        ? ((summary.idealWidth - summary.minWidth) / compressibleWidth) *
          targetCompression
        : 0;

    return summary.idealWidth - compression;
  });
};

const getPreviousTimeSignature = (
  measures: Measure[],
  startMeasureIndex: number,
  fallback: TimeSignature,
): TimeSignature => {
  let active = fallback;

  for (let index = 0; index < startMeasureIndex; index += 1) {
    active = measures[index]?.timeSignature ?? active;
  }

  return active;
};

/**
 * 根据 tie 的起点/终点锚点，生成真正可渲染的 tie segment 列表。
 *
 * 这里要刻意区分两个层级：
 * 1. `tie` 是音乐语义上的“某个音延到另一个音”；
 * 2. `segment` 是 SVG 渲染层真正要画出来的几何片段。
 *
 * 之所以不能直接输出一条 `source -> target` 的完整曲线，是因为 tie 可能跨行：
 * - 同一 system 内：可以直接画一段 single；
 * - 跨 system：必须拆成 start / middle / end，分别落在各自行内，
 *   否则页面层会画出一条穿过两行之间空白区域的长曲线，视觉上是错误的。
 *
 * 当前规则采用固定的 `TIE_SYSTEM_PADDING` 作为行首/行尾的安全内缩，
 * 让跨行 tie 在视觉上停在 system 边缘以内，而不是贴住边框。
 * 这样页面层只消费几何结果，不需要再理解分页规则。
 */
const buildTieSegments = (
  tieId: string,
  systemBoundsByIndex: Map<number, TieSystemBounds>,
  source: TieAnchor,
  target: TieAnchor,
): LaidOutTieSegment[] => {
  /**
   * 最简单的情况：源音和目标音在同一行。
   * 这时不需要分页拆分，直接输出单段即可，后续渲染层会把它画成一条完整弧线。
   */
  if (source.systemIndex === target.systemIndex) {
    return [
      {
        id: `${tieId}__single`,
        tieId,
        systemIndex: source.systemIndex,
        role: "single",
        x1: source.note.x,
        y1: source.note.y,
        x2: target.note.x,
        y2: target.note.y,
      },
    ];
  }

  /**
   * 跨行 tie 的第一段：
   * 从源音开始，延伸到当前 system 的右边界内缩位置。
   * 这里的 y 保持源音高度，视觉上表示“这一行里的延音仍在继续”。
   */
  const segments: LaidOutTieSegment[] = [
    {
      id: `${tieId}__start`,
      tieId,
      systemIndex: source.systemIndex,
      role: "start",
      x1: source.note.x,
      y1: source.note.y,
      x2: source.systemX + source.systemWidth - TIE_SYSTEM_PADDING,
      y2: source.note.y,
    },
  ];

  /**
   * 如果 source 和 target 中间还隔着完整的 system，就为这些中间行补齐 middle 段。
   * 这一步是为未来多行连续延音做兼容：虽然当前示例主要是 start/end，
   * 但数据模型不应该把自己锁死在“最多跨两行”的假设上。
   */
  for (
    let systemIndex = source.systemIndex + 1;
    systemIndex < target.systemIndex;
    systemIndex += 1
  ) {
    const systemBounds = systemBoundsByIndex.get(systemIndex);
    if (!systemBounds) continue;
    const segment = {
      id: `${tieId}__middle__${systemIndex}`,
      tieId,
      systemIndex,
      role: "middle" as const,
      x1: systemBounds.x + TIE_SYSTEM_PADDING,
      y1: source.note.y,
      x2: systemBounds.x + systemBounds.width - TIE_SYSTEM_PADDING,
      y2: source.note.y,
    };
    segments.push(segment);
  }

  /**
   * 跨行 tie 的最后一段：
   * 从目标 system 的左边界内缩位置开始，收束到目标音。
   * 这样上一行会表现为“延出去”，下一行表现为“接进来”。
   */
  segments.push({
    id: `${tieId}__end`,
    tieId,
    systemIndex: target.systemIndex,
    role: "end",
    x1: target.systemX + TIE_SYSTEM_PADDING,
    y1: target.note.y,
    x2: target.note.x,
    y2: target.note.y,
  });

  return segments;
};

/**
 * 从整首谱的 laid out notes 中重建 tie 关系，并为每条 tie 生成可渲染的 segment。
 *
 * layoutMeasure 只负责把单个 note 的局部几何算出来，并顺手保留
 * `tieTargetNoteId` 这种“关系线索”；它并不知道目标音最终会落在哪个 system。
 * 因此真正的 tie 汇总必须放在 score 级别：
 *
 * 1. 先遍历所有 system / measure / note，收集带 system 信息的 `TieAnchor`；
 * 2. 用 `note.id -> TieAnchor` 建索引，便于 O(1) 找到目标音；
 * 3. 对每个带 `tieTargetNoteId` 的源音，找到目标锚点；
 * 4. 再调用 `buildTieSegments`，把逻辑 tie 转成实际渲染片段。
 *
 * 这个拆分有两个直接收益：
 * - 页面层不再需要自己解析 `targetNoteId`、推断目标坐标、理解跨行分页；
 * - tie 的数据结构天然支持后续扩展，例如跨更多 system、编辑态高亮、选中某条 tie 等。
 */
const buildLaidOutTies = (systems: LaidOutSystem[]): LaidOutTie[] => {
  /**
   * 先把每一行 system 的水平边界提取出来。
   * `buildTieSegments` 在构造 start / middle / end 时只关心“这一行从哪里开始，到哪里结束”，
   * 不需要重复扫描整棵 layout 树。
   */
  const systemBoundsByIndex = new Map(
    systems.map((system) => [
      system.index,
      { x: system.x, width: system.width } satisfies TieSystemBounds,
    ]),
  );

  /**
   * 给每个音符补上“它位于哪一行”的上下文，形成 tie 计算用的锚点。
   * 注意这里保留的是绝对 SVG 坐标，而不是局部 measure 坐标，
   * 这样后面的 tie segment 可以直接拿去渲染。
   */
  const anchors = systems.flatMap((system) =>
    system.measures.flatMap((measure) =>
      measure.notes.map((note) => ({
        note,
        systemIndex: system.index,
        systemX: system.x,
        systemWidth: system.width,
      })),
    ),
  );

  /**
   * tie 的目标引用是 `targetNoteId`，所以需要先建一个按 note id 查询的索引。
   * 这样每条 tie 关系都能在常数时间内定位到目标音，而不是每次都全量扫描 notes。
   */
  const anchorByNoteId = new Map(
    anchors.map((anchor) => [anchor.note.id, anchor] as const),
  );

  return anchors.flatMap((sourceAnchor) => {
    /** 没有 tieTargetNoteId 的音符不参与 tie 几何构建。 */
    const targetId = sourceAnchor.note.tieTargetNoteId;
    if (!targetId) return [];

    /** 目标音不存在时直接跳过，避免异常打断渲染；语义问题由 validation 层兜底。 */
    const targetAnchor = anchorByNoteId.get(targetId);
    if (!targetAnchor) return [];

    const tieId = `${sourceAnchor.note.id}__${targetAnchor.note.id}`;
    return [
      {
        id: tieId,
        fromNoteId: sourceAnchor.note.id,
        toNoteId: targetAnchor.note.id,
        fromMeasureId: sourceAnchor.note.measureId,
        toMeasureId: targetAnchor.note.measureId,
        segments: buildTieSegments(
          tieId,
          systemBoundsByIndex,
          sourceAnchor,
          targetAnchor,
        ),
      },
    ];
  });
};

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
 * system 层负责把当前行内的小节按内容密度分配宽度，并维护拍号的继承关系。
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
    editingRhythm?: ScoreLayoutOptions["editingRhythm"];
  },
): LaidOutSystem => {
  let effectiveTimeSignature = context.previousTimeSignature;

  /**
   * 可用宽度先扣掉 system 行头，再按小节的 min/ideal width 分配。
   * 这一步替代旧的等宽小节，让三十二分等密集内容拥有更多水平空间。
   */
  const availableMeasureWidth = context.width - SYSTEM_HEADER_WIDTH;
  const measureSummaries = measures.map((measure) => {
    const summary = summarizeMeasureSpacingWidth(measure);
    return {
      measureId: summary.measureId,
      minWidth: summary.minWidth,
      idealWidth: summary.idealWidth,
    } satisfies MeasureWidthSummary;
  });
  const measureWidths = allocateMeasureWidths(
    measureSummaries,
    availableMeasureWidth,
  );
  let measureX = context.x + SYSTEM_HEADER_WIDTH;

  // 小节数据结构
  const laidOutMeasures = measures.map((measure, offset) => {
    const nextTimeSignature = measure.timeSignature ?? effectiveTimeSignature;
    const measureWidth =
      measureWidths[offset] ??
      availableMeasureWidth / Math.max(1, measures.length);
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
      x: measureX,
      y: context.y,
      width: measureWidth,
      timeSignature: nextTimeSignature,
      showTimeSignature,
      hitIndex: context.hitIndex,
      editingRhythm: context.editingRhythm,
    });
    /** 当前小节排完后更新有效拍号，供下一小节继承。 */
    effectiveTimeSignature = nextTimeSignature;
    measureX += measureWidth;
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
 * 2. 为每个小节预估 min/ideal width；
 * 3. 默认使用 system breaker 自动分行，显式传 measuresPerSystem 时保留固定切片；
 * 4. 每行内部再按内容密度分配小节宽度。
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

  const forcedMeasuresPerSystem = options.measuresPerSystem
    ? Math.max(1, Math.floor(options.measuresPerSystem))
    : undefined;
  const hitIndex: LayoutHitIndex = { measures: {}, beats: {}, notes: {} };
  if (!track) {
    return {
      width,
      height: 0,
      zoom,
      tempo: score.meta.tempo,
      systems: [],
      ties: [],
      hitIndex,
    };
  }

  const measureSummaries = Object.fromEntries(
    track.measures.map((measure) => {
      const summary = summarizeMeasureSpacingWidth(measure);
      return [
        measure.id,
        {
          measureId: summary.measureId,
          minWidth: summary.minWidth,
          idealWidth: summary.idealWidth,
        } satisfies MeasureBreakSummary,
      ];
    }),
  );
  const systemBreaks = createSystemBreaks(track.measures, measureSummaries, {
    availableWidth: width - SYSTEM_HEADER_WIDTH,
    forcedMeasuresPerSystem,
  });

  const systems = systemBreaks.map((systemBreak, systemIndex) => {
    const systemMeasures = track.measures.slice(
      systemBreak.startMeasureIndex,
      systemBreak.endMeasureIndex,
    );

    return layoutSystem(systemMeasures, {
      index: systemIndex,
      startMeasureIndex: systemBreak.startMeasureIndex,
      x: 0,
      y: systemIndex * (SYSTEM_HEIGHT + SYSTEM_GAP),
      width,
      initialTimeSignature: score.meta.timeSignature,
      previousTimeSignature: getPreviousTimeSignature(
        track.measures,
        systemBreak.startMeasureIndex,
        score.meta.timeSignature,
      ),
      hitIndex,
      editingRhythm: options.editingRhythm,
    });
  });

  const ties = buildLaidOutTies(systems);

  return {
    width,
    height:
      systems.length * SYSTEM_HEIGHT +
      Math.max(0, systems.length - 1) * SYSTEM_GAP,
    zoom,
    tempo: score.meta.tempo,
    systems,
    ties,
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

      const rawString =
        (point.y - measure.y - measure.staffTop) / measure.stringSpacing + 1;
      const string = clamp(Math.round(rawString), 1, GUITAR_STRING_COUNT);
      const slot = measure.editGrid?.slots.find((item) =>
        containsEditGridSlotPoint(
          {
            x: item.x,
            y: measure.y + measure.staffTop - HIT_PADDING,
            width: item.width,
            height: measure.staffHeight + HIT_PADDING * 2,
          },
          point,
        ),
      );

      if (slot) {
        /**
         * gap slot 和 beat slot 共享同一套命中矩形，但命令层后续处理完全不同：
         * - beat slot 仍然回指 coveringBeatId，表示“在已有 beat 内部写入”；
         * - gap slot 不再伪装成最近 beat，而是显式返回 gap 范围，让 reducer
         *   知道这次写入要 materialize 一段全新的真实时间线片段。
         */
        if (slot.kind === "gap") {
          return {
            measureId: measure.id,
            tick: slot.tick,
            string,
            slotId: slot.id,
            slotKind: "gap",
            gapStartTick: slot.gapStartTick,
            gapEndTick: slot.gapEndTick,
          };
        }

        return {
          measureId: measure.id,
          beatId: slot.coveringBeatId,
          tick: slot.tick,
          string,
          slotId: slot.id,
          slotKind: "beat",
        };
      }

      const beat = measure.beats.reduce<LaidOutBeat | null>((closest, item) => {
        if (!closest) return item;
        return Math.abs(item.x - point.x) < Math.abs(closest.x - point.x)
          ? item
          : closest;
      }, null);
      if (!beat) return null;

      return {
        measureId: measure.id,
        beatId: beat.id,
        tick: beat.tick,
        string,
      };
    }
  }

  return null;
};
