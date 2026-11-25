import type { ILXMJumpMark, ILXMMeasure } from "../../core/types";
import { getJumpMarkSide, JUMP_MARK_LABEL } from "../../core/playback/jump-marks";
import type { ILXMJumpMarkLayout, ILXMMeasureLayout, ILXMSystemLayout } from "../layout-types";
import { unionMusicBounds, type MusicTextRect } from "../music-text/music-text-metrics";
import { getFretTextBounds } from "../techniques/technique-geometry";
import { layoutBarline } from "./barline-layout";

export const isJumpDestination = (kind: ILXMJumpMark["kind"]) =>
  getJumpMarkSide(kind) === "start";

// 指令词汇固定；给 11px 斜体及两侧点击净空预留保守宽度，不依赖浏览器字体度量。
const LABEL_WIDTHS = {
  segno: 16, coda: 16, ds: 24, dsAlCoda: 62, toCoda: 44,
  dc: 24, fine: 24, dcAlFine: 60, dsAlFine: 60, dcAlCoda: 62,
} satisfies Record<ILXMJumpMark["kind"], number>;

const NUMBER_SHIFT_X = 14;
const MARK_CLEARANCE = 2;
const right = (rect: MusicTextRect) => rect.x + rect.width;
const bottom = (rect: MusicTextRect) => rect.y + rect.height;

/** 固定拍点与既有文字，碰撞时只把本记号及与它同排的小节号上移。 */
const clearObstacles = (bounds: MusicTextRect, obstacles: MusicTextRect[]) => {
  const neighbors = obstacles
    .filter((rect) => bounds.x < right(rect) + MARK_CLEARANCE && right(bounds) > rect.x - MARK_CLEARANCE)
    .sort((a, b) => bottom(b) - bottom(a));
  let y = bounds.y;
  for (const rect of neighbors) {
    if (y < bottom(rect) + MARK_CLEARANCE && y + bounds.height > rect.y - MARK_CLEARANCE)
      y = rect.y - MARK_CLEARANCE - bounds.height;
  }
  return y - bounds.y;
};

/**
 * 在技巧、和弦位置确定后投影跳转记号。落点先定位，指令再避让落点及编号；
 * 同小节同一端即使从外部读到多项也会逐项上移，维持每个稳定 ID 的可点击性。
 */
export const layoutJumpMarks = (
  system: ILXMSystemLayout,
  measures: ILXMMeasureLayout[],
  source: ReadonlyMap<string, ILXMMeasure>,
) => {
  const pending = measures.flatMap((measure, index) =>
    (source.get(measure.id)?.jumpMarks ?? []).map((mark) => ({ measure, index, mark })),
  );
  if (!pending.length) return undefined;
  const staffTop = measures[0]!.strings[0]!.y1;
  const obstacles = [
    ...measures.flatMap((measure) => (measure.chordSymbols ?? []).map((chord) => chord.bounds)),
    ...measures.flatMap((measure) => measure.notes.map(getFretTextBounds)).filter((bounds) => bounds.y < staffTop),
    ...system.techniques.map((technique) => technique.visualBounds),
  ];
  for (const destination of [true, false]) {
    for (const { measure, index, mark } of pending) {
      if (isJumpDestination(mark.kind) !== destination) continue;
      const staff = measure.strings[0]!;
      const width = LABEL_WIDTHS[mark.kind];
      // 空小节可能很窄。保留既有列宽，指令向左使用同一谱行的空间，且不越过行头。
      const x = destination ? staff.x1 : Math.max(system.x + width, staff.x2 - 11);
      const y = staff.y1 - (destination ? 7 : 17);
      const bounds = destination
        ? { x: x - width / 2, y: y - 8, width, height: 16 }
        : { x: x - width, y: y - 11, width: width + 2, height: 15 };
      const previous = destination ? measures[index - 1] : undefined;
      const sharesLine = previous && Math.abs(previous.strings[0]!.x2 - x) < 1e-6;
      if (previous && !sharesLine)
        measure.jumpMarkStartBarline ??= layoutBarline("single", measure.strings, x);
      // 仅同一谱行、同一根边界线需要让位。编号与符号一起检查上方的和弦和技巧。
      const numberX = x - NUMBER_SHIFT_X;
      const numberHalfWidth = previous ? String(previous.index + 1).length * 2.5 : 0;
      const numberBounds = sharesLine && !previous.numberPosition
        ? { x: numberX - numberHalfWidth, y: y - 4, width: numberHalfWidth * 2, height: 8 }
        : undefined;
      const footprint = numberBounds ? unionMusicBounds([bounds, numberBounds]) : bounds;
      const dy = clearObstacles(footprint, obstacles);
      if (numberBounds && previous) previous.numberPosition = { x: numberX, y: y + dy + 3 };
      const layout: ILXMJumpMarkLayout = {
        id: mark.id, kind: mark.kind, label: JUMP_MARK_LABEL[mark.kind], x, y: y + dy,
        bounds: { ...bounds, y: bounds.y + dy },
      };
      (measure.jumpMarks ??= []).push(layout);
      obstacles.push({ ...footprint, y: footprint.y + dy });
    }
  }
  return unionMusicBounds(measures.flatMap((measure) => (measure.jumpMarks ?? []).map((mark) => mark.bounds)));
};
