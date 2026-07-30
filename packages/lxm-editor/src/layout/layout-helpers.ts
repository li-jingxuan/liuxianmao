/**
 * layout 层通用辅助函数。
 *
 * 这些函数不持有状态，也不直接依赖 React 或 store。它们只负责把节奏、拍点和弦号
 * 这类领域数据转换成几何基础量，供更高层的 measure/system/score 排版复用。
 */

import {
  LXM_DURATION_FLAG_DESCENT,
  LXM_DURATION_HEAD_OFFSET_Y,
  LXM_DURATION_LANE_BOTTOM_PADDING,
  LXM_DURATION_STEM_LENGTH,
  LXM_STAFF_HEIGHT,
  LXM_STAFF_Y,
} from "./layout-constants";
import { ILXMStringLineLayout } from "./layout-types";

/**
 * 计算小节高度。
 *
 * 第六弦以下现在有固定 rhythm lane。除节奏头和符干外，还按 Bravura composite
 * flag 的实测向下视觉范围预留空间，使三十二分音符在 SVG viewBox 内也不会被裁切。
 * 所有小节使用相同高度，避免同一 System 因局部时值不同产生纵向跳动。
 */
export const calculateMeasureHeight = (): number =>
  LXM_STAFF_Y +
  LXM_STAFF_HEIGHT +
  LXM_DURATION_HEAD_OFFSET_Y +
  LXM_DURATION_STEM_LENGTH +
  LXM_DURATION_FLAG_DESCENT +
  LXM_DURATION_LANE_BOTTOM_PADDING;

/** 按数组元素的指定键排序 */
export const arraySortByKey = <T = Array<unknown>>(
  array: T[],
  key: keyof T,
): T[] =>
  array.sort((left, right) =>
    (left[key] as number) < (right[key] as number) ? -1 : 1,
  );

/** 找到 strings 中的 index 最大的元素 */
export const getLastStringLine = (
  strings: ILXMStringLineLayout[],
): ILXMStringLineLayout | undefined =>
  strings.reduce<ILXMStringLineLayout | undefined>(
    (lastString, string) =>
      !lastString || string.index > lastString.index ? string : lastString,
    undefined,
  );
