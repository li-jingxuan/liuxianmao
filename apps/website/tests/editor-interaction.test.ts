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
