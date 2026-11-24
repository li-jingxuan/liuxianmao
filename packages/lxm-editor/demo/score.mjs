import { CURRENT_SCHEMA_VERSION, SCORE_DOCUMENT_SCHEMA, TICKS_PER_QUARTER, createTuningPreset } from "@liuxianmao/lxm-editor";

/** 本例只使用合成的一小节空白 TAB，可直接保存为 .lxm；拍位也能在没有音符时命中。 */
export const exampleScoreJson = JSON.stringify({
  schema: SCORE_DOCUMENT_SCHEMA,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  documentRevision: 1,
  score: {
    id: "demo-score",
    title: "原生 JavaScript 示例",
    arranger: "",
    keySignature: null,
    meta: {},
    tracks: [{
      id: "demo-guitar",
      name: "吉他",
      instrument: "guitar",
      capo: 0,
      startBarline: "none",
      tuning: createTuningPreset("standard"),
      techniques: [],
      numberedMarks: [],
      measures: [{
        id: "demo-measure",
        timeSignature: { numerator: 4, denominator: 4 },
        barline: "single",
        chordSymbols: [],
        lyrics: [],
        tuplets: [],
        numberedVoice: { events: [], tuplets: [] },
        beats: Array.from({ length: 4 }, (_, index) => ({
          id: `demo-beat-${index + 1}`,
          tick: index * TICKS_PER_QUARTER,
          rhythm: { base: "quarter", dots: 0 },
          kind: "notes",
          notes: [],
        })),
      }],
    }],
  },
});
