"use client";

import { createEditorSession } from "@liuxianmao/lxm-editor-react";
import publicSample from "../../../packages/lxm-editor/example/default-score.lxm.json";

// 生产客户端只内置自有样谱。将原《理想》载入留在非生产分支，Webpack 可在编译时去掉这项依赖，
// 因此即使公共编辑器开放或访客直接请求静态 JS，也不会随初始化会话公开谱例。
const initialDocument: unknown = process.env.NODE_ENV === "production" ? publicSample :
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../../packages/lxm-editor/example/ideal-score.lxm.json");

/** 首页的新建和导入成功后会跳转到 /editor。网站持有同一会话，确保路由切换不会重建曲谱或历史。 */
export const websiteEditorSession = createEditorSession(initialDocument);

/** 确认放弃网站编辑内容后恢复本站示例。通用组件的空会话与默认谱由接入方决定。 */
export function resetWebsiteEditorSession() {
  websiteEditorSession.replaceDocument(initialDocument);
}
