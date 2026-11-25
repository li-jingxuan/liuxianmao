import { isValidElement, type ReactNode, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LXMScoreCommandEnum as C } from "@liuxianmao/lxm-editor";
import EXAMPLE from "../../../packages/lxm-editor/example/example-mvp2.json";
import { createEditorSessionStore as createEditorSession } from "../../../packages/lxm-editor-react/src/stores/editor-store";
import { createEditorDraftCoordinator } from "../../../packages/lxm-editor-react/src/EditorShell/session/editor-draft-coordinator";
import { createEditorModalController } from "../../../packages/lxm-editor-react/src/EditorShell/session/editor-modal-controller";
import { TechniqueToolbar, type TechniqueToolbarController } from "../../../packages/lxm-editor-react/src/EditorShell/tools/TechniqueToolbar";
import { resolveToolbarTechnique, toolbarTechniqueAvailability, techniquesInToolbarSelection } from "../../../packages/lxm-editor-react/src/EditorShell/tools/technique-toolbar-model";

// Exercise the real event handlers, owner, session and core commands. The hook host
// keeps component state across renders without substituting musical validation.
const host = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], cleanups: [] as (() => void)[],
  session: null as unknown, runtime: null as unknown }));
vi.mock("react", async load => {
  const react = await load<typeof import("react")>();
  const state = (initial: unknown) => {
    const i = host.cursor++;
    if (!(i in host.slots)) host.slots[i] = typeof initial === "function" ? initial() : initial;
    return [host.slots[i], (next: unknown) => { host.slots[i] = typeof next === "function" ? next(host.slots[i]) : next; }];
  };
  const effect = (callback: () => void | (() => void), deps: unknown[]) => {
    const i = host.cursor++;
    const previous = host.slots[i] as unknown[] | undefined;
    if (!previous || deps.some((value, index) => value !== previous[index])) {
      host.slots[i] = deps;
      const cleanup = callback(); if (cleanup) host.cleanups.push(cleanup);
    }
  };
  return { ...react, useState: state, useRef: (initial: unknown) => state(() => ({ current: initial }))[0],
    useMemo: (factory: () => unknown) => factory(), useEffect: effect, useLayoutEffect: effect,
    useImperativeHandle: (ref: { current?: unknown } | undefined, factory: () => unknown) => { if (ref) ref.current = factory(); } };
});
vi.mock("../../../packages/lxm-editor-react/src/stores/editor-store", async load => ({ ...await load<object>(), useEditorSessionStore: () => host.session }));
vi.mock("../../../packages/lxm-editor-react/src/EditorShell/session/EditorSessionRuntime", () => ({ useEditorRuntime: () => host.runtime }));
afterEach(() => {
  host.cleanups.reverse().forEach(cleanup => cleanup()); host.cleanups = []; host.slots = []; host.cursor = 0;
  vi.useRealTimers(); vi.unstubAllGlobals();
});
type Props = Record<string, unknown>;
const all = (tree: ReactNode, predicate: (props: Props) => boolean): Props[] => {
  if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate));
  if (!isValidElement<Props>(tree)) return [];
  return [...(predicate(tree.props) ? [tree.props] : []), ...all(tree.props.children as ReactNode, predicate)];
};
const find = (tree: ReactNode, predicate: (props: Props) => boolean) => {
  const result = all(tree, predicate)[0]; if (!result) throw new Error("Missing control"); return result;
};
const click = async (props: Props) => { (props.onClick as () => void)(); await Promise.resolve(); await Promise.resolve(); };
const fixture = () => {
  const source = structuredClone(EXAMPLE);
  const session = createEditorSession(source);
  const document = session.getState().document!;
  const track = document.score.tracks[0]!;
  const cell = (beat = "5", string = 6) => ({ trackId: track.id, measureId: track.measures[0]!.id, beatId: `mvp2-beat-1-${beat}`, string });
  session.getState().setSelection({ anchor: cell(), focus: cell() });
  host.session = session;
  host.runtime = { drafts: createEditorDraftCoordinator(session.getState), modals: createEditorModalController(session.getState, () => () => {}) };
  const execute = vi.fn<ComponentProps<typeof TechniqueToolbar>["execute"]>(async command => {
    const result = session.getState().execute(command);
    if (!result) throw new Error("Missing command result");
    return result.ok ? { status: result.changed ? "applied" : "noop", result } : { status: "blocked", message: result.message };
  });
  const onSuccess = vi.fn(), onClose = vi.fn(), setErrorMessage = vi.fn();
  const overrides: Partial<ComponentProps<typeof TechniqueToolbar>> = {};
  const render = () => {
    host.cursor = 0;
    const state = session.getState();
    return TechniqueToolbar({ document: state.document!, selection: state.selection, selectedTechniqueId: state.selectedTechniqueId,
      blocked: false, execute, onSuccess, onClose, onShowParameters: () => {}, setErrorMessage,
      setSelectedTechniqueId: id => session.getState().setSelectedTechniqueId(id), ...overrides });
  };
  const tile = (type: string) => find(render(), props => props["data-technique-type"] === type);
  const named = (name: string) => find(render(), props => props["aria-label"] === name);
  return { session, document, track, cell, execute, onSuccess, onClose, setErrorMessage, render, tile, named, overrides };
};

describe("REQ045 compact technique toolbar", () => {
  it("exposes all sixteen icon/name tiles and a unique-object text delete action", () => {
    const panel = fixture();
    const tree = panel.render();
    expect(all(tree, props => !!props["data-technique-type"])).toHaveLength(16);
    expect(all(tree, props => props.children === "所有技巧")).toHaveLength(1);
    expect(panel.named("删除当前技巧")).toMatchObject({ type: "text", disabled: true });
    for (const old of ["新增技巧：选择全部 16 类…", "添加技巧", "删除技巧", "选择吉他技巧"])
      expect(all(tree, props => props.children === old || props["aria-label"] === old)).toHaveLength(0);
  });

  it("applies parameterless tiles immediately through the session, stays open and supports undo", async () => {
    const panel = fixture();
    await click(panel.tile("vibrato"));
    expect(panel.execute).toHaveBeenCalledOnce();
    expect(panel.execute.mock.calls[0]![0]).toMatchObject({ type: C.AddTechnique, technique: { type: "vibrato", fromNoteId: "mvp2-note-1-5-6" } });
    expect(panel.onSuccess).toHaveBeenCalledOnce(); expect(panel.onClose).not.toHaveBeenCalled();
    expect(panel.session.getState().selectedTechniqueId).toBeTruthy();
    expect(panel.named("删除当前技巧").disabled).toBe(false);
    panel.session.getState().undo(); expect(panel.session.getState().document).toEqual(panel.document);
  });

  it("shows a valid, explicit connection before applying and keeps core direction constraints", async () => {
    const panel = fixture();
    expect(panel.tile("pullOff")["aria-disabled"]).toBe(true);
    expect(panel.tile("slideDown")["aria-disabled"]).toBe(true);
    await click(panel.tile("hammerOn")); expect(panel.execute).not.toHaveBeenCalled();
    const target = find(panel.render(), props => props.children === "应用到此目标");
    expect(target.disabled).toBe(false);
    await click(target);
    expect(panel.execute.mock.calls[0]![0]).toMatchObject({ technique: { type: "hammerOn", fromNoteId: "mvp2-note-1-5-6", toNoteId: "mvp2-note-1-6-6" } });
  });

  it("commits bend choices immediately and requires explicit replacement before overwriting another type", async () => {
    const panel = fixture();
    await click(panel.tile("bend")); expect(panel.execute).not.toHaveBeenCalled();
    await click(find(panel.render(), props => props.children === "半音"));
    const id = panel.session.getState().selectedTechniqueId;
    expect(panel.execute.mock.calls[0]![0]).toMatchObject({ type: C.AddTechnique, technique: { type: "bend", semitones: 1 } });
    await click(find(panel.render(), props => props.children === "全音"));
    expect(panel.execute.mock.calls[1]![0]).toMatchObject({ type: C.UpdateTechnique, techniqueId: id, technique: { semitones: 2 } });
    await click(panel.tile("tapping"));
    expect(panel.execute.mock.calls[2]![0]).toMatchObject({ type: C.AddTechnique, technique: { type: "tapping" } });
    await click(find(panel.render(), props => props.children === "更换类型"));
    await click(panel.tile("vibrato"));
    expect(panel.execute.mock.calls[3]![0]).toMatchObject({ type: C.UpdateTechnique, techniqueId: panel.session.getState().selectedTechniqueId, technique: { type: "vibrato" } });
  });

  it("keeps the imperative arpeggio shortcut and submits an explicitly clicked default direction", async () => {
    const panel = fixture();
    const ref: { current: TechniqueToolbarController | null } = { current: null };
    panel.overrides.ref = ref;
    panel.session.getState().setSelection({ anchor: panel.cell("2", 2), focus: panel.cell("2", 3) });
    panel.render();
    expect(ref.current!.openTechnique({ mode: "create", type: "arpeggio" })).toBe(true);
    expect(panel.execute).not.toHaveBeenCalled();
    await click(find(panel.render(), props => props.children === "上行"));
    expect(panel.execute.mock.calls[0]![0]).toMatchObject({ type: C.AddTechnique,
      technique: { type: "arpeggio", direction: "ascending", minString: 2, maxString: 3 } });
    expect(panel.tile("arpeggio")["aria-expanded"]).toBe(false);
    await click(panel.tile("arpeggio"));
    expect(find(panel.render(), props => props.children === "上行")["aria-pressed"]).toBe(true);
    await click(find(panel.render(), props => props.children === "下行"));
    expect(panel.execute.mock.calls[1]![0]).toMatchObject({ type: C.UpdateTechnique,
      technique: { type: "arpeggio", direction: "descending", minString: 2, maxString: 3 } });
  });

  it("keeps a direction picker transient and rejects a choice from an old selection", async () => {
    const panel = fixture();
    panel.session.getState().setSelection({ anchor: panel.cell("2", 2), focus: panel.cell("2", 3) });
    await click(panel.tile("strum"));
    expect(panel.tile("strum")["aria-expanded"]).toBe(true);
    const oldChoice = find(panel.render(), props => props.children === "向上");
    await click(panel.tile("strum"));
    expect(panel.tile("strum")["aria-expanded"]).toBe(false);
    expect(panel.session.getState().document).toBe(panel.document);
    await click(panel.tile("strum"));
    panel.session.getState().setSelection({ anchor: panel.cell("5"), focus: panel.cell("5") });
    await click(oldChoice);
    expect(panel.execute).not.toHaveBeenCalled();
  });

  it("retains the slide shortcut's explicit up/down choice and closes through the optional callback", async () => {
    const panel = fixture();
    const ref: { current: TechniqueToolbarController | null } = { current: null };
    panel.overrides.ref = ref; panel.render();
    expect(ref.current!.openTechnique({ mode: "create", type: "slide" })).toBe(true);
    expect(panel.execute).not.toHaveBeenCalled();
    await click(panel.tile("slideUp"));
    await click(find(panel.render(), props => props.children === "应用到此目标"));
    expect(panel.execute.mock.calls[0]![0]).toMatchObject({ technique: { type: "slideUp" } });
    await click(panel.named("关闭所有技巧")); expect(panel.onClose).toHaveBeenCalledOnce();
  });

  it("retains invalid trill input; commits only full legal values on blur or Enter; blocks IME and duplicates", async () => {
    const panel = fixture();
    await click(panel.tile("trill"));
    const change = (value: string) => (panel.named("辅助品位").onChange as (event: unknown) => void)({ target: { value } });
    const blur = async (value: string) => {
      (panel.named("辅助品位").onBlur as (event: unknown) => void)({ target: { value } }); await Promise.resolve(); await Promise.resolve();
    };
    const mainFret = String(panel.track.measures[0]!.beats.find(beat => beat.id === panel.cell().beatId)!.notes.find(note => note.string === 6)!.fret);
    for (const value of ["", "3.5", "3.", "2e0", "0x8", "25", mainFret]) {
      change(value); await blur(value);
      expect(panel.execute).not.toHaveBeenCalled(); expect(panel.named("辅助品位").value).toBe(value);
    }
    const region = () => find(panel.render(), props => props["data-technique-parameters"] !== undefined);
    class InputTarget { tagName = "INPUT"; value = "8"; type = "text"; disabled = false; readOnly = false; closest() { return null; } }
    vi.stubGlobal("HTMLInputElement", InputTarget);
    const enter = () => (region().onKeyDownCapture as (event: unknown) => void)({ nativeEvent: { isComposing: false, keyCode: 13 },
      key: "Enter", repeat: false, target: new InputTarget(), preventDefault() {}, stopPropagation() {} });
    change("8");
    vi.useFakeTimers(); (region().onCompositionStart as () => void)(); enter();
    expect(panel.execute).not.toHaveBeenCalled();
    (region().onCompositionEnd as () => void)(); enter(); expect(panel.execute).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60); enter(); enter();
    await Promise.resolve(); await Promise.resolve();
    expect(panel.execute).toHaveBeenCalledOnce();
    expect(panel.execute.mock.calls[0]![0]).toMatchObject({ technique: { type: "trill", auxiliaryFret: 8 } });
    await blur("8"); expect(panel.execute).toHaveBeenCalledOnce();
  });

  it("cancels prepared parameters when selection changes and rejects an old callback", async () => {
    const panel = fixture();
    await click(panel.tile("bend"));
    const oldChoice = find(panel.render(), props => props.children === "半音");
    panel.session.getState().setSelection({ anchor: panel.cell("6"), focus: panel.cell("6") });
    await click(oldChoice);
    expect(panel.execute).not.toHaveBeenCalled();
  });

  it("does not clear multiple selected techniques and removes only the specified ID", async () => {
    const panel = fixture();
    panel.session.getState().execute({ type: C.AddTechnique, trackId: panel.track.id, technique: { type: "bend", fromNoteId: "mvp2-note-1-5-6", semitones: 2 } });
    panel.session.getState().execute({ type: C.AddTechnique, trackId: panel.track.id, technique: { type: "tapping", fromNoteId: "mvp2-note-1-5-6" } });
    expect(panel.named("删除当前技巧").disabled).toBe(true);
    const objects = techniquesInToolbarSelection(panel.session.getState().document!, panel.session.getState().selection);
    expect(objects).toHaveLength(2);
    panel.session.getState().setSelectedTechniqueId(objects[0]!.id);
    await click(panel.named("删除当前技巧"));
    expect(panel.execute.mock.calls[0]![0]).toMatchObject({ type: C.RemoveTechnique, techniqueId: objects[0]!.id });
    expect(panel.session.getState().document!.score.tracks[0]!.techniques.map(item => item.id)).toEqual([objects[1]!.id]);
  });

  it("locks a pending submission and guards changes caused by beforeAction", async () => {
    const panel = fixture();
    await click(panel.tile("bend"));
    panel.overrides.beforeAction = () => panel.session.getState().setSelection({ anchor: panel.cell("6"), focus: panel.cell("6") });
    await click(find(panel.render(), props => props.children === "半音"));
    expect(panel.execute).not.toHaveBeenCalled();
    panel.overrides.beforeAction = undefined;
    await click(panel.tile("bend"));
    let finish!: () => void;
    panel.execute.mockImplementationOnce(async command => {
      await new Promise<void>(resolve => { finish = resolve; });
      const result = panel.session.getState().execute(command)!;
      if (!result.ok) return { status: "blocked", message: result.message };
      return { status: "applied", result };
    });
    const choice = find(panel.render(), props => props.children === "半音");
    await click(choice); await click(choice); expect(panel.execute).toHaveBeenCalledOnce();
    finish(); await Promise.resolve(); await Promise.resolve();
  });
});

describe("technique toolbar target and availability model", () => {
  it("edits the identified object's original scope even when focus points elsewhere", () => {
    const panel = fixture();
    panel.session.getState().execute({ type: C.AddTechnique, trackId: panel.track.id, technique: { type: "bend", fromNoteId: "mvp2-note-1-5-6", semitones: 2 } });
    const document = panel.session.getState().document!, id = document.score.tracks[0]!.techniques[0]!.id;
    const selection = { anchor: panel.cell("6"), focus: panel.cell("6") };
    expect(resolveToolbarTechnique(document, selection, "bend", { direction: "up", semitones: 1, trillFret: 8 }, id))
      .toMatchObject({ ok: true, draft: { type: "bend", fromNoteId: "mvp2-note-1-5-6", semitones: 1 } });
  });
  it("checks each type against the real core and permits a trill when the default auxiliary pitch equals the main pitch", () => {
    const panel = fixture();
    const document = structuredClone(panel.document);
    document.score.tracks[0]!.measures[0]!.beats.find(beat => beat.id === panel.cell().beatId)!.notes.find(note => note.string === 6)!.fret = 7;
    const selection = panel.session.getState().selection;
    expect(toolbarTechniqueAvailability(document, selection, "trill", null)).toBeNull();
    expect(resolveToolbarTechnique(document, selection, "trill", { direction: "down", semitones: 2, trillFret: 7 }))
      .toMatchObject({ ok: false, message: expect.stringContaining("不同于主品位") });
    expect(toolbarTechniqueAvailability(document, null, "vibrato", null)).toContain("TAB");
    expect(toolbarTechniqueAvailability(document, selection, "strum", null)).toContain("至少两根弦");
  });
});
