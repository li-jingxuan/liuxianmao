import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime),
  { expect } = require(`${runtime}/test`);
const profile = await mkdtemp(path.join(tmpdir(), "lxm-phase2-zoom-"));
const output = path.resolve("artifacts/ui-phase2-20261017");
const shots = path.resolve(
  "docs/design/04_实施验收/验收截图/20261017_阶段2收尾",
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
const btn = (name: string) => page.getByRole("button", { name, exact: true });
try {
  // Chrome 原生页面缩放，不使用 CSS zoom、deviceScaleFactor 或 CDP pinch。
  await page.goto("chrome://settings/appearance");
  await page.locator("select#zoomLevel").selectOption("2");
  await page.goto(process.env.EDITOR_URL ?? "http://127.0.0.1:3103/", {
    waitUntil: "networkidle",
  });
  await page
    .getByLabel("选择六线猫曲谱文件")
    .setInputFiles(path.join(output, "fixture.lxm.json"));
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
  checks.push("Chrome原生200%缩放");
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score
    .locator('text[stroke="#fff"]')
    .filter({ hasText: /^1$/ })
    .first()
    .click();
  await btn("更多工具").click();
  await page
    .locator(".ant-popover:visible")
    .getByRole("tab", { name: "拍点", exact: true })
    .click();
  await page.getByRole("button", { name: /复制所选拍点（全部六弦）$/ }).click();
  await btn("从目标拍覆盖…").click();
  const modal = page.getByRole("dialog").filter({ has: btn("应用粘贴") });
  await expect(modal).toContainText("源范围连接未复制");
  const footer = btn("取消预览");
  await expect(footer).toBeInViewport();
  const unobstructed = await footer.evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect(),
      top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || (!!top && el.contains(top));
  });
  assert(unobstructed);
  checks.push("长影响预览正文可滚动，取消底栏位于视口且未遮挡");
  const body = modal.locator(".ant-modal-body");
  await body.evaluate((el: HTMLElement) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByRole("checkbox", { name: /我已核对/ }),
  ).toBeInViewport();
  const cdp = await context.newCDPSession(page);
  const capture = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(
    path.join(shots, "07_原生200%缩放_粘贴影响.png"),
    Buffer.from(capture.data, "base64"),
  );
  await cdp.detach();
  await footer.click();
  await expect(btn("更多工具")).toBeFocused();
  await expect(btn("撤销")).toBeDisabled();
  checks.push("取消零音乐修改，焦点恢复至可见更多入口");
  await btn("更多工具").click();
  const popup = page.locator(".ant-popover:visible");
  await popup.evaluate(async (el: HTMLElement) => {
    await Promise.all(
      el
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise(requestAnimationFrame);
  });
  const rect = await popup.evaluate((el: HTMLElement) => {
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
      rect.right <= rect.width + 1 &&
      rect.top >= -1 &&
      rect.bottom <= rect.height + 1,
    JSON.stringify(rect),
  );
  await page.getByRole("combobox", { name: "拍点复制谱层" }).click();
  await expect(page.locator(".ant-select-dropdown:visible")).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(popup).toBeVisible();
  checks.push("缩放后工具重新对齐，Select候选和父层Esc隔离");
  await writeFile(
    path.join(output, "zoom-smoke-report.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        metrics,
        rect,
        unobstructed,
        checks,
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
