import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOCK_DOCUMENT,
  LXMScoreCommandEnum as C,
  createCollapsedTabCellSelection,
  type ILXMDocument,
} from "@liuxianmao/lxm-editor";
import { createEditorStore } from "../stores/editor-store";
import { resolveEditorRhythmTarget } from "../components/EditorShell/tools/editor-rhythm-target";
import { buildEditorToolCommand } from "../components/EditorShell/tools/editor-tool-actions";
import { NoteToolDetails } from "../components/EditorShell/tools/NoteToolDetails";

const setup = () => {
  const document: ILXMDocument = structuredClone(DEFAULT_MOCK_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.techniques = [];
  track.numberedMarks = [];
  track.measures = [track.measures[0]!];
  const measure = track.measures[0]!;
  measure.chordSymbols = [];
  measure.lyrics = [];
  measure.tuplets = [];
  measure.beats = [0, 960, 1920, 2880].map((tick, i) => ({ id: `tab-${i}`, tick, kind: "notes", notes: [], rhythm: { base: "quarter", dots: 0 } }));
  measure.numberedVoice = { tuplets: [], events: [{ id: "numbered-first", tick: 0, kind: "notes", rhythm: { base: "eighth", dots: 1 }, items: [{ id: "numbered-item", token: "1" }] }] };
  const target = { trackId: track.id, measureId: measure.id, beatId: "tab-0", string: 1 };
  const selection = createCollapsedTabCellSelection(target);
  const store = createEditorStore(document);
  store.getState().setSelection(selection);
  return { document, store, target, selection };
};

describe("BUG016 TAB 首次录入与默认时值", () => {
  it("toolbar和sidebar展示可继承的完整附点节奏", () => {
    const { document, selection } = setup();
    expect(resolveEditorRhythmTarget(document, selection, null, { base: "quarter", dots: 0 }, false).rhythm).toEqual({ base: "eighth", dots: 1 });
    const html = renderToStaticMarkup(<NoteToolDetails document={document} selection={selection} blocked={false} onAction={async () => true} />);
    expect(html).toMatch(/aria-label="八分音符"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/aria-label="附点"[^>]*aria-pressed="true"/);
  });

  it.each([false, true])("首次录入及细分只有一条可完整撤销的历史（rect=%s）", (rect) => {
    const { document, store, target, selection } = setup();
    const result = store.getState().execute(rect
      ? { type: C.SetNotesInRect, range: { trackId: target.trackId, anchor: selection.anchor, focus: selection.focus }, fret: 3 }
      : { type: C.SetNote, ...target, fret: 3 });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(store.getState().historyDepth.past).toBe(1);
    expect(store.getState().document!.score.tracks[0]!.measures[0]!.beats[1]).toMatchObject({ tick: 720, kind: "notes", notes: [] });
    store.getState().undo();
    expect(store.getState().document).toEqual(document);
    store.getState().redo();
    expect(store.getState().document!.score.tracks[0]!.measures[0]!.beats[0]!.rhythm).toEqual({ base: "eighth", dots: 1 });
  });

  it("显式选择相同quarter虽为no-op，下一次录入仍尊重选择", () => {
    const { document, store, target, selection } = setup();
    expect(store.getState().execute({ type: C.SetBeatRhythm, ...target, rhythm: { base: "quarter", dots: 0 } })).toMatchObject({ ok: true, changed: false });
    const overrides = store.getState().tabInputRhythmOverrides;
    expect(resolveEditorRhythmTarget(document, selection, null, { base: "quarter", dots: 0 }, false, overrides).rhythm).toEqual({ base: "quarter", dots: 0 });
    expect(buildEditorToolCommand(document, selection, { type: "dots", dots: 1 }, overrides)).toMatchObject({ rhythm: { base: "quarter", dots: 1 } });
    store.getState().execute({ type: C.SetNote, ...target, fret: 3 });
    expect(store.getState().document!.score.tracks[0]!.measures[0]!.beats[0]!.rhythm).toEqual({ base: "quarter", dots: 0 });
    expect(store.getState().historyDepth.past).toBe(1);
  });

  it("附点操作保留继承的eighth基础时值", () => {
    const { document, selection } = setup();
    expect(buildEditorToolCommand(document, selection, { type: "dots", dots: 0 })).toMatchObject({ rhythm: { base: "eighth", dots: 0 } });
  });
});
