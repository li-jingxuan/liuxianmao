import type { ILXMMeasureLayout } from "../layout/layout-types";
import type { ScorePrimitive } from "./scene-types";

/** 固定字形由斜划与两点构成，编辑谱面、打印及图片使用同一几何。 */
export const measureRepeatPrimitives = (measure: ILXMMeasureLayout): ScorePrimitive[] => {
  const repeat = measure.measureRepeat;
  if (!repeat) return [];
  const { x, y } = repeat;
  const identity = { measureRepeatId: measure.id, fill: "#202839" };
  return [
    { ...identity, kind: "polygon", points: [[x - 14, y + 8], [x - 12, y + 13], [x + 14, y - 8], [x + 12, y - 13]] },
    { ...identity, kind: "circle", cx: x - 7, cy: y - 7, r: 2.8 },
    { ...identity, kind: "circle", cx: x + 7, cy: y + 7, r: 2.8 },
  ];
};
