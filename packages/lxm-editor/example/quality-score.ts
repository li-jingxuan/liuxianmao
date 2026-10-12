import source from "./example-technique-rhythm";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  type ILXMScoreCommand,
} from "../src/core/commands";
import { loadDocument } from "../src/core/loader";
import { copyChordPreset } from "../src/core/chord-presets";
import type { ILXMDocument } from "../src/core/types";

/** 固定混合谱通过领域复制生成唯一 ID，16/100 小节共用同一测试数据。 */
export const createQualityScore = (count: 16 | 100): ILXMDocument => {
  const loaded = loadDocument(JSON.stringify(source));
  if (!loaded.ok) throw new Error(loaded.errors.join(";"));
  let document = loaded.document;
  const run = (command: ILXMScoreCommand) => {
    const result = applyScoreCommand(document, command);
    if (!result.ok) throw new Error(result.message);
    document = result.document;
  };
  document = {
    ...document,
    score: {
      ...document.score,
      title: `A4 图片质量验收 · ${count} 小节混合谱`,
      arranger: "中文字体、歌词与技巧分页验收",
    },
  };
  const track = document.score.tracks[0]!;
  const first = track.measures[0]!;
  for (const verse of [1, 2, 3, 4] as const)
    for (const [index, beat] of first.beats.entries())
      run({
        type: LXMScoreCommandEnum.SetLyric,
        trackId: track.id,
        measureId: first.id,
        beatId: beat.id,
        verse,
        text: ["春", "风", "又", "绿"][index % 4]!,
      });
  run({
    type: LXMScoreCommandEnum.SetChordSymbol,
    trackId: track.id,
    measureId: first.id,
    beatId: first.beats[0]!.id,
    display: "nameAndDiagram",
    chord: copyChordPreset("F")!,
  });
  run({
    type: LXMScoreCommandEnum.SetSectionLabel,
    trackId: track.id,
    measureId: first.id,
    label: "主歌 A",
  });
  // 空闲拍添加闷音与两位品位，不破坏已有跨行技巧关联。
  const spare = track.measures[track.measures.length - 1]!;
  run({
    type: LXMScoreCommandEnum.SetNote,
    trackId: track.id,
    measureId: spare.id,
    beatId: spare.beats[0]!.id,
    string: 1,
    fret: "x",
  });
  run({
    type: LXMScoreCommandEnum.SetNote,
    trackId: track.id,
    measureId: spare.id,
    beatId: spare.beats[0]!.id,
    string: 2,
    fret: 12,
  });
  while (document.score.tracks[0]!.measures.length < count) {
    const t = document.score.tracks[0]!;
    const n = Math.min(count - t.measures.length, t.measures.length);
    run({
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: t.id,
      sourceStartMeasureId: t.measures[0]!.id,
      sourceEndMeasureId: t.measures[n - 1]!.id,
      afterMeasureId: t.measures.at(-1)!.id,
    });
  }
  const verified = loadDocument(JSON.stringify(document));
  if (!verified.ok) throw new Error(verified.errors.join(";"));
  return verified.document;
};
