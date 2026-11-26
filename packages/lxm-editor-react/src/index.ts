"use client";

export { createEditorSession, type EditorChangeEvent, type EditorErrorEvent, type EditorSession, type EditorSessionDocumentSource, type EditorSessionOptions } from "./editor-session.js";
export { LxmEditor, LxmEditorFileActions, type LxmEditorFileActionControls, type LxmEditorFileActionsProps, type LxmEditorProps } from "./LxmEditor.js";
export type { EditorHost, EditorHostAction, EditorHostFile, EditorHostResult } from "./editor-host.js";
export type { LxmEditorNavigation, LxmEditorNavigationLinkProps, LxmEditorResources, LxmEditorToolbar, LxmEditorToolbarState } from "./editor-integration.js";

// 桌面谱库沿用工作区文件预检与默认建谱规则，避免出现只在首页可导入的谱或不一致的初始小节。
export { decodeScoreFile } from "./EditorShell/output/score-file";
export { createBlankScore } from "./EditorShell/output/new-score";

// 宿主可从同一个入口取得工作区、命令与 Core 类型，运行时继续使用同一份 Core 依赖。
export * from "@liuxianmao/lxm-editor";
