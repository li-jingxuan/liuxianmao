import {
  sameEditorSession,
  sameEditorVersion,
  type EditorSessionVersion,
} from "./editor-session-version";

type CloseReason = "cancel" | "resolved" | "stale";
export interface EditorModalRequest {
  kind: "keyboard-help" | "structure-impact";
  title: string;
  message: string;
  version?: EditorSessionVersion;
  confirm?: (context: {
    isCurrent: () => boolean;
  }) => boolean | Promise<boolean>;
  onClose?: (reason: CloseReason) => void;
}
export interface EditorModalState {
  id: number;
  request: EditorModalRequest;
  busy: boolean;
  error: string | null;
}

/** 弹层只协调版本、忙碌锁和焦点；领域命令由请求方提交。 */
export const createEditorModalController = (
  getVersion: () => EditorSessionVersion,
  captureFocus: () => () => void,
) => {
  let current: EditorModalState | null = null;
  let sequence = 0;
  let restoreFocus: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const close = (id: number, reason: CloseReason): boolean => {
    if (!current || current.id !== id || (current.busy && reason === "cancel"))
      return false;
    const previous = current;
    current = null;
    publish();
    previous.request.onClose?.(reason);
    return true;
  };
  const isCurrent = (state: EditorModalState) =>
    current?.id === state.id &&
    (!state.request.version ||
      sameEditorVersion(getVersion(), state.request.version));
  return {
    open(request: EditorModalRequest): number | null {
      // 一次只展示一个请求，不能覆盖另一个工具仍等待确认的操作。
      if (current) return null;
      restoreFocus = captureFocus();
      current = { id: ++sequence, request, busy: false, error: null };
      publish();
      return current.id;
    },
    close,
    async confirm(id: number) {
      if (
        !current ||
        current.id !== id ||
        current.busy ||
        !current.request.confirm
      )
        return false;
      const state = current;
      const confirm = state.request.confirm!;
      if (!isCurrent(state)) {
        close(id, "stale");
        return false;
      }
      current = { ...state, busy: true, error: null };
      publish();
      try {
        const accepted = await confirm({ isCurrent: () => isCurrent(state) });
        if (current?.id !== id) return false;
        if (
          state.request.version &&
          !sameEditorSession(getVersion(), state.request.version)
        ) {
          close(id, "stale");
          return false;
        }
        if (accepted) return close(id, "resolved");
        current = {
          ...state,
          busy: false,
          error: "修改尚未提交，请检查当前条件。",
        };
        if (!isCurrent(state)) close(id, "stale");
        else publish();
      } catch {
        if (current?.id === id) {
          current = {
            ...state,
            busy: false,
            error: "操作失败，请重试或取消。",
          };
          if (!isCurrent(state)) close(id, "stale");
          else publish();
        }
      }
      return false;
    },
    invalidate() {
      // 确认中的同步命令会产生自己的新版本，由 confirm 的结果决定关闭原因。
      if (current && !current.busy && !isCurrent(current))
        close(current.id, "stale");
    },
    restoreFocus() {
      // 等退出动画结束再恢复；此时若已有新弹层，不能把焦点带回背景。
      if (current) return;
      const restore = restoreFocus;
      restoreFocus = null;
      restore?.();
    },
    isOpen: () => current !== null,
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
export type EditorModalController = ReturnType<
  typeof createEditorModalController
>;
