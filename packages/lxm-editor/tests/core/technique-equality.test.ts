import { describe, expect, it } from "vitest";
import EXAMPLE from "../../example/example-mvp2.json";
import { applyScoreCommand, LXMScoreCommandEnum as C } from "../../src/core/commands";
import { sameTechniqueDraft } from "../../src/core/technique-equality";
import type { ILXMTechniqueDraft } from "../../src/core/types";

const drafts: ILXMTechniqueDraft[] = [
  { type: "bend", fromNoteId: "a", semitones: 2 },
  { type: "trill", fromNoteId: "a", auxiliaryFret: 7 },
  ...(["vibrato", "naturalHarmonic", "artificialHarmonic", "tapping"] as const).map((type) => ({ type, fromNoteId: "a" })),
  ...(["hammerOn", "pullOff", "slideUp", "slideDown", "tie"] as const).map((type) => ({ type, fromNoteId: "a", toNoteId: "b" })),
  { type: "strum", beatId: "a", minString: 2, maxString: 6, stroke: "down" },
  { type: "arpeggio", beatId: "a", minString: 2, maxString: 6, direction: "ascending" },
  { type: "pickStroke", beatId: "a", stroke: "up" },
  { type: "palmMute", fromBeatId: "a", toBeatId: "b" },
  { type: "letRing", fromBeatId: "a", toBeatId: "b" },
];

describe("technique domain equality", () => {
  it.each(drafts)("$type ignores insertion order and ID, compares every musical field", (draft) => {
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as ILXMTechniqueDraft;
    const imported = { ...reordered, id: "imported" };
    expect(sameTechniqueDraft(draft, imported)).toBe(true);
    for (const [field, value] of Object.entries(draft)) {
      const changed = { ...reordered, [field]: typeof value === "number" ? value + 1 : `${value}-different` } as ILXMTechniqueDraft;
      expect(sameTechniqueDraft(draft, changed), field).toBe(false);
    }
  });
  it("reordered duplicate Add is recognized before conflicts; Update preserves document identity and revision", () => {
    const first = applyScoreCommand(EXAMPLE, { type: C.AddTechnique, trackId: "mvp2-track-guitar",
      technique: { type: "strum", beatId: "mvp2-beat-1-2", minString: 2, maxString: 3, stroke: "down" } });
    expect(first).toMatchObject({ ok: true, changed: true });
    if (!first.ok) return;
    const document = JSON.parse(JSON.stringify(first.document));
    // Imported data may place the ID or any musical field first.
    document.score.tracks[0].techniques[0] = { stroke: "down", maxString: 3, id: first.document.score.tracks[0]!.techniques[0]!.id,
      beatId: "mvp2-beat-1-2", type: "strum", minString: 2 };
    const technique = { minString: 2, stroke: "down", type: "strum", maxString: 3, beatId: "mvp2-beat-1-2" } as const;
    for (const type of [C.AddTechnique, C.UpdateTechnique] as const) {
      const result = applyScoreCommand(document, { type, trackId: "mvp2-track-guitar",
        techniqueId: document.score.tracks[0].techniques[0].id, technique });
      expect(result).toMatchObject({ ok: true, changed: false });
      if (result.ok) expect(result.document).toBe(document);
    }
    const replaced = applyScoreCommand(document, { type: C.AddTechnique, trackId: "mvp2-track-guitar",
      technique: { ...technique, stroke: "up" } });
    expect(replaced).toMatchObject({ ok: true, changed: true });
    if (replaced.ok) expect(replaced.document.score.tracks[0]!.techniques).toEqual([
      { ...technique, id: document.score.tracks[0].techniques[0].id, stroke: "up" },
    ]);
  });
});
