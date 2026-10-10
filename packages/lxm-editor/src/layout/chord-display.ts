import type { ILXMChordSymbol, ILXMTrack } from "../core/types";

/** 省略全局偏好沿用旧文档设置；显式开关只影响视图，不修改保存的指法。 */
export const effectiveChordDisplay = (
  symbol: ILXMChordSymbol,
  showChordDiagrams?: boolean,
): ILXMChordSymbol["display"] =>
  showChordDiagrams === undefined
    ? symbol.display
    : showChordDiagrams && symbol.chord.diagram
      ? "nameAndDiagram"
      : "name";

/** 在布局门面生成浅层视图，间距、断行、内容和命中共同消费同一显示结果。 */
export const chordDisplayTrack = (
  track: ILXMTrack,
  showChordDiagrams?: boolean,
): ILXMTrack =>
  showChordDiagrams === undefined
    ? track
    : {
        ...track,
        measures: track.measures.map((measure) => ({
          ...measure,
          chordSymbols: measure.chordSymbols.map((symbol) => ({
            ...symbol,
            display: effectiveChordDisplay(symbol, showChordDiagrams),
          })),
        })),
      };
