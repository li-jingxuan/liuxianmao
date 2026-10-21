import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime);
const { expect } = require(`${runtime}/test`);
const { unzipSync } = createRequire(
  path.resolve("apps/website/package.json"),
)("fflate");
const output = path.resolve("artifacts/ui-phase6-20261022");
const fixtures = path.resolve("artifacts/ui-phase5-20261022");
const shots = path.resolve(
  "docs/design/04_实施验收/验收截图/20261022_阶段6响应式与多浏览器",
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
page.setDefaultTimeout(12000);
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
const workspace = page.locator("[data-image-export-status]");
const exportTrigger = () =>
  page.getByRole("button", { name: /导出.*图片/ }).first();
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
const reset = async (fixture: string) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page
    .getByLabel("选择六线猫曲谱文件")
    .setInputFiles(path.join(fixtures, fixture));
  await button("导入并替换").click();
  await expect(page.getByRole("banner")).toContainText("阶段5固定验收谱");
};
const openImageModal = async () => {
  await exportTrigger().click();
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
let success = false;
try {
  await reset("fixture.lxm.json");
  const cases = [
    {
      width: 1440,
      height: 900,
      editor: "07-00_1440默认工作区",
      modal: "07-00m_1440图片预览",
    },
    {
      width: 1280,
      height: 800,
      editor: "07-01_笔记本1280_谱面与属性并列",
      modal: "07-01m_1280图片预览",
    },
    {
      width: 1024,
      height: 768,
      editor: "07-02_窄窗口1024_底部属性分区",
      modal: "07-02m_1024图片预览三栏",
    },
    {
      width: 1280,
      height: 650,
      editor: "07-03_低高度650_独立滚动与固定动作",
      modal: "07-03m_650图片预览",
    },
    {
      width: 768,
      height: 900,
      editor: "07-04_紧凑768_更多工具与底部编辑",
      modal: "07-04m_768图片预览堆叠",
    },
  ];

  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await expect(score()).toBeVisible();
    await expect(exportTrigger()).toBeInViewport();
    await shot(item.editor);
    await openImageModal();
    const columns = await workspace.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns,
    );
    if (item.width <= 900) assert.equal(columns.trim().split(/\s+/).length, 1);
    else assert.equal(columns.trim().split(/\s+/).length, 3);
    await expect(button("关闭预览")).toBeInViewport();
    await choose("输出范围", "全部 3 页");
    await button("生成全部图片").scrollIntoViewIfNeeded();
    await expect(button("生成全部图片")).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "第 1 页", exact: true }),
    ).toBeVisible();
    await shot(item.modal);
    await closeImageModal();
  }
  record("五组视口下工作区与图片预览可达，≤900 视口图片 Modal 单列堆叠");

  await page.setViewportSize({ width: 1440, height: 900 });
  await openImageModal();
  const closePreview = button("关闭预览");
  await expect(closePreview).toBeFocused();
  const dialog = page.getByRole("dialog", { name: "A4 图片预览" });
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.press("Tab");
    assert(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
      `Tab ${index + 1} 逃出图片 Modal`,
    );
  }
  const lastControl = dialog
    .locator(
      "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]",
    )
    .last();
  await lastControl.focus();
  await page.keyboard.press("Tab");
  await expect(closePreview).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(exportTrigger()).toBeFocused();
  record("图片 Modal Tab 首尾循环、Esc 关闭并恢复触发按钮焦点");

  await reset("long-score.lxm.json");
  const started = Date.now();
  await expect(score()).toBeVisible();
  await openImageModal();
  const pageHeading = page.getByRole("heading", { name: /页面 · 共 \d+ 页/ });
  await expect(pageHeading).toBeVisible();
  const pageCount = Number(
    (await pageHeading.innerText()).match(/共\s*(\d+)\s*页/)?.[1],
  );
  assert(pageCount > 1);
  await expect(
    page.getByRole("button", {
      name: `第 ${pageCount} 页`,
      exact: true,
    }),
  ).toBeVisible();
  await button("生成全部图片").click();
  await expect(workspace).toHaveAttribute(
    "data-image-export-status",
    "generated",
    { timeout: 120000 },
  );
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载图片包" }).click();
  const zip = await zipDownload;
  const zipPath = path.join(output, "long-score.zip");
  await zip.saveAs(zipPath);
  const entries = Object.entries(unzipSync(await readFile(zipPath)));
  assert.equal(entries.length, pageCount);
  for (const [name, content] of entries) {
    assert(name.endsWith(".png"), name);
    assert.deepEqual(
      Array.from(content.slice(0, 8)),
      [137, 80, 78, 71, 13, 10, 26, 10],
      name,
    );
  }
  await shot("07-05_100小节长谱多页ZIP");
  record(
    `100 小节长谱 ${pageCount} 页全部生成，ZIP 条目完整且均为 PNG（${Date.now() - started}ms）`,
    { pageCount, entries: entries.map(([name]) => name) },
  );
  await closeImageModal();

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleIssues, []);
  success = true;
} catch (error) {
  await page
    .screenshot({
      path: path.join(output, "responsive-failure.png"),
      animations: "disabled",
    })
    .catch(() => {});
  await writeFile(
    path.join(output, "responsive-failure-body.txt"),
    await page.locator("body").innerText(),
  );
  throw error;
} finally {
  await writeFile(
    path.join(output, "responsive-output-report.json"),
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
