import {
  CURRENT_SCHEMA_VERSION,
  SCORE_DOCUMENT_SCHEMA,
  STANDARD_GUITAR_TUNING,
} from "../src/core/constants";
import { calculateRhythmTicks } from "../src/core/rhythm";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  type ILXMScoreCommand,
} from "../src/core/commands";
import { copyChordPreset } from "../src/core/chord-presets";
import type { ILXMBeat, ILXMDocument, ILXMMeasure } from "../src/core/types";

interface MockBeat {
  numbered?: string;
  notes: readonly (readonly [string: number, fret: number])[];
  base?: ILXMBeat["rhythm"]["base"];
  dots?: number;
}

/** 按真实时值累计 tick；简谱只作为独立标注，不从品位推导音级。 */
const createMeasure = (
  number: number,
  sectionLabel: string,
  entries: readonly MockBeat[],
  verses: readonly (readonly string[])[] = [],
  chordName?: string,
): ILXMMeasure => {
  let tick = 0;
  const beats: ILXMBeat[] = entries.map((entry, index) => {
    const id = `mvp72-beat-${number}-${index + 1}`;
    const rhythm = { base: entry.base ?? "quarter", dots: entry.dots ?? 0 };
    const duration = calculateRhythmTicks(rhythm);
    if (!duration.ok) throw new Error("MVP v7.2 mock 包含不可表示的时值。");
    const beat: ILXMBeat = {
      id,
      tick,
      rhythm,
      kind: entry.notes.length ? "notes" : "rest",
      notes: entry.notes.map(([string, fret]) => ({
        id: `${id}-note-${string}`,
        string,
        fret,
      })),
    };
    tick += duration.ticks;
    return beat;
  });
  if (tick !== 3840) throw new Error("MVP v7.2 mock 的 4/4 小节须恰好四拍。");
  // 各和弦标记独立复制标准模板，名称与指法图一致，避免共享可变指法数据。
  const chord = chordName ? copyChordPreset(chordName) : null;
  if (chordName && !chord) throw new Error(`缺少 ${chordName} 和弦指法模板。`);
  return {
    id: `mvp72-measure-${number}`,
    timeSignature: { numerator: 4, denominator: 4 },
    barline: number === 8 ? "final" : "single",
    sectionLabel,
    beats,
    numberedVoice: {
      events: beats.flatMap((beat, i) => {
        const tokens = entries[i]!.numbered?.split("+");
        return tokens
          ? [
              {
                id: `${beat.id}-numbered`,
                tick: beat.tick,
                rhythm: { ...beat.rhythm },
                kind:
                  tokens[0] === "0"
                    ? ("rest" as const)
                    : tokens[0] === "-"
                      ? ("continuation" as const)
                      : ("notes" as const),
                items: tokens.map((token, j) => ({
                  id: `${beat.id}-numbered-item-${j}`,
                  token,
                })),
              },
            ]
          : [];
      }),
      tuplets: [],
    },
    tuplets: [],
    // 按 Beat、段号顺序生成歌词，满足正式 loader 的排序约束；两行歌词验证竖线上缘。
    lyrics: beats.flatMap((beat, index) =>
      verses.flatMap((words, verseIndex) =>
        words[index]
          ? [
              {
                id: `mvp72-lyric-${number}-${verseIndex + 1}-${index + 1}`,
                beatId: beat.id,
                verse: (verseIndex + 1) as 1 | 2,
                text: words[index]!,
              },
            ]
          : [],
      ),
    ),
    chordSymbols: chord
      ? [
          {
            id: `mvp72-chord-${number}`,
            beatId: beats[0]!.id,
            display: "nameAndDiagram",
            chord,
          },
        ]
      : [],
  };
};

/** 短谱集中覆盖简谱能力，同时作为编辑器默认展示的完整 4/4 混合谱。 */
const baseDocument: ILXMDocument = {
  schema: SCORE_DOCUMENT_SCHEMA,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  documentRevision: 1,
  score: {
    id: "mvp72-numbered-mock",
    title: "风吹过山谷 · 4/4 六线谱示例",
    arranger: "六线猫",
    keySignature: "C",
    meta: { fixture: "mvp-v7.2-numbered", purpose: "简谱编辑与布局验收" },
    tracks: [
      {
        id: "mvp72-track-guitar",
        name: "标准调弦吉他",
        instrument: "guitar",
        tuning: {
          strings: structuredClone(STANDARD_GUITAR_TUNING).map((string) => ({
            ...string,
          })),
        },
        capo: 0,
        startBarline: "none",
        numberedMarks: [],
        techniques: [],
        measures: [
          createMeasure(
            1,
            "普通音级",

            [
              { numbered: "1", notes: [[2, 1]] },
              { numbered: "2", notes: [[2, 3]] },
              { numbered: "3", notes: [[1, 0]] },
              { numbered: "5", notes: [[1, 3]] },
            ],
            [["轻", "轻", "唱", "起"]],
            "C",
          ),
          createMeasure(
            2,
            "八分节奏与高音",
            [
              { numbered: "5", notes: [[1, 3]], base: "eighth" },
              { numbered: "6", notes: [[1, 5]], base: "eighth" },
              { numbered: "7", notes: [[1, 7]], base: "eighth" },
              { numbered: "1'", notes: [[1, 8]], base: "eighth" },
              { numbered: "2'", notes: [[1, 10]], base: "eighth" },
              { numbered: "3'", notes: [[1, 12]], base: "eighth" },
              { numbered: "2'", notes: [[1, 10]], base: "eighth" },
              { numbered: "1'", notes: [[1, 8]], base: "eighth" },
            ],
            [["旋", "律", "随", "风", "慢", "慢", "升", "起"]],
          ),
          createMeasure(3, "升降号与多级八度", [
            { numbered: "#4'", notes: [[1, 14]] },
            { numbered: "b7.", notes: [[3, 3]] },
            { numbered: "1''", notes: [[1, 20]] },
            { numbered: "6...", notes: [[5, 0]] },
          ]),
          createMeasure(
            4,
            "同拍多音与两行歌词",
            [
              {
                numbered: "1+3+5",
                notes: [
                  [3, 0],
                  [2, 1],
                  [1, 0],
                ],
              },
              {
                numbered: "2+4+6",
                notes: [
                  [3, 2],
                  [2, 3],
                  [1, 1],
                ],
              },
              {
                numbered: "3+5+7",
                notes: [
                  [3, 4],
                  [2, 5],
                  [1, 3],
                ],
              },
              {
                numbered: "1'+3'+5'",
                notes: [
                  [3, 12],
                  [2, 13],
                  [1, 12],
                ],
              },
            ],
            [
              ["和", "声", "轻", "响"],
              ["再", "唱", "一", "遍"],
            ],
            "C",
          ),
          createMeasure(5, "休止与延音标记", [
            { numbered: "0", notes: [] },
            { numbered: "-", notes: [[1, 3]] },
            { numbered: "5", notes: [[1, 3]] },
            { numbered: "0", notes: [] },
          ]),
          createMeasure(6, "空简谱拍：可补录", [
            { numbered: "1", notes: [[2, 1]] },
            { notes: [[2, 3]] },
            { numbered: "3", notes: [[1, 0]] },
            { notes: [[1, 3]] },
          ]),
          createMeasure(7, "无简谱与歌词：横梁收边", [
            { notes: [[2, 1]], base: "eighth" },
            { notes: [[2, 3]], base: "eighth" },
            { notes: [[1, 0]], base: "eighth" },
            { notes: [[1, 1]], base: "eighth" },
            { notes: [[1, 3]], base: "eighth" },
            { notes: [[1, 1]], base: "eighth" },
            { notes: [[1, 0]], base: "eighth" },
            { notes: [[2, 1]], base: "eighth" },
          ]),
          createMeasure(
            8,
            "附点与长音收尾",
            [
              { numbered: "1", notes: [[2, 1]], dots: 1 },
              { numbered: "2", notes: [[2, 3]], base: "eighth" },
              { numbered: "1", notes: [[2, 1]], base: "half" },
            ],
            [
              ["歌", "声", "落"],
              ["余", "音", "长"],
            ],
            "C",
          ),
        ],
      },
    ],
  },
};

/**
 * 默认谱例通过正式领域命令补齐编辑工作台常见状态，避免手写一个“看起来像”
 * 谱面的对象却绕过命令校验。所有 ID、影响和历史语义仍由 core 负责。
 */
const createCompleteEditorExample = (initial: ILXMDocument): ILXMDocument => {
  let document = initial;
  const run = (command: ILXMScoreCommand) => {
    const result = applyScoreCommand(document, command);
    if (!result.ok) throw new Error(`默认谱例命令失败：${result.message}`);
    document = result.document;
  };
  const track = () => document.score.tracks[0]!;
  const measure = (index: number) => track().measures[index]!;
  const beat = (measureIndex: number, beatIndex: number) =>
    measure(measureIndex).beats[beatIndex]!;
  const noteId = (measureIndex: number, beatIndex: number, string: number) =>
    beat(measureIndex, beatIndex).notes.find((note) => note.string === string)
      ?.id;

  const addChord = (measureIndex: number, name: string) => {
    const target = beat(measureIndex, 0);
    const chord = copyChordPreset(name);
    if (!chord) throw new Error(`默认谱例缺少 ${name} 和弦预设。`);
    run({
      type: LXMScoreCommandEnum.SetChordSymbol,
      trackId: track().id,
      measureId: target.id.startsWith("mvp72-measure-")
        ? measure(measureIndex).id
        : measure(measureIndex).id,
      beatId: target.id,
      display: "nameAndDiagram",
      chord,
    });
  };

  // 每个段落使用不同和弦，指法图与歌曲设置、图片导出共享真实 chord scene。
  addChord(1, "G");
  addChord(2, "Am");
  addChord(4, "F");
  addChord(5, "G");
  addChord(6, "Am");

  // 反复结构：第二小节后结束反复，第四小节后开启副歌段落双向反复。
  // 谱首保持普通起线，避免默认歌词空编辑位被谱首特殊边界吞掉。
  run({
    type: LXMScoreCommandEnum.SetBarlineBoundary,
    trackId: track().id,
    boundary: { kind: "afterMeasure", measureId: measure(1).id },
    barline: "repeatEnd",
  });
  run({
    type: LXMScoreCommandEnum.SetBarlineBoundary,
    trackId: track().id,
    boundary: { kind: "afterMeasure", measureId: measure(4).id },
    barline: "repeatBoth",
  });

  // 第二小节前三个八分音符使用三连音，保持 4/4 容量和核心时值规则。
  run({
    type: LXMScoreCommandEnum.SetTuplet,
    trackId: track().id,
    measureId: measure(1).id,
    startBeatId: beat(1, 0).id,
    endBeatId: beat(1, 2).id,
    ratio: { actual: 3, normal: 2 },
  });
  // 为演示真实延音线，把三连音后的目标音改为相邻同弦同品位的 10 品位。
  run({
    type: LXMScoreCommandEnum.SetNote,
    trackId: track().id,
    measureId: measure(1).id,
    beatId: beat(1, 5).id,
    string: 1,
    fret: 10,
  });

  const addTechnique = (technique: ILXMScoreCommand) => run(technique);
  // 第一小节留作最干净的歌词/选区默认态；技巧放在后续小节展示。
  const firstNote = noteId(1, 0, 1);
  const secondNote = noteId(1, 1, 1);
  const eighthNoteA = noteId(1, 0, 1);
  const eighthNoteB = noteId(1, 1, 1);
  // 延音线要求同弦同品位；第二组三连音后半段的两个 10 品位音满足该约束。
  const eighthNoteC = noteId(1, 4, 1);
  const eighthNoteD = noteId(1, 5, 1);
  const bendNote = noteId(2, 0, 1);
  const trillNote = noteId(2, 2, 1);
  if (
    !firstNote ||
    !secondNote ||
    !eighthNoteA ||
    !eighthNoteB ||
    !eighthNoteC ||
    !eighthNoteD ||
    !bendNote ||
    !trillNote
  )
    throw new Error("默认谱例缺少技巧目标音符。");

  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: { type: "hammerOn", fromNoteId: firstNote, toNoteId: secondNote },
  });
  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: { type: "slideUp", fromNoteId: eighthNoteA, toNoteId: eighthNoteB },
  });
  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: { type: "tie", fromNoteId: eighthNoteC, toNoteId: eighthNoteD },
  });
  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: { type: "bend", fromNoteId: bendNote, semitones: 2 },
  });
  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: { type: "trill", fromNoteId: trillNote, auxiliaryFret: 22 },
  });
  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: {
      type: "arpeggio",
      beatId: beat(3, 0).id,
      minString: 1,
      maxString: 3,
      direction: "ascending",
    },
  });
  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: { type: "strum", beatId: beat(3, 1).id, minString: 1, maxString: 3, stroke: "down" },
  });
  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: { type: "palmMute", fromBeatId: beat(1, 0).id, toBeatId: beat(1, 2).id },
  });
  addTechnique({
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track().id,
    technique: { type: "letRing", fromBeatId: beat(3, 0).id, toBeatId: beat(3, 3).id },
  });

  return document;
};

const document = createCompleteEditorExample(baseDocument);

export default document;
