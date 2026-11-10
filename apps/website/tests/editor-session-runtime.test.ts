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
  it("同一 owner 的身份跨重绘有效，失效后仅新 generation 可以接收结果", () => {
    const { drafts, record, render } = setup();
    const handle = render([record]);
    const identity = handle.captureIdentity();
    expect(handle.isCurrent(identity)).toBe(true);
    expect(render([{ ...record, targetKey: "B" }])).toBe(handle);
    expect(handle.isCurrent(identity)).toBe(true);
    handle.invalidateOwner();
    expect(handle.isCurrent(identity)).toBe(false);
    const next = handle.captureIdentity();
    expect(next.owner).toBe(identity.owner);
    expect(next.generation).toBe(identity.generation + 1);
    expect(handle.isCurrent(next)).toBe(true);
    handle.invalidateOwner();
    expect(handle.isCurrent(next)).toBe(false);
    expect(drafts.isOutputBlocked()).toBe(false);
  });

  it("generation 相同的其他 owner 身份不能用于当前输入", () => {
    const first = setup();
    const firstHandle = first.render([first.record]);
    const firstIdentity = firstHandle.captureIdentity();
    harness.states = [];
    const second = setup();
    const secondHandle = second.render([second.record]);
    const secondIdentity = secondHandle.captureIdentity();
    expect(firstIdentity.generation).toBe(secondIdentity.generation);
    expect(secondHandle.isCurrent(firstIdentity)).toBe(false);
    expect(firstHandle.isCurrent(secondIdentity)).toBe(false);
    expect(firstHandle.isCurrent(firstIdentity)).toBe(true);
    expect(secondHandle.isCurrent(secondIdentity)).toBe(true);
  });

  it("没有 runtime 时离开仍递增身份 generation，拒绝旧结果", () => {
    const { record, render } = setup();
    harness.runtime = null;
    const handle = render([record]);
    const identity = handle.captureIdentity();
    handle.invalidateOwner();
    expect(handle.isCurrent(identity)).toBe(false);
    const next = handle.captureIdentity();
    expect(next.owner).toBe(identity.owner);
    expect(next.generation).toBe(identity.generation + 1);
    expect(handle.isCurrent(next)).toBe(true);
  });

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
