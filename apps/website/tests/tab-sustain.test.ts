import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  createCollapsedTabCellSelection,
  LXMScoreCommandEnum as C,
} from "@liuxianmao/lxm-editor";
import { buildEditorToolCommand } from "../components/EditorShell/editor-tool-actions";
import { deriveEditorToolState } from "../components/EditorShell/editor-tool-state";
import { createEditorSession } from "../stores/editor-store";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.techniques = [];
  const measure = track.measures[0]!;
  const source = measure.beats[0]!;
  for (const beat of measure.beats.slice(1)) {
    beat.kind = "rest";
    beat.notes = [];
  }
  const selection = (beatId: string) =>
    createCollapsedTabCellSelection({
      trackId: track.id,
      measureId: measure.id,
      beatId,
      string: source.notes[0]!.string,
    });
  return { document, track, measure, source, selection };
};

describe("六线谱延续一拍工具", () => {
  it("选中起音或紧邻空拍均指向同一个源音，原子提交并一次撤销", () => {
    for (const selected of [0, 1]) {
      const f = fixture();
      const session = createEditorSession(f.document);
      const selection = f.selection(f.measure.beats[selected]!.id);
      const command = buildEditorToolCommand(f.document, selection, {
        type: "sustain",
      });
      expect(command).toEqual({
        type: C.ExtendBeat,
        trackId: f.track.id,
        measureId: f.measure.id,
        beatId: f.source.id,
      });
      expect(deriveEditorToolState(f.document, selection).sustain.enabled).toBe(
        true,
      );
      const before = session.getState().document;
      const result = session.getState().execute(command!);
      expect(
        result?.ok,
        result && !result.ok ? result.message : "missing result",
      ).toBe(true);
      if (!result?.ok) continue;
      const track = result.document.score.tracks[0]!;
      const target = track.measures[0]!.beats[1]!;
      expect(target.kind).toBe("notes");
      expect(target.rhythm).toEqual({ base: "quarter", dots: 0 });
      expect(target.notes.map(({ string, fret }) => [string, fret])).toEqual(
        f.source.notes.map(({ string, fret }) => [string, fret]),
      );
      expect(track.techniques.filter((t) => t.type === "tie")).toHaveLength(
        f.source.notes.length,
      );
      expect(track.measures[0]!.numberedVoice).toEqual(f.measure.numberedVoice);
      expect(track.measures[0]!.lyrics).toEqual(f.measure.lyrics);
      expect(session.getState().historyDepth.past).toBe(1);
      session.getState().undo();
      expect(session.getState().document).toBe(before);
    }
  });
  it("无前音的空拍、闷音、多拍及非四分单位拍不提供续音动作", () => {
    const f = fixture();
    const sourceSelection = f.selection(f.source.id);
    f.source.notes[0]!.fret = "x";
    expect(
      buildEditorToolCommand(f.document, sourceSelection, { type: "sustain" }),
    ).toBeNull();
    f.source.kind = "rest";
    f.source.notes = [];
    expect(
      buildEditorToolCommand(f.document, sourceSelection, { type: "sustain" }),
    ).toBeNull();
    const g = fixture();
    const multi = {
      anchor: g.selection(g.source.id).anchor,
      focus: g.selection(g.measure.beats[1]!.id).focus,
    };
    expect(
      buildEditorToolCommand(g.document, multi, { type: "sustain" }),
    ).toBeNull();
    g.measure.timeSignature = { numerator: 6, denominator: 8 };
    expect(
      deriveEditorToolState(g.document, g.selection(g.source.id)).sustain
        .enabled,
    ).toBe(false);
  });
});
