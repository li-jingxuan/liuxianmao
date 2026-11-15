import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildLayout,
  copyChordPreset,
  EXAMPLE_MVP_6_DOCUMENT,
} from "@liuxianmao/lxm-editor";
import { ChordEditor, type ChordDraft } from "../components/EditorShell/chords/ChordEditor";
import { createEditorStore } from "../stores/editor-store";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const descendants = (node: ReactNode): Element[] => Children.toArray(node).flatMap(child => {
  if (!isValidElement(child)) return [];
  const element = child as Element;
  return [element, ...descendants(element.props.children)];
});

describe("BUG-033 全谱和弦显示配置", () => {
  it("单选即时更新全谱视图，保留未应用的和弦草稿、原指法与撤销历史", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const store = createEditorStore(document);
    const before = structuredClone(document);
    const draft: ChordDraft = { display: "nameAndDiagram", chord: copyChordPreset("F")! };
    draft.chord.name = "尚未应用的名称";
    const draftBefore = structuredClone(draft);
    const onChange = vi.fn();
    let showChordDiagrams = true;
    const onShowChordDiagramsChange = vi.fn((show: boolean) => { showChordDiagrams = show; });
    const render = () => ChordEditor({
      draft, onChange, presetsEnabled: true, inputRef: () => {},
      showChordDiagrams, onShowChordDiagramsChange,
    });
    const radio = () => descendants(render()).find(e => e.props["aria-label"] === "和弦显示方式")!;
    const change = (value: string) => (radio().props.onChange as (e: unknown) => void)({ target: { value } });
    const chords = () => buildLayout(document, { purpose: "editing", showChordDiagrams }).systems
      .flatMap(s => s.measures.flatMap(m => m.chordSymbols ?? []));
    const visible = chords();
    expect(visible.filter(c => c.diagram).length).toBeGreaterThan(1);
    change("name");
    expect(onShowChordDiagramsChange).toHaveBeenLastCalledWith(false);
    expect(radio().props.value).toBe("name");
    expect(chords()).toHaveLength(visible.length);
    expect(chords().every(c => c.diagram === null)).toBe(true);
    expect(renderToStaticMarkup(render())).toContain("Tips: 谱面显示配置全局生效。");
    change("nameAndDiagram");
    expect(onShowChordDiagramsChange).toHaveBeenLastCalledWith(true);
    expect(chords()).toEqual(visible);
    expect(onChange).not.toHaveBeenCalled();
    expect(draft).toEqual(draftBefore);
    expect(store.getState().document).toBe(document);
    expect(store.getState().historyDepth.past).toBe(0);
    expect(document).toEqual(before);
  });

  it("换到没有指法的和弦时仍反映全局状态，并允许开启其它和弦的图", () => {
    const tree = ChordEditor({
      draft: { display: "name", chord: { name: "C", diagram: null } },
      onChange: vi.fn(), inputRef: () => {}, presetsEnabled: true,
      showChordDiagrams: true, onShowChordDiagramsChange: vi.fn(),
    });
    const radio = descendants(tree).find(e => e.props["aria-label"] === "和弦显示方式")!;
    expect(radio.props.value).toBe("nameAndDiagram");
    expect(radio.props.options).toContainEqual({ value: "nameAndDiagram", label: "名称与指法", disabled: false });
  });
});
