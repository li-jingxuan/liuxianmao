import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT, createDocumentIdFactory, editNumberedTrack, type ILXMNumberedVoiceCommand } from "@liuxianmao/lxm-editor";
import { buildNumberedPreviewRows } from "../components/EditorShell/numbered/numbered-preview";

describe("BUG017/020 preview shares the committed time targets", () => {
  it.each([false, true])("includes virtual slots and skips without inventing source events; skip=%s", skip => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    track.numberedMarks = [];
    const measure = track.measures[0]!;
    measure.numberedVoice = { events: [{ id: "first", tick: 0, kind: "notes", rhythm: { base: "sixteenth", dots: 0 }, items: [{ id: "first-item", token: "1" }] }], tuplets: [] };
    measure.lyrics = [];
    measure.beats = [0, 240, 480, 720].map((tick, i) => ({ id: `tab-${i}`, tick, kind: "rest", notes: [], rhythm: { base: "sixteenth", dots: 0 } }));
    measure.tuplets = [];
    const command: ILXMNumberedVoiceCommand = { type: "numbered.sequence.overwrite", trackId: track.id, measureId: measure.id, startTick: 0, allowOverwrite: true, items: [{ kind: "set", tokens: ["2"] }, skip ? { kind: "skip" } : { kind: "set", tokens: ["3"] }, { kind: "set", tokens: ["3"] }] };
    const preview = editNumberedTrack(track, command, createDocumentIdFactory(document), true);
    const applied = editNumberedTrack(track, command, createDocumentIdFactory(document));
    expect(preview.ok && applied.ok).toBe(true);
    if (!preview.ok || !applied.ok) return;
    expect(applied.track).toEqual(preview.track);
    const rows = buildNumberedPreviewRows(track, preview, command);
    expect(rows.map(row => [row.startTick, row.endTick])).toEqual([[0, 240], [240, 480], [480, 720]]);
    expect(rows.reduce((sum, row) => sum + row.endTick - row.startTick, 0)).toBe(720);
    expect(rows[1]).toMatchObject({ before: "—", status: skip ? "skip" : "add", sourcePosition: null });
    expect(rows[1]!.plannedPosition).toEqual(skip ? null : { trackId: track.id, measureId: measure.id, startTick: 240, endTick: 480 });
    expect(applied.track.measures[0]!.numberedVoice.events.some(event => event.tick === 240)).toBe(!skip);
  });
});
