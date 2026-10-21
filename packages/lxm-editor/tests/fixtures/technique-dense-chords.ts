import source from "../../example/example-mvp7.2";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands";
import type { ILXMDocument } from "../../src/core/types";
/** 完整截图谱例：先在第五弦添加，再在相同两拍的第二弦添加。 */
export const screenshot = (reverse = false): ILXMDocument => {
  let document = structuredClone(source);
  const track = document.score.tracks[0]!;
  const measure = track.measures[6]!;
  for (const [index, fret] of [
    [0, 2],
    [1, 3],
    [2, 2],
    [3, 4],
  ] as const) {
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetNote,
      trackId: track.id,
      measureId: measure.id,
      beatId: measure.beats[index]!.id,
      string: 5,
      fret,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    document = result.document;
  }
  const beats = document.score.tracks[0]!.measures[6]!.beats;
  const pairs = [
    [5, 0],
    [2, 0],
    [5, 2],
  ] as const;
  for (const [string, start] of reverse ? [...pairs].reverse() : pairs) {
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.AddTechnique,
      trackId: track.id,
      technique: {
        type: "hammerOn",
        fromNoteId: beats[start]!.notes.find((n) => n.string === string)!.id,
        toNoteId: beats[start + 1]!.notes.find((n) => n.string === string)!.id,
      },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    document = result.document;
  }
  return document;
};

/** 两颗和弦同时带同类型技巧，覆盖六根弦的所有组合。 */
export const chordPair = (
  strings: number[],
  type: "hammerOn" | "pullOff" | "tie",
  twoDigits = false,
): ILXMDocument => {
  let document = structuredClone(source);
  const track = document.score.tracks[0]!;
  const measure = track.measures[6]!;
  const base = twoDigits ? 12 : 2;
  for (const index of [0, 1]) {
    measure.beats[index]!.notes = strings.map((string) => ({
      id: `chord-${index}-${string}`,
      string,
      fret:
        base +
        (index === 1
          ? type === "hammerOn"
            ? 2
            : type === "pullOff"
              ? -2
              : 0
          : 0),
    }));
  }
  for (const string of strings) {
    const added = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.AddTechnique,
      trackId: track.id,
      technique: {
        type,
        fromNoteId: `chord-0-${string}`,
        toNoteId: `chord-1-${string}`,
      },
    });
    if (!added.ok) throw new Error(JSON.stringify(added));
    document = added.document;
  }
  return document;
};

/** 上一张截图：完整 Am 小节第 5/6 颗八分音符，第四弦 1→2。 */
export const fourthStringScreenshot = (): ILXMDocument => {
  let document = structuredClone(source);
  const track = document.score.tracks[0]!;
  const measure = track.measures[6]!;
  for (const [index, fret] of [
    [4, 1],
    [5, 2],
  ] as const) {
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetNote,
      trackId: track.id,
      measureId: measure.id,
      beatId: measure.beats[index]!.id,
      string: 4,
      fret,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    document = result.document;
  }
  const beats = document.score.tracks[0]!.measures[6]!.beats;
  const added = applyScoreCommand(document, {
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track.id,
    technique: {
      type: "hammerOn",
      fromNoteId: beats[4]!.notes.find((n) => n.string === 4)!.id,
      toNoteId: beats[5]!.notes.find((n) => n.string === 4)!.id,
    },
  });
  if (!added.ok) throw new Error(JSON.stringify(added));
  return added.document;
};
