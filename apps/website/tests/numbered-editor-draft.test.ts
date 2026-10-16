import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "@liuxianmao/lxm-editor";
import {
  NumberedEditor,
  type NumberedEditorDraft,
} from "../components/EditorShell/NumberedEditor";
import { numberedDraftKey } from "../components/EditorShell/numbered-editor-target";

describe("简谱目标草稿", () => {
  it("事件与空白时间窗各有独立缓存键", () => {
    const base = { trackId: "track", measureId: "measure" };
    expect(
      numberedDraftKey({
        kind: "numberedEvent",
        ...base,
        eventId: "first",
        itemId: "a",
      }),
    ).not.toBe(
      numberedDraftKey({
        kind: "numberedEvent",
        ...base,
        eventId: "second",
        itemId: "b",
      }),
    );
    expect(
      numberedDraftKey({
        kind: "numberedTime",
        ...base,
        tick: 0,
        endTick: 480,
      }),
    ).not.toBe(
      numberedDraftKey({
        kind: "numberedTime",
        ...base,
        tick: 480,
        endTick: 960,
      }),
    );
  });

  it("切回目标时恢复未应用的简谱文本和时值", () => {
    const document = EXAMPLE_MVP_7_2_DOCUMENT;
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events[0]!;
    const savedDraft: NumberedEditorDraft = {
      selectedId: event.id,
      start: event.tick,
      end: event.tick + 960,
      raw: "1 2 3",
      initial: "",
      overwrite: false,
      base: "eighth",
      dots: 0,
      template: "front8",
      itemId: event.items[0]!.id,
      destination: "",
      customRhythms: [],
      ratioIndex: 1,
      itemDraft: event.items[0]!.token,
    };
    const html = renderToStaticMarkup(
      createElement(NumberedEditor, {
        ref: null,
        document,
        target: {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          eventId: event.id,
        },
        savedDraft,
        commit: () => null,
        onDirty: () => {},
        onInputActive: () => {},
        onPreviewTargetChange: () => {},
        onActivate: () => {},
        onCanApply: () => {},
        onSelectTarget: () => {},
        mode: "sequence",
        onModeChange: () => {},
        onCancel: () => {},
        getClipboard: () => null,
        copyRange: () => false,
        selectedMarkId: null,
      }),
    );
    expect(html).toContain("1 2 3</textarea>");
    // Ant Design Select 以可见选中内容呈现草稿模板，不再生成原生 option。
    expect(html).toContain('title="前八后十六"');
    expect(html).toContain('aria-label="简谱节奏模板"');
    expect(html).toContain('role="combobox"');
  });

  it("连续简谱回填选中拍点内的已有音符", () => {
    const document = EXAMPLE_MVP_7_2_DOCUMENT;
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const first = measure.beats[0]!;
    const second = measure.beats[1]!;
    const html = renderToStaticMarkup(
      createElement(NumberedEditor, {
        ref: null,
        document,
        target: {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          beatId: second.id,
        },
        selection: {
          anchor: {
            trackId: track.id,
            measureId: measure.id,
            beatId: first.id,
            string: 1,
          },
          focus: {
            trackId: track.id,
            measureId: measure.id,
            beatId: second.id,
            string: 1,
          },
        },
        commit: () => null,
        onDirty: () => {},
        onInputActive: () => {},
        onPreviewTargetChange: () => {},
        onActivate: () => {},
        onCanApply: () => {},
        onSelectTarget: () => {},
        mode: "sequence",
        onModeChange: () => {},
        onCancel: () => {},
        getClipboard: () => null,
        copyRange: () => false,
        selectedMarkId: null,
      }),
    );
    expect(html).toContain("1 2</textarea>");
  });
});
