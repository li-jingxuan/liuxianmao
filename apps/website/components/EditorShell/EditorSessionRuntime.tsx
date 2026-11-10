"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "../../stores/editor-store";
import {
  createEditorDraftCoordinator,
  createEditorDraftOwner,
  type EditorDraftRecord,
  type EditorDraftRegistration,
} from "./editor-draft-coordinator";
import { createEditorModalController } from "./editor-modal-controller";
import { EditorModalHost } from "./EditorModalHost";

const createRuntime = (session: StoreApi<EditorStoreState>) => ({
  drafts: createEditorDraftCoordinator(session.getState),
  modals: createEditorModalController(session.getState, () => {
    const trigger = document.activeElement;
    const group =
      trigger instanceof HTMLElement
        ? trigger.closest<HTMLElement>("[data-tool-panel]")?.dataset.toolPanel
        : undefined;
    return () => {
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

/** 与 EditorShell 共用 session key，普通重排保持实例，替换曲谱时整体重建。 */
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

/** 登记在提交后的 effect 中进行；不会把 React 草稿写入 Zustand 文档历史。 */
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
