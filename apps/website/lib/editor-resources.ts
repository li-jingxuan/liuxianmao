import type { LxmEditorResources } from "@liuxianmao/lxm-editor-react";
import { sitePath } from "./site-path";

/** 网站保留完整木吉他采样和原有图标。资源地址随 Next 部署前缀一起生成。 */
export const websiteEditorResources: LxmEditorResources = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  audioDirectory: sitePath("/assets/audio/meta-steel-guitar-v1"),
  brandIconUrl: sitePath("/assets/brand/liuxianmao-128.png"),
  musicIconBaseUrl: sitePath("/assets/svg/music-controls"),
};
