import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime);
const { expect } = require(`${runtime}/test`);
const output = path.resolve("artifacts/ui-phase5-20261022");
const shots = path.resolve(
  "docs/design/04_实施验收/验收截图/20261022_阶段5图片导出",
);
await Promise.all([
  mkdir(output, { recursive: true }),
  mkdir(shots, { recursive: true }),
]);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
page.setDefaultTimeout(10000);
const checks: { name: string; details: unknown }[] = [];
const errors: string[] = [];
const consoleIssues: string[] = [];
const ignoredConsoleIssues: string[] = [];
page.on("console", (message) => {
  if (!["error", "warning"].includes(message.type())) return;
  const url = message.location().url;
  const text = `${url}: ${message.text()}`;
  if (url.endsWith("/favicon.ico") && message.text().includes("404"))
    ignoredConsoleIssues.push(text);
  else consoleIssues.push(text);
});
page.on("pageerror", (error: Error) => errors.push(error.message));
const url = process.env.EDITOR_URL ?? "http://127.0.0.1:3110/";
const button = (name: string) =>
  page
    .getByRole("button", {
      name: new RegExp(
        Array.from(name)
          .map((c) => ("\\^$.*+?()[]{}|".includes(c) ? "\\" + c : c))
          .join("\\s*") + "$",
      ),
    })
    .first();
const score = () => page.getByRole("application", { name: "六线谱编辑器" });
const lyricText = () =>
  page.getByRole("textbox", { name: "连续歌词", exact: true });
const workspace = page.locator("[data-image-export-status]");
const status = () => workspace.getAttribute("data-image-export-status");
const record = (name: string, details: unknown = true) => {
  checks.push({ name, details });
  console.log(`PASS ${name}`);
};
const shot = async (name: string) => {
  await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await page.screenshot({
    path: path.join(shots, `${name}.png`),
    animations: "disabled",
  });
};
const reset = async (fixture = "fixture.lxm.json") => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page
    .getByLabel("选择六线猫曲谱文件")
    .setInputFiles(path.join(output, fixture));
  await button("导入并替换").click();
  await expect(page.getByRole("banner")).toContainText(
    fixture === "overflow.lxm.json" ? "阶段5超宽验收谱" : "阶段5固定验收谱",
  );
};
const choose = async (name: string, label: string) => {
  const control = page.getByRole("combobox", { name, exact: true });
  await control.scrollIntoViewIfNeeded();
  await control.click();
  const listId = await control.getAttribute("aria-controls");
  const dropdown = page
    .locator(".ant-select-dropdown")
    .filter({ has: page.locator(`[id="${listId}"]`) });
  await expect(dropdown).toBeVisible();
  const option = dropdown.locator(".ant-select-item-option-content").filter({
    hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  });
  await option.click();
};
const exportButton = () =>
  page.getByRole("button", { name: /导出.*图片/ }).first();
const outputBlocked = () =>
  page.getByRole("dialog", { name: "先处理未应用的输入" });
const openImageModal = async () => {
  await exportButton().click();
  await expect(
    page.getByRole("heading", { name: "A4 图片预览" }),
  ).toBeVisible();
  await expect(workspace).toHaveAttribute("data-image-export-status", "ready");
};
const closeImageModal = async () => {
  await button("关闭预览").click();
  await expect(
    page.getByRole("heading", { name: "A4 图片预览" }),
  ).toBeHidden();
};
let success = false;
try {
  await reset();
  await score().locator("text").filter({ hasText: /^验$/ }).first().click();
  await expect(lyricText()).toBeVisible();
  await lyricText().fill("未应用的歌词草稿");
  await exportButton().click();
  await expect(outputBlocked()).toBeVisible();
  const pending = page.getByLabel("待处理草稿");
  await expect(pending).toContainText("歌词输入");
  await expect(pending).toContainText("第 1 小节");
  await expect(outputBlocked().getByText("未应用的歌词草稿")).toHaveCount(0);
  await shot("S02_未应用草稿阻止输出");
  await button("返回编辑").click();
  await expect(outputBlocked()).toBeHidden();
  await expect(lyricText()).toBeVisible();
  record("S02 草稿位置列表、返回编辑并恢复原输入");

  await exportButton().click();
  await expect(outputBlocked()).toBeVisible();
  await button("放弃全部草稿").click();
  await expect(
    page.getByRole("button", { name: /^确认放弃 1 处$/ }),
  ).toBeVisible();
  await shot("S02_放弃全部二次确认");
  await button("确认放弃 1 处").click();
  await expect(outputBlocked()).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "A4 图片预览" }),
  ).toBeHidden();
  record("S02 放弃全部需二次确认且不自动打开图片预览");

  await openImageModal();
  await expect(workspace).toHaveAttribute("data-inspected-page", "0");
  await expect(
    page.getByRole("button", { name: "第 1 页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await shot("06-01_A4多页图片预览");
  await page.getByRole("button", { name: "第 2 页", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-inspected-page", "1");
  await expect(
    page.getByRole("button", { name: "第 2 页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await choose("输出范围", "当前第 2 页");
  await expect(
    page.getByRole("button", { name: "生成第 2 页图片", exact: true }),
  ).toBeVisible();
  await button("生成第 2 页图片").click();
  await expect(workspace).toHaveAttribute("data-image-export-status", "generated");
  await expect(
    page.getByRole("link", { name: "下载图片", exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.getByText("第 2 页图片已生成", { exact: true }).count(),
    1,
  );
  const single = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载图片", exact: true }).click();
  const singleDownload = await single;
  assert(singleDownload.suggestedFilename().endsWith("_002.png"));
  await singleDownload.saveAs(path.join(output, "single-page.png"));
  record("06-01 缩略图只改预览页，单页范围生成与下载文件名正确");

  await choose("输出范围", "全部 3 页");
  await expect(workspace).toHaveAttribute("data-image-export-status", "ready");
  await button("生成全部图片").click();
  await expect(workspace).toHaveAttribute("data-image-export-status", "generated");
  await expect(
    page.getByText("全部图片已生成", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "下载图片包", exact: true }),
  ).toBeVisible();
  await shot("06-03_图片生成成功与下载");
  const all = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载图片包", exact: true }).click();
  const allDownload = await all;
  assert(allDownload.suggestedFilename().endsWith(".zip"));
  await allDownload.saveAs(path.join(output, "all-pages.zip"));
  record("06-03 全部页 ZIP 成功态与下载");

  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    const target = window as typeof window & { __restoreToBlob?: () => void };
    target.__restoreToBlob = () => {
      HTMLCanvasElement.prototype.toBlob = original;
      delete target.__restoreToBlob;
    };
    HTMLCanvasElement.prototype.toBlob = function (
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ) {
      setTimeout(() => original.call(this, callback, type, quality), 2000);
    };
  });
  await button("重新生成").click();
  await expect(workspace).toHaveAttribute("data-image-export-status", "generating");
  await expect(
    page.getByText(/正在生成第 1 \/ 3 页/),
  ).toBeVisible();
  await shot("06-02_图片生成进度与取消");
  await button("取消生成").click();
  await expect(workspace).toHaveAttribute("data-image-export-status", "ready");
  await expect(
    page.getByRole("link", { name: /下载图片/ }),
  ).toHaveCount(0);
  await page.waitForTimeout(2200);
  await expect(workspace).toHaveAttribute("data-image-export-status", "ready");
  await expect(
    page.getByRole("link", { name: /下载图片/ }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as typeof window & { __restoreToBlob?: () => void }
    ).__restoreToBlob?.(),
  );
  record("06-02 取消中止任务、清空进度且迟到结果不发布下载");

  await page.evaluate(() =>
    document.fonts.dispatchEvent(new Event("loadingdone")),
  );
  await expect(workspace).toHaveAttribute("data-image-export-status", "stale");
  await expect(page.getByText("预览已失效", { exact: true })).toBeVisible();
  await shot("06-04_字体变化预览失效");
  await button("重新准备预览").click();
  await expect(workspace).toHaveAttribute("data-image-export-status", "ready");
  await expect(
    page.getByRole("button", { name: "第 1 页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  record("字体变化使预览失效，重新准备恢复可用页数据");
  await closeImageModal();

  await reset("overflow.lxm.json");
  await exportButton().click();
  await expect(
    page.getByRole("heading", { name: "A4 图片预览" }),
  ).toBeVisible();
  await expect(workspace).toHaveAttribute("data-image-export-status", "failed");
  await expect(
    page.getByText("超出 A4 页面范围", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("输出设置").getByText(/谱行超过 A4 宽度/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /下载图片/ })).toHaveCount(0);
  await shot("06-04_A4超宽失败");
  await button("返回编辑器调整内容").click();
  await expect(
    page.getByRole("heading", { name: "A4 图片预览" }),
  ).toBeHidden();
  record("06-04 A4 布局诊断来自 controller，失败无下载并可返回编辑");

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleIssues, []);
  success = true;
} catch (error) {
  await page
    .screenshot({
      path: path.join(output, "failure.png"),
      animations: "disabled",
    })
    .catch(() => {});
  await writeFile(
    path.join(output, "failure-body.txt"),
    await page.locator("body").innerText(),
  );
  throw error;
} finally {
  await writeFile(
    path.join(output, "phase5-browser-report.json"),
    JSON.stringify(
      {
        success,
        testedAt: new Date().toISOString(),
        url,
        checks,
        errors,
        consoleIssues,
        ignoredConsoleIssues,
        browser: browser.version(),
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
