import { isValidElement, type ReactNode, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT, type ILXMNumberedEvent, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { NumberedEditor, type NumberedEditorController } from "../components/EditorShell/numbered/NumberedEditor";
import type { createNumberedSubmission } from "../components/EditorShell/numbered/numbered-submission";
import { createEditorSession } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const harness = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[],
  changes: [] as unknown[], submission: null as ReturnType<typeof createNumberedSubmission> | null,
}));
vi.mock("react", async (load) => {
  const react = await load<typeof import("react")>();
  return { ...react,
    useState: (initial: unknown) => {
      const [value, setValue] = react.useState(initial);
      return [value, (next: unknown) => { harness.changes.push(next); setValue(next); }];
    },
    useLayoutEffect: (effect: () => void | (() => void)) => harness.effects.push(effect),
    useImperativeHandle: (ref: RefObject<unknown> | null, create: () => unknown) => { if (ref) ref.current = create(); },
  };
});
vi.mock("../components/EditorShell/numbered/numbered-submission", async (load) => {
  const original = await load<typeof import("../components/EditorShell/numbered/numbered-submission")>();
  return { ...original, createNumberedSubmission: (...args: Parameters<typeof createNumberedSubmission>) => {
    harness.submission = original.createNumberedSubmission(...args);
    return harness.submission;
  } };
});
afterEach(() => {
  harness.cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  harness.effects = []; harness.changes = []; harness.submission = null;
});

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!]; track.numberedMarks = []; track.techniques = [];
  const measure = track.measures[0]!;
  measure.lyrics = [];
  const event = (id: string, tick: number, base: ILXMNumberedEvent["rhythm"]["base"], token: string): ILXMNumberedEvent => ({
    id, tick, rhythm: { base, dots: 0 }, kind: token === "" ? "gap" : token === "0" ? "rest" : "notes",
    items: token ? [{ id: `item-${id}`, token }] : [],
  } as ILXMNumberedEvent);
  measure.numberedVoice = { tuplets: [], events: [
    event("first", 0, "quarter", "0"), event("gap-a", 960, "sixteenth", ""),
    event("gap-b", 1200, "sixteenth", ""), event("target", 1440, "sixteenth", "0"),
    event("covered", 1680, "eighth", "3"), event("later", 2400, "quarter", "2"),
    event("last", 3600, "sixteenth", "1"),
  ] };
  return { document, track, measure };
};
const setup = (eventId: string | number, adjust?: (measure: ReturnType<typeof fixture>["measure"], track: ReturnType<typeof fixture>["track"]) => void) => {
  const { document, track, measure } = fixture();
  adjust?.(measure, track);
  const session = createEditorSession(document);
  expect(session.getState().document, session.getState().errorMessage ?? "valid fixture").not.toBeNull();
  const ref: RefObject<NumberedEditorController | null> = { current: null };
  const commit = vi.fn((operation: ILXMScoreCommand) => session.getState().execute(operation));
  let tree: ReactNode;
  const Harness = () => {
    harness.effects = [];
    const target = typeof eventId === "string" ? { eventId } : { tick: eventId, endTick: eventId + 240 };
    tree = NumberedEditor({ ref, document, target: { kind: "numbered", trackId: track.id, measureId: measure.id, ...target },
      mode: "sequence", commit, onDirty: () => {}, onInputActive: () => {}, onPreviewTargetChange: () => {},
      onActivate: () => {}, onCanApply: () => {}, onSelectTarget: () => {}, onModeChange: () => {}, onCancel: () => {},
      getClipboard: () => null, copyRange: () => false, selectedMarkId: null,
    });
    return tree;
  };
  renderToStaticMarkup(<EditorStoreContext.Provider value={{ ...session, getInitialState: session.getState }}><Harness /></EditorStoreContext.Provider>);
  harness.effects.splice(0).forEach((effect) => { const cleanup = effect(); if (cleanup) harness.cleanups.push(cleanup); });
  return { session, ref, commit, tree: tree! };
};
const findRhythm = (tree: ReactNode): { onChange: (base: "quarter", dots: number) => void; onSustain: () => void; disabled: boolean; disabledReason?: string; sustain: boolean } | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = findRhythm(child); if (found) return found; }
  } else if (isValidElement<Record<string, unknown>>(tree)) {
    if ("base" in tree.props && "onSustain" in tree.props) return tree.props as ReturnType<typeof findRhythm>;
    return findRhythm(tree.props.children as ReactNode);
  }
  return null;
};

describe("BUG036 fixed onset rhythm editing", () => {
  it("the rhythm toolbar explains insufficient time and leaves the document/history unchanged", async () => {
    const { tree, session, commit } = setup("last");
    const before = session.getState();
    findRhythm(tree)!.onChange("quarter", 0);
    await Promise.resolve(); await Promise.resolve();
    expect(harness.changes).toContain("当前位置后续时值不够，已超出本小节末尾；请缩短时值。");
    expect(commit).not.toHaveBeenCalled();
    expect(session.getState().document).toBe(before.document);
    expect(session.getState().history).toBe(before.history);
    expect(harness.submission!.isBusy()).toBe(false);
  });

  it("accepts a legal cross-beat duration after coverage confirmation, retaining both preceding gaps", async () => {
    const { ref, session, commit } = setup("target");
    const before = session.getState();
    const result = ref.current!.setRhythm({ base: "quarter", dots: 0 });
    expect(harness.submission!.isBusy()).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(session.getState().document).toBe(before.document);
    harness.submission!.confirm();
    expect(await result).toEqual({ status: "applied", group: "rhythm" });
    expect(commit).toHaveBeenCalledTimes(1);
    const events = session.getState().document!.score.tracks[0]!.measures[0]!.numberedVoice.events;
    expect(events.find((event) => event.id === "target")).toMatchObject({ tick: 1440, rhythm: { base: "quarter", dots: 0 } });
    expect(events.filter((event) => event.kind === "gap").map((event) => [event.id, event.tick])).toEqual([["gap-a", 960], ["gap-b", 1200]]);
    expect(events.some((event) => event.id === "covered")).toBe(false);
    expect(events.find((event) => event.id === "later")!.tick).toBe(2400);
    expect(session.getState().history.past.length).toBe(before.history.past.length + 1);
  });

  it("cancelling coverage preserves all events and creates no history", async () => {
    const { ref, session, commit } = setup("target");
    const before = session.getState();
    const result = ref.current!.setRhythm({ base: "quarter", dots: 0 });
    harness.submission!.cancel();
    expect(await result).toMatchObject({ status: "cancelled", group: "rhythm" });
    expect(commit).not.toHaveBeenCalled();
    expect(session.getState().document).toBe(before.document);
    expect(session.getState().history).toBe(before.history);
  });
});

describe("BUG067 continuation controls", () => {
  it.each(["first", 2160])("the continuation button writes an undotted quarter at %s", (target) => {
    const { tree, commit } = setup(target, (measure) => {
      if (typeof target === "number") measure.numberedVoice.events = measure.numberedVoice.events.filter((event) => event.id !== "later");
    });
    findRhythm(tree)!.onSustain();
    expect(commit).toHaveBeenCalledOnce();
    const result = commit.mock.results[0]?.value;
    expect(result).toMatchObject({ ok: true });
    if (!result?.ok) return;
    expect(result.document.score.tracks[0]?.measures[0]?.numberedVoice.events).toContainEqual(expect.objectContaining({
      tick: target === "first" ? 0 : target, kind: "continuation", rhythm: { base: "quarter", dots: 0 },
    }));
  });

  it("explains the blocked continuation button and leaves the following note and history intact", async () => {
    const { tree, session, commit } = setup("target");
    const before = session.getState();
    findRhythm(tree)!.onSustain();
    await Promise.resolve(); await Promise.resolve();
    expect(harness.changes).toContainEqual(expect.stringContaining("会覆盖后续简谱事件"));
    expect(commit).not.toHaveBeenCalled();
    expect(session.getState().document).toBe(before.document);
    expect(session.getState().history).toBe(before.history);
  });

  it("disables duration and dot controls for a continuation imported with old timing", async () => {
    const { tree, ref, commit } = setup("target", (measure) => {
      const event = measure.numberedVoice.events.find((item) => item.id === "target")!;
      measure.numberedVoice.events[3] = { ...event, kind: "continuation", items: [{ id: "item-target", token: "-" }] };
    });
    const controls = findRhythm(tree)!;
    expect(controls).toMatchObject({ disabled: true, disabledReason: expect.stringContaining("不能调整时值或添加附点"), sustain: true });
    controls.onChange("quarter", 1);
    expect(await ref.current!.setRhythm({ base: "quarter", dots: 1 })).toMatchObject({ status: "blocked" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("requests confirmation for a slur at the source and preserves it on cancel", () => {
    const { tree, session, commit } = setup("first", (measure, track) => {
      const [source] = measure.numberedVoice.events;
      measure.numberedVoice.events[0] = { ...source!, kind: "notes", items: [{ id: "item-first", token: "1" }] };
      track.numberedMarks = [{ id: "source-slur", type: "slur", fromEventId: "first", toEventId: "covered" }];
    });
    const before = session.getState();
    findRhythm(tree)!.onSustain();
    expect(harness.submission!.isBusy()).toBe(true);
    harness.submission!.cancel();
    expect(commit).not.toHaveBeenCalled();
    expect(session.getState().document).toBe(before.document);
    expect(session.getState().history).toBe(before.history);
  });
});
