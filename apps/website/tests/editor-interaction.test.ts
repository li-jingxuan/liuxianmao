import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDeferredFretDraftCommit,
  resolveBeatKindShortcut,
  resolveEditorHistoryShortcut,
} from "../components/EditorShell/editor-interaction";

describe("editor interaction", () => {
  afterEach(() => vi.useRealTimers());

  it("只在对应历史可用时解析撤销和重做快捷键", () => {
    expect(
      resolveEditorHistoryShortcut(
        { key: "z", metaKey: true, ctrlKey: false, shiftKey: false },
        { canUndo: true, canRedo: false },
      ),
    ).toBe("undo");
    expect(
      resolveEditorHistoryShortcut(
        { key: "Z", metaKey: false, ctrlKey: true, shiftKey: true },
        { canUndo: false, canRedo: true },
      ),
    ).toBe("redo");
    expect(
      resolveEditorHistoryShortcut(
        { key: "y", metaKey: false, ctrlKey: true, shiftKey: false },
        { canUndo: false, canRedo: true },
      ),
    ).toBe("redo");
    expect(
      resolveEditorHistoryShortcut(
        { key: "z", metaKey: true, ctrlKey: false, shiftKey: false },
        { canUndo: false, canRedo: false },
      ),
    ).toBeNull();
  });

  it("解析 R 与 Shift+R，并保留带系统修饰键的快捷键", () => {
    const base = { metaKey: false, ctrlKey: false, altKey: false };
    expect(
      resolveBeatKindShortcut({ ...base, key: "r", shiftKey: false }),
    ).toBe("setRest");
    expect(resolveBeatKindShortcut({ ...base, key: "R", shiftKey: true })).toBe(
      "unsetRest",
    );
    expect(
      resolveBeatKindShortcut({
        ...base,
        key: "r",
        shiftKey: false,
        metaKey: true,
      }),
    ).toBeNull();
    expect(
      resolveBeatKindShortcut({
        ...base,
        key: "r",
        shiftKey: false,
        altKey: true,
      }),
    ).toBeNull();
  });

  it("取消后不会提交已经等待中的品位草稿", () => {
    vi.useFakeTimers();
    const deferred = createDeferredFretDraftCommit(600);
    const commit = vi.fn();

    deferred.schedule("1", commit);
    deferred.cancel();
    vi.advanceTimersByTime(600);

    expect(commit).not.toHaveBeenCalled();
  });

  it("重新调度时只提交最后一份品位草稿", () => {
    vi.useFakeTimers();
    const deferred = createDeferredFretDraftCommit(600);
    const commit = vi.fn();

    deferred.schedule("1", commit);
    deferred.schedule("12", commit);
    vi.advanceTimersByTime(600);

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith("12");
  });
});

// X 不接管系统组合键和输入法候选，大小写键共用闷音语义。
describe("闷音快捷键", () => {
  it("仅非组合输入的 x/X 生效", async () => {
    const { resolveMutedNoteShortcut } =
      await import("../components/EditorShell/editor-interaction");
    const input = {
      key: "x",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
    };
    expect(resolveMutedNoteShortcut(input)).toBe(true);
    expect(
      resolveMutedNoteShortcut({ ...input, key: "X", shiftKey: true }),
    ).toBe(true);
    for (const flag of ["metaKey", "ctrlKey", "altKey", "isComposing"] as const)
      expect(resolveMutedNoteShortcut({ ...input, [flag]: true })).toBe(false);
    expect(resolveMutedNoteShortcut({ ...input, key: "r" })).toBe(false);
  });
});
