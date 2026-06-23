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
 * Iteration 1 的规范夹具，覆盖多种常见时值（四分、八分、十六分、附点）、技巧、
 * 休止拍、变拍号、三连音、歌词、和弦与跨小节延音。
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
            barline: "final",
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
