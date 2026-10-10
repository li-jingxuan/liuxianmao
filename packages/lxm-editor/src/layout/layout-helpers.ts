/**
 * layout 层通用辅助函数。
 *
 * 这些函数不持有状态，也不直接依赖 React 或 store。它们只负责把节奏、拍点和弦号
 * 这类领域数据转换成几何基础量，供更高层的 measure/system/score 排版复用。
 */

import {
  LXM_DURATION_LANE_BOTTOM_PADDING,
  LXM_STAFF_HEIGHT,
  LXM_STAFF_Y,
} from "./layout-constants";
import { ILXMStringLineLayout } from "./layout-types";

/**
 * 计算小节高度。
 *
 * 根据实际节奏下缘保留底部净空，至少容纳六线谱和选择框。
 * 谱行取各小节高度最大值，无需在没有符尾时预留最长符尾的字体行框。
 */
export const calculateMeasureHeight = (
  y: number,
  rhythmBottom: number,
): number =>
  Math.max(LXM_STAFF_Y + LXM_STAFF_HEIGHT, rhythmBottom - y) +
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
