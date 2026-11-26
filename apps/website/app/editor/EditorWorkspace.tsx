"use client";

import { LxmEditor } from "@liuxianmao/lxm-editor-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { websiteEditorResources } from "../../lib/editor-resources";
import { resetWebsiteEditorSession, websiteEditorSession } from "../website-editor-session";

export function EditorWorkspace({ learningOpen }: { learningOpen: boolean }) {
  const router = useRouter();
  return (
    <LxmEditor
      fullPage
      session={websiteEditorSession}
      resources={websiteEditorResources}
      navigation={{
        homeHref: "/",
        // 只在显式开启本地进阶预览时声明入口，公共写谱工作台仍使用同一会话和退出确认。
        learningHref: learningOpen ? "/guitar-advanced" : undefined,
        onNavigate: router.push,
        onDiscard: resetWebsiteEditorSession,
        // 交由 Next Link 处理 basePath、修饰键打开和客户端导航，编辑器会话继续负责离开确认。
        renderLink: (props) => <Link {...props} />,
      }}
    />
  );
}
