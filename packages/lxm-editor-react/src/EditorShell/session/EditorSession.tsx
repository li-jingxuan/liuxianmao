"use client";

import { useStore } from "zustand";
import { useRef, type RefObject } from "react";
import type { StoreApi } from "zustand/vanilla";
import { EditorStoreContext } from "../../stores/editor-context";
import type { EditorStoreState } from "../../stores/editor-store";
import { EditorShell } from "..";
import { EditorSessionRuntime } from "./EditorSessionRuntime";
import type { LxmEditorNavigation, LxmEditorResources, LxmEditorToolbar } from "../../editor-integration";
import { EditorResourceProvider } from "../../resources/editor-resources";
import type { EditorHost } from "../../editor-host";
import type { BoundScoreFile } from "../output/use-score-file-flow";

/** 外部替换成功后重建壳：复用 React 清理机制取消延迟输入、指针与侧栏草稿。 */
export const EditorSession = ({
  session,
  navigation,
  resources,
  toolbar,
  host,
  boundFileRef,
}: {
  session: StoreApi<EditorStoreState>;
  host?: EditorHost;
  navigation?: LxmEditorNavigation;
  resources?: LxmEditorResources;
  toolbar?: LxmEditorToolbar;
  boundFileRef?: RefObject<BoundScoreFile | undefined>;
}) => {
  const sessionId = useStore(session, (state) => state.sessionId);
  const version = useStore(session, (state) => state.sessionVersion);
  // 文件绑定来自公开会话。换谱会重建工作区，并用会话身份过滤旧的授权。
  const localFileRef = useRef<BoundScoreFile | undefined>(undefined);
  return (
    <EditorResourceProvider paths={resources}>
      <EditorStoreContext.Provider value={session}>
        <EditorSessionRuntime key={`${sessionId}:${version}`} session={session}>
          <EditorShell navigation={navigation} toolbar={toolbar} host={host} boundFileRef={boundFileRef ?? localFileRef} />
        </EditorSessionRuntime>
      </EditorStoreContext.Provider>
    </EditorResourceProvider>
  );
};
