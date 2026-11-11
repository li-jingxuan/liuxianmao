"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "../../../stores/editor-store";
import {
  createEditorDraftCoordinator,
  createEditorDraftOwner,
  type EditorDraftRecord,
  type EditorDraftRegistration,
} from "./editor-draft-coordinator";
import { createEditorModalController } from "./editor-modal-controller";
import { EditorModalHost } from "./EditorModalHost";

/** 会话只创建一套草稿目录与模态协调器，各编辑表单通过登记参与统一保护。 */
const createRuntime = (session: StoreApi<EditorStoreState>) => ({
  drafts: createEditorDraftCoordinator(session.getState),
  modals: createEditorModalController(session.getState, () => {
    const trigger = document.activeElement;
    const group =
      trigger instanceof HTMLElement
        ? trigger.closest<HTMLElement>("[data-tool-panel]")?.dataset.toolPanel
        : undefined;
    return () => {
      // 弹层关闭时入口可能已因响应式重排而卸载：优先原入口，再找同组工具，
      // 最后回到谱面；不能把焦点交给已隐藏或已移出文档的元素。
      const visible = (element: HTMLElement | null): element is HTMLElement =>
        !!element &&
        element.isConnected &&
        element.getClientRects().length > 0 &&
        !element.closest("[hidden],[inert]");
      const equivalent = group
        ? Array.from(
            document.querySelectorAll<HTMLElement>(
              `[data-tool-trigger="${group}"],[data-tool-trigger="more"]`,
            ),
          ).find(visible)
        : null;
      if (trigger instanceof HTMLElement && visible(trigger))
        trigger.focus({ preventScroll: true });
      else if (equivalent) equivalent.focus({ preventScroll: true });
      else
        document
          .querySelector<SVGSVGElement>('svg[aria-label="六线谱编辑器"]')
          ?.focus();
    };
  }),
});
type EditorRuntime = ReturnType<typeof createRuntime>;
const RuntimeContext = createContext<EditorRuntime | null>(null);

/**
 * 与 EditorShell 共用 session key，普通重排保持实例，替换曲谱时整体重建。
 * 会话版本变化时让模态控制器复核当前请求，防止旧确认覆盖更新后的文档。
 * 调用方应通过上层 EditorSession 的 key 切换会话，而非在此重建第二套运行时。
 */
export const EditorSessionRuntime = ({
  session,
  children,
}: {
  session: StoreApi<EditorStoreState>;
  children: ReactNode;
}) => {
  const [runtime] = useState(() => createRuntime(session));
  useEffect(
    () => session.subscribe(() => runtime.modals.invalidate()),
    [session, runtime],
  );
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
      <EditorModalHost controller={runtime.modals} />
    </RuntimeContext.Provider>
  );
};

export const useEditorRuntime = () => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("编辑工作区必须位于 EditorSessionRuntime 内。");
  return runtime;
};

/**
 * 把表单持有的草稿描述登记到会话目录，不把未应用输入写入 Zustand 文档历史。
 * owner 标识表单实例，generation 标识该实例当前有效的一轮输入；接受离开后
 * 递增代次，旧 render 的 effect 和异步回调就不能重新登记或应用已放弃的草稿。
 * effect 清理只解除本次登记，实际内容及应用/丢弃行为仍由原表单负责。
 */
export const useEditorDraftRecords = (
  records: readonly EditorDraftRecord[] | (() => readonly EditorDraftRecord[]),
) => {
  const runtime = useContext(RuntimeContext);
  const [owner] = useState(createEditorDraftOwner);
  // 在 render 捕获，而非在 effect 执行时读取，防止旧 render 的 effect 迟到登记。
  const generation = owner.generation;
  const [handle] = useState(() => ({
    captureIdentity: (): EditorDraftRegistration => ({
      owner,
      generation: owner.generation,
    }),
    isCurrent: (identity: EditorDraftRegistration) =>
      identity.owner === owner && identity.generation === owner.generation,
    invalidateOwner: () => {
      if (runtime) runtime.drafts.invalidateOwner(owner);
      else owner.generation += 1;
    },
  }));
  useEffect(() => {
    if (!runtime || owner.generation !== generation) return;
    const entries = typeof records === "function" ? records() : records;
    const release = entries.map((record) =>
      runtime.drafts.register(record, { owner, generation }),
    );
    return () => release.forEach((unregister) => unregister());
  }, [runtime, records, owner, generation]);
  return handle;
};
