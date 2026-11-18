import { describe, expect, it } from "vitest";
import {
  buildLayout,
  createCollapsedTabCellSelection,
  loadDocument,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import { buildEditorToolCommand } from "../components/EditorShell/tools/editor-tool-actions";
import { buildScoreScene } from "@liuxianmao/lxm-editor";
import { inspectScoreFile, serializeScoreFile } from "../components/EditorShell/output/score-file";
import { deriveEditorToolState } from "../components/EditorShell/tools/editor-tool-state";
import { resolveTechniqueDraft } from "../components/EditorShell/tools/editor-technique-target";
import historicalSource from "../../../packages/lxm-editor/example/default-score.lxm.json";

describe("TAB 横线延音标记", () => {
  it("谱例末尾空拍写入横线、文件重开及图片图元保留标记，并可一次撤销", () => {
    const loaded = loadDocument(JSON.stringify(historicalSource));
    if (!loaded.ok) throw new Error(loaded.errors.join("；"));
    const session = createEditorSession(loaded.document);
    const before = session.getState().document!;
    const track = before.score.tracks[0]!;
    const measure = track.measures.at(-1)!;
    const lastBeat = measure.beats.at(-1)!;
    expect(lastBeat.tick).toBe(2880);
    expect(lastBeat.notes).toEqual([]);
    const selection = createCollapsedTabCellSelection({
      trackId: track.id, measureId: measure.id, beatId: lastBeat.id, string: 4,
    });
    const command = buildEditorToolCommand(before, selection, { type: "continuation" });
    expect(command).not.toBeNull();
    const result = session.getState().execute(command!);
    expect(result?.ok, JSON.stringify(result)).toBe(true);
    if (!result?.ok) throw new Error("横线标记录入失败");
    const after = result.document;
    const changed = after.score.tracks[0]!.measures.at(-1)!;
    expect(changed.beats.at(-1)!).toMatchObject({
      tick: 2880, rhythm: { base: "quarter", dots: 0 },
      notes: [{ string: 3, fret: "-" }],
    });
    expect(changed.beats.slice(0, -1)).toEqual(measure.beats.slice(0, -1));
    expect(changed.numberedVoice).toEqual(measure.numberedVoice);
    expect(changed.lyrics).toEqual(measure.lyrics);
    expect(after.score.tracks[0]!.techniques).toEqual(track.techniques);
    expect(deriveEditorToolState(after, selection).sustain.enabled).toBe(false);
    expect(resolveTechniqueDraft(after, selection, "bend")).toMatchObject({
      ok: false, message: expect.stringContaining("横线"),
    });

    const saved = serializeScoreFile(after);
    if (!saved.ok) throw new Error(saved.errors.join("；"));
    const reopened = inspectScoreFile(saved.text);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.errors.join("；"));
    expect(reopened.document).toEqual(after);
    for (const density of ["compact", "comfortable"] as const) {
      const layout = buildLayout(reopened.document, { density });
      const mark = layout.systems.flatMap((system) => system.measures)
        .find((item) => item.id === measure.id)!.notes
        .find((item) => item.beatId === lastBeat.id && item.tabContinuation)!;
      expect(mark.fret).toBe("-");
      expect(buildScoreScene(layout).systems.flatMap((system) => system.items))
        .toContainEqual(expect.objectContaining({
          kind: "line", x1: mark.x - 6, x2: mark.x + 6,
          y1: mark.y, y2: mark.y,
        }));
    }
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toBe(before);
    session.getState().redo();
    expect(session.getState().document).toEqual(after);
  });
});
