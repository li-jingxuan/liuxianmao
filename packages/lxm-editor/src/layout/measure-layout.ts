/**
 * 单小节布局模块。
 *
 * 这个模块负责把一个小节转换为可渲染的几何数据，包括小节边界、六根弦线、
 * beat 的横向位置以及音符在对应弦上的坐标。它应消费 measure-spacing 的结果，
 * 不直接决定节奏列宽策略。
 */

import { ILXMBeat, ILXMMeasure } from "../core/types"
import { ILXMMeasureLayout, ILXMNoteLayout } from "./layout-types";
import { layoutMeasureSpacing } from "./measure-spacing";
import { calculateMeasureHeight } from "./layout-helpers"
import { STANDARD_GUITAR_TUNING } from "../core/constants";
import { LXM_STRING_SPACING, LXM_STAFF_Y } from "./layout-constants";
import { layoutBarline } from "./barline-layout";

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

const getStringY = (y: number, string: number) => {
	return y + LXM_STAFF_Y + LXM_STRING_SPACING * (string - 1)
}

/** 构建弦线布局 */
export const buildStringLines = (x: number, y: number, width: number) => {
	return STANDARD_GUITAR_TUNING.map(line => {
		const cursorY = getStringY(y, line.index)

		return {
			index: line.index,
			x1: x,
			y1: cursorY,

			x2: x + width,
			y2: cursorY,
			width,
		}
	})
}

/** 通过 beats 构建音符位置坐标 */
export const layoutNodes = (
	measureId: string,
	beats: ILXMBeat[],
	slotsByBeatId: ReturnType<typeof layoutMeasureSpacing>["slotsByBeatId"],
	measureY: number,
): ILXMNoteLayout[] => {
	return beats.flatMap((beat) => {
		const slot = slotsByBeatId[beat.id]
		
		return beat.notes.map((note) => ({
			id: note.id,
			beatId: beat.id,
			measureId,
			string: note.string,
			fret: note.fret,
			fretText: note.fret.toString(),
			x: slot.x,
			y: getStringY(measureY, note.string),
			width: slot.width,
		}))
	})
}

export const layoutMeasure = (
	measure: ILXMMeasure,
	context: ILXMLayoutMeasureContext
): ILXMMeasureLayout => {
	const { index, x, y } = context;
	const measureSpacing = layoutMeasureSpacing(measure, { x })
	const {
		assignedWidth,
		columns,
		slotsByBeatId,
	} = measureSpacing;
	const beats = Object.values(slotsByBeatId)
	const strings = buildStringLines(x, y, assignedWidth)

	return {
		id: measure.id,
		index,
		x,
		y,
		width: assignedWidth,
		barline: layoutBarline(measure.barline, strings),
		height: calculateMeasureHeight(),
		columns,
		beats,
		strings,
		notes: layoutNodes(measure.id, measure.beats, slotsByBeatId, context.y)
	}
}
