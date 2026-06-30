/**
 * layout 层通用辅助函数。
 *
 * 这些函数不持有状态，也不直接依赖 React 或 store。它们只负责把节奏、拍点和弦号
 * 这类领域数据转换成几何基础量，供更高层的 measure/system/score 排版复用。
 */

import { LXM_STAFF_Y, LXM_STAFF_HEIGHT } from "./layout-constants";

/** 计算小节高度 */
export const calculateMeasureHeight = (): number =>
  LXM_STAFF_Y * 2 + LXM_STAFF_HEIGHT;
