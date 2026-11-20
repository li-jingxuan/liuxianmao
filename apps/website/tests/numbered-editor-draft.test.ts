import {
  createElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT, type ILXMRhythm } from "@liuxianmao/lxm-editor";
import { NumberedEditor } from "../components/EditorShell/numbered/NumberedEditor";
import { createEditorSession } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const renderEditor = (
  props: Partial<ComponentProps<typeof NumberedEditor>> = {},
  explicit: boolean | ILXMRhythm = false,
  edits: { label: string; value: unknown }[] = [],
) => {
  const document = props.document ?? structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  if (!props.document)
    measure.numberedVoice.events[0]!.rhythm = { base: "eighth", dots: 0 };
  const session = createEditorSession(document);
  if (explicit)
    session.getState().setNumberedInputRhythm(typeof explicit === "object" ? explicit : { base: "quarter", dots: 0 });
  let edited = false;
  const change = (node: ReactNode, label: string, value: unknown): boolean => {
    if (Array.isArray(node))
      return node.some((child) => change(child, label, value));
    if (
      !isValidElement<{
        "aria-label"?: string;
        children?: ReactNode;
        onChange?: (value: unknown) => void;
      }>(node)
    )
      return false;
    if (node.props["aria-label"] === label || node.props.children === label) {
      node.props.onChange!(value);
      return true;
    }
    return change(node.props.children, label, value);
  };
  const EditorWithInput = (props: ComponentProps<typeof NumberedEditor>) => {
    const editor = NumberedEditor(props);
    if (!edited) {
      edited = true;
      for (const edit of edits)
        expect(change(editor, edit.label, edit.value)).toBe(true);
    }
    return editor;
  };
  return renderToStaticMarkup(
    createElement(
      EditorStoreContext.Provider,
      { value: { ...session, getInitialState: session.getState } },
      createElement(EditorWithInput, {
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

describe("简谱当前目标初始化", () => {
  it("空位从空文本和均匀模板初始化，不产生未应用修改", () => {
    const html = renderEditor();
    expect(html).toContain('aria-label="简谱内容"');
    expect(html.match(/role="group" aria-label="常用时值"/g)).toHaveLength(1);
    expect(html).not.toContain("录入方式");
    expect(html).not.toContain('aria-label="节拍映射预览"');
    expect(html).not.toContain("允许覆盖此时间范围的简谱");
    expect(html.match(/<button[^>]*aria-label="应用简谱内容"[^>]*>/)?.[0]).toContain("disabled");
  });

  it("默认时值适应短空位，显式时值保留用户选择", () => {
    const implicit = renderEditor();
    expect(implicit.match(/<button[^>]*aria-label="八分音符"[^>]*>/)?.[0]).toContain('aria-pressed="true"');
    const explicit = renderEditor({}, true);
    expect(explicit.match(/<button[^>]*aria-label="四分音符"[^>]*>/)?.[0]).toContain('aria-pressed="true"');
  });

  it("普通空位允许部分填入，不强制填满原范围", () => {
    const partial = renderEditor({}, { base: "sixteenth", dots: 0 }, [
      { label: "简谱内容", value: { target: { value: "6" } } },
    ]);
    expect(partial).toContain('aria-label="节拍映射预览"');
    expect(partial).toContain('data-start-tick="480" data-end-tick="720"');
    expect(partial).not.toContain("允许覆盖此时间范围的简谱");
    expect(partial).not.toContain("固定范围替换");
  });

  it("事件回填曲谱内容和自身时值，独立于创建模板偏好", () => {
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
        mode: "single",
      },
      true,
    );
    expect(html.match(/<input\b[^>]*aria-label="简谱内容"[^>]*>/)?.[0]).toContain(
      `value="${event.items.map((item) => item.token).join("+")}"`,
    );
    expect(html.match(/<button[^>]*aria-label="八分音符"[^>]*>/)?.[0]).toContain('aria-pressed="true"');
    expect(html).not.toContain("应用前需确认");
    expect(html.match(/<button[^>]*aria-label="应用简谱内容"[^>]*>/)?.[0]).toContain("disabled");
  });

  it("正文草稿可选时值，即时音高与延音保持禁用", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events[0]!;
    const html = renderEditor(
      {
        document,
        target: {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          eventId: event.id,
        },
      },
      false,
      [{ label: "简谱内容", value: { target: { value: "5" } } }],
    );
    expect(html.match(/<button[^>]*aria-label="二分音符"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.match(/<button[^>]*aria-label="延音"[^>]*>/)?.[0]).toContain("disabled");
    expect(html).toContain("随内容应用");
    expect(html.match(/<button[^>]*aria-label="高八度"[^>]*>/)?.[0]).toContain("disabled");
    expect(html).toContain('aria-label="八度与变音"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("恢复简谱内容");
  });

  it("连续简谱回填选中拍点内的已有音符", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const first = measure.beats[0]!;
    const second = measure.beats[1]!;
    const html = renderEditor({
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
    });
    expect(html.match(/<input\b[^>]*aria-label="简谱内容"[^>]*>/)?.[0]).toContain('value="1 2"');
  });
});
