"use client";

import { ConfigProvider, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { EditorSession as EditorSessionView } from "./EditorShell/session/EditorSession";
import { ScoreFilePanels } from "./EditorShell/output/ScoreFilePanels";
import { useScoreFileFlow } from "./EditorShell/output/use-score-file-flow";
import { getEditorSessionStore, type EditorSession } from "./editor-session.js";
import type { LxmEditorNavigation, LxmEditorResources, LxmEditorToolbar } from "./editor-integration.js";

// 保留工作区既有色彩和 Ant Design 控件密度。配置仅作用于编辑器子树和它打开的 Portal。
const editorTheme = {
  components: {
    Radio: { buttonSolidCheckedBg: "#F0F7FF", buttonSolidCheckedColor: "#285BE0", buttonSolidCheckedHoverBg: "#E7F0FE", buttonSolidCheckedActiveBg: "#DFEAFD" },
    Form: { itemMarginBottom: 16, labelColor: "#626E82", labelFontSize: 13 },
  },
  token: {
    colorPrimary: "#285BE0", colorText: "#202838", colorTextSecondary: "#626E82",
    colorSuccess: "#19734F", colorWarning: "#92600C", colorError: "#BC3547",
    colorBgLayout: "#F4F6FA", colorBgContainer: "#FFFFFF", colorBorder: "#8995A8", colorBorderSecondary: "#DCE2EC",
    fontFamily: '"PingFang SC", "Microsoft YaHei", Arial, sans-serif', fontSize: 13,
    borderRadius: 6, controlHeight: 32, controlHeightSM: 24, controlHeightLG: 40,
  },
} satisfies ThemeConfig;

export interface LxmEditorProps {
  session: EditorSession;
  toolbar?: LxmEditorToolbar;
  navigation?: LxmEditorNavigation;
  resources?: LxmEditorResources;
}

/** 工作区为句柄对应的已存在会话构建界面。卸载界面后，宿主仍能通过句柄访问曲谱和历史。 */
export function LxmEditor({ session, ...props }: LxmEditorProps) {
  const store = getEditorSessionStore(session);
  return <ConfigProvider locale={zhCN} theme={editorTheme}>
    <EditorSessionView session={store} {...props} />
  </ConfigProvider>;
}

export interface LxmEditorFileActionControls {
  newScore(trigger: HTMLElement | null): void;
  importScore(trigger: HTMLElement | null): void;
  notice: string | null;
}

export interface LxmEditorFileActionsProps {
  session: EditorSession;
  onReplacement?: () => void;
  children: (controls: LxmEditorFileActionControls) => ReactNode;
}

/** 宿主可在工作区外打开原有文件面板，例如首页建谱成功后再路由到编辑页。 */
export function LxmEditorFileActions({ session, onReplacement, children }: LxmEditorFileActionsProps) {
  const store = getEditorSessionStore(session);
  const sessionId = useStore(store, (state) => state.sessionId);
  // 会话句柄变了就关闭旧对话框，避免旧文件预览把谱写入另一份会话。
  return <FileActions key={sessionId} session={session} onReplacement={onReplacement}>{children}</FileActions>;
}

function FileActions({ session, onReplacement, children }: LxmEditorFileActionsProps) {
  const store = getEditorSessionStore(session);
  const document = useStore(store, (state) => state.document);
  const flow = useScoreFileFlow({ session: store, onReplacement });
  return <>
    {children({ newScore: (trigger) => flow.showPanel("new", trigger), importScore: (trigger) => flow.showPanel("import", trigger), notice: flow.notice || null })}
    <ConfigProvider locale={zhCN} theme={editorTheme}>
      <ScoreFilePanels flow={flow} session={store} document={document} />
    </ConfigProvider>
  </>;
}
