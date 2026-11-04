import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import {
  createEditorDraftCoordinator,
  type EditorDraftRecord,
} from "../components/EditorShell/editor-draft-coordinator";
import { captureEditorVersion } from "../components/EditorShell/editor-session-version";
import { useEditorDraftRecords } from "../components/EditorShell/EditorSessionRuntime";

const harness = vi.hoisted(() => ({
  runtime: null as {
    drafts: ReturnType<typeof createEditorDraftCoordinator>;
  } | null,
  states: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
}));

// Hold render and passive effects separately so an accepted leave can precede an old effect.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useContext: () => harness.runtime,
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states))
      harness.states[index] =
        typeof initial === "function" ? initial() : initial;
    return [harness.states[index], vi.fn()];
  },
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
  },
}));
vi.mock("../components/EditorShell/EditorModalHost", () => ({
  EditorModalHost: () => null,
}));

beforeEach(() => {
  harness.states = [];
  harness.cursor = 0;
  harness.effects = [];
  harness.runtime = null;
});

const setup = () => {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const drafts = createEditorDraftCoordinator(session.getState);
  harness.runtime = { drafts };
  const record: EditorDraftRecord = {
    id: "text",
    kind: "lyric",
    targetKey: "A",
    label: "歌词",
    dirty: true,
    composing: false,
    canApply: true,
    error: null,
    version: captureEditorVersion(session.getState()),
    focus: () => true,
    apply: () => "applied",
    discard: () => true,
  };
  const useRecords = (
    records:
      | readonly EditorDraftRecord[]
      | (() => readonly EditorDraftRecord[]),
  ) => {
    harness.cursor = 0;
    return useEditorDraftRecords(records);
  };
  return { drafts, record, render: useRecords };
};

describe("当前输入 owner 登记生命周期", () => {
  it("离开立即放行输出；旧 effect 迟到不能重新登记；新 generation 的真实输入继续阻断", () => {
    const { drafts, record, render } = setup();
    const handle = render([record]);
    const lateEffect = harness.effects.shift()!;
    handle.invalidateOwner();
    expect(drafts.isOutputBlocked()).toBe(false);
    const oldCleanup = lateEffect();
    expect(drafts.isOutputBlocked()).toBe(false);
    expect(render(() => [{ ...record, targetKey: "B" }])).toBe(handle);
    const cleanup = harness.effects.shift()!();
    expect(drafts.isOutputBlocked()).toBe(true);
    oldCleanup?.();
    expect(drafts.inspect().pending[0]?.targetKey).toBe("B");
    handle.invalidateOwner();
    expect(drafts.isOutputBlocked()).toBe(false);
    cleanup?.();
  });

  it("StrictMode 的 setup / cleanup / setup 只留下一个登记，旧 cleanup 不清新记录", () => {
    const { drafts, record, render } = setup();
    const handle = render([record]);
    const effect = harness.effects.shift()!;
    const firstCleanup = effect();
    firstCleanup?.();
    const secondCleanup = effect();
    expect(drafts.inspect().pending).toHaveLength(1);
    handle.invalidateOwner();
    render([{ ...record, targetKey: "new" }]);
    harness.effects.shift()!();
    secondCleanup?.();
    expect(drafts.inspect().pending).toHaveLength(1);
    expect(drafts.inspect().pending[0]?.targetKey).toBe("new");
  });
});
