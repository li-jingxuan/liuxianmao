import { GUITAR_STRING_COUNT } from "../core/constants";
import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
} from "../core/rhythm";
import type {
  Beat,
  Measure,
  RhythmValue,
  Score,
  TimeSignature,
  TupletGroup,
} from "../core/schema";

/**
 * 六线谱只读排版模块。
 *
 * 这里的坐标系使用 SVG 用户坐标：左上角为原点，x 向右递增，y 向下递增。
 * 核心职责是把领域模型里的音乐时间（tick、小节、拍号、连音组）转换成稳定的二维几何信息。
 * React 页面只消费这些几何结果绘制 SVG，不在组件里重复推导拍点、弦线或命中区域。
 */
export const FIXED_SCORE_LAYOUT_WIDTH = 1040;
export const FIXED_MEASURES_PER_SYSTEM = 4;

/**
 * 当前 MVP 只按 720p 桌面基线设计，不做响应式重排。
 * 后续如果接入真实制谱碰撞规避，可以继续在这个模块里扩展，而不影响页面渲染层。
 */
const SYSTEM_GAP = 34;
const SYSTEM_HEIGHT = 142;

/** system 左侧保留 TAB 前缀、拍号等行头空间，小节从这个 x 偏移后开始。 */
const SYSTEM_HEADER_WIDTH = 88;

/** 小节内左右留白，避免 tick=0 或小节末尾的数字压到小节线。 */
const MEASURE_PADDING_X = 18;

/** 六线谱第一根弦相对小节顶部的 y 坐标。 */
const STAFF_TOP = 54;

/** 时值轨道放在六线谱上方，用来单独画时值头、符干和连梁，避免与品位数字打架。 */
const DURATION_LANE_Y = STAFF_TOP + 5;

// 连音符号竖线高度、与时值轨道的间距
const TUPLET_HEIGHT = 4;
const TUPLET_MARGIN_TOP = DURATION_LANE_Y + TUPLET_HEIGHT + 14;

/** 符干基础长度，额外的多层连梁会在此基础上继续向下延展。 */
const DURATION_STEM_LENGTH = 14;

/** 多层符尾或多层连梁之间的垂直间距。 */
const DURATION_LEVEL_GAP = 4;

/** 相邻弦线的垂直间距；六条弦实际高度为 5 个间距。 */
const STRING_SPACING = 11;
const STRING_LINE_WIDTH = 1;
const STAFF_HEIGHT = STRING_SPACING * (GUITAR_STRING_COUNT - 1);

/** 命中区域比视觉图形略大，下一迭代点击定位时更容易命中音符或拍点。 */
const HIT_PADDING = 8;

/** layoutScore 的外部输入只保留缩放和测试覆盖用的固定宽度，不再读取容器宽度。 */
export interface ScoreLayoutOptions {
  zoom?: number;
  width?: number;
  measuresPerSystem?: number;
}

/** 矩形边界统一使用 SVG 坐标，供命中测试和可视区域计算复用。 */
export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 按领域 id 建立几何索引。
 * Iteration 3 的点击、框选和键盘定位可以直接查这个索引，避免重新遍历 layout 树。
 */
export interface LayoutHitIndex {
  measures: Record<string, LayoutBounds>;
  beats: Record<string, LayoutBounds>;
  notes: Record<string, LayoutBounds>;
}

/** 拍点布局结果：x 是拍点起始位置，width 是该拍时值在当前小节内占用的水平长度。 */
export interface LaidOutBeat {
  id: string;
  measureId: string;
  kind: Beat["kind"];
  tick: number;
  x: number;
  width: number;
  rhythm: RhythmValue;
}

/** 音符布局结果：同一拍多根弦会共享 x，通过 string 映射到不同 y。 */
export interface LaidOutNote {
  id: string;
  beatId: string;
  measureId: string;
  fret: string;
  string: number;
  x: number;
  y: number;
  tied: boolean;
  ghost: boolean;
}

/** 休止符布局结果：symbol 使用 Bravura 的 SMuFL 私用区码点，普通文本不使用该字体。 */
export interface LaidOutRest {
  id: string;
  measureId: string;
  rhythm: RhythmValue;
  symbol: string;
  x: number;
  y: number;
}

/** 音符时值布局结果：一个 notes beat 只生成一条时值标记，多弦和弦共享同一份时值几何。 */
export interface LaidOutDurationMark {
  beatId: string;
  measureId: string;
  x: number;
  y: number;
  base: RhythmValue["base"];
  dots: RhythmValue["dots"];
  notehead: "whole" | "half" | "filled";
  hasStem: boolean;
  stemX: number;
  stemTopY: number;
  stemBaseY: number;
  stemBottomY: number;
  flagCount: 0 | 1 | 2 | 3;
}

/** 连梁按层输出：八分为 level=1，十六分在同一组上再追加 level=2，以此类推。 */
export interface LaidOutBeamGroup {
  measureId: string;
  beatIds: string[];
  level: 1 | 2 | 3;
  x1: number;
  x2: number;
  y: number;
}

/** 连音组括号布局结果：x1/x2 覆盖连音组从首拍开始到末拍结束的范围。 */
export interface LaidOutTuplet {
  id: string;
  measureId: string;
  number: number;
  x1: number;
  x2: number;
  y: number;
  bracket: Exclude<TupletGroup["bracket"], "hide">;
}

/** 小节布局结果，包含渲染小节所需的所有局部几何信息。 */
export interface LaidOutMeasure {
  id: string;
  index: number;
  number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  staffTop: number;
  staffHeight: number;
  stringSpacing: number;
  capacityTicks: number;
  timeSignature: TimeSignature;
  showTimeSignature: boolean;
  barline: Measure["barline"];
  beats: LaidOutBeat[];
  notes: LaidOutNote[];
  rests: LaidOutRest[];
  durationMarks: LaidOutDurationMark[];
  beamGroups: LaidOutBeamGroup[];
  tuplets: LaidOutTuplet[];
}

/** system 表示一行谱表；当前只排第一条吉他轨，但结构允许后续扩展多轨。 */
export interface LaidOutSystem {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  measures: LaidOutMeasure[];
}

/** 完整谱面 layout 输出，页面层只需遍历 systems 即可绘制。 */
export interface ScoreLayout {
  width: number;
  height: number;
  zoom: number;
  tempo: number;
  systems: LaidOutSystem[];
  hitIndex: LayoutHitIndex;
}

export interface ScoreLayoutHit {
  measureId: string;
  beatId: string;
  tick: number;
  string: number;
}

/** Bravura SMuFL 休止符码点，只在 rest 渲染时配合 music-icon 字体类使用。 */
const REST_SYMBOLS: Record<RhythmValue["base"], string> = {
  whole: "\uE4E3",
  half: "\uE4E4",
  quarter: "\uE4E5",
  eighth: "\uE4E6",
  sixteenth: "\uE4E7",
  thirtySecond: "\uE4E8",
};

/** 把数值限制在闭区间内，避免缩放、tick 比例或小节数量越界。 */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * 把吉他弦号映射为 y 坐标。
 *
 * 模型里的 string 从 1 开始计数，所以这里先减 1 再乘弦距。
 * 公式：y = 小节顶部 + 第一根弦偏移 + (弦号 - 1) * 弦距。
 */
const getStringY = (measureY: number, stringIndex: number): number =>
  measureY + STAFF_TOP + (stringIndex - 1) * STRING_SPACING;

/**
 * 查找某个 beat 所属的连音组，并只返回节奏换算需要的倍率字段。
 * calculateRhythmTicks 会用 normalNotes / actualNotes 把普通时值压缩或拉伸为连音 tick。
 */
const getBeatTuplet = (
  beatId: string,
  tuplets: TupletGroup[],
): Pick<TupletGroup, "actualNotes" | "normalNotes"> | undefined => {
  const tuplet = tuplets.find((item) => item.beatIds.includes(beatId));
  return tuplet
    ? { actualNotes: tuplet.actualNotes, normalNotes: tuplet.normalNotes }
    : undefined;
};

/**
 * 计算一个 beat 在时间轴上的真实长度。
 * 如果组合无法整除为整数 tick，前置语义校验会报错；layout 这里降级为 0，避免异常打断渲染。
 */
const getBeatTicks = (beat: Beat, tuplets: TupletGroup[]): number => {
  const result = calculateRhythmTicks(
    beat.rhythm,
    getBeatTuplet(beat.id, tuplets),
  );
  return result.ok ? result.ticks : 0;
};

/**
 * 将小节内 tick 映射为 SVG x 坐标。
 *
 * 关键公式：
 * 1. usableWidth = 小节宽度 - 左右留白
 * 2. progress = beat.tick / 小节容量 tick
 * 3. x = 小节左边界 + 左留白 + usableWidth * progress
 *
 * clamp(progress, 0, 1) 可以防止非法或临界数据把元素画到小节外。
 */
const getBeatX = (
  measureX: number,
  measureWidth: number,
  tick: number,
  capacityTicks: number,
): number => {
  const usableWidth = measureWidth - MEASURE_PADDING_X * 2;
  const progress = capacityTicks > 0 ? tick / capacityTicks : 0;

  return measureX + MEASURE_PADDING_X + usableWidth * clamp(progress, 0, 1);
};

/** 休止符放在六线谱垂直中线附近，后续可按具体休止符类型细调 y。 */
const getRestY = (measureY: number): number =>
  measureY + STAFF_TOP + STAFF_HEIGHT / 2;

/** whole / half 用空心头，quarter 及更短时值统一用实心头。 */
const getDurationNotehead = (
  base: RhythmValue["base"],
): LaidOutDurationMark["notehead"] => {
  switch (base) {
    case "whole":
      return "whole";
    case "half":
      return "half";
    default:
      return "filled";
  }
};

/** flagCount 表示该 beat 需要几层符尾；参与连梁时同样用于决定连梁层数。 */
const getDurationFlagCount = (base: RhythmValue["base"]): 0 | 1 | 2 | 3 => {
  switch (base) {
    case "eighth":
      return 1;
    case "sixteenth":
      return 2;
    case "thirtySecond":
      return 3;
    default:
      return 0;
  }
};

/** whole 只有时值头没有符干，其余常规音符都绘制符干。 */
const hasDurationStem = (base: RhythmValue["base"]): boolean => base !== "whole";

/** 用函数创建 bounds，保证所有命中矩形都使用同一字段顺序。 */
const createBounds = (
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutBounds => ({ x, y, width, height });

/**
 * 连梁分组的 MVP 规则：
 * 1. 只在 notes beat 之间分组，rest 会中断；
 * 2. 只处理需要对应 level 连梁的短时值；
 * 3. 同一段连续 beat 至少两个时，才输出真正的 beam group。
 *
 * 这样先把最常见的八分/十六分连续音画出来，后续如需更复杂的 partial beam，
 * 再在 layout 层扩展，不把规则散落到 React 组件中。
 */
const buildBeamGroups = (
  beats: Beat[],
  durationMarkByBeatId: Map<string, LaidOutDurationMark>,
): LaidOutBeamGroup[] => {
  const beamGroups: LaidOutBeamGroup[] = [];

  const flushRun = (
    level: 1 | 2 | 3,
    run: LaidOutDurationMark[],
    measureId: string,
  ) => {
    if (run.length < 2) return;
    beamGroups.push({
      measureId,
      beatIds: run.map((mark) => mark.beatId),
      level,
      x1: run[0]!.stemX,
      x2: run[run.length - 1]!.stemX,
      y: run[0]!.stemBaseY + (level - 1) * DURATION_LEVEL_GAP,
    });
  };

  ([
    1,
    2,
    3,
  ] as const).forEach((level) => {
    let run: LaidOutDurationMark[] = [];
    let measureId = "";

    for (const beat of beats) {
      if (beat.kind !== "notes") {
        flushRun(level, run, measureId);
        run = [];
        measureId = "";
        continue;
      }
      const mark = durationMarkByBeatId.get(beat.id);
      if (!mark || mark.flagCount < level) {
        flushRun(level, run, measureId);
        run = [];
        measureId = "";
        continue;
      }
      if (run.length === 0) {
        measureId = mark.measureId;
      }
      run.push(mark);
    }

    flushRun(level, run, measureId);
  });

  return beamGroups;
};

const containsPoint = (bounds: LayoutBounds, x: number, y: number): boolean =>
  x >= bounds.x &&
  x <= bounds.x + bounds.width &&
  y >= bounds.y &&
  y <= bounds.y + bounds.height;

/**
 * 排版单个小节。
 *
 * 输入是已经确定好的小节 x/y/width 和有效拍号；输出包含该小节内所有拍点、
 * 音符、休止符、连音括号以及对应的命中区域。这个函数不决定一行放几个小节，
 * 只负责把一个小节内部的音乐时间转换为局部几何。
 */
export const layoutMeasure = (
  measure: Measure,
  context: {
    index: number;
    x: number;
    y: number;
    width: number;
    timeSignature: TimeSignature;
    showTimeSignature: boolean;
    hitIndex: LayoutHitIndex;
  },
): LaidOutMeasure => {
  /** 小节容量是 tick 到 x 坐标映射的分母，例如 4/4 为 3840，3/4 为 2880。 */
  const capacityTicks = getMeasureCapacityTicks(context.timeSignature);

  const beats = measure.beats.map((beat) => {
    const x = getBeatX(context.x, context.width, beat.tick, capacityTicks);
    /**
     * 拍点宽度使用“该拍 tick 长度 / 小节容量”乘以可用宽度。
     * 最小 10px 是命中测试和后续光标绘制的兜底，避免极短时值变成不可点击区域。
     */
    const width = Math.max(
      10,
      ((context.width - MEASURE_PADDING_X * 2) *
        getBeatTicks(beat, measure.tuplets)) /
        capacityTicks,
    );
    /** 拍点命中区覆盖整组六线谱高度，而不是只覆盖视觉数字，方便空拍点击定位。 */
    context.hitIndex.beats[beat.id] = createBounds(
      x - HIT_PADDING,
      context.y + STAFF_TOP - HIT_PADDING,
      width + HIT_PADDING * 2,
      STAFF_HEIGHT + HIT_PADDING * 2,
    );
    return {
      id: beat.id,
      measureId: measure.id,
      kind: beat.kind,
      tick: beat.tick,
      x,
      width,
      rhythm: beat.rhythm,
    };
  });

  /** 音符坐标由 beat.tick 决定 x，由 string 决定 y；和弦中的多个音符因此天然垂直对齐。 */
  const notes = measure.beats.flatMap((beat) => {
    if (beat.kind !== "notes") return [];
    const x = getBeatX(context.x, context.width, beat.tick, capacityTicks);
    return beat.notes.map((note) => {
      const y = getStringY(context.y, note.string);
      context.hitIndex.notes[note.id] = createBounds(
        x - HIT_PADDING,
        y - HIT_PADDING,
        HIT_PADDING * 2,
        HIT_PADDING * 2,
      );
      return {
        id: note.id,
        beatId: beat.id,
        measureId: measure.id,
        fret: String(note.fret),
        string: note.string,
        x,
        y,
        tied: Boolean(note.tie),
        ghost: Boolean(note.ghost),
      };
    });
  });

  /** 休止拍没有 string，使用小节中线 y，并保留 rhythm 供页面渲染附点。 */
  const rests = measure.beats.flatMap((beat) =>
    beat.kind === "rest"
      ? [
          {
            id: beat.id,
            measureId: measure.id,
            rhythm: beat.rhythm,
            symbol: REST_SYMBOLS[beat.rhythm.base],
            x: getBeatX(context.x, context.width, beat.tick, capacityTicks),
            y: getRestY(context.y),
          },
        ]
      : [],
  );

  /**
   * 音符时值属于 beat，不属于单个 note。
   * 因此这里按 notes beat 生成一份时值标记：和弦多音会共享同一时值头、符干与附点。
   */
  const durationMarks = measure.beats.flatMap((beat) => {
    if (beat.kind !== "notes") return [];

    if (beat.notes.length === 0) return [];

    const lastNodeString = beat.notes.sort((a, b) => b.string - a.string)[0];
    
    const x = getBeatX(context.x, context.width, beat.tick, capacityTicks);
    const flagCount = getDurationFlagCount(beat.rhythm.base);
    const hasStem = hasDurationStem(beat.rhythm.base);

    const nodeStringY = (lastNodeString.string - 1) * STRING_SPACING;
    const y = context.y + DURATION_LANE_Y + nodeStringY;

    // STAFF_TOP + (弦号 - 1) * 弦距
    // 例如弦号 1 为 54，弦号 2 为 59，弦号 3 为 64，以此类推。
    const stemBaseY = y + DURATION_STEM_LENGTH + STAFF_HEIGHT - nodeStringY;
    /**
     * 多层符尾/连梁需要更长的符干。
     * 例如三十二分音符要承载 3 层，stemBottomY 会比普通八分音符再向下延伸两级间距。
     */
    const stemBottomY = stemBaseY + Math.max(0, flagCount - 1) * DURATION_LEVEL_GAP;

    return [
      {
        beatId: beat.id,
        measureId: measure.id,
        x,
        y,
        base: beat.rhythm.base,
        dots: beat.rhythm.dots,
        notehead: getDurationNotehead(beat.rhythm.base),
        hasStem,
        stemX: x,
        stemTopY: y,
        stemBaseY,
        stemBottomY,
        flagCount,
      },
    ];
  });

  const durationMarkByBeatId = new Map(
    durationMarks.map((mark) => [mark.beatId, mark] as const),
  );
  const beamGroups = buildBeamGroups(measure.beats, durationMarkByBeatId);

  /**
   * 连音括号需要覆盖从首拍开始到末拍结束的区间。
   * 因此右端点不是最后一个 beat 的 x，而是 lastBeat.tick + lastBeatTicks 对应的位置。
   */
  const beatById = new Map(measure.beats.map((beat) => [beat.id, beat]));
  const tuplets = measure.tuplets.flatMap((tuplet) => {
    if (tuplet.bracket === "hide") return [];
    const tupletBeats = tuplet.beatIds
      .map((beatId) => beatById.get(beatId))
      .filter((beat): beat is Beat => Boolean(beat));
    if (tupletBeats.length < 2) return [];
    const firstBeat = tupletBeats[0]!;
    const lastBeat = tupletBeats[tupletBeats.length - 1]!;
    const lastBeatTicks = getBeatTicks(lastBeat, measure.tuplets);
    const bracket: LaidOutTuplet["bracket"] =
      tuplet.bracket === "auto" ? "auto" : "show";
      
    return [
      {
        id: tuplet.id,
        measureId: measure.id,
        number: tuplet.actualNotes,
        x1: getBeatX(context.x, context.width, firstBeat.tick, capacityTicks),
        x2: getBeatX(
          context.x,
          context.width,
          lastBeat.tick + lastBeatTicks,
          capacityTicks,
        ),
        // + 12 表示下移 12 的距离
        y: context.y + STAFF_HEIGHT + TUPLET_MARGIN_TOP,
        bracket,
      },
    ];
  });

  /** 小节命中区使用整行小节高度，后续可以支持点击空白区域选中小节。 */
  context.hitIndex.measures[measure.id] = createBounds(
    context.x,
    context.y,
    context.width,
    SYSTEM_HEIGHT,
  );

  return {
    id: measure.id,
    index: context.index,
    number: context.index + 1,
    x: context.x,
    y: context.y,
    width: context.width,
    height: SYSTEM_HEIGHT,
    staffTop: STAFF_TOP,
    staffHeight: STAFF_HEIGHT + STRING_LINE_WIDTH,
    stringSpacing: STRING_SPACING,
    capacityTicks,
    timeSignature: context.timeSignature,
    showTimeSignature: context.showTimeSignature,
    barline: measure.barline,
    beats,
    notes,
    rests,
    durationMarks,
    beamGroups,
    tuplets,
  };
};

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
 * 当前 MVP 不做响应式适配，算法步骤：
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
