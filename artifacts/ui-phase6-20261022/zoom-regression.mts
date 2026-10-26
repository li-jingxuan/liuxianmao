import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime),
  { expect } = require(`${runtime}/test`);
const profile = await mkdtemp(path.join(tmpdir(), "lxm-phase6-zoom-"));
const output = path.resolve("artifacts/ui-phase6-20261022");
const fixtures = path.resolve("artifacts/ui-phase3-20261018");
const shots = path.resolve(
  "docs/design/04_实施验收/验收截图/20261022_阶段6响应式与多浏览器",
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
  await page.goto(process.env.EDITOR_URL ?? "http://127.0.0.1:3110/", {
    waitUntil: "networkidle",
  });
  await page
    .getByLabel("选择六线猫曲谱文件")
    .setInputFiles(path.join(fixtures, "impact.lxm.json"));
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

  await btn("放弃并切换").click();
  await expect(
    page.getByRole("alertdialog", { name: "当前草稿尚未应用" }),
  ).toBeHidden();
  checks.push("200%缩放放弃悬置草稿后 S02 不再阻断图片导出");

  const exportTrigger = page
    .getByRole("button", { name: /导出.*图片/ })
    .first();
  await exportTrigger.click();
  const imageDialog = page.getByRole("dialog", { name: "A4 图片预览" });
  await expect(imageDialog).toBeVisible();
  await expect(page.locator("[data-image-export-status]")).toHaveAttribute(
    "data-image-export-status",
    "ready",
  );
  await expect(btn("关闭预览")).toBeInViewport();
  const range = page.getByRole("combobox", {
    name: "输出范围",
    exact: true,
  });
  await range.scrollIntoViewIfNeeded();
  await expect(range).toBeInViewport();
  await btn("生成全部图片").scrollIntoViewIfNeeded();
  const exportWorkspace = page.locator("[data-image-export-status]");
  await exportWorkspace.evaluate((element: HTMLElement) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(btn("生成全部图片")).toBeInViewport();
  const actionBounds = await page.evaluate(() => {
    const workspace = document
      .querySelector("[data-image-export-status]")!
      .getBoundingClientRect();
    const generate = Array.from(
      document.querySelectorAll('[role="dialog"] button'),
    ).find((button) => /生成全部图片/.test(button.textContent ?? ""));
    const bounds = generate!.getBoundingClientRect();
    const scroll = document.querySelector(
      "[data-image-export-status]",
    ) as HTMLElement;
    return {
      workspaceTop: workspace.top,
      workspaceBottom: workspace.bottom,
      buttonTop: bounds.top,
      buttonBottom: bounds.bottom,
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
    };
  });
  assert(
    actionBounds.buttonTop >= actionBounds.workspaceTop &&
      actionBounds.buttonBottom <= actionBounds.workspaceBottom + 0.5,
    JSON.stringify(actionBounds),
  );
  const cdpImage = await context.newCDPSession(page);
  const imageCapture = await cdpImage.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(
    path.join(shots, "07_原生200%缩放_图片预览.png"),
    Buffer.from(imageCapture.data, "base64"),
  );
  await cdpImage.detach();
  await page.keyboard.press("Escape");
  await expect(imageDialog).toBeHidden();
  await expect(exportTrigger).toBeFocused();
  checks.push("200%下图片预览关闭/范围/生成入口可达，Esc关闭并恢复触发按钮");

  await writeFile(
    path.join(output, "zoom-regression-report.json"),
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
