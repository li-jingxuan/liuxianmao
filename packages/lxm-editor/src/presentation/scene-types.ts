/** 纯图元只描述绘制与音乐身份，不携带 DOM、React 或选区状态。 */
export interface SceneStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: string;
  lineCap?: "round" | "butt";
}
export type ScorePrimitive = (
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
    }
  | { kind: "path"; d: string }
  | { kind: "polygon"; points: readonly [number, number][] }
  | {
      kind: "text";
      text: string;
      x: number;
      y: number;
      fontSize: number;
      fontFamily: string;
      fontWeight: number;
      textAnchor: "start" | "middle" | "end";
    }
) &
  SceneStyle & {
    techniqueId?: string;
    numberedMarkId?: string;
    numberedEventId?: string;
    numberedItemId?: string;
  };
export interface ScoreScene {
  header: ScorePrimitive[];
  systems: { index: number; items: ScorePrimitive[] }[];
}
