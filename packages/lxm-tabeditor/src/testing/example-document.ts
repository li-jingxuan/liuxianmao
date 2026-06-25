import type {
  LxmScoreDocument,
  RhythmValue,
  TabNote,
  Technique,
} from "../core/schema";
import { STANDARD_GUITAR_TUNING } from "../core/constants";

const rhythm = (
  base: RhythmValue["base"],
  dots: RhythmValue["dots"] = 0,
): RhythmValue => ({
  base,
  dots,
});

const note = (
  id: string,
  string: number,
  fret: TabNote["fret"],
  techniques: Technique[] = [],
  options: Pick<TabNote, "tie" | "ghost"> = {},
): TabNote => ({
  id,
  string,
  fret,
  techniques,
  ...(options.tie ? { tie: options.tie } : {}),
  ...(options.ghost !== undefined ? { ghost: options.ghost } : {}),
});

/**
 * Iteration 1 的规范夹具，覆盖多种常见时值（四分、八分、十六分、三十二分、附点）、
 * 技巧、休止拍、变拍号、三连音、歌词、和弦与跨小节延音。
 */
export const guitarTabEditorExample: LxmScoreDocument = {
  schema: "lxm-tab-score",
  schemaVersion: 1,
  documentRevision: 1,
  score: {
    id: "score-demo-001",
    title: "六线谱完整数据示例",
    meta: {
      tempo: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: "C",
      capo: 0,
    },
    tracks: [
      {
        id: "track-guitar-001",
        name: "原声吉他",
        instrument: "guitar",
        tuning: {
          strings: STANDARD_GUITAR_TUNING.map((item) => ({ ...item })),
        },
        measures: [
          /*
          {
            id: "measure-001",
            timeSignature: { numerator: 4, denominator: 4 },
            barline: "single",
            chordSymbols: [
              {
                id: "chord-symbol-001",
                tick: 0,
                chordDefinitionId: "chord-am-open",
                display: "nameAndDiagram",
              },
            ],
            lyrics: [
              { id: "lyric-001", tick: 0, text: "风", syllable: "begin" },
              { id: "lyric-002", tick: 480, text: "吹", syllable: "middle" },
              { id: "lyric-003", tick: 960, text: "过", syllable: "end" },
              { id: "lyric-004", tick: 3360, text: "来", syllable: "single" },
            ],
            tuplets: [],
            beats: [
              {
                id: "beat-001-01",
                tick: 0,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [
                  note("note-001-01-01", 3, 0, [
                    { type: "hammerOn", targetNoteId: "note-001-02-01" },
                  ]),
                ],
              },
              {
                id: "beat-001-02",
                tick: 480,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [
                  note("note-001-02-01", 3, 2, [
                    { type: "pullOff", targetNoteId: "note-001-03-01" },
                  ]),
                ],
              },
              {
                id: "beat-001-03",
                tick: 960,
                rhythm: rhythm("quarter"),
                kind: "notes",
                notes: [
                  note("note-001-03-01", 3, 0, [
                    { type: "vibrato", width: "medium" },
                  ]),
                  note("note-001-03-02", 5, 0),
                ],
              },
              {
                id: "beat-001-04",
                tick: 1920,
                rhythm: rhythm("sixteenth"),
                kind: "notes",
                notes: [note("note-001-04-01", 4, 2)],
              },
              {
                id: "beat-001-05",
                tick: 2160,
                rhythm: rhythm("quarter"),
                kind: "notes",
                notes: [note("note-001-05-01", 2, 1, [], { ghost: true })],
              },
              {
                id: "beat-001-06",
                tick: 3120,
                rhythm: rhythm("eighth"),
                kind: "rest",
              },
              {
                id: "beat-001-07",
                tick: 3600,
                rhythm: rhythm("sixteenth"),
                kind: "notes",
                notes: [
                  note("note-001-07-01", 1, 0, [
                    { type: "harmonic", harmonicType: "natural" },
                  ]),
                ],
              },
            ],
          },
          // 小节 2
          {
            id: "measure-002",
            barline: "repeatEnd",
            chordSymbols: [
              {
                id: "chord-symbol-002",
                tick: 0,
                chordDefinitionId: "chord-f-barre",
                display: "nameAndDiagram",
              },
              {
                id: "chord-symbol-003",
                tick: 1920,
                chordDefinitionId: "chord-c-open",
                display: "nameAndDiagram",
              },
            ],
            lyrics: [],
            tuplets: [],
            beats: [
              {
                id: "beat-002-01",
                tick: 0,
                rhythm: rhythm("quarter", 1),
                kind: "notes",
                notes: [
                  note("note-002-01-01", 1, 1, [
                    { type: "slideUp", targetNoteId: "note-002-02-01" },
                  ]),
                ],
              },
              {
                id: "beat-002-02",
                tick: 1440,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [
                  note("note-002-02-01", 1, 3, [
                    { type: "slideDown", targetNoteId: "note-002-03-01" },
                    { type: "bend", semitones: 2, release: true },
                  ]),
                ],
              },
              {
                id: "beat-002-03",
                tick: 1920,
                rhythm: rhythm("eighth", 1),
                kind: "notes",
                notes: [
                  note("note-002-03-01", 1, 1, [
                    { type: "harmonic", harmonicType: "natural" },
                  ]),
                ],
              },
              {
                id: "beat-002-04",
                tick: 2640,
                rhythm: rhythm("sixteenth"),
                kind: "notes",
                notes: [
                  note("note-002-04-01", 2, 1, [
                    { type: "harmonic", harmonicType: "artificial" },
                  ]),
                ],
              },
              {
                id: "beat-002-05",
                tick: 2880,
                rhythm: rhythm("quarter"),
                kind: "notes",
                notes: [note("note-002-05-01", 6, 1, [{ type: "palmMute" }])],
              },
            ],
          },
          {
            id: "measure-003",
            timeSignature: { numerator: 3, denominator: 4 },
            barline: "repeatStart",
            chordSymbols: [
              {
                id: "chord-symbol-004",
                tick: 0,
                chordDefinitionId: "chord-g-open",
                display: "nameAndDiagram",
              },
            ],
            lyrics: [
              { id: "lyric-005", tick: 0, text: "向", syllable: "single" },
              { id: "lyric-006", tick: 480, text: "远", syllable: "single" },
              { id: "lyric-007", tick: 1440, text: "方", syllable: "single" },
            ],
            tuplets: [],
            beats: [
              {
                id: "beat-003-01",
                tick: 0,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [note("note-003-01-01", 6, 3)],
              },
              {
                id: "beat-003-02",
                tick: 480,
                rhythm: rhythm("quarter"),
                kind: "notes",
                notes: [
                  note("note-003-02-01", 3, 0, [
                    { type: "vibrato", width: "wide" },
                  ]),
                ],
              },
              {
                id: "beat-003-03",
                tick: 1440,
                rhythm: rhythm("quarter", 1),
                kind: "notes",
                notes: [
                  note("note-003-03-01", 1, 3, [], {
                    tie: { targetNoteId: "note-004-01-01" },
                  }),
                ],
              },
            ],
          },
          {
            id: "measure-004",
            barline: "single",
            chordSymbols: [
              {
                id: "chord-symbol-005",
                tick: 0,
                chordDefinitionId: "chord-g-open",
                display: "nameOnly",
              },
              {
                id: "chord-symbol-006",
                tick: 1920,
                chordDefinitionId: "chord-am-open",
                display: "hidden",
              },
            ],
            lyrics: [],
            tuplets: [
              {
                id: "tuplet-004-01",
                actualNotes: 3,
                normalNotes: 2,
                beatIds: ["beat-004-01", "beat-004-02", "beat-004-03"],
                bracket: "show",
              },
            ],
            beats: [
              {
                id: "beat-004-01",
                tick: 0,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [note("note-004-01-01", 1, 3)],
              },
              {
                id: "beat-004-02",
                tick: 320,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [note("note-004-02-01", 2, 1)],
              },
              {
                id: "beat-004-03",
                tick: 640,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [note("note-004-03-01", 3, 0)],
              },
              {
                id: "beat-004-04",
                tick: 960,
                rhythm: rhythm("quarter", 1),
                kind: "notes",
                notes: [
                  note("note-004-04-01", 2, 1, [
                    { type: "vibrato", width: "small" },
                  ]),
                ],
              },
              {
                id: "beat-004-05",
                tick: 2400,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [note("note-004-05-01", 3, 2)],
              },
            ],
          },
          */
          // 第二段：补充更高密度的三十二分音符与附点组合。
          {
            id: "measure-005",
            timeSignature: { numerator: 4, denominator: 4 },
            chordSymbols: [
              {
                id: "chord-symbol-007",
                tick: 0,
                chordDefinitionId: "chord-c-open",
                display: "nameOnly",
              },
            ],
            lyrics: [],
            tuplets: [],
            beats: [
              // 第 1 拍：四个三十二分音符 + 两个十六分音符。
              // {
              //   id: "beat-005-01",
              //   tick: 0,
              //   rhythm: rhythm("thirtySecond"),
              //   kind: "notes",
              //   notes: [note("note-005-01-01", 2, 1)],
              // },
              // {
              //   id: "beat-005-02",
              //   tick: 120,
              //   rhythm: rhythm("thirtySecond"),
              //   kind: "notes",
              //   notes: [note("note-005-02-01", 1, 0)],
              // },
              // {
              //   id: "beat-005-03",
              //   tick: 240,
              //   rhythm: rhythm("thirtySecond"),
              //   kind: "notes",
              //   notes: [note("note-005-03-01", 2, 3)],
              // },
              // {
              //   id: "beat-005-04",
              //   tick: 360,
              //   rhythm: rhythm("thirtySecond"),
              //   kind: "notes",
              //   notes: [note("note-005-04-01", 1, 1)],
              // },
              // {
              //   id: "beat-005-05",
              //   tick: 480,
              //   rhythm: rhythm("sixteenth"),
              //   kind: "notes",
              //   notes: [note("note-005-05-01", 3, 0)],
              // },
              // {
              //   id: "beat-005-06",
              //   tick: 720,
              //   rhythm: rhythm("sixteenth"),
              //   kind: "notes",
              //   notes: [note("note-005-06-01", 4, 2)],
              // },
              // 第 2 拍：使用四分音符占满整拍，避免和下一组更短时值混成一段。
              // {
              //   id: "beat-005-07",
              //   tick: 960,
              //   rhythm: rhythm("quarter"),
              //   kind: "notes",
              //   notes: [note("note-005-07-01", 3, 2)],
              // },
              {
                id: "beat-005-08",
                tick: 1920,
                rhythm: rhythm("thirtySecond"),
                kind: "notes",
                notes: [note("note-005-08-01", 2, 1)],
              },
              {
                id: "beat-005-09",
                tick: 2040,
                rhythm: rhythm("thirtySecond"),
                kind: "notes",
                notes: [note("note-005-09-01", 1, 3)],
              },
              {
                id: "beat-005-10",
                tick: 2160,
                rhythm: rhythm("thirtySecond"),
                kind: "notes",
                notes: [note("note-005-10-01", 2, 0)],
              },
              // 第 3 拍：再次出现高密度三十二分音符组，并在拍尾用八分音符收束。
              {
                id: "beat-005-11",
                tick: 2280,
                rhythm: rhythm("thirtySecond"),
                kind: "notes",
                notes: [note("note-005-11-01", 5, 3)],
              },
              {
                id: "beat-005-12",
                tick: 2400,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [note("note-005-12-01", 4, 0)],
              },
              
              // 第 4 拍：八分音符加两个十六分音符，保证整小节恰好 4/4。
              {
                id: "beat-005-13",
                tick: 2880,
                rhythm: rhythm("eighth"),
                kind: "notes",
                notes: [note("note-005-13-01", 3, 2)],
              },
              {
                id: "beat-005-14",
                tick: 3360,
                rhythm: rhythm("sixteenth"),
                kind: "notes",
                notes: [note("note-005-14-01", 2, 3)],
              },
              {
                id: "beat-005-15",
                tick: 3600,
                rhythm: rhythm("sixteenth"),
                kind: "notes",
                notes: [note("note-005-15-01", 1, 1)],
              },
            ],
          },
          // {
          //   id: "measure-006",
          //   timeSignature: { numerator: 4, denominator: 4 },
          //   chordSymbols: [
          //     {
          //       id: "chord-symbol-008",
          //       tick: 0,
          //       chordDefinitionId: "chord-am-open",
          //       display: "nameAndDiagram",
          //     },
          //   ],
          //   lyrics: [],
          //   tuplets: [],
          //   beats: [
          //     {
          //       id: "beat-006-01",
          //       tick: 0,
          //       rhythm: rhythm("eighth", 1),
          //       kind: "notes",
          //       notes: [note("note-006-01-01", 2, 1)],
          //     },
          //     {
          //       id: "beat-006-02",
          //       tick: 720,
          //       rhythm: rhythm("sixteenth"),
          //       kind: "notes",
          //       notes: [note("note-006-02-01", 3, 2)],
          //     },
          //     {
          //       id: "beat-006-03",
          //       tick: 960,
          //       rhythm: rhythm("sixteenth", 1),
          //       kind: "notes",
          //       notes: [note("note-006-03-01", 2, 3)],
          //     },
          //     {
          //       id: "beat-006-04",
          //       tick: 1320,
          //       rhythm: rhythm("thirtySecond"),
          //       kind: "notes",
          //       notes: [note("note-006-04-01", 1, 0)],
          //     },
          //     {
          //       id: "beat-006-05",
          //       tick: 1440,
          //       rhythm: rhythm("quarter", 1),
          //       kind: "notes",
          //       notes: [note("note-006-05-01", 4, 2)],
          //     },
          //     {
          //       id: "beat-006-06",
          //       tick: 2880,
          //       rhythm: rhythm("eighth"),
          //       kind: "notes",
          //       notes: [note("note-006-06-01", 3, 0)],
          //     },
          //     {
          //       id: "beat-006-07",
          //       tick: 3360,
          //       rhythm: rhythm("sixteenth", 1),
          //       kind: "notes",
          //       notes: [note("note-006-07-01", 2, 1)],
          //     },
          //     {
          //       id: "beat-006-08",
          //       tick: 3720,
          //       rhythm: rhythm("thirtySecond"),
          //       kind: "notes",
          //       notes: [note("note-006-08-01", 1, 3)],
          //     },
          //   ],
          // },
          // {
          //   id: "measure-007",
          //   timeSignature: { numerator: 4, denominator: 4 },
          //   chordSymbols: [
          //     {
          //       id: "chord-symbol-009",
          //       tick: 0,
          //       chordDefinitionId: "chord-f-barre",
          //       display: "nameOnly",
          //     },
          //   ],
          //   lyrics: [],
          //   tuplets: [],
          //   beats: [
          //     {
          //       id: "beat-007-01",
          //       tick: 0,
          //       rhythm: rhythm("eighth", 2),
          //       kind: "notes",
          //       notes: [note("note-007-01-01", 1, 1)],
          //     },
          //     {
          //       id: "beat-007-02",
          //       tick: 840,
          //       rhythm: rhythm("thirtySecond"),
          //       kind: "notes",
          //       notes: [note("note-007-02-01", 2, 1)],
          //     },
          //     {
          //       id: "beat-007-03",
          //       tick: 960,
          //       rhythm: rhythm("sixteenth", 1),
          //       kind: "notes",
          //       notes: [note("note-007-03-01", 3, 2)],
          //     },
          //     {
          //       id: "beat-007-04",
          //       tick: 1320,
          //       rhythm: rhythm("thirtySecond"),
          //       kind: "notes",
          //       notes: [note("note-007-04-01", 2, 3)],
          //     },
          //     {
          //       id: "beat-007-05",
          //       tick: 1440,
          //       rhythm: rhythm("quarter", 1),
          //       kind: "notes",
          //       notes: [note("note-007-05-01", 4, 3)],
          //     },
          //     {
          //       id: "beat-007-06",
          //       tick: 2880,
          //       rhythm: rhythm("sixteenth", 2),
          //       kind: "notes",
          //       notes: [note("note-007-06-01", 3, 2)],
          //     },
          //     {
          //       id: "beat-007-07",
          //       tick: 3300,
          //       rhythm: rhythm("thirtySecond"),
          //       kind: "notes",
          //       notes: [note("note-007-07-01", 2, 1)],
          //     },
          //     {
          //       id: "beat-007-08",
          //       tick: 3420,
          //       rhythm: rhythm("sixteenth", 2),
          //       kind: "notes",
          //       notes: [note("note-007-08-01", 1, 1)],
          //     },
          //   ],
          // },
          // {
          //   id: "measure-008",
          //   timeSignature: { numerator: 4, denominator: 4 },
          //   barline: "final",
          //   chordSymbols: [
          //     {
          //       id: "chord-symbol-010",
          //       tick: 0,
          //       chordDefinitionId: "chord-g-open",
          //       display: "nameAndDiagram",
          //     },
          //   ],
          //   lyrics: [],
          //   tuplets: [],
          //   beats: [
          //     {
          //       id: "beat-008-01",
          //       tick: 0,
          //       rhythm: rhythm("eighth"),
          //       kind: "notes",
          //       notes: [note("note-008-01-01", 6, 3)],
          //     },
          //     {
          //       id: "beat-008-02",
          //       tick: 480,
          //       rhythm: rhythm("sixteenth"),
          //       kind: "notes",
          //       notes: [note("note-008-02-01", 5, 2)],
          //     },
          //     {
          //       id: "beat-008-03",
          //       tick: 720,
          //       rhythm: rhythm("sixteenth"),
          //       kind: "notes",
          //       notes: [note("note-008-03-01", 4, 0)],
          //     },
          //     {
          //       id: "beat-008-04",
          //       tick: 960,
          //       rhythm: rhythm("quarter"),
          //       kind: "notes",
          //       notes: [note("note-008-04-01", 3, 0)],
          //     },
          //     {
          //       id: "beat-008-05",
          //       tick: 1920,
          //       rhythm: rhythm("eighth", 1),
          //       kind: "notes",
          //       notes: [note("note-008-05-01", 2, 1)],
          //     },
          //     {
          //       id: "beat-008-06",
          //       tick: 2640,
          //       rhythm: rhythm("thirtySecond"),
          //       kind: "notes",
          //       notes: [note("note-008-06-01", 1, 0)],
          //     },
          //     {
          //       id: "beat-008-07",
          //       tick: 2760,
          //       rhythm: rhythm("thirtySecond"),
          //       kind: "notes",
          //       notes: [note("note-008-07-01", 2, 3)],
          //     },
          //     {
          //       id: "beat-008-08",
          //       tick: 2880,
          //       rhythm: rhythm("sixteenth"),
          //       kind: "notes",
          //       notes: [note("note-008-08-01", 3, 2)],
          //     },
          //     {
          //       id: "beat-008-09",
          //       tick: 3120,
          //       rhythm: rhythm("eighth"),
          //       kind: "notes",
          //       notes: [note("note-008-09-01", 2, 1)],
          //     },
          //     {
          //       id: "beat-008-10",
          //       tick: 3600,
          //       rhythm: rhythm("sixteenth"),
          //       kind: "notes",
          //       notes: [note("note-008-10-01", 1, 3)],
          //     },
          //   ],
          // },
        ],
      },
    ],
    // 和弦
    chordLibrary: [
      {
        id: "chord-am-open",
        name: "Am",
        frets: [0, 1, 2, 2, 0, "x"],
        fingers: [null, 1, 3, 2, null, null],
        baseFret: 1,
        barres: [],
      },
      {
        id: "chord-f-barre",
        name: "F",
        frets: [1, 1, 2, 3, 3, 1],
        fingers: [1, 1, 2, 4, 3, 1],
        baseFret: 1,
        barres: [{ fret: 1, fromString: 1, toString: 6, finger: 1 }],
      },
      {
        id: "chord-c-open",
        name: "C",
        frets: [0, 1, 0, 2, 3, "x"],
        fingers: [null, 1, null, 2, 3, null],
        baseFret: 1,
        barres: [],
      },
      {
        id: "chord-g-open",
        name: "G",
        frets: [3, 0, 0, 0, 2, 3],
        fingers: [4, null, null, null, 1, 2],
        baseFret: 1,
        barres: [],
      },
    ],
  },
};

/** 每个测试获取独立副本，避免用例之间共享可变引用。 */
export const createExampleDocument = (): LxmScoreDocument =>
  structuredClone(guitarTabEditorExample);
