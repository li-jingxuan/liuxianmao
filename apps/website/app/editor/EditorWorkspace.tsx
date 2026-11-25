"use client";

import { LxmEditor } from "@liuxianmao/lxm-editor-react";
import Link from "next/link";
import { websiteEditorResources } from "../../lib/editor-resources";
import { resetWebsiteEditorSession, websiteEditorSession } from "../website-editor-session";

export function EditorWorkspace({ navigate }: { navigate?: (destination: string) => void }) {
  return (
    <LxmEditor
      fullPage
      session={websiteEditorSession}
      resources={websiteEditorResources}
      navigation={{
        homeHref: "/",
        learningHref: "/guitar-advanced",
        onNavigate: navigate,
        onDiscard: resetWebsiteEditorSession,
        // 交由 Next Link 处理 basePath、修饰键打开和客户端导航，编辑器会话继续负责离开确认。
        renderLink: (props) => <Link {...props} />,
      }}
    />
  );
}
