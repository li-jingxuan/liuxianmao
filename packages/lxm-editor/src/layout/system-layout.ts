/**
 * 谱面行（system）布局。
 *
 * 此模块只负责按小节的固有宽度进行自动断行并分配最终坐标；小节内部弦线、
 * 音符、符干等几何仍完全由 measure-layout 计算，避免两个层级重复推导坐标。
 */

import type { ILXMMeasure, ILXMTrackStartBarlineType } from "../core/types";
import type { ILXMLayoutMeasureContext } from "./measure-layout";
import { layoutMeasure } from "./measure-layout";
import { summarizeMeasureSpacingWidth } from "./measure-spacing";
import {
  LXM_LEADING_REPEAT_CLEARANCE_WIDTH,
  LXM_SPARSE_SYSTEM_MAX_CONTENT_SCALE,
  LXM_SYSTEM_HEADER_WIDTH,
  LXM_TIME_SIGNATURE_WIDTH,
} from "./layout-constants";
import type { ILXMLayoutDensity, ILXMSystemLayout } from "./layout-types";
import { shouldShowTimeSignature } from "./time-signature-layout";
import { layoutSystemHeader } from "./system-header-layout";

/** system 断行所需的已解析配置，避免函数内部读取默认常量。 */
export interface ILXMSystemLayoutOptions {
  startX: number;
  startY: number;
  measureGap: number;
  systemWidth: number;
  systemGapY: number;
  density: ILXMLayoutDensity;
  /** 第一小节之前的领域边界；只会投影到第一条 system。 */
  startBarline: ILXMTrackStartBarlineType;
}

/**
 * 先计算小节固有宽度。
 *
 * 断行阶段只需要节奏摘要，不提前生成音符、弦线和连梁等完整几何；等 System
 * 分组及 assignedWidth 确定后，每个小节只执行一次正式 layoutMeasure。
 */
interface ILXMPendingMeasure {
  measure: ILXMMeasure;
  index: number;
  /** 断行阶段得到并缓存的固有宽度，提交 System 时不再重复计算。 */
  intrinsicWidth: number;
  /** 不包含 density profile 左右 padding 的真实节奏内容宽度。 */
  intrinsicContentWidth: number;
}

/**
 * System 被提交的原因。
 *
 * `wrapped` 表示加入下一个小节会超过行宽，此时当前行后面确定还有内容；`final`
 * 只在输入遍历结束时使用。显式携带原因比事后通过 system index 猜测更可靠，因为
 * flush 执行时完整的 systems 数组尚未生成。
 */
type ILXMSystemFlushReason = "wrapped" | "final";

interface ILXMResolveSystemTargetWidthContext {
  systemWidth: number;
  intrinsicSystemWidth: number;
  measures: ILXMPendingMeasure[];
  isFinalSystem: boolean;
}

/**
 * 决定一条 System 的实际绘制宽度。
 *
 * 正文中的多小节行继续两端对齐；末行和任意单小节行则限制节奏内容的拉伸倍数。
 * `intrinsicSystemWidth` 已经包含 measureGap，而每个 pending measure 同时保存了不含
 * padding 的内容宽度，因此两者之差正好是所有不可伸展空间（padding + gap）。
 */
const resolveSystemTargetWidth = ({
  systemWidth,
  intrinsicSystemWidth,
  measures,
  isFinalSystem,
}: ILXMResolveSystemTargetWidthContext): number => {
  // 贪心断行允许单个超宽小节独占一行。它不能被压缩回 systemWidth，否则节奏列会
  // 低于固有宽度，并破坏 measure-spacing 只扩张、不压缩的契约。
  if (intrinsicSystemWidth >= systemWidth) return intrinsicSystemWidth;

  const shouldLimitStretch = isFinalSystem || measures.length === 1;
  if (!shouldLimitStretch) return systemWidth;

  const totalContentWidth = measures.reduce(
    (total, measure) => total + measure.intrinsicContentWidth,
    0,
  );
  const fixedWidth = intrinsicSystemWidth - totalContentWidth;
  const maxReadableWidth =
    fixedWidth + totalContentWidth * LXM_SPARSE_SYSTEM_MAX_CONTENT_SCALE;

  // 对内容已经足够密集的末行，maxReadableWidth 会自然达到 systemWidth，因此仍可
  // 完整对齐页面右边界；短末行则保留真实的右侧画布留白。
  return Math.min(systemWidth, maxReadableWidth);
};

/**
 * 将一组连续小节按贪心策略切分为多条谱面行。
 *
 * 关键算法：只有当“当前行已有小节”且再放入一个小节会超宽时才换行；因此超宽
 * 小节会独占一行而不会无限循环，也不会被缩放或截断。
 */
export const layoutSystems = (
  measures: ILXMMeasure[],
  options: ILXMSystemLayoutOptions,
): ILXMSystemLayout[] => {
  // systemWidth 会参与除法和剩余空间计算，Infinity/NaN 不再只是一个“很大的
  // 断行上限”，而会直接污染所有子元素坐标，因此必须在布局入口拒绝。
  if (
    !Number.isFinite(options.systemWidth) ||
    options.systemWidth <= LXM_SYSTEM_HEADER_WIDTH
  ) {
    throw new RangeError(
      `systemWidth 必须是大于行头宽度 ${LXM_SYSTEM_HEADER_WIDTH} 的有限数值，实际为 ${options.systemWidth}`,
    );
  }
  if (!Number.isFinite(options.measureGap) || options.measureGap < 0) {
    throw new RangeError(
      `measureGap 必须是大于等于 0 的有限数值，实际为 ${options.measureGap}`,
    );
  }

  const systems: ILXMSystemLayout[] = [];
  let pendingMeasures: ILXMPendingMeasure[] = [];
  let pendingWidth = 0;
  let systemY = options.startY;
  // systemWidth 是整行宽度；measure 断行只能使用扣除 TAB 行头后的正文宽度。
  const staffWidthLimit = options.systemWidth - LXM_SYSTEM_HEADER_WIDTH;

  /**
   * 开始反复的圆点属于共享边界，却会伸入其后 measure。无论边界两侧最终是否
   * 换行，后一个 measure 都必须预留相同净空，避免断行变化时拍号突然跳动。
   */
  const getLeadingBarlineClearance = (measureIndex: number): number => {
    const previousBarline = measures[measureIndex - 1]?.barline;
    const startsWithRepeat =
      measureIndex === 0
        ? options.startBarline === "repeatStart"
        : previousBarline === "repeatStart" || previousBarline === "repeatBoth";
    return startsWithRepeat ? LXM_LEADING_REPEAT_CLEARANCE_WIDTH : 0;
  };

  /** 将当前待布局小节提交为一条最终坐标确定的谱面行。 */
  const flushSystem = (reason: ILXMSystemFlushReason) => {
    if (pendingMeasures.length === 0) return;

    const systemIndex = systems.length;
    // 这里先决定六线谱正文宽度，随后再加固定行头得到 system.width。若直接把
    // 整行宽度分给 measures，TAB 会被挤到画布外，命中区域也会比视觉宽一段。
    const targetStaffWidth = resolveSystemTargetWidth({
      systemWidth: staffWidthLimit,
      intrinsicSystemWidth: pendingWidth,
      measures: pendingMeasures,
      isFinalSystem: reason === "final",
    });
    const remainingWidth = targetStaffWidth - pendingWidth;
    const flexibleWidths = pendingMeasures.map(
      ({ intrinsicContentWidth }) => intrinsicContentWidth,
    );
    const totalFlexibleWidth = flexibleWidths.reduce(
      (total, width) => total + width,
      0,
    );

    // System 剩余空间只加入各小节的内容区。按 flexibleWidth 比例分配等价于
    // 让整行节奏内容使用统一横向比例；空小节全部没有内容宽度时才退化为均分。
    const assignedWidths = pendingMeasures.map(
      ({ intrinsicWidth }, measureIndex) => {
        const weight =
          totalFlexibleWidth > 0
            ? flexibleWidths[measureIndex]! / totalFlexibleWidth
            : 1 / pendingMeasures.length;
        return intrinsicWidth + remainingWidth * weight;
      },
    );

    const staffX = options.startX + LXM_SYSTEM_HEADER_WIDTH;
    let cursorX = staffX;
    let systemHeight = 0;
    const laidOutMeasures = pendingMeasures.map(
      ({ measure, index }, measureIndex) => {
        const isLastMeasure = measureIndex === pendingMeasures.length - 1;
        // 最后一个小节直接使用目标右边界减去当前游标，吸收小节比例分配、gap
        // 和 startX 参与运算后的全部浮点残差。这样视觉小节线不会逐节漂移。
        const assignedWidth = isLastMeasure
          ? staffX + targetStaffWidth - cursorX
          : assignedWidths[measureIndex]!;

        // 反复开始边界若正好位于换行处，视觉主体必须移动到下一行开头；上一行
        // 仍需用普通单线收束 staff。双向反复则在上一行保留结束反复部分。
        const visualBarline =
          isLastMeasure && reason === "wrapped"
            ? measure.barline === "repeatStart"
              ? "single"
              : measure.barline === "repeatBoth"
                ? "repeatEnd"
                : measure.barline
            : measure.barline;
        const context: ILXMLayoutMeasureContext = {
          index,
          systemIndex,
          x: cursorX,
          y: systemY,
          density: options.density,
          assignedWidth,
          showTimeSignature: shouldShowTimeSignature(measures, index),
          leadingBarlineClearance: getLeadingBarlineClearance(index),
          visualBarline,
        };
        const layout = layoutMeasure(measure, context);
        cursorX += layout.width + options.measureGap;
        systemHeight = Math.max(systemHeight, layout.height);
        return layout;
      },
    );

    const firstPending = pendingMeasures[0]!;
    const previousMeasure = measures[firstPending.index - 1];
    // 第一条 system 的行首反复来自 track.startBarline；后续行只在前一领域边界
    // 是 repeatStart/repeatBoth 时投影开始反复。文档本身永远不因断行而改写。
    const leadingBarline =
      systemIndex === 0
        ? options.startBarline === "repeatStart"
          ? "repeatStart"
          : null
        : previousMeasure?.barline === "repeatStart" ||
            previousMeasure?.barline === "repeatBoth"
          ? "repeatStart"
          : null;
    const firstMeasureStrings = laidOutMeasures[0]?.strings ?? [];

    systems.push({
      index: systemIndex,
      x: options.startX,
      y: systemY,
      // 普通行使用调用方目标宽度；超宽小节行使用其真实固有宽度。
      width: LXM_SYSTEM_HEADER_WIDTH + targetStaffWidth,
      height: systemHeight,
      header: layoutSystemHeader({
        systemX: options.startX,
        systemY,
        staffX,
        firstMeasureStrings,
        leadingBarline,
      }),
      measures: laidOutMeasures,
      techniques: [],
      techniqueLaneCount: 0,
    });

    systemY += systemHeight + options.systemGapY;
    pendingMeasures = [];
    pendingWidth = 0;
  };

  measures.forEach((measure, index) => {
    const timeSignatureWidth = shouldShowTimeSignature(measures, index)
      ? LXM_TIME_SIGNATURE_WIDTH
      : 0;
    const spacingSummary = summarizeMeasureSpacingWidth(
      measure,
      options.density,
      timeSignatureWidth + getLeadingBarlineClearance(index),
    );
    const width = spacingSummary.assignedWidth;
    const nextWidth =
      pendingMeasures.length === 0
        ? width
        : pendingWidth + options.measureGap + width;

    if (pendingMeasures.length > 0 && nextWidth > staffWidthLimit) {
      // 当前行因为下一个小节放不下而结束，它是正文换行而不是文档末行。
      flushSystem("wrapped");
    }

    pendingWidth =
      pendingMeasures.length === 0
        ? width
        : pendingWidth + options.measureGap + width;
    pendingMeasures.push({
      measure,
      index,
      intrinsicWidth: width,
      intrinsicContentWidth: spacingSummary.contentWidth,
    });
  });

  // 只有遍历完成后仍待提交的这一行才是真正的末行。末行无论包含几个小节，都按
  // 内容密度限制拉伸，避免两个短小节同样被过度铺满。
  flushSystem("final");
  return systems;
};
