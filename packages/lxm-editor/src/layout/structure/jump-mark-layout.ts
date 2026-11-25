import type { ILXMJumpMark, ILXMMeasure } from "../../core/types";
import { getJumpMarkSide, JUMP_MARK_LABEL } from "../../core/playback/jump-marks";
import type { ILXMJumpMarkLayout, ILXMMeasureLayout, ILXMSystemLayout } from "../layout-types";
import { translateChordBlock } from "../music-text/music-text-layout";
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

const DESTINATION_INSET_X = 9;
const NUMBER_MIN_SHIFT_X = 13;
const NUMBER_DIGIT_WIDTH = 5;
const MARK_CLEARANCE = 2;
const right = (rect: MusicTextRect) => rect.x + rect.width;
const bottom = (rect: MusicTextRect) => rect.y + rect.height;
const overlapsX = (a: MusicTextRect, b: MusicTextRect) =>
  a.x < right(b) + MARK_CLEARANCE && right(a) > b.x - MARK_CLEARANCE;
const overlaps = (a: MusicTextRect, b: MusicTextRect) =>
  overlapsX(a, b) && a.y < bottom(b) + MARK_CLEARANCE && bottom(a) > b.y - MARK_CLEARANCE;
const numberBoundsAt = (measure: ILXMMeasureLayout, x: number, y: number): MusicTextRect => {
  const width = String(measure.index + 1).length * NUMBER_DIGIT_WIDTH;
  return { x: x - width / 2, y: y - 7, width, height: 8 };
};

/** 从下往上检查横向相交的占位，连续撞到多层时依次让位，结果始终只改纵坐标。 */
const clearObstacles = (bounds: MusicTextRect, obstacles: readonly MusicTextRect[]) => {
  const neighbors = obstacles
    .filter((rect) => overlapsX(bounds, rect))
    .sort((a, b) => bottom(b) - bottom(a));
  let y = bounds.y;
  for (const rect of neighbors) {
    if (y < bottom(rect) + MARK_CLEARANCE && y + bounds.height > rect.y - MARK_CLEARANCE)
      y = rect.y - MARK_CLEARANCE - bounds.height;
  }
  return y - bounds.y;
};

/**
 * 先贴着实际起始线放 Segno/Coda 和所属节号，再检查各个和弦图的成品边界。
 * 技巧、纯和弦名仍占原位，多个同端记号也保留各自命中区。末端文字沿用右端锚点，
 * 按原始和弦位置完成避让，避免局部抬图把文字指令带到更高一层。
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
  const chords = measures.flatMap((measure) => measure.chordSymbols ?? []);
  const obstacles = [
    ...chords.filter((chord) => !chord.diagram).map((chord) => chord.bounds),
    ...measures.flatMap((measure) => measure.notes.map(getFretTextBounds)).filter((bounds) => bounds.y < staffTop),
    ...system.techniques.map((technique) => technique.visualBounds),
  ];
  const destinations: MusicTextRect[] = [];
  const instructions: MusicTextRect[] = [];
  const numberedDestinations = new Set<ILXMMeasureLayout>();
  for (const destination of [true, false]) {
    if (!destination) {
      // 先看完本行全部落点：相邻小节也可能都有记号，此时前节号已经在自己的起始线。
      for (let index = 1; index < measures.length; index++) {
        const measure = measures[index]!;
        const previous = measures[index - 1]!;
        if (!numberedDestinations.has(measure) || numberedDestinations.has(previous)) continue;
        const staff = previous.strings[0]!;
        if (Math.abs(staff.x2 - measure.strings[0]!.x1) >= 1e-6) continue;
        const lines = previous.barline.parts.filter((part) => part.kind === "line");
        const x = lines.length ? Math.max(...lines.map((line) => line.x)) : staff.x2;
        const y = staff.y1 - 1;
        const oldNumber = numberBoundsAt(previous, x, y);
        const position = measure.numberPosition!;
        const startNumber = numberBoundsAt(measure, position.x, position.y);
        if (overlaps(oldNumber, startNumber)) {
          // 共线时仅给确实重叠的旧号让出横向间隔，保留原基线和小节归属。
          previous.numberPosition = { x: startNumber.x - MARK_CLEARANCE - oldNumber.width / 2, y };
        }
      }
      obstacles.push(...chords.filter((chord) => chord.diagram).map((chord) => chord.bounds));
    }
    for (const { measure, index, mark } of pending) {
      if (isJumpDestination(mark.kind) !== destination) continue;
      const staff = measure.strings[0]!;
      const width = LABEL_WIDTHS[mark.kind];
      // 空小节可能很窄。保留既有列宽，指令向左使用同一谱行的空间，且不越过行头。
      const x = destination ? staff.x1 + DESTINATION_INSET_X : Math.max(system.x + width, staff.x2 - 11);
      const y = staff.y1 - (destination ? 13 : 17);
      const bounds = destination
        ? { x: x - width / 2, y: y - 8, width, height: 16 }
        : { x: x - width, y: y - 11, width: width + 2, height: 15 };
      const previous = destination ? measures[index - 1] : undefined;
      const sharesLine = previous && Math.abs(previous.strings[0]!.x2 - staff.x1) < 1e-6;
      if (previous && !sharesLine)
        measure.jumpMarkStartBarline ??= layoutBarline("single", measure.strings, staff.x1);
      // 行首、分隔小节和共线边界遵循相同规则：编号属于有落点的小节，同一小节只绘制一次。
      // 以普通节号的 8px 字号估宽，三位及更多的节号按宽度再向左留出符号净空。
      const numberHalfWidth = String(measure.index + 1).length * NUMBER_DIGIT_WIDTH / 2;
      const numberX = x - Math.max(NUMBER_MIN_SHIFT_X, numberHalfWidth + 7);
      const numberBounds = destination && !numberedDestinations.has(measure)
        ? numberBoundsAt(measure, numberX, y + 3)
        : undefined;
      const footprint = numberBounds ? unionMusicBounds([bounds, numberBounds]) : bounds;
      const dy = clearObstacles(footprint, obstacles);
      if (numberBounds) {
        measure.numberPosition = { x: numberX, y: y + dy + 3 };
        numberedDestinations.add(measure);
      }
      const layout: ILXMJumpMarkLayout = {
        id: mark.id, kind: mark.kind, label: JUMP_MARK_LABEL[mark.kind], x, y: y + dy,
        bounds: { ...bounds, y: bounds.y + dy },
      };
      (measure.jumpMarks ??= []).push(layout);
      const occupied = { ...footprint, y: footprint.y + dy };
      obstacles.push(occupied);
      (destination ? destinations : instructions).push(occupied);
    }
  }
  // 仅实际撞到起始记号带的和弦图提升。整块移动以保持和弦名和网格的距离，
  // 横坐标仍沿用原拍。若上移路径碰到末端指令，一并留足净空，指令坐标保持原样。
  for (const measure of measures) {
    measure.chordSymbols = measure.chordSymbols?.map((chord) => {
      if (!chord.diagram || !destinations.some((bounds) => overlaps(chord.bounds, bounds))) return chord;
      return translateChordBlock(chord, 0, clearObstacles(chord.bounds, [...destinations, ...instructions]));
    });
  }
  return unionMusicBounds([...destinations, ...instructions]);
};
