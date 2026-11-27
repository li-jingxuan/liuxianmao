import { NextResponse, type NextRequest } from "next/server";
import { isGuitarAdvancedOpen, isInternalPreviewOpen, isWebEditorOpen } from "./lib/website-release";

// 在 Next.js 渲染和预取前返回真实 HTTP 404，覆盖首层、历史深链及 App Router 请求。
// nextUrl.pathname 已移除 basePath，飞牛子路径与域名根路径使用同一访问边界。
export function proxy({ nextUrl }: NextRequest) {
  // 同一栏目下的根页面与深链共用访问规则，进阶与技巧验收页可以分别控制。
  const section = nextUrl.pathname.split("/")[1];
  const isOpen = section === "editor" ? isWebEditorOpen()
    : section === "guitar-advanced" ? isGuitarAdvancedOpen()
    : isInternalPreviewOpen();
  if (isOpen) return NextResponse.next();

  return new NextResponse("404 — 页面未找到", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/editor/:path*", "/guitar-advanced/:path*", "/technique-test/:path*"],
};
