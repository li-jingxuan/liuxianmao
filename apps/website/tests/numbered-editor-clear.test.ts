import {
  createElement,
  isValidElement,
  type ReactNode,
  type RefObject,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseNumberedSequence,
  type ILXMNumberedEvent,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import {
  NumberedEditor,
  type NumberedEditorController,
} from "../../../packages/lxm-editor-react/src/EditorShell/numbered/NumberedEditor";
import { createEditorSessionStore as createEditorSession } from "../../../packages/lxm-editor-react/src/stores/editor-store";
import { EditorStoreContext } from "../../../packages/lxm-editor-react/src/stores/editor-context";
import type { createNumberedSubmission } from "../../../packages/lxm-editor-react/src/EditorShell/numbered/numbered-submission";

const harness = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  cleanups: [] as (() => void)[],
  submission: null as ReturnType<typeof createNumberedSubmission> | null,
  stateChanges: [] as unknown[],
}));

// Publish the controller and submission owner in the existing SSR test environment.
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useState: (initial: unknown) => {
      const [value, setValue] = original.useState(initial);
      return [
        value,
        (next: unknown) => {
          harness.stateChanges.push(next);
          setValue(next);
        },
      ];
    },
    useLayoutEffect: (effect: () => void | (() => void)) =>
      harness.effects.push(effect),
    useImperativeHandle: (
      ref: RefObject<unknown> | null,
      create: () => unknown,
    ) => {
      if (ref) ref.current = create();
    },
  };
});
vi.mock(
  "../../../packages/lxm-editor-react/src/EditorShell/numbered/numbered-submission",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../../../packages/lxm-editor-react/src/EditorShell/numbered/numbered-submission")
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
  harness.stateChanges = [];
});

const findInput = (
  node: ReactNode,
  label: string,
): {
  onChange: (event: { target: { value: string } }) => void;
} | null => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findInput(child, label);
      if (found) return found;
    }
  } else if (
    isValidElement<{
      "aria-label"?: string;
      children?: ReactNode;
      onChange: (event: { target: { value: string } }) => void;
    }>(node)
  ) {
    if (node.props["aria-label"] === label) return node.props;
    return findInput(node.props.children, label);
  }
  return null;
};

const setup = (
  raw: string,
  kind: ILXMNumberedEvent["kind"] | "missing" = "notes",
  mode: "single" | "sequence" = "single",
  tied = false,
  gapTimeWithOldPreference = false,
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
  if (gapTimeWithOldPreference) session.getState().setNumberedInputRhythm({ base: "quarter", dots: 0 });
  expect(
    session.getState().document,
    session.getState().errorMessage ?? "valid fixture",
  ).not.toBeNull();
  const commit = vi.fn((operation: ILXMScoreCommand) =>
    session.getState().execute(operation),
  );
  const ref: RefObject<NumberedEditorController | null> = { current: null };
  let entered = false;
  // SSR supports render-phase updates: exercise the real field onChange after
  // initialization, retaining its score-derived initial value and baseline.
  const EditorWithInput = (props: Parameters<typeof NumberedEditor>[0]) => {
    harness.effects = [];
    const editor = NumberedEditor(props);
    if (!entered) {
      entered = true;
      findInput(editor, "简谱内容")!.onChange({ target: { value: raw } });
    }
    return editor;
  };
  const html = renderToStaticMarkup(
    createElement(
      EditorStoreContext.Provider,
      { value: { ...session, getInitialState: session.getState } },
      createElement(EditorWithInput, {
        ref,
        document,
        target: {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          ...(kind === "missing" || gapTimeWithOldPreference
            ? { tick: event.tick, endTick: event.tick + 720 }
            : { eventId: event.id, itemId: event.items[0]?.id }),
        },
        commit,
        onDirty: () => {},
        onInputActive: () => {},
        onPreviewTargetChange: () => {},
        onActivate: () => {},
        onCanApply: () => {},
        onSelectTarget: () => {},
        textAdvance: { checked: true, onChange: () => {} },
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
      expect(html).toContain('aria-label="节拍映射预览"');
      expect(html).toContain("→ 空白");
      expect(html).not.toContain("简谱音高无效");
      expect(html).toMatch(
        /<button(?![^>]*disabled)[^>]*aria-label="应用简谱内容"[^>]*>/,
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

  it("primary apply does not advance when clearing, even with advance checked", async () => {
    const { ref } = setup("");
    harness.stateChanges = [];
    expect(await ref.current!.applyContent()).toMatchObject({ status: "applied" });
    expect(harness.stateChanges).not.toContainEqual(expect.objectContaining({ surface: "sidebar" }));
  });

  it.each(["primary", "global"] as const)("only a %s text apply eligible for advance can queue a new target", async (entry) => {
    const { ref } = setup("7");
    harness.stateChanges = [];
    const result = await (entry === "primary" ? ref.current!.applyContent(undefined, "popover") : ref.current!.apply());
    expect(result).toMatchObject({ status: "applied" });
    const advance = expect.objectContaining({ surface: "popover", target: expect.objectContaining({ kind: "numbered" }) });
    if (entry === "primary") expect(harness.stateChanges).toContainEqual(advance);
    else expect(harness.stateChanges).not.toContainEqual(advance);
  });

  it.each(["", " \n\t "])("an existing gap stays clean for %j", async (raw) => {
    const { ref, commit, session, document, html } = setup(raw, "gap");
    expect(ref.current!.dirty).toBe(false);
    expect(ref.current!.dirtyGroups).toEqual([]);
    expect(html.match(/<button[^>]*aria-label="应用简谱内容"[^>]*>/)?.[0]).toContain("disabled");
    expect(await ref.current!.applyGroup("content")).toMatchObject({
      status: "noop",
    });
    expect(commit).not.toHaveBeenCalled();
    expect(session.getState().document).toEqual(document);
  });

  it("a blank unoccupied time range remains a no-op", async () => {
    const { ref, commit, html } = setup("", "missing");
    expect(ref.current!.dirty).toBe(false);
    expect(html).not.toContain('aria-label="节拍映射预览"');
    expect(await ref.current!.apply()).toMatchObject({ status: "noop" });
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(["single", "sequence"] as const)("an exact gap time target keeps saved rhythm despite an old preference in %s mode", async (mode) => {
    const { ref, session, event, document } = setup("7", "gap", mode, false, true);
    expect(ref.current!.dirty).toBe(true);
    const result = await ref.current!.applyGroup("content");
    expect(result.status).toBe("applied");
    const measure = session.getState().document!.score.tracks[0]!.measures[0]!;
    expect(measure.numberedVoice.events.find(item => item.id === event.id)).toMatchObject({
      kind: "notes", tick: event.tick, rhythm: { base: "eighth", dots: 1 },
      items: [{ token: "7" }],
    });
    expect(measure.lyrics).toEqual(document.score.tracks[0]!.measures[0]!.lyrics);
    expect(measure.beats).toEqual(document.score.tracks[0]!.measures[0]!.beats);
  });

  it.each(["", "　 ", " \n\t "])("blank sequence %j clears the current event without moving later events", async (raw) => {
    const { ref, commit, html, session, event, document } = setup(raw, "notes", "sequence");
    expect(parseNumberedSequence("").ok).toBe(false);
    expect(ref.current!.canApply).toBe(true);
    expect(html).not.toContain("简谱输入错误");
    expect(await ref.current!.applyGroup("content")).toMatchObject({
      status: "applied",
    });
    expect(commit.mock.calls[0]![0]).toMatchObject({ type: "numbered.event.set", eventId: event.id, tokens: [] });
    const before = document.score.tracks[0]!.measures[0]!;
    const after = session.getState().document!.score.tracks[0]!.measures[0]!;
    expect(after.numberedVoice.events).toEqual(before.numberedVoice.events.map(item => item.id === event.id ? { ...event, kind: "gap", items: [] } : item));
    expect(after.lyrics).toEqual(before.lyrics);
    session.getState().undo();
    expect(session.getState().document).toEqual(document);
    session.getState().redo();
    expect(session.getState().document!.score.tracks[0]!.measures[0]!.numberedVoice.events.find(item => item.id === event.id)?.kind).toBe("gap");
  });

  it("invalid sequence uses the concise error and cannot submit", async () => {
    const { ref, commit, html } = setup("8", "notes", "sequence");
    expect(html).toContain("简谱输入错误");
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain("每批须有有效简谱");
    expect(ref.current!.canApply).toBe(false);
    expect(await ref.current!.applyGroup("content")).toMatchObject({ status: "blocked" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("blank sequence at an existing gap creates no history", async () => {
    const { ref, commit, html } = setup("　", "gap", "sequence");
    expect(ref.current!.dirty).toBe(false);
    expect(html).not.toContain("简谱输入错误");
    expect(await ref.current!.applyGroup("content")).toMatchObject({ status: "noop" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("clearing linked notes confirms the impact before submitting without an itemId", async () => {
    const { ref, commit, session, document } = setup(
      "",
      "notes",
      "single",
      true,
    );
    harness.stateChanges = [];
    const applyCurrent = ref.current!.apply;
    const pending = applyCurrent();
    expect(harness.submission!.isBusy()).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    harness.submission!.confirm();
    expect(await pending).toMatchObject({ status: "applied" });
    expect(
      harness.stateChanges.some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "kind" in value &&
          value.kind === "numbered",
      ),
    ).toBe(false);
    expect(commit.mock.calls[0]![0]).toMatchObject({
      tokens: [],
      confirmedRemovedMarkIds: ["clear-tie"],
    });
    expect(commit.mock.calls[0]![0]).not.toHaveProperty("itemId");
    session.getState().undo();
    expect(session.getState().document).toEqual(document);
  });
});
