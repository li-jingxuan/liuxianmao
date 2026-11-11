import { describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "@liuxianmao/lxm-editor";
import {
  createChordEditSession,
  type ChordEditContext,
} from "../components/EditorShell/chords/chord-edit-session";
import { createEditorDraftOwner } from "../components/EditorShell/session/editor-draft-coordinator";
import { captureEditorVersion } from "../components/EditorShell/session/editor-session-version";
import { createEditorSession } from "../stores/editor-store";

const setup = () => {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const owner = createEditorDraftOwner();
  const parent = { name: "C", display: "name" };
  let context: ChordEditContext | null = {
    identity: { owner, generation: owner.generation },
    version: captureEditorVersion(session.getState()),
    targetKey: "measure:1/chord:1",
    parentValue: JSON.stringify(parent),
  };
  const edits = createChordEditSession(() => context);
  const write = vi.fn(() => {
    parent.name = "D";
  });
  return {
    edits,
    owner,
    parent,
    write,
    getContext: () => context!,
    setContext: (next: ChordEditContext | null) => {
      context = next;
    },
  };
};

const staleContexts: {
  name: string;
  change: (context: ChordEditContext) => ChordEditContext | null;
}[] = [
  {
    name: "原输入 owner 被替换，即使 generation 相同",
    change: (context) => ({
      ...context,
      identity: { owner: createEditorDraftOwner(), generation: 0 },
    }),
  },
  {
    name: "原 owner 失效，读取仍返回旧登记 generation",
    change: (context) => {
      context.identity.owner.generation += 1;
      return context;
    },
  },
  {
    name: "原 owner 失效，读取已经返回新登记 generation",
    change: (context) => {
      context.identity.owner.generation += 1;
      return {
        ...context,
        identity: {
          ...context.identity,
          generation: context.identity.owner.generation,
        },
      };
    },
  },
  {
    name: "登记 generation 与原捕获身份不同",
    change: (context) => ({
      ...context,
      identity: {
        ...context.identity,
        generation: context.identity.generation + 1,
      },
    }),
  },
  {
    name: "文档状态版本改变",
    change: (context) => ({
      ...context,
      version: {
        ...context.version,
        stateVersion: context.version.stateVersion + 1,
      },
    }),
  },
  {
    name: "同 ID 文档对象被替换",
    change: (context) => ({
      ...context,
      version: {
        ...context.version,
        document: structuredClone(context.version.document),
      },
    }),
  },
  {
    name: "编辑会话 ID 改变",
    change: (context) => ({
      ...context,
      version: {
        ...context.version,
        sessionId: context.version.sessionId + 1,
      },
    }),
  },
  {
    name: "同 ID 编辑会话版本改变",
    change: (context) => ({
      ...context,
      version: {
        ...context.version,
        sessionVersion: context.version.sessionVersion + 1,
      },
    }),
  },
  {
    name: "父草稿值改变",
    change: (context) => ({ ...context, parentValue: "changed parent" }),
  },
  {
    name: "目标改变",
    change: (context) => ({ ...context, targetKey: "measure:1/chord:2" }),
  },
  { name: "原输入已离开", change: () => null },
];

describe("和弦弹层返回原输入的身份校验", () => {
  it("没有原输入不能打开；已有活动编辑不能被覆盖", () => {
    const { edits, setContext, getContext, write, parent } = setup();
    const original = getContext();
    setContext(null);
    expect(edits.open()).toBeNull();
    setContext(original);
    const id = edits.open()!;
    expect(edits.open()).toBeNull();
    expect(edits.isCurrent(id)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(parent.name).toBe("C");
  });

  it("同一原输入重读上下文后仍可完成，父草稿只回填一次", () => {
    const { edits, getContext, setContext, write, parent } = setup();
    const id = edits.open()!;
    const original = getContext();
    setContext({
      ...original,
      identity: { ...original.identity },
      version: { ...original.version },
    });
    expect(edits.isCurrent(id)).toBe(true);
    expect(parent.name).toBe("C");
    expect(edits.complete(id, write)).toBe(true);
    expect(parent.name).toBe("D");
    expect(edits.isCurrent(id)).toBe(false);
    expect(edits.complete(id, write)).toBe(false);
    expect(write).toHaveBeenCalledOnce();
    expect(edits.open()).not.toBeNull();
  });

  it("稍后绑定读取器不替换已捕获的原输入身份", () => {
    const { getContext, write } = setup();
    const edits = createChordEditSession();
    expect(edits.open()).toBeNull();
    const original = getContext();
    edits.setReader(() => original);
    const id = edits.open()!;
    edits.setReader(() => ({ ...original, version: { ...original.version } }));
    expect(edits.isCurrent(id)).toBe(true);
    edits.setReader(() => ({ ...original, parentValue: "later parent draft" }));
    expect(edits.isCurrent(id)).toBe(false);
    expect(edits.complete(id, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(staleContexts)("$name：旧结果不能写入父草稿", ({ change }) => {
    const { edits, getContext, setContext, write, parent } = setup();
    const id = edits.open()!;
    setContext(change(getContext()));
    expect(edits.isCurrent(id)).toBe(false);
    expect(edits.complete(id, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(parent).toEqual({ name: "C", display: "name" });
  });

  it("旧取消和旧完成不能结束后来打开的新编辑", () => {
    const { edits, write, parent } = setup();
    const first = edits.open()!;
    edits.cancel(first);
    expect(edits.isCurrent(first)).toBe(false);
    expect(parent.name).toBe("C");
    const second = edits.open()!;
    expect(second).not.toBe(first);
    edits.cancel(first);
    expect(edits.complete(first, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(edits.isCurrent(second)).toBe(true);
    expect(edits.complete(second, write)).toBe(true);
    expect(write).toHaveBeenCalledOnce();
  });

  it("拒绝失效结果后释放当前编辑，允许新 generation 重新打开", () => {
    const { edits, owner, getContext, setContext, write } = setup();
    const first = edits.open()!;
    owner.generation += 1;
    expect(edits.complete(first, write)).toBe(false);
    setContext({
      ...getContext(),
      identity: { owner, generation: owner.generation },
    });
    const second = edits.open()!;
    expect(second).not.toBeNull();
    expect(edits.isCurrent(second)).toBe(true);
    expect(edits.complete(second, write)).toBe(true);
    expect(write).toHaveBeenCalledOnce();
  });
});
