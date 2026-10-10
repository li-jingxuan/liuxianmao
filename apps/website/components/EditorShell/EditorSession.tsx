"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { EditorStoreContext } from "../../stores/editor-context";
import type { EditorStoreState } from "../../stores/editor-store";
import { EditorShell } from ".";

/** 外部替换成功后重建壳：复用 React 清理机制取消延迟输入、指针与侧栏草稿。 */
export const EditorSession = ({
  session,
}: {
  session: StoreApi<EditorStoreState>;
}) => {
  const sessionId = useStore(session, (state) => state.sessionId);
  const version = useStore(session, (state) => state.sessionVersion);
  return (
    <EditorStoreContext.Provider value={session}>
      <EditorShell key={`${sessionId}:${version}`} />
    </EditorStoreContext.Provider>
  );
};
