import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  EXAMPLE_MVP_5_1_DOCUMENT,
  createCollapsedTabCellSelection,
  getFirstTabCellReference,
} from "@liuxianmao/lxm-editor";
import { deriveEditorToolState } from "../components/EditorShell/editor-tool-state";
import { createEditorSession } from "../stores/editor-store";

describe("编辑工具入口条件", () => {
  it("无选区或失效选区不产生默认首拍目标", () => {
    const document = EXAMPLE_MVP_7_2_DOCUMENT;
    for (const selection of [
      null,
      createCollapsedTabCellSelection({
        ...getFirstTabCellReference(document)!,
        beatId: "missing",
      }),
    ]) {
      const state = deriveEditorToolState(document, selection);
      expect(state.range).toBeNull();
      expect(state.focused).toBeNull();
      expect(state.note.enabled).toBe(false);
      expect(state.rhythm.reason).toContain("单拍");
      expect(state.copyMeasures.enabled).toBe(false);
    }
  });
  it("单拍多弦允许时值，多拍/跨小节不误改 focus 拍时值", () => {
    const document = EXAMPLE_MVP_7_2_DOCUMENT,
      first = getFirstTabCellReference(document)!,
      track = document.score.tracks[0]!;
    const sameBeat = { anchor: first, focus: { ...first, string: 6 } };
    expect(deriveEditorToolState(document, sameBeat).rhythm.enabled).toBe(true);
    const multi = {
      anchor: first,
      focus: { ...first, beatId: track.measures[0]!.beats[1]!.id },
    };
    expect(deriveEditorToolState(document, multi)).toMatchObject({
      rhythm: { enabled: false },
      mergeBeats: { enabled: true },
      copyBeats: { enabled: true },
    });
    const cross = {
      anchor: first,
      focus: {
        ...first,
        measureId: track.measures[1]!.id,
        beatId: track.measures[1]!.beats[0]!.id,
      },
    };
    expect(deriveEditorToolState(document, cross)).toMatchObject({
      mergeBeats: { enabled: false },
      copyBeats: { enabled: false },
      copyMeasures: { enabled: true },
    });
  });
  it("最后一个小节不能删，谱首反复不跟随末小节开放", () => {
    const source = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = source.score.tracks[0]!;
    track.measures = [track.measures[0]!];
    track.techniques = [];
    track.numberedMarks = [];
    const document = createEditorSession(source).getState().document!;
    expect(document).not.toBeNull();
    const state = deriveEditorToolState(
      document,
      createCollapsedTabCellSelection(getFirstTabCellReference(document)!),
    );
    expect(state.removeMeasure.enabled).toBe(false);
    expect(state.startRepeat.enabled).toBe(true);
    expect(state.focused?.isLast).toBe(true);
  });
  it("连音数量来自真实核心解析，五连音不能误启用三连音", () => {
    const document = EXAMPLE_MVP_5_1_DOCUMENT,
      track = document.score.tracks[0]!,
      measure = track.measures[3]!,
      group = measure.tuplets[0]!;
    const selection = {
      anchor: {
        trackId: track.id,
        measureId: measure.id,
        beatId: group.beatIds[0]!,
        string: 1,
      },
      focus: {
        trackId: track.id,
        measureId: measure.id,
        beatId: group.beatIds.at(-1)!,
        string: 6,
      },
    };
    const state = deriveEditorToolState(document, selection);
    expect(state.tupletRatio(5).enabled).toBe(true);
    expect(state.tupletRatio(3).enabled).toBe(false);
  });
});
