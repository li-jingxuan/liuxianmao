// Run with a Next development server, e.g. pnpm --filter @liuxianmao/website dev --port 3031.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.LXM_BROWSER_CHANNEL ?? "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
  if (["error", "warning"].includes(message.type())) errors.push(message.text());
});
// The editor has no favicon. Keep that unrelated 404 out of console assertions.
await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
const output = new URL("../../../output/playwright/bug031-033/", import.meta.url);
const url = process.env.BUGFIX_NEXT_URL ?? "http://127.0.0.1:3031/editor";
await mkdir(output, { recursive: true });
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  const popover = page.locator("[id$=chord-edit-popover]");
  const library = page.getByRole("dialog", { name: /^和弦库/ });
  const button = (root, name) => root.getByRole("button", { name, exact: true });
  await score.waitFor();
  for (let i = 0; i < 3; i++) {
    await score.getByText("C", { exact: true }).first().click();
    const opener = button(popover, "和弦库");
    await opener.click();
    await library.getByRole("textbox", { name: "库内搜索全部和弦", exact: true }).fill("Bm");
    await library.getByTestId("chord-library-scroll").getByText("Bm", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await library.waitFor({ state: "hidden" });
    await page.waitForFunction(element => element === document.activeElement, await opener.elementHandle());
    await button(popover, "关闭快捷编辑").click();
    await page.locator("[data-chord-popover-name]").waitFor({ state: "detached" });
  }
  await score.getByText("C", { exact: true }).first().click();
  const circles = await score.locator("circle").count();
  assert.ok(circles > 0);
  await sidebar.getByRole("radio", { name: "仅名称", exact: true }).check();
  await page.waitForFunction(count => document.querySelectorAll('svg[role="application"] circle').length < count, circles);
  await sidebar.getByText("Tips: 谱面显示配置全局生效。", { exact: true }).waitFor();
  await page.screenshot({ path: new URL("next-names-only.png", output).pathname, animations: "disabled" });
  await sidebar.getByRole("radio", { name: "名称与指法", exact: true }).check();
  await page.waitForFunction(count => document.querySelectorAll('svg[role="application"] circle').length === count, circles);
  await page.screenshot({ path: new URL("next-names-and-diagrams.png", output).pathname, animations: "disabled" });
  assert.deepEqual(errors, []);
  const result = { passed: true, url, checks: ["反复打开完整库、搜索、Escape恢复、关闭快捷编辑", "全局仅名称与名称指法即时切换及Tips", "无控制台错误或警告，无pageerror"], errors };
  await writeFile(new URL("next-result.json", output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({ path: new URL("next-failure.png", output).pathname }).catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}
