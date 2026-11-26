import { NextResponse, type NextRequest } from "next/server";
import { isInternalPreviewOpen, isWebEditorOpen } from "./lib/website-release";

// 在 Next.js 渲染和预取前返回真实 HTTP 404，覆盖首层、历史深链及 App Router 请求。
// nextUrl.pathname 已移除 basePath，飞牛子路径与域名根路径使用同一访问边界。
export function proxy({ nextUrl }: NextRequest) {
  const path = nextUrl.pathname;
  const isEditor = path === "/editor" || path.startsWith("/editor/");
  if (isEditor ? isWebEditorOpen() : isInternalPreviewOpen()) return NextResponse.next();

  return new NextResponse("404 — 页面未找到", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/editor/:path*", "/guitar-advanced/:path*", "/technique-test/:path*"],
};
