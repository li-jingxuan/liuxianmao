/** 节奏区的实际下缘是连音标注与小节高度的共同来源。 */
import type {
  ILXMBeamSegmentLayout,
  ILXMDurationGlyphLayout,
  ILXMDurationMarkLayout,
  ILXMRestLayout,
  ILXMStringLineLayout,
} from "./layout-types";

/** 仓库 Bravura.otf 在字号 18 下的轮廓下缘；SVG Y 与字体坐标方向相反。 */
const FLAG_OUTLINE_DESCENT: Readonly<Record<string, number>> = {
  "\uE241": 0.252,
  "\uE243": 0.162,
  "\uE245": 3.096,
};

/** 用字形轮廓而非字体行框计算下缘，额外保留 1 个布局单位抗锯齿净空。 */
export const getDurationFlagBottom = (flag: ILXMDurationGlyphLayout): number =>
  flag.y + (FLAG_OUTLINE_DESCENT[flag.glyph] ?? 36) * (flag.fontSize / 18) + 1;

/** 符尾缺席时不预留空间；连梁、延续线、附点和休止符仍参与边界计算。 */
export const getRhythmBottom = (
  strings: ILXMStringLineLayout[],
  beams: ILXMBeamSegmentLayout[],
  marks: ILXMDurationMarkLayout[],
  rests: ILXMRestLayout[],
): number =>
  Math.max(
    ...strings.map((line) => Math.max(line.y1, line.y2)),
    ...beams.map((beam) => beam.y + beam.thickness / 2),
    ...marks.map((mark) =>
      Math.max(
        mark.stemY1,
        mark.stemY2,
        mark.flag ? getDurationFlagBottom(mark.flag) : mark.stemY2,
        ...mark.sustainMarks.map((line) => line.y + line.thickness / 2),
        ...mark.dotAnchors.map((dot) => dot.y + 2),
      ),
    ),
    // 休止符位于六线谱中部，保留既有的保守下缘，不缩小它们的净空。
    ...rests.map((rest) => rest.y + 18),
  );
