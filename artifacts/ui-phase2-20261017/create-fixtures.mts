import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  loadDocument,
} from "../../packages/lxm-editor/src/index";

// 固定合法谱例经正式 loader 验证；浏览器通过文件导入使用，不注入内部 store。
const doc = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
doc.score.title = "阶段2固定验收谱";
const track = doc.score.tracks[0]!;
track.techniques = [];
track.numberedMarks = [];
track.startBarline = "none";
track.measures = Array.from({ length: 3 }, (_, m) => ({
  id: `p2-m${m}`,
  timeSignature: { numerator: 4, denominator: 4 },
  barline: m === 2 ? ("final" as const) : ("single" as const),
  sectionLabel: `段落${m + 1}`,
  beats: Array.from({ length: 4 }, (_, b) => ({
    id: `p2-b${m}-${b}`,
    tick: b * 960,
    rhythm: { base: "quarter" as const, dots: 0 },
    kind: "notes" as const,
    notes: [
      { id: `p2-n${m}-${b}-1`, string: 1, fret: m * 8 + b * 2 + 1 },
      { id: `p2-n${m}-${b}-2`, string: 2, fret: 2 },
    ],
  })),
  lyrics: [{ id: `p2-l${m}`, beatId: `p2-b${m}-0`, verse: 1, text: "验" }],
  chordSymbols: [],
  tuplets: [],
  numberedVoice: {
    events: Array.from({ length: 4 }, (_, b) => ({
      id: `p2-e${m}-${b}`,
      tick: b * 960,
      rhythm: { base: "quarter" as const, dots: 0 },
      kind: "notes" as const,
      items: [{ id: `p2-i${m}-${b}`, token: ["1", "3", "5", "6"][b]! }],
    })),
    tuplets: [],
  },
}));
track.numberedMarks = [{ id: "p2-mark", type: "fermata", eventId: "p2-e0-1" }];
track.techniques = [
  {
    id: "p2-hammer",
    type: "hammerOn",
    fromNoteId: "p2-n0-0-1",
    toNoteId: "p2-n0-1-1",
  },
];
const validate = (value: unknown) => {
  const result = loadDocument(JSON.stringify(value));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.document : null;
};
await mkdir("artifacts/ui-phase2-20261017", { recursive: true });
await writeFile(
  "artifacts/ui-phase2-20261017/fixture.lxm.json",
  JSON.stringify(validate(doc), null, 2) + "\n",
);
const tuplet = structuredClone(doc);
const measure = tuplet.score.tracks[0]!.measures[1]!;
measure.beats = [0, 320, 640, 960, 1920].map((tick, i) => ({
  id: `p2-tb${i}`,
  tick,
  rhythm: { base: i < 3 ? "eighth" : i === 3 ? "quarter" : "half", dots: 0 },
  kind: "notes",
  notes: [{ id: `p2-tn${i}`, string: 1, fret: 9 + i * 2 }],
}));
measure.beats[4]!.kind = "rest";
measure.beats[4]!.notes = [];
measure.tuplets = [
  {
    id: "p2-triplet",
    beatIds: measure.beats.slice(0, 3).map((b) => b.id),
    ratio: { actual: 3, normal: 2 },
  },
];
measure.lyrics = [];
await writeFile(
  "artifacts/ui-phase2-20261017/tuplet-fixture.lxm.json",
  JSON.stringify(validate(tuplet), null, 2) + "\n",
);
console.log("2 fixtures passed loadDocument");
// 同一合法五连音分别应用 5:4 与 5:3，避免只核对按钮文字。
const five = structuredClone(tuplet);
const fiveMeasure = five.score.tracks[0]!.measures[1]!;
fiveMeasure.beats = Array.from({ length: 6 }, (_, i) => ({
  id: `p2-five-b${i}`,
  tick: i < 5 ? i * 384 : 1920,
  rhythm: { base: i < 5 ? "eighth" : "half", dots: 0 },
  kind: i < 5 ? "notes" : "rest",
  notes: i < 5 ? [{ id: `p2-five-n${i}`, string: 1, fret: 9 + i * 2 }] : [],
}));
fiveMeasure.tuplets = [
  {
    id: "p2-five",
    beatIds: fiveMeasure.beats.slice(0, 5).map((b) => b.id),
    ratio: { actual: 5, normal: 4 },
  },
];
await writeFile(
  "artifacts/ui-phase2-20261017/five-tuplet-fixture.lxm.json",
  JSON.stringify(validate(five), null, 2) + "\n",
);
const overflow = structuredClone(tuplet);
overflow.score.tracks[0]!.measures[1]!.beats[4]!.kind = "notes";
overflow.score.tracks[0]!.measures[1]!.beats[4]!.notes = [
  { id: "p2-overflow-note", string: 1, fret: 17 },
];
await writeFile(
  "artifacts/ui-phase2-20261017/tuplet-overflow-fixture.lxm.json",
  JSON.stringify(validate(overflow), null, 2) + "\n",
);
console.log("All 4 fixtures passed loadDocument");
