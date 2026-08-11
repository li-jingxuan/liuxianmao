/**
 * 拍号显示策略与几何布局。
 *
 * 拍号数据早已参与节奏容量计算，但“是否显示”不能交给 React：自动换行变化后，
 * 页面若只看当前 system 会错误地在每行重复拍号。这里始终按文档 measure 顺序
 * 比较相邻值，并返回渲染层可以直接消费的最终文字坐标。
 */
import type { ILXMMeasure } from "../core/types";
import {
  LXM_STAFF_Y,
  LXM_TIME_SIGNATURE_DENOMINATOR_OFFSET_Y,
  LXM_TIME_SIGNATURE_FONT_SIZE,
  LXM_TIME_SIGNATURE_NUMERATOR_OFFSET_Y,
  LXM_TIME_SIGNATURE_WIDTH,
} from "./layout-constants";
import type { ILXMTimeSignatureLayout } from "./layout-types";

/** 第一小节必显示；之后只在分子或分母变化时显示。 */
export const shouldShowTimeSignature = (
  measures: ILXMMeasure[],
  measureIndex: number,
): boolean => {
  if (measureIndex === 0) return true;
  const current = measures[measureIndex];
  const previous = measures[measureIndex - 1];
  if (!current || !previous) return false;
  return (
    current.timeSignature.numerator !== previous.timeSignature.numerator ||
    current.timeSignature.denominator !== previous.timeSignature.denominator
  );
};

/**
 * 把分子、分母放在小节左 padding 后的固定前导区中央。
 * y 偏移以第一根弦为基准，避免页面依赖具体的六弦间距常量。
 */
export const layoutTimeSignature = (
  measure: ILXMMeasure,
  measureX: number,
  measureY: number,
  /** 开始反复圆点占用小节最左侧时，拍号整体越过该固定净空。 */
  leadingOffsetX = 0,
): ILXMTimeSignatureLayout => {
  const centerX = measureX + leadingOffsetX + LXM_TIME_SIGNATURE_WIDTH / 2;
  const createText = (text: string, y: number) => ({
    text,
    x: centerX,
    y,
    fontSize: LXM_TIME_SIGNATURE_FONT_SIZE,
    textAnchor: "middle" as const,
  });

  return {
    measureId: measure.id,
    width: LXM_TIME_SIGNATURE_WIDTH,
    numerator: createText(
      String(measure.timeSignature.numerator),
      measureY + LXM_STAFF_Y + LXM_TIME_SIGNATURE_NUMERATOR_OFFSET_Y,
    ),
    denominator: createText(
      String(measure.timeSignature.denominator),
      measureY + LXM_STAFF_Y + LXM_TIME_SIGNATURE_DENOMINATOR_OFFSET_Y,
    ),
  };
};
