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
  type EditorDraftRecord,
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
  useEffect(() => {
    if (!runtime) return;
    const entries = typeof records === "function" ? records() : records;
    const release = entries.map((record) => runtime.drafts.register(record));
    return () => release.forEach((unregister) => unregister());
  }, [runtime, records]);
};
