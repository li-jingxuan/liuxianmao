/**
 * 谱面行（system）布局。
 *
 * 此模块只负责按小节的固有宽度进行自动断行并分配最终坐标；小节内部弦线、
 * 音符、符干等几何仍完全由 measure-layout 计算，避免两个层级重复推导坐标。
 */

import type { ILXMMeasure } from "../core/types";
import type { ILXMLayoutMeasureContext } from "./measure-layout";
import { layoutMeasure } from "./measure-layout";
import { summarizeMeasureSpacingWidth } from "./measure-spacing";
import { LXM_MEASURE_PADDING_X } from "./layout-constants";
import type { ILXMSystemLayout } from "./layout-types";

/** system 断行所需的已解析配置，避免函数内部读取默认常量。 */
export interface ILXMSystemLayoutOptions {
  startX: number;
  startY: number;
  measureGap: number;
  systemWidth: number;
  systemGapY: number;
}

/**
 * 先计算小节固有宽度。
 *
 * 断行阶段只需要节奏摘要，不提前生成音符、弦线和连梁等完整几何；等 System
 * 分组及 assignedWidth 确定后，每个小节只执行一次正式 layoutMeasure。
 */
const measureIntrinsicWidth = (measure: ILXMMeasure): number =>
  summarizeMeasureSpacingWidth(measure).assignedWidth;

interface ILXMPendingMeasure {
  measure: ILXMMeasure;
  index: number;
  /** 断行阶段得到并缓存的固有宽度，提交 System 时不再重复计算。 */
  intrinsicWidth: number;
}

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
  if (!Number.isFinite(options.systemWidth) || options.systemWidth <= 0) {
    throw new RangeError(
      `systemWidth 必须是大于 0 的有限数值，实际为 ${options.systemWidth}`,
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

  /** 将当前待布局小节提交为一条最终坐标确定的谱面行。 */
  const flushSystem = () => {
    if (pendingMeasures.length === 0) return;

    const systemIndex = systems.length;
    // 贪心断行保证 pendingWidth 通常不超过 systemWidth。唯一例外是单个小节
    // 自身已经超宽，此时保持真实宽度，不压缩也不截断。
    const targetSystemWidth = Math.max(pendingWidth, options.systemWidth);
    const remainingWidth = targetSystemWidth - pendingWidth;
    const flexibleWidths = pendingMeasures.map(({ intrinsicWidth }) =>
      Math.max(0, intrinsicWidth - LXM_MEASURE_PADDING_X * 2),
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

    let cursorX = options.startX;
    let systemHeight = 0;
    const laidOutMeasures = pendingMeasures.map(
      ({ measure, index }, measureIndex) => {
        const isLastMeasure = measureIndex === pendingMeasures.length - 1;
        // 最后一个小节直接使用目标右边界减去当前游标，吸收小节比例分配、gap
        // 和 startX 参与运算后的全部浮点残差。这样视觉小节线不会逐节漂移。
        const assignedWidth = isLastMeasure
          ? options.startX + targetSystemWidth - cursorX
          : assignedWidths[measureIndex]!;
        const context: ILXMLayoutMeasureContext = {
          index,
          systemIndex,
          x: cursorX,
          y: systemY,
          assignedWidth,
        };
        const layout = layoutMeasure(measure, context);
        cursorX += layout.width + options.measureGap;
        systemHeight = Math.max(systemHeight, layout.height);
        return layout;
      },
    );

    systems.push({
      index: systemIndex,
      x: options.startX,
      y: systemY,
      // 普通行使用调用方目标宽度；超宽小节行使用其真实固有宽度。
      width: targetSystemWidth,
      height: systemHeight,
      measures: laidOutMeasures,
    });

    systemY += systemHeight + options.systemGapY;
    pendingMeasures = [];
    pendingWidth = 0;
  };

  measures.forEach((measure, index) => {
    const width = measureIntrinsicWidth(measure);
    const nextWidth =
      pendingMeasures.length === 0
        ? width
        : pendingWidth + options.measureGap + width;

    if (pendingMeasures.length > 0 && nextWidth > options.systemWidth) {
      flushSystem();
    }

    pendingWidth =
      pendingMeasures.length === 0
        ? width
        : pendingWidth + options.measureGap + width;
    pendingMeasures.push({ measure, index, intrinsicWidth: width });
  });

  flushSystem();
  return systems;
};
