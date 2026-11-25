import type {
  DocumentLoadResult,
  ILXMApplyScoreCommandResult,
  ILXMCommandEffect,
  ILXMDocument,
  ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import { createEditorSessionStore } from "./stores/editor-store";

export interface EditorChangeEvent {
  /** 已提交的当前快照。宿主应按不可变数据读取，可复制后另行修改。 */
  readonly document: ILXMDocument;
  readonly reason: "command" | "undo" | "redo" | "replace";
  readonly command?: ILXMScoreCommand;
  readonly effects: readonly ILXMCommandEffect[];
}

export interface EditorErrorEvent {
  readonly message: string;
}

export interface EditorSessionOptions {
  onChange?: (event: EditorChangeEvent) => void;
  /** 也接收工厂校验初始文档时的错误。 */
  onError?: (event: EditorErrorEvent) => void;
}

export interface EditorSession {
  /** 同一份已提交快照保持引用稳定，可直接作为 useSyncExternalStore 的读取函数。 */
  getDocument(): ILXMDocument | null;
  execute(command: ILXMScoreCommand): ILXMApplyScoreCommandResult | null;
  undo(): void;
  redo(): void;
  replaceDocument(input: unknown): DocumentLoadResult;
  on(event: "change", listener: (event: EditorChangeEvent) => void): () => void;
  on(event: "error", listener: (event: EditorErrorEvent) => void): () => void;
}

type ChangeListener = (event: EditorChangeEvent) => void;
type ErrorListener = (event: EditorErrorEvent) => void;

// 一个公开句柄只对应一个 store。WeakMap 键跟随句柄回收，工作区和外置文件入口共享同一份状态。
const sessionStores = new WeakMap<EditorSession, ReturnType<typeof createEditorSessionStore>>();

/** @internal 仅供源码内部与仓库测试使用，包导出不提供取出 StoreApi 的入口。 */
export function getEditorSessionStore(session: EditorSession) {
  const store = sessionStores.get(session);
  if (!store) throw new Error("请使用当前编辑器包的 createEditorSession 创建会话。");
  return store;
}

/** 校验宿主文档并创建独立会话，可在挂载组件前调用。省略文档时显示新建和导入入口。 */
export function createEditorSession(input?: unknown, options: EditorSessionOptions = {}): EditorSession {
  const changes = new Set<ChangeListener>();
  const errors = new Set<ErrorListener>();
  if (options.onChange) changes.add(options.onChange);
  if (options.onError) errors.add(options.onError);

  const publishError = (event: EditorErrorEvent) => {
    for (const listener of [...errors]) {
      try { listener(event); } catch { /* 避免错误监听器异常中断其他订阅或触发递归上报。 */ }
    }
  };
  const publishChange = (event: EditorChangeEvent) => {
    let failed = false;
    for (const listener of [...changes]) {
      try { listener(event); } catch { failed = true; }
    }
    // Zustand 已完成提交，监听器异常统一由 store 错误入口报告，并保留当前文档和历史。
    if (failed) throw new Error("宿主接收编辑结果失败，编辑结果已保留。");
  };

  const store = createEditorSessionStore(input, { onChange: publishChange, onError: publishError,
    onReplace: (document) => publishChange({ document, reason: "replace", effects: [] }),
  });

  function on(event: "change", listener: ChangeListener): () => void;
  function on(event: "error", listener: ErrorListener): () => void;
  function on(event: "change" | "error", listener: ChangeListener | ErrorListener): () => void {
    // 每次注册独立处理，同一个回调可以被多个组件各自订阅和取消。
    if (event === "change") {
      const callback: ChangeListener = (value) => (listener as ChangeListener)(value);
      changes.add(callback);
      return () => { changes.delete(callback); };
    }
    const callback: ErrorListener = (value) => (listener as ErrorListener)(value);
    errors.add(callback);
    return () => { errors.delete(callback); };
  }

  const session: EditorSession = Object.freeze({
    getDocument: () => store.getState().document,
    execute: (command: ILXMScoreCommand) => store.getState().execute(command),
    undo: () => store.getState().undo(),
    redo: () => store.getState().redo(),
    replaceDocument: (next: unknown) => store.getState().replaceDocument(next),
    on,
  });
  sessionStores.set(session, store);
  return session;
}
