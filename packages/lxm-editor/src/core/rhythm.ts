/**
 * 节奏时间轴工具模块。
 *
 * 这个模块只负责把乐谱中的节奏语义转换为内部 tick 时间，不参与任何视觉宽度、
 * SVG 坐标或渲染策略计算。后续实现时应保持它是纯音乐时间层：例如四分音符
 * 等于多少 tick、附点如何换算、小节拍号对应多少 tick。
 */
import {
  LXM_EDITABLE_TIME_SIGNATURES,
  LXM_RHYTHM_BASES,
  TICKS_PER_QUARTER,
} from "./constants";
import type { ILXMBeat, ILXMRhythm, ILXMTimeSignature } from "./types";

// 基准节奏时值对应 tick 数
export const BASE_RHYTHM_TICKS = {
  whole: TICKS_PER_QUARTER * 4,
  half: TICKS_PER_QUARTER * 2,
  quarter: TICKS_PER_QUARTER,
  eighth: TICKS_PER_QUARTER / 2,
  sixteenth: TICKS_PER_QUARTER / 4,
  thirtySecond: TICKS_PER_QUARTER / 8,
} as const;

// 附点音符对应的时值倍率
const DOTTED_RHYTHM_MULTIPLIERS = {
  0: { numerator: 1, denominator: 1 },
  1: { numerator: 3, denominator: 2 },
  2: { numerator: 7, denominator: 4 },
} as const;

export type RhythmTickResult =
  | { ok: true; ticks: number }
  | { ok: false; code: "UNSUPPORTED_DOTS" | "NON_INTEGER_RHYTHM_TICKS" };

/**
 * 一个保持附点写法不变、只缩短基础时值的候选。
 *
 * level 表示沿 LXM_RHYTHM_BASES 向更短方向移动了几级。把级数显式返回，是为了让
 * 上层压缩规划能够比较“修改是否均匀”，而不必再次理解基础时值的排列规则。
 */
export interface ILXMShorterRhythmOption {
  rhythm: ILXMRhythm;
  level: number;
  ticks: number;
}

/** 只计算音乐时间轴 tick，不参与任何视觉宽度决策。 */
export const calculateRhythmTicks = (rhythm: ILXMRhythm): RhythmTickResult => {
  // 附点时值使用分数表达：
  // - 无附点 = 1/1
  // - 单附点 = 3/2
  // - 双附点 = 7/4
  const dottedMultiplier =
    DOTTED_RHYTHM_MULTIPLIERS[
      rhythm.dots as keyof typeof DOTTED_RHYTHM_MULTIPLIERS
    ];

  // 不支持的附点数
  if (!dottedMultiplier) {
    return { ok: false, code: "UNSUPPORTED_DOTS" };
  }

  // 获取当前时值 tick 数量
  const numerator = BASE_RHYTHM_TICKS[rhythm.base] * dottedMultiplier.numerator;
  const denominator = dottedMultiplier.denominator;

  if (numerator % denominator !== 0) {
    return { ok: false, code: "NON_INTEGER_RHYTHM_TICKS" };
  }

  // 返回当前 Rhythm（节奏） 最终 tick 数量
  return { ok: true, ticks: numerator / denominator };
};

/**
 * 返回当前 rhythm 的全部更短候选，顺序固定为“缩短一级”到“缩短最多级”。
 *
 * 自动压缩只调整 base，不调整 dots。附点属于用户可见的节奏拼写；如果这里为了
 * 凑容量擅自移除附点，用户修改一个 beat 时就会同时改变其他 beat 的附点语义。
 * 因此精确容量组合由上层在这些保留附点的候选中寻找，找不到时明确失败。
 */
export const getShorterRhythmOptions = (
  rhythm: ILXMRhythm,
): ILXMShorterRhythmOption[] => {
  const currentIndex = LXM_RHYTHM_BASES.indexOf(rhythm.base);
  if (currentIndex < 0) return [];

  return LXM_RHYTHM_BASES.slice(currentIndex + 1).flatMap(
    (base, optionIndex) => {
      const candidate: ILXMRhythm = { base, dots: rhythm.dots };
      const duration = calculateRhythmTicks(candidate);

      // 正常 schema 下候选都可表示；保留过滤守卫，避免未来扩展 rhythm 后把非法
      // tick 带入容量规划。
      return duration.ok
        ? [
            {
              rhythm: candidate,
              level: optionIndex + 1,
              ticks: duration.ticks,
            },
          ]
        : [];
    },
  );
};

/** 分子、分母是值对象，不能依赖对象引用判断两个拍号是否相同。 */
export const isSameTimeSignature = (
  left: ILXMTimeSignature,
  right: ILXMTimeSignature,
): boolean =>
  left.numerator === right.numerator && left.denominator === right.denominator;

/** 命令层只允许写入已有明确拍组定义的首批拍号。 */
export const isEditableTimeSignature = (
  timeSignature: ILXMTimeSignature,
): boolean =>
  LXM_EDITABLE_TIME_SIGNATURES.some((candidate) =>
    isSameTimeSignature(candidate, timeSignature),
  );

/**
 * 根据拍号计算完整小节容量。
 *
 * 一个全音符等于四个四分音符，因此公式中的 4 不能省略。例如 3/4 是
 * 960 * 4 * 3 / 4 = 2880 tick，6/8 同样是 2880 tick。
 *
 * 这里刻意只回答“整小节多长”，不再同时承担连梁拍组含义。旧实现把两个概念
 * 混在一起，会让 3/4 和 6/8 都得到错误的 720 tick 拍组。
 */
export const getMeasureCapacityTicks = ({
  numerator,
  denominator,
}: ILXMTimeSignature): number =>
  (TICKS_PER_QUARTER * 4 * numerator) / denominator;

/**
 * 返回拍号的显式连梁拍组；null 表示核心不掌握该拍号的专业分组语义。
 *
 * 数组而不是单一长度可以自然扩展不等长拍组。当前白名单虽然除复拍子外都等长，
 * layout 仍按累计边界消费数组，未来增加 5/8 的 2+3 时无需再次更改接口。
 */
export const getTimeSignatureBeatGroupTicks = (
  timeSignature: ILXMTimeSignature,
): number[] | null => {
  if (isSameTimeSignature(timeSignature, { numerator: 2, denominator: 4 }))
    return [TICKS_PER_QUARTER, TICKS_PER_QUARTER];
  if (isSameTimeSignature(timeSignature, { numerator: 3, denominator: 4 }))
    return [TICKS_PER_QUARTER, TICKS_PER_QUARTER, TICKS_PER_QUARTER];
  if (isSameTimeSignature(timeSignature, { numerator: 4, denominator: 4 }))
    return [
      TICKS_PER_QUARTER,
      TICKS_PER_QUARTER,
      TICKS_PER_QUARTER,
      TICKS_PER_QUARTER,
    ];
  if (isSameTimeSignature(timeSignature, { numerator: 6, denominator: 8 }))
    return [TICKS_PER_QUARTER * 1.5, TICKS_PER_QUARTER * 1.5];
  return null;
};

/** 获取 beat 的结束 tick；调用方可据此构建连续、不重叠的时间轴。 */
export const getBeatEndTick = (beat: ILXMBeat): RhythmTickResult => {
  const duration = calculateRhythmTicks(beat.rhythm);
  return duration.ok
    ? { ok: true, ticks: beat.tick + duration.ticks }
    : duration;
};

/**
 * 将一段静音时长分解为可显示的休止 beat。
 *
 * 采用从长到短的贪心策略：当前所有基础时值都是 120 tick 的整数倍，先取最长
 * 时值既能减少 beat 数，也能保证每一步都保持精确整数 tick；最后无法整除时才
 * 明确失败，绝不通过取整制造错误的音乐时间。
 */
export const createRestRhythmsForTicks = (
  ticks: number,
):
  | { ok: true; rhythms: ILXMRhythm[] }
  | { ok: false; code: "RHYTHM_NOT_REPRESENTABLE" } => {
  if (!Number.isInteger(ticks) || ticks < 0) {
    return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
  }

  const bases = Object.entries(BASE_RHYTHM_TICKS).sort(
    ([, left], [, right]) => right - left,
  ) as [ILXMRhythm["base"], number][];
  const rhythms: ILXMRhythm[] = [];
  let remaining = ticks;

  for (const [base, duration] of bases) {
    while (remaining >= duration) {
      rhythms.push({ base, dots: 0 });
      remaining -= duration;
    }
  }

  return remaining === 0
    ? { ok: true, rhythms }
    : { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
};
