import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "@liuxianmao/lxm-editor";
import {
  NumberedEditor,
  type NumberedEditorDraft,
} from "../components/EditorShell/NumberedEditor";
import { numberedDraftKey } from "../components/EditorShell/numbered-editor-target";
import { createEditorSession } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const renderEditor = (
  props: Partial<ComponentProps<typeof NumberedEditor>> = {},
  explicit = false,
) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  measure.numberedVoice.events[0]!.rhythm = { base: "eighth", dots: 0 };
  const session = createEditorSession(document);
  if (explicit)
    session.getState().setNumberedInputRhythm({ base: "quarter", dots: 0 });
  const store = { ...session, getInitialState: session.getState };
  return renderToStaticMarkup(
    createElement(
      EditorStoreContext.Provider,
      { value: store },
      createElement(NumberedEditor, {
        ref: null,
        document,
        target: {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          tick: 480,
          endTick: 960,
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
        ...props,
      }),
    ),
  );
};

const blankDraft = (
  changes: Partial<NumberedEditorDraft> = {},
): NumberedEditorDraft => ({
  selectedId: "",
  start: 480,
  end: 960,
  raw: "6",
  initial: "",
  overwrite: true,
  base: "quarter",
  dots: 0,
  template: "uniform",
  itemId: "",
  destination: "",
  customRhythms: [],
  ratioIndex: 1,
  itemDraft: "",
  ...changes,
});

describe("简谱目标草稿", () => {
  it("普通空位录入允许部分填入，不要求填满固定范围", () => {
    const html = renderEditor({
      savedDraft: blankDraft({ templateBase: "sixteenth", templateDots: 0 }),
    });
    expect(html).toContain("修改预览 · 1 项");
    expect(html).toContain("十六分");
    expect(html).not.toContain("允许覆盖此时间范围的简谱");
  });

  it("会话默认时值适应短空位，显式时值不足则保留并提示", () => {
    const savedDraft = blankDraft();
    const implicit = renderEditor({ savedDraft });
    expect(implicit).toContain("修改预览 · 1 项");
    expect(implicit).toContain("八分");
    const explicit = renderEditor({ savedDraft }, true);
    expect(explicit).not.toContain("修改预览 · 1 项");
    expect(explicit).toContain("四分");
  });

  it("固定范围高级录入仍要求成员时值填满范围", () => {
    const html = renderEditor({
      savedDraft: blankDraft({
        fixedRange: true,
        templateBase: "sixteenth",
        templateDots: 0,
      }),
    });
    expect(html).not.toContain("修改预览 · 1 项");
    expect(html).toContain("允许覆盖此时间范围的简谱");
  });

  it("事件内容编辑保留自身时值，不借用创建模板时值", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events[0]!;
    event.rhythm = { base: "eighth", dots: 0 };
    const html = renderEditor(
      {
        document,
        target: {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          eventId: event.id,
        },
        savedDraft: blankDraft({
          selectedId: event.id,
          start: 0,
          end: 480,
          initial: "1",
          templateBase: "whole",
        }),
      },
      true,
    );
    expect(html).toContain("修改预览 · 1 项");
    expect(html).not.toContain("应用前需确认");
  });

  it("侧栏延长时值预览显示后续移动和压缩，未误报为覆盖", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events[0]!;
    const html = renderEditor({
      document,
      target: {
        kind: "numbered",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
      },
      savedDraft: blankDraft({
        selectedId: event.id,
        start: 0,
        end: 960,
        raw: "1",
        initial: "1",
        base: "half",
      }),
    });
    expect(html).toContain('aria-label="简谱时值修改预览"');
    expect(html).toMatch(
      /移动 \d+ 个后续事件，缩短 \d+ 个后续事件；应用前需确认/,
    );
    expect(html).not.toMatch(/覆盖 \d+ 个后续音符/);
  });

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
