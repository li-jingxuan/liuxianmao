import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLayout, EXAMPLE_MVP_7_2_DOCUMENT, type ILXMNumberedEvent } from "@liuxianmao/lxm-editor";
import { MusicTextSidebar, type ParagraphEditingSession } from "../components/EditorShell/music-text/MusicTextSidebar";
import type { MusicTextDraft, MusicTextTarget } from "../components/EditorShell/music-text/music-text-draft";
import { resolveParagraphLyricTarget } from "../components/EditorShell/music-text/music-text-target";
import { resolveParagraphFocus } from "../components/EditorShell/score/music-text-focus";
import { EditorSessionRuntime } from "../components/EditorShell/session/EditorSessionRuntime";
import { EditorStoreContext } from "../stores/editor-context";
import { createEditorSession } from "../stores/editor-store";

const effects = vi.hoisted(() => ({ callback: null as unknown, paragraph: null as (() => void) | null }));
// The suite's SSR harness exercises real event handlers and render-phase updates.
// Publish only the paragraph notification effect; browser positioning effects stay inert.
vi.mock("react", async (load) => {
  const react = await load<typeof import("react")>();
  return { ...react, useEffect: (effect: () => void, deps?: readonly unknown[]) => {
    if (effects.callback && deps?.[0] === effects.callback) effects.paragraph = effect;
    react.useEffect(effect, deps);
  } };
});
afterEach(() => { effects.callback = null; effects.paragraph = null; });

type Props = Record<string, unknown>;
const find = (tree: ReactNode, predicate: (props: Props) => boolean): Props | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = find(child, predicate); if (found) return found; }
  } else if (isValidElement<Props>(tree)) {
    if (predicate(tree.props)) return tree.props;
    return find(tree.props.children as ReactNode, predicate);
  }
  return null;
};
const switchKind = (tree: ReactNode, kind: "lyric" | "numbered") =>
  (find(tree, (p) => p["aria-label"] === "简谱或歌词")!.onChange as (kind: string) => void)(kind);
const lyricForm = (tree: ReactNode) => find(tree, (p) => !!p.draft && typeof p.onTextChange === "function");

const fixture = (kind: ILXMNumberedEvent["kind"] | "empty" = "notes") => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!]; track.numberedMarks = []; track.techniques = [];
  document.score.meta.lyricVerseCount = 3;
  const measure = track.measures[0]!;
  measure.lyrics = []; measure.numberedVoice.tuplets = [];
  measure.numberedVoice.events = kind === "empty" ? [] : [0, 960, 1920, 2880].map((tick, index) => ({
    id: `event-${index}`, tick, rhythm: { base: "quarter", dots: 0 },
    kind: index === 1 ? kind : "notes",
    items: [{ id: `item-${index}`, token: index === 1 && kind === "rest" ? "0" : index === 1 && kind === "continuation" ? "-" : "3" }],
  } as ILXMNumberedEvent));
  const target: Extract<MusicTextTarget, { kind: "numbered" }> = { kind: "numbered", trackId: track.id, measureId: measure.id,
    ...(kind === "empty" ? { tick: 960, endTick: 1920 } : { eventId: "event-1", itemId: "item-1" }) };
  return { document, target };
};

const run = (input: ReturnType<typeof fixture>, steps: ((tree: ReactNode) => void)[]) => {
  const session = createEditorSession(input.document);
  expect(session.getState().document, session.getState().errorMessage ?? "valid fixture").not.toBeNull();
  const original = session.getState().document;
  const history = session.getState().history;
  const { target } = input;
  session.getState().setNumberedSelection({ ...target, kind: "eventId" in target && target.eventId ? "numberedEvent" : "numberedTime" } as Parameters<ReturnType<typeof session.getState>["setNumberedSelection"]>[0]);
  const notify = vi.fn<(value: ParagraphEditingSession | null) => void>();
  effects.callback = notify;
  const noop = () => {};
  const props: ComponentProps<typeof MusicTextSidebar> = {
    ref: null, onOpen: noop, onEditingChange: noop, onPopoverHiddenChange: noop,
    onNumberedActionBlockedChange: noop, onTargetChange: noop, onScoreFocus: noop,
    onParagraphEditingChange: notify, onScoreSelection: noop, getNumberedBeatEventIds: () => [],
    getFloatingAnchor: () => null,
    getFloatingViewport: () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }),
  };
  let stage = 0;
  let final: ReactNode;
  const Harness = () => {
    const tree = MusicTextSidebar(props);
    final = tree;
    if (stage === 0) {
      stage++;
      (find(tree, (p) => p.activeKey === "selection" && Array.isArray(p.items))!.onChange as (tab: string) => void)("paragraph");
    } else if (stage <= steps.length) steps[stage++ - 1]!(tree);
    return tree;
  };
  const html = renderToStaticMarkup(<EditorStoreContext.Provider value={{ ...session, getInitialState: session.getState }}><EditorSessionRuntime session={session}><Harness /></EditorSessionRuntime></EditorStoreContext.Provider>);
  effects.paragraph?.();
  expect(stage).toBe(steps.length + 1);
  expect(session.getState().document).toBe(original);
  expect(session.getState().history).toBe(history);
  return { html, tree: final!, notify, session };
};

describe("BUG039 paragraph switching", () => {
  it.each(["notes", "empty"] as const)("inherits the exact %s position without creating score content or history", (kind) => {
    const input = fixture(kind);
    const { tree, html } = run(input, [(tree) => switchKind(tree, "lyric")]);
    const draft = lyricForm(tree)!.draft as MusicTextDraft;
    if (draft.target.kind !== "lyric") throw new Error("expected lyric session");
    const { itemId: _itemId, ...position } = input.target;
    expect(draft.target).toMatchObject({ ...position, kind: "lyric", verse: 1 });
    expect(draft.target).not.toHaveProperty("itemId");
    expect(draft.text).toBe("");
    expect(html).toContain('aria-label="连续歌词"');
    expect(resolveParagraphFocus(buildLayout(input.document, { purpose: "editing", paragraphEditing: draft.target }), draft.target)).not.toBeNull();
  });

  it("retains the valid verse through lyric → numbered → lyric", () => {
    const { tree } = run(fixture(), [
      (tree) => switchKind(tree, "lyric"),
      (tree) => (find(tree, (p) => p["aria-label"] === "歌词段落")!.onChange as (verse: number) => void)(3),
      (tree) => switchKind(tree, "numbered"),
      (tree) => switchKind(tree, "lyric"),
    ]);
    expect((lyricForm(tree)!.draft as MusicTextDraft).target).toMatchObject({ eventId: "event-1", verse: 3 });
  });

  it("inherits the current numbered preview after the editor rebinds its event", () => {
    const input = fixture();
    const { tree } = run(input, [
      (tree) => (find(tree, (p) => typeof p.onPreviewTargetChange === "function")!.onPreviewTargetChange as (target: MusicTextTarget) => void)({ kind: "numbered", trackId: input.target.trackId, measureId: input.target.measureId, eventId: "event-2" }),
      (tree) => switchKind(tree, "lyric"),
    ]);
    expect((lyricForm(tree)!.draft as MusicTextDraft).target.eventId).toBe("event-2");
  });

  it.each(["rest", "continuation"] as const)("keeps the lyric row for %s without selecting another note", (kind) => {
    const input = fixture(kind);
    const { tree, notify } = run(input, [(tree) => switchKind(tree, "lyric")]);
    expect(lyricForm(tree)).toBeNull();
    expect(notify).toHaveBeenLastCalledWith({ trackId: input.target.trackId, measureId: input.target.measureId, kind: "lyric", verse: 1 });
    const layout = buildLayout(input.document, { purpose: "editing", paragraphEditing: notify.mock.lastCall![0]! });
    expect(resolveParagraphFocus(layout, { trackId: input.target.trackId, measureId: input.target.measureId, kind: "lyric", eventId: "event-2", verse: 1 })).not.toBeNull();
  });

  it("does not apply a lyric draft when switching; composing input still blocks the switch", () => {
    const { tree } = run(fixture(), [
      (tree) => switchKind(tree, "lyric"),
      (tree) => (lyricForm(tree)!.onTextChange as (text: string) => void)("未应用"),
      (tree) => {
        (find(tree, (p) => typeof p.onCompositionStart === "function")!.onCompositionStart as (event: unknown) => void)({ target: { closest: () => null } });
        switchKind(tree, "numbered");
      },
    ]);
    expect((lyricForm(tree)!.draft as MusicTextDraft).text).toBe("未应用");
  });

  it("falls back to verse 1 when the remembered verse is no longer valid", () => {
    const { document, target } = fixture();
    document.score.meta.lyricVerseCount = 1;
    expect(resolveParagraphLyricTarget(document, target, 3)?.verse).toBe(1);
  });
});
