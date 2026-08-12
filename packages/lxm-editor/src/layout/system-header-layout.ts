/**
 * System 行头布局。
 *
 * 行头只返回几何，不读取 DOM 或字体测量结果。固定宽度让服务端、测试和浏览器
 * 对同一文档得到完全一致的断行；将纵向 TAB、弦线延伸段与行首反复线放在核心
 * 层，也能确保页面不会通过 CSS 位移破坏小节命中坐标。
 */
import type { ILXMBarlineType } from "../core/types";
import { layoutBarline } from "./barline-layout";
import {
  LXM_STAFF_Y,
  LXM_SYSTEM_HEADER_WIDTH,
  LXM_TAB_LABEL_BASELINE_OFFSETS_Y,
  LXM_TAB_LABEL_CENTER_OFFSET_X,
  LXM_TAB_LABEL_FONT_SIZE,
} from "./layout-constants";
import type {
  ILXMStringLineLayout,
  ILXMSystemHeaderLayout,
} from "./layout-types";

export interface ILXMLayoutSystemHeaderContext {
  systemX: number;
  systemY: number;
  /** staffX 由 systemX + 固定行头宽度得到，是该行所有小节的坐标起点。 */
  staffX: number;
  firstMeasureStrings: ILXMStringLineLayout[];
  leadingBarline: ILXMBarlineType | null;
}

export const layoutSystemHeader = ({
  systemX,
  systemY,
  staffX,
  firstMeasureStrings,
  leadingBarline,
}: ILXMLayoutSystemHeaderContext): ILXMSystemHeaderLayout => ({
  width: LXM_SYSTEM_HEADER_WIDTH,
  staffX,
  // 三个独立文字节点比 SVG 内嵌换行更稳定：核心 layout 明确控制每个基线，
  // 服务端、浏览器和测试不会因 line-height 或字体继承差异得到不同排版。
  tabLetters: ["T", "A", "B"].map((text, index) => ({
    text,
    x: systemX + LXM_TAB_LABEL_CENTER_OFFSET_X,
    y: systemY + LXM_STAFF_Y + LXM_TAB_LABEL_BASELINE_OFFSETS_Y[index]!,
    fontSize: LXM_TAB_LABEL_FONT_SIZE,
    textAnchor: "middle",
  })),
  // 第一小节的弦线 y 坐标是当前 system 的最终几何真相。这里只复制纵坐标并把
  // 横向范围限制在行头，既与正文无缝衔接，也不会扩大 measure 的命中区域。
  strings: firstMeasureStrings.map((string) => ({
    ...string,
    x1: systemX,
    x2: staffX,
  })),
  leadingBarline: leadingBarline
    ? layoutBarline(leadingBarline, firstMeasureStrings, staffX)
    : null,
});
