import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime),
  { expect } = require(`${runtime}/test`);
const profile = await mkdtemp(path.join(tmpdir(), "lxm-phase3-zoom-"));
const output = path.resolve("artifacts/ui-phase3-20261018");
const shots = path.resolve(
  "docs/design/04_实施验收/验收截图/20261018_阶段3属性表单",
);
await mkdir(path.join(profile, "Default"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: null,
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ["--window-size=1440,900"],
});
const page = context.pages()[0];
page.setDefaultTimeout(8000);
const checks: string[] = [];

const btn = (name: string) =>
  page
    .getByRole("button", {
      name: new RegExp(`^${name.split("").join("\\s*")}$`),
    })
    .first();
try {
  await page.goto("chrome://settings/appearance");
  await page.locator("select#zoomLevel").selectOption("2");
  await page.goto(process.env.EDITOR_URL ?? "http://127.0.0.1:3109/", {
    waitUntil: "networkidle",
  });
  await page
    .getByLabel("选择六线猫曲谱文件")
    .setInputFiles(path.join(output, "impact.lxm.json"));
  await btn("导入并替换").click();
  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    outerWidth,
    devicePixelRatio,
    visualScale: visualViewport?.scale,
  }));
  assert.equal(metrics.width, 720);
  assert.equal(metrics.outerWidth, 1440);
  assert.equal(metrics.devicePixelRatio, 2);
  checks.push("Chrome原生200%缩放，实测720CSS像素");
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score
    .locator('g[data-system-index="0"] text:not([stroke="#fff"])')
    .filter({ hasText: /^1$/ })
    .first()
    .click();
  const raw = page.getByRole("textbox", { name: "连续简谱", exact: true });
  await raw.fill("2 3");
  const owner = await raw.elementHandle();
  const select = page.getByRole("combobox", { name: "简谱时值", exact: true });
  await select.scrollIntoViewIfNeeded();
  await select.click();
  await expect(page.locator(".ant-select-dropdown:visible")).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(raw).toHaveValue("2 3");
  assert(await owner.evaluate((el: HTMLElement) => el.isConnected));
  checks.push("Select候选可见，Esc只关闭候选，raw及owner保持");
  await btn("恢复内容组").scrollIntoViewIfNeeded();
  await expect(btn("恢复内容组")).toBeInViewport();
  await btn("恢复内容组").click();
  const item = page.getByRole("textbox", {
    name: "简谱单音符音高",
    exact: true,
  });
  await item.fill("2");
  await btn("取消").click();
  await btn("应用并切换").click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  const rect = await dialog.evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: innerWidth,
      height: innerHeight,
    };
  });
  assert(
    rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= rect.width + 1 &&
      rect.bottom <= rect.height + 1,
    JSON.stringify(rect),
  );
  await expect(
    dialog.getByRole("button", { name: /^取\s*消$/ }),
  ).toBeInViewport();
  checks.push("分组恢复/应用动作可达，原生影响确认完整位于低高度视口");
  const cdp = await context.newCDPSession(page);
  const capture = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(
    path.join(shots, "07_原生200%缩放_属性影响确认.png"),
    Buffer.from(capture.data, "base64"),
  );
  await cdp.detach();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(btn("撤销")).toBeDisabled();
  await expect(btn("继续编辑")).toBeFocused();
  checks.push("Esc取消零历史且焦点恢复至可见保护区");
  await writeFile(
    path.join(output, "zoom-smoke-report.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        metrics,
        rect,
        checks,
        success: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length, metrics, rect }));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
