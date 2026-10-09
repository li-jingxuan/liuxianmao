import { cloneChordDiagram } from "./chord-diagram";
import type { ILXMChordDiagram, ILXMChordString } from "./types";

/** 人工登记的标准调弦常用指法；模板仅复制进草稿，不参与已保存文档的解释。 */
const createPreset = (
  name: string,
  frets: (number | "x")[],
  fingers: number[],
  barres: ILXMChordDiagram["barres"] = [],
) => ({
  name,
  diagram: {
    startFret: 1,
    fretCount: 5 as const,
    strings: frets
      .map((fret, i) => ({
        string: (6 - i) as ILXMChordString["string"],
        fret,
        finger: fingers[i] ? (fingers[i] as ILXMChordString["finger"]) : null,
      }))
      .reverse(),
    barres,
  },
});
export const CHORD_PRESETS = [
  createPreset("C", ["x", 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]),
  createPreset("D", ["x", "x", 0, 2, 3, 2], [0, 0, 0, 1, 3, 2]),
  createPreset("E", [0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0]),
  createPreset("G", [3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3]),
  createPreset("A", ["x", 0, 2, 2, 2, 0], [0, 0, 1, 2, 3, 0]),
  createPreset("Am", ["x", 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0]),
  createPreset("Dm", ["x", "x", 0, 2, 3, 1], [0, 0, 0, 2, 3, 1]),
  createPreset("Em", [0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0]),
  createPreset(
    "F",
    [1, 3, 3, 2, 1, 1],
    [1, 3, 4, 2, 1, 1],
    [{ fret: 1, minString: 1, maxString: 6, finger: 1 }],
  ),
  createPreset(
    "Bm",
    ["x", 2, 4, 4, 3, 2],
    [0, 1, 3, 4, 2, 1],
    [{ fret: 2, minString: 1, maxString: 5, finger: 1 }],
  ),
  createPreset("D7", ["x", "x", 0, 2, 1, 2], [0, 0, 0, 2, 1, 3]),
  createPreset("E7", [0, 2, 0, 1, 0, 0], [0, 2, 0, 1, 0, 0]),
  createPreset("A7", ["x", 0, 2, 0, 2, 0], [0, 0, 1, 0, 2, 0]),
  createPreset("Cmaj7", ["x", 3, 2, 0, 0, 0], [0, 3, 2, 0, 0, 0]),
];
/** 每次选模板产生独立快照，修改一处不影响模板与其他标记。 */
export const copyChordPreset = (name: string) => {
  const preset = CHORD_PRESETS.find((item) => item.name === name);
  return preset
    ? { name: preset.name, diagram: cloneChordDiagram(preset.diagram) }
    : null;
};
