import { createContext } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "./editor-store";

/** 界面从最近的会话读取状态，多个宿主挂载点可以维护不同曲谱。 */
export const EditorStoreContext =
  createContext<StoreApi<EditorStoreState> | null>(null);
