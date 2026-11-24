"use client";

import { createEditorSession } from "@liuxianmao/lxm-editor-react";
import { DEFAULT_MOCK_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";

/** 首页的新建和导入成功后会跳转到 /editor。网站持有同一会话，确保路由切换不会重建曲谱或历史。 */
export const websiteEditorSession = createEditorSession(DEFAULT_MOCK_DOCUMENT);

/** 确认放弃网站编辑内容后恢复本站示例。通用组件的空会话与默认谱由接入方决定。 */
export function resetWebsiteEditorSession() {
  websiteEditorSession.replaceDocument(DEFAULT_MOCK_DOCUMENT);
}
