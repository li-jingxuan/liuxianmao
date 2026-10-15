import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime);
const { expect } = require(`${runtime}/test`);
const output = path.resolve("artifacts/ui-phase1-20261016");
const profile = await mkdtemp(path.join(tmpdir(), "lxm-ui-zoom-"));
await mkdir(path.join(profile, "Default"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: null,
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ["--window-size=1440,900"],
});
try {
  const page = context.pages()[0];
  // 在独立配置的 Chrome 原生设置页选择200%，不使用设备像素模拟或CSS zoom。
  await page.goto("chrome://settings/appearance");
  await page.locator("select#zoomLevel").selectOption("2");
  await page.goto(process.env.EDITOR_URL ?? "http://127.0.0.1:3100/", {
    waitUntil: "networkidle",
  });
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    devicePixelRatio: window.devicePixelRatio,
    visualScale: window.visualViewport?.scale,
  }));
  assert.equal(metrics.devicePixelRatio, 2);
  assert.equal(metrics.outerWidth, 1440);
  assert.equal(metrics.innerWidth, 720);
  await page.getByRole("tab", { name: /歌曲$/ }).click();
  const title = page.getByRole("textbox", { name: "歌曲名称", exact: true });
  await title.fill("200% 页面缩放草稿");
  const last = page.getByRole("button", { name: "复制小节范围", exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const unobstructed = await last.evaluate((element: HTMLElement) => {
    const r = element.getBoundingClientRect();
    const top = document.elementFromPoint(
      r.x + r.width / 2,
      r.y + r.height / 2,
    );
    return top === element || (!!top && element.contains(top));
  });
  assert.equal(unobstructed, true);
  await page.getByRole("combobox", { name: "插入位置", exact: true }).click();
  await expect(
    page
      .locator(".ant-select-dropdown:visible")
      .getByText("谱首", { exact: true }),
  ).toBeVisible();
  const popup = page.locator(".ant-select-dropdown:visible");
  await expect(popup).toBeInViewport();
  await expect(popup).toHaveCSS("opacity", "1");
  await popup.evaluate(async (element: HTMLElement) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  // 原生页面缩放时直接捕获完整浏览器 surface，避免截图工具按CSS视口裁切。
  const cdp = await context.newCDPSession(page);
  const captured = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(
    path.join(output, "browser-zoom-200-percent.png"),
    Buffer.from(captured.data, "base64"),
  );
  await cdp.detach();
  await page.keyboard.press("Escape");
  await title.scrollIntoViewIfNeeded();
  await expect(title).toHaveValue("200% 页面缩放草稿");
  await writeFile(
    path.join(output, "zoom-smoke-report.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        metrics,
        unobstructed,
        checks: [
          "原生浏览器200%页面缩放，1440物理窗口对应720CSS宽度",
          "最末控件可滚动到达且未遮挡",
          "Select popup可见，歌曲草稿保持",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: 3, metrics, unobstructed }));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
