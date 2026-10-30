import { createElement, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  parseNumberedSequence,
  type ILXMNumberedEvent,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import {
  NumberedEditor,
  type NumberedEditorController,
  type NumberedEditorDraft,
} from "../components/EditorShell/NumberedEditor";
import { createEditorSession } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";
import type { createNumberedSubmission } from "../components/EditorShell/numbered-submission";

const harness = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  cleanups: [] as (() => void)[],
  submission: null as ReturnType<typeof createNumberedSubmission> | null,
}));

// Publish the controller and submission owner in the existing SSR test environment.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useLayoutEffect: (effect: () => void | (() => void)) =>
    harness.effects.push(effect),
  useImperativeHandle: (
    ref: RefObject<unknown> | null,
    create: () => unknown,
  ) => {
    if (ref) ref.current = create();
  },
}));
vi.mock(
  "../components/EditorShell/numbered-submission",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../components/EditorShell/numbered-submission")
      >();
    return {
      ...original,
      createNumberedSubmission: (
        ...args: Parameters<typeof createNumberedSubmission>
      ) => {
        harness.submission = original.createNumberedSubmission(...args);
        return harness.submission;
      },
    };
  },
);

afterEach(() => {
  harness.cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  harness.effects = [];
  harness.submission = null;
});

const setup = (
  raw: string,
  kind: ILXMNumberedEvent["kind"] | "missing" = "notes",
  mode: "single" | "sequence" = "single",
  tied = false,
) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const first = measure.numberedVoice.events[0]!;
  const original = measure.numberedVoice.events[1]!;
  const event: ILXMNumberedEvent = {
    id: original.id,
    tick: original.tick,
    rhythm: { base: "eighth", dots: 1 },
    ...(kind === "notes"
      ? { kind: "notes", items: [{ id: original.items[0]!.id, token: "1" }] }
      : kind === "rest"
        ? { kind: "rest", items: [{ id: original.items[0]!.id, token: "0" }] }
        : kind === "continuation"
          ? {
              kind: "continuation",
              items: [{ id: original.items[0]!.id, token: "-" }],
            }
          : { kind: "gap", items: [] }),
  };
  measure.numberedVoice.events = kind === "missing" ? [first] : [first, event];
  measure.numberedVoice.tuplets = [];
  measure.lyrics =
    kind !== "notes" && kind !== "gap"
      ? []
      : [{ id: "retained-lyric", eventId: event.id, verse: 1, text: "保留" }];
  track.numberedMarks = tied
    ? [
        {
          id: "clear-tie",
          type: "tie",
          fromItemId: first.items[0]!.id,
          toItemId: event.items[0]!.id,
        },
      ]
    : [];
  const session = createEditorSession(document);
  expect(
    session.getState().document,
    session.getState().errorMessage ?? "valid fixture",
  ).not.toBeNull();
  const commit = vi.fn((operation: ILXMScoreCommand) =>
    session.getState().execute(operation),
  );
  const ref: RefObject<NumberedEditorController | null> = { current: null };
  const initial = event.items.map((item) => item.token).join("+");
  const savedDraft: NumberedEditorDraft = {
    selectedId: kind === "missing" ? "" : event.id,
    start: event.tick,
    end: event.tick + 720,
    raw,
    initial,
    overwrite: true,
    base: event.rhythm.base,
    dots: event.rhythm.dots,
    template: "uniform",
    itemId: event.items[0]?.id ?? "",
    destination: "",
    customRhythms: [],
    ratioIndex: 1,
    itemDraft: initial,
  };
  const html = renderToStaticMarkup(
    createElement(
      EditorStoreContext.Provider,
      { value: { ...session, getInitialState: session.getState } },
      createElement(NumberedEditor, {
        ref,
        document,
        target: {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          ...(kind === "missing"
            ? { tick: event.tick, endTick: event.tick + 720 }
            : { eventId: event.id, itemId: event.items[0]?.id }),
        },
        savedDraft,
        commit,
        onDirty: () => {},
        onInputActive: () => {},
        onPreviewTargetChange: () => {},
        onActivate: () => {},
        onCanApply: () => {},
        onSelectTarget: () => {},
        mode,
        onModeChange: () => {},
        onCancel: () => {},
        getClipboard: () => null,
        copyRange: () => false,
        selectedMarkId: null,
      }),
    ),
  );
  harness.effects.splice(0).forEach((effect) => {
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
  });
  return { ref, commit, session, document, event, html };
};

describe("clearing a single numbered event", () => {
  it.each(["notes", "rest", "continuation"] as const)(
    "blank %s content previews and applies a gap, preserving event time and lyrics",
    async (kind) => {
      const { ref, commit, session, document, event, html } = setup("", kind);
      expect(ref.current!.dirtyGroups).toEqual(["content"]);
      expect(ref.current!.canApply).toBe(true);
      expect(html).toContain("修改预览 · 1 项");
      expect(html).toContain("→ 空白");
      expect(html).not.toContain("简谱音高无效");
      expect(html).toMatch(
        /<button(?![^>]*disabled)[^>]*><span>应用内容<\/span>/,
      );
      expect(await ref.current!.apply()).toMatchObject({ status: "applied" });
      expect(commit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "numbered.event.set",
          trackId: document.score.tracks[0]!.id,
          measureId: document.score.tracks[0]!.measures[0]!.id,
          eventId: event.id,
          tokens: [],
        }),
      );
      expect(commit.mock.calls[0]![0]).not.toHaveProperty("itemId");
      const before = document.score.tracks[0]!.measures[0]!;
      const after = session.getState().document!.score.tracks[0]!.measures[0]!;
      expect(after.numberedVoice.events).toEqual(
        before.numberedVoice.events.map((item) =>
          item.id === event.id ? { ...event, kind: "gap", items: [] } : item,
        ),
      );
      expect(after.lyrics).toEqual(before.lyrics);
      session.getState().undo();
      expect(session.getState().document).toEqual(document);
    },
  );

  it("whitespace clears an existing note", async () => {
    const { ref, commit } = setup(" \n\t ");
    expect(await ref.current!.applyGroup("content")).toMatchObject({
      status: "applied",
    });
    expect(commit.mock.calls[0]![0]).toMatchObject({ tokens: [] });
    expect(commit.mock.calls[0]![0]).not.toHaveProperty("itemId");
  });

  it.each(["", " \n\t "])("an existing gap stays clean for %j", async (raw) => {
    const { ref, commit, session, document, html } = setup(raw, "gap");
    expect(ref.current!.dirty).toBe(false);
    expect(ref.current!.dirtyGroups).toEqual([]);
    expect(html).toMatch(/<button[^>]*disabled[^>]*><span>应用内容<\/span>/);
    expect(await ref.current!.applyGroup("content")).toMatchObject({
      status: "noop",
    });
    expect(commit).not.toHaveBeenCalled();
    expect(session.getState().document).toEqual(document);
  });

  it("a blank unoccupied time range remains a no-op", async () => {
    const { ref, commit, html } = setup("", "missing");
    expect(ref.current!.dirty).toBe(false);
    expect(html).not.toContain("修改预览 ·");
    expect(await ref.current!.apply()).toMatchObject({ status: "noop" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("blank sequence input remains invalid", async () => {
    const { ref, commit, html } = setup("", "notes", "sequence");
    expect(parseNumberedSequence("").ok).toBe(false);
    expect(ref.current!.canApply).toBe(false);
    expect(html).not.toContain("修改预览 ·");
    expect(await ref.current!.applyGroup("content")).toMatchObject({
      status: "blocked",
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("clearing linked notes confirms the impact before submitting without an itemId", async () => {
    const { ref, commit, session, document } = setup(
      "",
      "notes",
      "single",
      true,
    );
    const pending = ref.current!.applyGroup("content");
    expect(harness.submission!.isBusy()).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    harness.submission!.confirm();
    expect(await pending).toMatchObject({ status: "applied" });
    expect(commit.mock.calls[0]![0]).toMatchObject({
      tokens: [],
      confirmedRemovedMarkIds: ["clear-tie"],
    });
    expect(commit.mock.calls[0]![0]).not.toHaveProperty("itemId");
    session.getState().undo();
    expect(session.getState().document).toEqual(document);
  });
});
