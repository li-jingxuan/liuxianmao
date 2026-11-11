import type { ILXMBarlineLayout, ILXMMeasureLayout } from "./layout-types";

/** 只平移已有几何；技巧占高与谱行重排仍由调用方决定。 */
export const translateBarline = (
  barline: ILXMBarlineLayout | null,
  dy: number,
): ILXMBarlineLayout | null =>
  barline
    ? {
        ...barline,
        parts: barline.parts.map((part) =>
          part.kind === "line"
            ? { ...part, y1: part.y1 + dy, y2: part.y2 + dy }
            : { ...part, cy: part.cy + dy },
        ),
      }
    : null;

/**
 * 平移小节的 TAB 基础几何，而不是只改 measure.y。
 *
 * layout 产物是渲染和命中的唯一坐标来源；若遗漏 Note、beam 或 rest 中任一个子项，
 * 页面就会出现弦线与音符错位的隐蔽漂移。简谱、歌词、和弦、visualBounds
 * 由正文布局另行平移；这里不能重复处理，技巧与谱行重排也仍由调用方负责。
 */
export const translateMeasure = (
  measure: ILXMMeasureLayout,
  dy: number,
): ILXMMeasureLayout => ({
  ...measure,
  y: measure.y + dy,
  strings: measure.strings.map((line) => ({
    ...line,
    y1: line.y1 + dy,
    y2: line.y2 + dy,
  })),
  notes: measure.notes.map((note) => ({ ...note, y: note.y + dy })),
  restMarks: measure.restMarks.map((rest) => ({ ...rest, y: rest.y + dy })),
  barline: translateBarline(measure.barline, dy)!,
  timeSignature: measure.timeSignature
    ? {
        ...measure.timeSignature,
        numerator: {
          ...measure.timeSignature.numerator,
          y: measure.timeSignature.numerator.y + dy,
        },
        denominator: {
          ...measure.timeSignature.denominator,
          y: measure.timeSignature.denominator.y + dy,
        },
      }
    : null,
  beamSegments: measure.beamSegments.map((beam) => ({
    ...beam,
    y: beam.y + dy,
  })),
  tuplets: measure.tuplets.map((group) => ({
    ...group,
    label: { ...group.label, y: group.label.y + dy },
    bracket: group.bracket
      ? {
          ...group.bracket,
          y: group.bracket.y + dy,
          lines: group.bracket.lines.map((line) => ({
            ...line,
            y1: line.y1 + dy,
            y2: line.y2 + dy,
          })),
        }
      : null,
  })),
  durationMarks: measure.durationMarks.map((mark) => ({
    ...mark,
    head: { ...mark.head, y: mark.head.y + dy },
    stemY1: mark.stemY1 + dy,
    stemY2: mark.stemY2 + dy,
    beamY: mark.beamY + dy,
    sustainMarks: mark.sustainMarks.map((item) => ({
      ...item,
      y: item.y + dy,
    })),
    flag: mark.flag ? { ...mark.flag, y: mark.flag.y + dy } : null,
    dotAnchors: mark.dotAnchors.map((dot) => ({ ...dot, y: dot.y + dy })),
  })),
});
