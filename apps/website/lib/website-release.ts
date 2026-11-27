const isDevelopment = process.env.NODE_ENV === "development";

export const webReleaseNotice = "浏览器写谱工作台的正式开放时间待确认。";

// 发布配置仅从服务端环境读取。没有显式确认时，生产站的入口与直接请求都关闭。
export function isWebEditorOpen() {
  return isDevelopment || process.env.LXM_WEBSITE_WEB_EDITOR === "1";
}

// 本地默认开放吉他进阶，显式设置 0 可关闭入口和所有子页面。生产始终关闭此功能。
export function isGuitarAdvancedOpen() {
  return isDevelopment && process.env.LXM_WEBSITE_INTERNAL_PREVIEW !== "0";
}

// 技巧验收页仍需在本地显式打开，避免随吉他进阶入口一起开放。
export function isInternalPreviewOpen() {
  return isDevelopment && process.env.LXM_WEBSITE_INTERNAL_PREVIEW === "1";
}

// 开关同时控制页面图片与受控资源地址，避免仅移除链接后原图仍能直接访问。
export function isIdealPreviewOpen() {
  const setting = process.env.LXM_WEBSITE_IDEAL_PREVIEW;
  return setting === "1" || (isDevelopment && setting !== "0");
}

function readDownloadUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    // 无效值保持待发布说明，避免给访客展示无法打开的安装包入口。
  }
  return undefined;
}

export function readWebsiteRelease() {
  return {
    webEditor: isWebEditorOpen(),
    guitarAdvanced: isGuitarAdvancedOpen(),
    idealPreview: isIdealPreviewOpen(),
    macDownload: readDownloadUrl(process.env.LXM_WEBSITE_MAC_DOWNLOAD_URL),
    windowsDownload: readDownloadUrl(process.env.LXM_WEBSITE_WINDOWS_DOWNLOAD_URL),
    // 默认展示已核准的网站备案号（含网站序号），并保留部署环境显式覆盖的能力。
    icpNumber: process.env.LXM_WEBSITE_ICP_NUMBER?.trim() ?? "湘ICP备2026058082号-1",
    // 与项目远端和部署文档一致，并通过 GitHub 匿名 API 核验为公开仓库。
    github: "https://github.com/li-jingxuan/liuxianmao",
  };
}
