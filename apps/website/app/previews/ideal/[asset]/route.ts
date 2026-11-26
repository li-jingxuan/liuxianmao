import { readFile } from "node:fs/promises";
import path from "node:path";
import { isIdealPreviewOpen } from "../../../../lib/website-release";

const assets = new Map([
  ["editor.png", "image/png"],
  ["tab.png", "image/png"],
  ["chords.png", "image/png"],
  ["numbered.png", "image/png"],
  ["gallery-tab.webp", "image/webp"],
  ["printed-page.webp", "image/webp"],
]);

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const contentType = assets.get(asset);

  // 《理想》图片在 public 之外。以白名单读取，授权开关关闭时不发送任何图片字节。
  if (!contentType || !isIdealPreviewOpen()) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const image = await readFile(path.join(process.cwd(), "assets/marketing/ideal", asset));
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
  });
}
