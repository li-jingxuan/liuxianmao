import { describe, expect, it } from "vitest";
import example from "../../example/example-mvp7.2";
import { applyScoreCommand, LXMScoreCommandEnum as C } from "../../src/core/commands";
import { loadDocument } from "../../src/core/loader";
import {
  SCORE_TONALITY_NAMESPACE as NS,
  keySignatureForTonality,
  readScoreTonality,
  semanticJsonEqual,
  type ScoreTonalityV1,
} from "../../src/core/score-tonality";
import type { ILXMKeySignature } from "../../src/core/types";

const create = (raw?: unknown, key: ILXMKeySignature | null = "C") => {
  const document = structuredClone(example);
  document.score.keySignature = key;
  document.score.meta = { "other:extension": { keep: [1, 2] } };
  if (raw !== undefined) document.score.meta[NS] = structuredClone(raw);
  return document;
};
const major: ScoreTonalityV1 = { version: 1, tonic: "C", mode: "major" };
const info = (document: ReturnType<typeof create>) => ({ title: document.score.title, arranger: document.score.arranger, keySignature: document.score.keySignature });

describe("committed score tonality", () => {
  it("distinguishes absent, malformed, future and conflicting namespaces without mutation", () => {
    const cases = [
      [undefined, "C", "unconfirmed"], [undefined, null, "unset"],
      [null, "C", "invalid"], [[], "C", "invalid"], [{ mode: "major" }, "C", "invalid"],
      [{ version: "2" }, "C", "invalid"], [{ version: 2 }, "C", "unsupported"],
      [{ version: 1, tonic: "A", mode: "minor" }, "C", "invalid"],
      [{ version: 1, tonic: "H", mode: "major" }, "C", "invalid"],
      [major, null, "conflict"], [major, "D", "conflict"], [major, "C", "confirmed"],
    ] as const;
    for (const [raw, key, kind] of cases) {
      const document = create(raw, key);
      const original = structuredClone(document);
      expect(readScoreTonality(document).kind).toBe(kind);
      expect(document).toEqual(original);
    }
  });
  it("both minor notation systems recommend the same tonic, and theoretical spellings map digital 1 to its enum", () => {
    for (const degree of [1, 6] as const) {
      const tonality: ScoreTonalityV1 = { version: 1, tonic: "A", mode: "minor", minorTonicDegree: degree };
      const key = keySignatureForTonality(tonality);
      expect(key).toBe(degree === 6 ? "C" : "A");
      expect(readScoreTonality(create(tonality, key))).toMatchObject({ kind: "confirmed", key: { tonicPc: 9, tonicSpelling: "A", mode: "minor" } });
    }
    const theoretical: ScoreTonalityV1 = { version: 1, tonic: "B#", mode: "major" };
    expect(keySignatureForTonality(theoretical)).toBe("C");
    expect(readScoreTonality(create(theoretical))).toMatchObject({ kind: "confirmed", tonicSpelling: "B#" });
    expect(keySignatureForTonality({ version: 1, tonic: "Bbb", mode: "minor", minorTonicDegree: 6 })).toBe("C");
  });
  it("invalid/future data and unknown meta survive JSON load unchanged", () => {
    for (const raw of [null, { version: 9, future: { untouched: ["a", "b"] } }]) {
      const document = create(raw);
      const loaded = loadDocument(JSON.stringify(document));
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.document.score.meta).toEqual(document.score.meta);
    }
  });
  it("JSON equality ignores object order but keeps namespace presence and array order", () => {
    expect(semanticJsonEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 })).toBe(true);
    expect(semanticJsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(semanticJsonEqual({}, { [NS]: null })).toBe(false);
  });
});

describe("SetScoreInfo atomic namespace writes", () => {
  it("sets all info in one revision, rejects mismatches atomically and clones the payload", () => {
    const document = create();
    const tonality: ScoreTonalityV1 = { version: 1, tonic: "A", mode: "minor", minorTonicDegree: 6 };
    const result = applyScoreCommand(document, { type: C.SetScoreInfo, ...info(document), title: " 新标题 ", tonality });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
    expect(result.document.score.title).toBe("新标题");
    expect(result.document.score.meta).toEqual({ ...document.score.meta, [NS]: tonality });
    tonality.tonic = "B";
    expect(result.document.score.meta[NS]).toMatchObject({ tonic: "A" });
    expect(document.score.meta).not.toHaveProperty(NS);
    for (const keySignature of ["D", null] as const) {
      const rejected = applyScoreCommand(document, { type: C.SetScoreInfo, ...info(document), title: "不应写入", keySignature, tonality: major });
      expect(rejected.ok).toBe(false);
      expect(document.score.title).not.toBe("不应写入");
    }
  });
  it("preserves exact malformed or future namespace on title edits; changing key requires repair/delete", () => {
    for (const raw of [null, { version: 4, future: [3, 2, 1] }, { version: 1, tonic: "A", mode: "minor" }, major]) {
      const document = create(raw, "D");
      for (const type of [C.SetScoreInfo, C.SetNotationInfo] as const) {
        const result = applyScoreCommand(document, { type, ...info(document), title: "标题编辑" });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.document.score.meta).toEqual(document.score.meta);
      }
      expect(applyScoreCommand(document, { type: C.SetScoreInfo, ...info(document), keySignature: "E" }).ok).toBe(false);
      const cleared = applyScoreCommand(document, { type: C.SetScoreInfo, ...info(document), keySignature: null, tonality: null });
      expect(cleared.ok).toBe(true);
      if (cleared.ok) {
        expect(cleared.document.score.meta).not.toHaveProperty(NS);
        expect(cleared.document.score.meta["other:extension"]).toEqual(document.score.meta["other:extension"]);
        expect(readScoreTonality(cleared.document).kind).toBe("unset");
      }
    }
  });
  it("guards legacy key changes only for valid v1, permits old scores and preserves future meta", () => {
    for (const keySignature of ["D", null] as const)
      expect(applyScoreCommand(create(major), { type: C.SetNotationInfo, ...info(create(major)), keySignature }).ok).toBe(false);
    for (const raw of [undefined, null, { version: 8, future: true }]) {
      const document = create(raw);
      const result = applyScoreCommand(document, { type: C.SetNotationInfo, ...info(document), keySignature: "E" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.document.score.meta).toEqual(document.score.meta);
    }
  });
  it("equal set/delete is no-op while enharmonic spelling changes are real edits", () => {
    const document = create({ tonic: "C", mode: "major", version: 1 });
    expect(applyScoreCommand(document, { type: C.SetScoreInfo, ...info(document), tonality: major })).toMatchObject({ ok: true, changed: false, document });
    const changed = applyScoreCommand(document, { type: C.SetScoreInfo, ...info(document), tonality: { ...major, tonic: "B#" } });
    expect(changed).toMatchObject({ ok: true, changed: true });
    const absent = create();
    const noop = applyScoreCommand(absent, { type: C.SetScoreInfo, ...info(absent), tonality: null });
    expect(noop.ok && noop.document).toBe(absent);
  });
});
