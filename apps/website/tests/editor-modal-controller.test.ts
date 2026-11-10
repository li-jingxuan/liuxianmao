import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum,
  createCollapsedTabCellSelection,
  getFirstTabCellReference,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import {
  createEditorModalController,
  type EditorModalRequest,
} from "../components/EditorShell/editor-modal-controller";
import { captureEditorVersion } from "../components/EditorShell/editor-session-version";

const setup = () => {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const restore = vi.fn();
  const capture = vi.fn(() => restore);
  const modals = createEditorModalController(session.getState, capture);
  const request = (
    overrides: Partial<
      Extract<EditorModalRequest, { kind: "structure-impact" }>
    > = {},
  ): EditorModalRequest => ({
    kind: "structure-impact",
    title: "结构影响",
    message: "确认修改",
    version: captureEditorVersion(session.getState()),
    confirm: () => true,
    ...overrides,
  });
  return { session, modals, restore, capture, request };
};

describe("统一弹层宿主控制器", () => {
  it("活动请求不能被覆盖，退出动画结束前仍占用宿主且只恢复一次焦点", async () => {
    const { session, modals, restore, capture, request } = setup();
    const onClose = vi.fn();
    const confirm = vi.fn(() => true);
    const id = modals.open(request({ onClose, confirm }))!;
    expect(modals.open(request())).toBeNull();
    expect(capture).toHaveBeenCalledOnce();
    expect(modals.close(id + 1, "cancel")).toBe(false);
    expect(modals.close(id, "cancel")).toBe(true);
    expect(modals.getSnapshot()).toMatchObject({
      id,
      closing: true,
      busy: false,
    });
    expect(modals.isOpen()).toBe(true);
    expect(modals.open(request())).toBeNull();
    expect(await modals.confirm(id)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(modals.close(id, "cancel")).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("cancel");
    expect(session.getState().historyDepth.past).toBe(0);
    expect(restore).not.toHaveBeenCalled();
    modals.restoreFocus(id);
    expect(modals.getSnapshot()).toBeNull();
    expect(modals.isOpen()).toBe(false);
    modals.restoreFocus(id);
    expect(restore).toHaveBeenCalledOnce();
  });

  it("旧弹层的迟到 afterClose 不能释放新的活动或退出中弹层", () => {
    const { modals, restore, request } = setup();
    const first = modals.open(request())!;
    modals.restoreFocus(first);
    expect(modals.getSnapshot()?.id).toBe(first);
    modals.close(first, "cancel");
    expect(modals.open(request())).toBeNull();
    modals.restoreFocus(first + 1);
    expect(restore).not.toHaveBeenCalled();
    modals.restoreFocus(first);
    const second = modals.open(request())!;
    expect(second).not.toBe(first);
    restore.mockClear();
    modals.restoreFocus(first);
    expect(modals.getSnapshot()).toMatchObject({ id: second });
    expect(modals.close(first, "cancel")).toBe(false);
    modals.close(second, "cancel");
    modals.restoreFocus(first);
    expect(modals.getSnapshot()).toMatchObject({ id: second, closing: true });
    expect(modals.isOpen()).toBe(true);
    expect(restore).not.toHaveBeenCalled();
    modals.restoreFocus(second);
    expect(restore).toHaveBeenCalledOnce();
  });

  it("确认中禁止重复提交和取消；失败保留弹层并释放锁", async () => {
    const { modals, request } = setup();
    let finish: ((accepted: boolean) => void) | undefined;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const confirm = vi.fn(() => pending);
    const id = modals.open(request({ confirm }))!;
    const result = modals.confirm(id);
    expect(modals.getSnapshot()?.busy).toBe(true);
    expect(modals.close(id, "cancel")).toBe(false);
    expect(await modals.confirm(id)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    finish!(false);
    expect(await result).toBe(false);
    expect(modals.getSnapshot()).toMatchObject({
      id,
      busy: false,
      error: expect.any(String),
    });
    expect(modals.close(id, "cancel")).toBe(true);
  });

  it("文档改变立即使待确认弹层失效，旧确认不再执行", async () => {
    const { session, modals, request } = setup();
    const confirm = vi.fn(() => true),
      onClose = vi.fn();
    const id = modals.open(request({ confirm, onClose }))!;
    const unsubscribe = session.subscribe(modals.invalidate);
    session.getState().execute({
      type: LXMScoreCommandEnum.SetNotationInfo,
      title: "外部修改",
      arranger: "",
      keySignature: "C",
    });
    expect(modals.getSnapshot()).toMatchObject({ id, closing: true });
    expect(modals.isOpen()).toBe(true);
    expect(onClose).toHaveBeenCalledWith("stale");
    expect(await modals.confirm(id)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    modals.restoreFocus(id);
    expect(modals.isOpen()).toBe(false);
    unsubscribe();
  });

  it("确认自己的成功命令不会被订阅器当成过期，历史仍可整体撤销", async () => {
    const { session, modals, request } = setup();
    const original = session.getState().document;
    const onClose = vi.fn();
    const unsubscribe = session.subscribe(modals.invalidate);
    const id = modals.open(
      request({
        onClose,
        confirm: ({ isCurrent }) => {
          if (!isCurrent()) return false;
          return !!session.getState().execute({
            type: LXMScoreCommandEnum.SetNotationInfo,
            title: "确认成功",
            arranger: "",
            keySignature: "C",
          })?.ok;
        },
      }),
    )!;
    expect(await modals.confirm(id)).toBe(true);
    expect(modals.getSnapshot()).toMatchObject({ id, closing: true });
    expect(onClose).toHaveBeenCalledExactlyOnceWith("resolved");
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toBe(original);
    unsubscribe();
  });

  it("异步确认期间替换同 ID 会话，提交前检查拒绝旧结果", async () => {
    const { session, modals, request } = setup();
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const write = vi.fn(),
      onClose = vi.fn();
    const id = modals.open(
      request({
        onClose,
        confirm: async ({ isCurrent }) => {
          await pending;
          if (!isCurrent()) return false;
          write();
          return true;
        },
      }),
    )!;
    const result = modals.confirm(id);
    session.getState().replaceDocument(EXAMPLE_MVP_7_2_DOCUMENT);
    finish!();
    expect(await result).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith("stale");
  });

  it("抛出异常不关闭确认，未绑定版本的请求不随文档变化失效", async () => {
    const { session, modals, request } = setup();
    const id = modals.open(
      request({
        confirm: () => {
          throw new Error("错误");
        },
      }),
    )!;
    expect(await modals.confirm(id)).toBe(false);
    expect(modals.getSnapshot()).toMatchObject({
      busy: false,
      error: expect.any(String),
    });
    modals.close(id, "cancel");
    modals.restoreFocus(id);
    const unversioned = modals.open({
      kind: "structure-impact",
      title: "结构影响",
      message: "确认修改",
    })!;
    session.getState().replaceDocument(EXAMPLE_MVP_7_2_DOCUMENT);
    modals.invalidate();
    expect(modals.getSnapshot()?.id).toBe(unversioned);
    expect(await modals.confirm(unversioned)).toBe(false);
  });
  it("选区条件改变立即作废类型请求，旧下一步不再交接", () => {
    const { session, modals, request } = setup();
    const before = JSON.stringify(session.getState().selection);
    const id = modals.open(
      request({
        isValid: () => JSON.stringify(session.getState().selection) === before,
      }),
    )!;
    const unsubscribe = session.subscribe(modals.invalidate);
    session
      .getState()
      .setSelection(
        createCollapsedTabCellSelection(
          getFirstTabCellReference(session.getState().document!)!,
        ),
      );
    expect(modals.getSnapshot()).toMatchObject({ id, closing: true });
    expect(modals.close(id, "cancel")).toBe(false);
    unsubscribe();
  });

  it("下一步交接只在动画结束后一次执行，优先于背景焦点恢复", async () => {
    const { modals, restore, request } = setup();
    const handoff = vi.fn(() => true);
    const id = modals.open(request({ afterClose: handoff }))!;
    expect(await modals.confirm(id)).toBe(true);
    expect(handoff).not.toHaveBeenCalled();
    modals.restoreFocus(id);
    modals.restoreFocus(id);
    expect(handoff).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
  });

  it("显式交接在 afterClose 后打开下一弹层，退出期间不能重复交接", () => {
    const { modals, restore, request } = setup();
    const onClose = vi.fn();
    const resolved = vi.fn(() => true);
    const id = modals.open(request({ onClose, afterClose: resolved }))!;
    let nextId: number | null = null;
    const next = vi.fn(() => {
      nextId = modals.open(request());
      return nextId !== null;
    });
    const duplicate = vi.fn(() => true);
    expect(modals.handoff(id, next)).toBe(true);
    expect(onClose).toHaveBeenCalledExactlyOnceWith("handoff");
    expect(modals.getSnapshot()).toMatchObject({ id, closing: true });
    expect(next).not.toHaveBeenCalled();
    expect(modals.handoff(id, duplicate)).toBe(false);
    expect(modals.open(request())).toBeNull();
    modals.restoreFocus(id + 1);
    expect(next).not.toHaveBeenCalled();
    modals.restoreFocus(id);
    expect(next).toHaveBeenCalledOnce();
    expect(nextId).not.toBeNull();
    expect(modals.getSnapshot()?.id).toBe(nextId);
    modals.restoreFocus(id);
    expect(modals.getSnapshot()?.id).toBe(nextId);
    expect(next).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it("取消不会执行已完成交接回调；交接未接收时恢复焦点", () => {
    const { modals, restore, request } = setup();
    const afterClose = vi.fn(() => true);
    const id = modals.open(request({ afterClose }))!;
    modals.close(id, "cancel");
    modals.restoreFocus(id);
    expect(afterClose).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledOnce();
    restore.mockClear();
    const next = vi.fn(() => false);
    const second = modals.open(request())!;
    expect(modals.handoff(second, next)).toBe(true);
    expect(next).not.toHaveBeenCalled();
    modals.restoreFocus(second);
    expect(next).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(modals.isOpen()).toBe(false);
  });

  it("忙碌、过期和错误 ID 的交接不执行回调", async () => {
    const { modals, request } = setup();
    let finish!: (accepted: boolean) => void;
    let valid = true;
    const id = modals.open(
      request({
        isValid: () => valid,
        confirm: () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      }),
    )!;
    const next = vi.fn(() => true);
    expect(modals.handoff(id + 1, next)).toBe(false);
    const pending = modals.confirm(id);
    expect(modals.handoff(id, next)).toBe(false);
    finish(false);
    expect(await pending).toBe(false);
    valid = false;
    expect(modals.handoff(id, next)).toBe(false);
    modals.invalidate();
    modals.restoreFocus(id);
    expect(next).not.toHaveBeenCalled();
  });
});
