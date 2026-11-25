"use client";

export { createEditorSession, type EditorChangeEvent, type EditorErrorEvent, type EditorSession, type EditorSessionOptions } from "./editor-session.js";
export { LxmEditor, LxmEditorFileActions, type LxmEditorFileActionControls, type LxmEditorFileActionsProps, type LxmEditorProps } from "./LxmEditor.js";
export type { EditorHost, EditorHostAction, EditorHostFile, EditorHostResult } from "./editor-host.js";
export type { LxmEditorNavigation, LxmEditorNavigationLinkProps, LxmEditorResources, LxmEditorToolbar, LxmEditorToolbarState } from "./editor-integration.js";

// 宿主可从同一个入口取得工作区、命令与 Core 类型，运行时继续使用同一份 Core 依赖。
export * from "@liuxianmao/lxm-editor";
