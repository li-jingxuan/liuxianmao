import type { ILXMJumpMark, ILXMMeasure } from "../../core/types";
import { getJumpMarkSide, JUMP_MARK_LABEL } from "../../core/playback/jump-marks";
import type { ILXMJumpMarkLayout, ILXMMeasureLayout, ILXMSystemLayout } from "../layout-types";
import { translateChordBlock } from "../music-text/music-text-layout";
import { unionMusicBounds, type MusicTextRect } from "../music-text/music-text-metrics";
import { getFretTextBounds } from "../techniques/technique-geometry";

const isJumpDestination = (kind: ILXMJumpMark["kind"]) =>
  getJumpMarkSide(kind) === "start";

// 指令词汇固定；给 11px 斜体及两侧点击净空预留保守宽度，不依赖浏览器字体度量。
const LABEL_WIDTHS = {
  segno: 16, coda: 16, ds: 24, dsAlCoda: 62, toCoda: 44,
  dc: 24, fine: 24, dcAlFine: 60, dsAlFine: 60, dcAlCoda: 62,
} satisfies Record<ILXMJumpMark["kind"], number>;

// 沿用符号相对第一根弦的高度，给边界上的小节号留出原有纵向净空。
const DESTINATION_ABOVE_STAFF = 18;
const MARK_CLEARANCE = 2;
const right = (rect: MusicTextRect) => rect.x + rect.width;
const bottom = (rect: MusicTextRect) => rect.y + rect.height;
const overlapsX = (a: MusicTextRect, b: MusicTextRect) =>
  a.x < right(b) + MARK_CLEARANCE && right(a) > b.x - MARK_CLEARANCE;
const overlaps = (a: MusicTextRect, b: MusicTextRect) =>
  overlapsX(a, b) && a.y < bottom(b) + MARK_CLEARANCE && bottom(a) > b.y - MARK_CLEARANCE;

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
 * Segno/Coda 画在配对小节的起点，与试听落点一致。共线时这里也是前一节的右边界。
 * 小节号独立使用各节的右端锚点。先按原始和弦位置排末端文字，随后让符号避开已有文字，
 * 避免符号移到共用边界时把前一节的文字指令抬高。
 */
export const layoutJumpMarks = (
  system: ILXMSystemLayout,
  measures: ILXMMeasureLayout[],
  source: ReadonlyMap<string, ILXMMeasure>,
) => {
  const pending = measures.flatMap((measure) =>
    (source.get(measure.id)?.jumpMarks ?? []).map((mark) => ({ measure, mark })),
  );
  if (!pending.length) return undefined;
  const staffTop = measures[0]!.strings[0]!.y1;
  const chords = measures.flatMap((measure) => measure.chordSymbols ?? []);
  const fixedObstacles = [
    ...chords.filter((chord) => !chord.diagram).map((chord) => chord.bounds),
    ...measures.flatMap((measure) => measure.notes.map(getFretTextBounds)).filter((bounds) => bounds.y < staffTop),
    ...system.techniques.map((technique) => technique.visualBounds),
  ];
  const destinations: MusicTextRect[] = [];
  const instructions: MusicTextRect[] = [];
  for (const destination of [false, true]) {
    const obstacles = destination
      ? [...fixedObstacles, ...instructions]
      : [...fixedObstacles, ...chords.filter((chord) => chord.diagram).map((chord) => chord.bounds)];
    for (const { measure, mark } of pending) {
      if (isJumpDestination(mark.kind) !== destination) continue;
      const staff = measure.strings[0]!;
      const width = LABEL_WIDTHS[mark.kind];
      // 空小节可能很窄。保留既有列宽，指令向左使用同一谱行的空间，且不越过行头。
      // 符号跟随本节弦线起点，换行、有小节间距或复合小节线时也使用实际的行内位置。
      const x = destination ? staff.x1 : Math.max(system.x + width, staff.x2 - 11);
      const y = staff.y1 - (destination ? DESTINATION_ABOVE_STAFF : 17);
      const bounds = destination
        ? { x: x - width / 2, y: y - 8, width, height: 16 }
        : { x: x - width, y: y - 11, width: width + 2, height: 15 };
      const dy = clearObstacles(bounds, obstacles);
      const layout: ILXMJumpMarkLayout = {
        id: mark.id, kind: mark.kind, label: JUMP_MARK_LABEL[mark.kind], x, y: y + dy,
        bounds: { ...bounds, y: bounds.y + dy },
      };
      const marks = measure.jumpMarks ??= [];
      if (destination) marks.unshift(layout);
      else marks.push(layout);
      obstacles.push(layout.bounds);
      (destination ? destinations : instructions).push(layout.bounds);
    }
  }
  // 仅实际撞到回跳符号的和弦图提升。整块移动以保持和弦名和网格的距离，
  // 横坐标仍沿用原拍。若上移路径碰到末端指令，一并留足净空，指令坐标保持原样。
  for (const measure of measures) {
    measure.chordSymbols = measure.chordSymbols?.map((chord) => {
      if (!chord.diagram || !destinations.some((bounds) => overlaps(chord.bounds, bounds))) return chord;
      return translateChordBlock(chord, 0, clearObstacles(chord.bounds, [...destinations, ...instructions]));
    });
  }
  return unionMusicBounds([...destinations, ...instructions]);
};
