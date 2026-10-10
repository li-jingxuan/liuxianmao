import { createContext } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "./editor-store";

/** 提供会话实例，旧首页在未提供上下文时仍使用默认会话。 */
export const EditorStoreContext =
  createContext<StoreApi<EditorStoreState> | null>(null);
