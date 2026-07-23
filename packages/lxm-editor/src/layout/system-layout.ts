/**
 * 谱面行（system）布局。
 *
 * 此模块只负责按小节的固有宽度进行自动断行并分配最终坐标；小节内部弦线、
 * 音符、符干等几何仍完全由 measure-layout 计算，避免两个层级重复推导坐标。
 */

import type { ILXMMeasure } from "../core/types";
import type { ILXMLayoutMeasureContext } from "./measure-layout";
import { layoutMeasure } from "./measure-layout";
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
 * 先计算小节固有尺寸。
 *
 * 固有宽度只取决于小节内容，因此使用 (0, 0) 作为临时坐标。正式布局时会再次
 * 调用 layoutMeasure，确保所有子元素都使用其最终所在 system 的坐标。
 */
const measureIntrinsicSize = (measure: ILXMMeasure) => {
  const layout = layoutMeasure(measure, {
    index: 0,
    systemIndex: 0,
    x: 0,
    y: 0,
  });

  return { width: layout.width, height: layout.height };
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
  const systems: ILXMSystemLayout[] = [];
  let pendingMeasures: Array<{ measure: ILXMMeasure; index: number }> = [];
  let pendingWidth = 0;
  let systemY = options.startY;

  /** 将当前待布局小节提交为一条最终坐标确定的谱面行。 */
  const flushSystem = () => {
    if (pendingMeasures.length === 0) return;

    const systemIndex = systems.length;
    let cursorX = options.startX;
    let systemHeight = 0;
    const laidOutMeasures = pendingMeasures.map(({ measure, index }) => {
      const context: ILXMLayoutMeasureContext = {
        index,
        systemIndex,
        x: cursorX,
        y: systemY,
      };
      const layout = layoutMeasure(measure, context);
      cursorX += layout.width + options.measureGap;
      systemHeight = Math.max(systemHeight, layout.height);
      return layout;
    });

    const lastMeasure = laidOutMeasures[laidOutMeasures.length - 1]!;
    const systemWidth = lastMeasure.x + lastMeasure.width - options.startX;
    systems.push({
      index: systemIndex,
      x: options.startX,
      y: systemY,
      width: systemWidth,
      height: systemHeight,
      measures: laidOutMeasures,
    });

    systemY += systemHeight + options.systemGapY;
    pendingMeasures = [];
    pendingWidth = 0;
  };

  measures.forEach((measure, index) => {
    const { width } = measureIntrinsicSize(measure);
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
    pendingMeasures.push({ measure, index });
  });

  flushSystem();
  return systems;
};
