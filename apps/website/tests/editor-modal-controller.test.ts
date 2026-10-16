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
      Extract<
        EditorModalRequest,
        { kind: "keyboard-help" | "structure-impact" }
      >
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
  it("活动请求不能被覆盖，取消不写历史且动画结束后只恢复一次焦点", () => {
    const { session, modals, restore, capture, request } = setup();
    const onClose = vi.fn();
    const id = modals.open(request({ onClose }))!;
    expect(modals.open(request())).toBeNull();
    expect(capture).toHaveBeenCalledOnce();
    expect(modals.close(id + 1, "cancel")).toBe(false);
    expect(modals.close(id, "cancel")).toBe(true);
    expect(onClose).toHaveBeenCalledWith("cancel");
    expect(session.getState().historyDepth.past).toBe(0);
    expect(restore).not.toHaveBeenCalled();
    modals.restoreFocus();
    modals.restoreFocus();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("退出动画中打开新弹层时，不把焦点恢复到背景", () => {
    const { modals, restore, request } = setup();
    const first = modals.open(request())!;
    modals.close(first, "cancel");
    const second = modals.open(request())!;
    modals.restoreFocus();
    expect(restore).not.toHaveBeenCalled();
    expect(modals.close(first, "cancel")).toBe(false);
    modals.close(second, "cancel");
    modals.restoreFocus();
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
    expect(modals.getSnapshot()).toBeNull();
    expect(onClose).toHaveBeenCalledWith("stale");
    expect(await modals.confirm(id)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
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

  it("抛出异常不关闭确认，帮助弹层不绑定音乐版本", async () => {
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
    const help = modals.open({
      kind: "keyboard-help",
      title: "帮助",
      message: "快捷键",
    })!;
    session.getState().replaceDocument(EXAMPLE_MVP_7_2_DOCUMENT);
    modals.invalidate();
    expect(modals.getSnapshot()?.id).toBe(help);
    expect(await modals.confirm(help)).toBe(false);
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
    expect(modals.getSnapshot()).toBeNull();
    expect(modals.close(id, "cancel")).toBe(false);
    unsubscribe();
  });

  it("下一步交接只在动画结束后一次执行，优先于背景焦点恢复", async () => {
    const { modals, restore, request } = setup();
    const handoff = vi.fn(() => true);
    const id = modals.open(request({ afterClose: handoff }))!;
    expect(await modals.confirm(id)).toBe(true);
    expect(handoff).not.toHaveBeenCalled();
    modals.restoreFocus();
    modals.restoreFocus();
    expect(handoff).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
  });
});
