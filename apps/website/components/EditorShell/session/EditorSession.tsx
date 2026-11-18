"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { EditorStoreContext } from "../../../stores/editor-context";
import type { EditorStoreState } from "../../../stores/editor-store";
import { EditorShell } from "..";
import { EditorSessionRuntime } from "./EditorSessionRuntime";

/** 外部替换成功后重建壳：复用 React 清理机制取消延迟输入、指针与侧栏草稿。 */
export const EditorSession = ({
  session,
  navigate,
}: {
  session: StoreApi<EditorStoreState>;
  navigate?: (destination: string) => void;
}) => {
  const sessionId = useStore(session, (state) => state.sessionId);
  const version = useStore(session, (state) => state.sessionVersion);
  return (
    <EditorStoreContext.Provider value={session}>
      <EditorSessionRuntime key={`${sessionId}:${version}`} session={session}>
        <EditorShell navigate={navigate} />
      </EditorSessionRuntime>
    </EditorStoreContext.Provider>
  );
};
