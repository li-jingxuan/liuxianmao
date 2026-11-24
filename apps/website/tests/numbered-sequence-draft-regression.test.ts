import { createElement, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDocumentIdFactory, editNumberedTrack, type ILXMNumberedVoiceCommand } from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { checkNumberedDraftDependencies, NumberedEditor, type NumberedEditorController } from "../../../packages/lxm-editor-react/src/EditorShell/numbered/NumberedEditor";
import { numberedContentDependency } from "../../../packages/lxm-editor-react/src/EditorShell/numbered/numbered-draft-dependencies";
import { createEditorSessionStore as createEditorSession } from "../../../packages/lxm-editor-react/src/stores/editor-store";
import { EditorStoreContext } from "../../../packages/lxm-editor-react/src/stores/editor-context";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.numberedMarks = []; track.techniques = []; track.measures = [track.measures[0]!];
  const measure = track.measures[0]!;
  measure.chordSymbols = []; measure.lyrics = []; measure.tuplets = [];
  measure.beats = Array.from({ length: 16 }, (_, i) => ({ id: `tab-${i}`, tick: i * 240, kind: "rest" as const, notes: [], rhythm: { base: "sixteenth" as const, dots: 0 } }));
  measure.numberedVoice = { events: [0, 480].map((tick, i) => ({ id: `event-${i}`, tick, rhythm: { base: "sixteenth", dots: 0 }, kind: "notes", items: [{ id: `item-${i}`, token: i ? "3" : "1" }] })), tuplets: [] };
  return { document, track, measure };
};

describe("continuous numbered draft time targets", () => {
  it("backfills virtual slots in a TAB range as skips", () => {
    const { document, track, measure } = fixture();
    const session = createEditorSession(document);
    const cell = (index: number) => ({ trackId: track.id, measureId: measure.id, beatId: `tab-${index}`, string: 1 as const });
    const ref: RefObject<NumberedEditorController | null> = { current: null };
    const html = renderToStaticMarkup(createElement(EditorStoreContext.Provider, { value: session }, createElement(NumberedEditor, {
      ref, document, target: { kind: "numbered", ...cell(3) }, selection: { anchor: cell(0), focus: cell(3) },
      mode: "sequence", onModeChange: () => {}, commit: () => null, onDirty: () => {}, onInputActive: () => {}, onPreviewTargetChange: () => {}, onActivate: () => {}, onCanApply: () => {}, onSelectTarget: () => {}, onCancel: () => {}, getClipboard: () => null, copyRange: () => false, selectedMarkId: null,
    })));
    expect(html.match(/<input\b[^>]*aria-label="简谱内容"[^>]*value="([^"]*)"/)?.[1]).toBe("1 _ 3 _");
  });

  it("includes every event consumed by explicit rhythm, even without a matching new onset", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events[0]!.rhythm = { base: "quarter", dots: 0 };
    measure.numberedVoice.events[1]!.tick = 960;
    measure.numberedVoice.events[1]!.rhythm = { base: "quarter", dots: 0 };
    const operation: ILXMNumberedVoiceCommand = { type: "numbered.sequence.overwrite", trackId: track.id, measureId: measure.id, startTick: 0, items: [{ kind: "set", tokens: ["5"] }], rhythms: [{ base: "half", dots: 0 }], allowOverwrite: true };
    const before = numberedContentDependency(track, measure.id, "event-0", "5", operation);
    const changed = structuredClone(track);
    changed.measures[0]!.numberedVoice.events[1]!.items[0]!.token = "7";
    expect(numberedContentDependency(changed, measure.id, "event-0", "5", operation)).not.toBe(before);
    const candidate = editNumberedTrack(track, { type: "numbered.event.set", trackId: track.id, measureId: measure.id, eventId: "event-1", tokens: ["7"] }, createDocumentIdFactory(document), true);
    if (!candidate.ok) throw new Error(candidate.message);
    expect(checkNumberedDraftDependencies({ contentDirty: true, rhythmDirty: false, itemPitchDirty: false, track, measureId: measure.id, event: measure.numberedVoice.events[0], raw: "5", itemId: "item-0", contentOperation: operation }, candidate, "itemPitch")).toContain("先应用或恢复内容组");
  });
});
