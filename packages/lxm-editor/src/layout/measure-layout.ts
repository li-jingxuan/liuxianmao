/**
 * 单小节布局模块。
 *
 * 这个模块负责把一个小节转换为可渲染的几何数据，包括小节边界、六根弦线、
 * beat 的横向位置以及音符在对应弦上的坐标。它应消费 measure-spacing 的结果，
 * 不直接决定节奏列宽策略。
 */

import { ILXMMeasure } from "../core/types"
import { ILXMMeasureLayout } from "./layout-types";
import { layoutMeasureSpacing } from "./measure-spacing";

export interface ILXMLayoutMeasureContext {
  index: number;
  x: number;
  y: number;

	// TODO 下面两个参数后续版本在拓展
	// 小节已经设置了宽度，则参与计算比较
  // assignedWidth?: number;
	// 小节内和弦符号、歌词和简谱 需要的最小宽度
  // widthContributors?: ILXMColumnWidthContributors;
}

export const layoutMeasure = (
	measure: ILXMMeasure,
	context: ILXMLayoutMeasureContext
): ILXMMeasureLayout => {
	const { index, x, y } = context;

	const measureSpacing = layoutMeasureSpacing(measure, { x })
	const { minWidth, idealWidth, columns } = measureSpacing;

	return {
		index,
		x,
		y,
		width: idealWidth,
		height: idealWidth,
		columns,
	} as ILXMMeasureLayout
}
