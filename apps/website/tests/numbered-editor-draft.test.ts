import {
  createElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "@liuxianmao/lxm-editor";
import { NumberedEditor } from "../components/EditorShell/NumberedEditor";
import { createEditorSession } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const renderEditor = (
  props: Partial<ComponentProps<typeof NumberedEditor>> = {},
  explicit = false,
  edits: { label: string; value: unknown }[] = [],
) => {
  const document = props.document ?? structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  if (!props.document)
    measure.numberedVoice.events[0]!.rhythm = { base: "eighth", dots: 0 };
  const session = createEditorSession(document);
  if (explicit)
    session.getState().setNumberedInputRhythm({ base: "quarter", dots: 0 });
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
    expect(html).toContain('aria-label="连续简谱"');
    expect(html).toContain('title="自选时值"');
    expect(html).not.toContain('aria-label="节拍映射预览"');
    expect(html).not.toContain("允许覆盖此时间范围的简谱");
    expect(html).toMatch(/<button[^>]*disabled[^>]*><span>应用简谱内容<\/span>/);
  });

  it("默认时值适应短空位，显式时值保留用户选择", () => {
    const implicit = renderEditor();
    expect(implicit).toContain('title="八分"');
    const explicit = renderEditor({}, true);
    expect(explicit).toContain('title="四分"');
  });

  it("普通空位允许部分填入，固定范围仍要求填满范围", () => {
    const edits = [
      { label: "连续简谱", value: { target: { value: "6" } } },
      { label: "模板成员时值", value: "sixteenth" },
    ];
    const partial = renderEditor({}, false, edits);
    expect(partial).toContain('aria-label="节拍映射预览"');
    expect(partial).not.toContain("允许覆盖此时间范围的简谱");
    const fixed = renderEditor({}, false, [
      ...edits,
      {
        label: "固定范围替换（高级）",
        value: { target: { checked: true } },
      },
    ]);
    expect(fixed).not.toContain('aria-label="节拍映射预览"');
    expect(fixed).toContain("允许覆盖此时间范围的简谱");
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
    expect(html).toContain(
      `${event.items.map((item) => item.token).join("+")}</textarea>`,
    );
    expect(html).toContain('title="八分"');
    expect(html).not.toContain("应用前需确认");
    expect(html).toMatch(/<button[^>]*disabled[^>]*><span>应用简谱内容<\/span>/);
  });

  it("延长事件时值显示后续移动和压缩，未误报为覆盖", () => {
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
      [{ label: "简谱时值", value: "half" }],
    );
    expect(html).toContain('aria-label="简谱时值修改预览"');
    expect(html).toMatch(
      /移动 \d+ 个后续事件，缩短 \d+ 个后续事件；应用前需确认/,
    );
    expect(html).not.toMatch(/覆盖 \d+ 个后续音符/);
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
    expect(html).toContain("1 2</textarea>");
  });
});
