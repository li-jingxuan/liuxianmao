/* 真实页面回归：面板入口、草稿保护、详情导航与响应式抽屉。 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const output = path.resolve("artifacts/editor-panel");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sidebar = page.locator("#music-text-sidebar");
  const toggle = page.getByRole("button", { name: "编辑面板", exact: true });
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  const expanded = async (value) => {
    await page.waitForFunction((expected) =>
      document.querySelector('button[aria-label="编辑面板"]')?.getAttribute("aria-expanded") === String(expected), value);
    assert.equal(await sidebar.isVisible(), value);
  };
  try {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3000", {
      waitUntil: "networkidle",
    });
    await svg.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expanded(true);
    assert.equal(await page.getByRole("toolbar").locator('button[aria-label="编辑面板"]').count(), 1);
    assert.equal((await toggle.textContent()).trim(), "", "工具栏入口只显示图标");
    assert.equal(await sidebar.getByRole("button", { name: "收起编辑面板", exact: true }).count(), 0);
    assert.equal(await sidebar.locator(":scope > :first-child").getByRole("tablist").count(), 1, "侧栏从页签直接开始");
    assert.equal(await page.getByRole("button", { name: "打开编辑台", exact: true }).count(), 0);
    await toggle.click();
    await expanded(false);
    await page.screenshot({ path: path.join(output, "collapsed-1440.png") });

    // 谱面文字直接进入气泡；展开和收起面板不会提交或丢弃文字草稿。
    await svg.getByText("旋", { exact: true }).click();
    const popover = page.locator('[data-text-surface="popover"]');
    const input = popover.getByRole("textbox", { name: "歌词文本", exact: true });
    await input.fill("旋律草稿");
    await expanded(false);
    await toggle.focus();
    await toggle.press("Enter");
    await expanded(true);
    const sidebarInput = sidebar.getByRole("textbox", { name: "歌词文本", exact: true });
    assert.equal(await sidebarInput.inputValue(), "旋律草稿");
    await sidebarInput.dispatchEvent("compositionstart");
    await toggle.click();
    await expanded(true);
    await sidebarInput.dispatchEvent("compositionend");
    // 已请求的收起在组合输入结束后完成，草稿保留在气泡。
    await expanded(false);
    assert.equal(await input.inputValue(), "旋律草稿");
    await toggle.click();
    await expanded(true);
    assert.equal(await sidebarInput.inputValue(), "旋律草稿");
    assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
    await popover.getByRole("button", { name: "结束文字编辑", exact: true }).click();
    await toggle.click();
    await expanded(false);
    assert.equal(await toggle.evaluate((element) => element === document.activeElement), true);
    console.log("PASS 工具栏开关、键盘入口、焦点返回与组合输入草稿保护");

    // 选择 TAB 保持谱面空间；显式进入详情时才展开面板。
    await svg.getByText("14", { exact: true }).click();
    await expanded(false);
    await page.getByRole("button", { name: "小节工具", exact: true }).click();
    await page.getByRole("button", { name: "小节属性…", exact: true }).click();
    await expanded(true);
    await page.screenshot({ path: path.join(output, "details-1440.png") });
    await toggle.click();
    await expanded(false);
    console.log("PASS 选择音符保持面板收起，小节详情自动展开");

    for (const width of [768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => ["compact", "narrow"].includes(document.querySelector("[data-layout]")?.getAttribute("data-layout")));
      const bounds = await toggle.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
      await toggle.click();
      await expanded(true);
      assert.equal(await sidebar.getAttribute("aria-modal"), "true");
      assert.equal(await toggle.evaluate((element) => !!element.closest("[inert]")), false, "抽屉内同一图标可收起");
      assert.equal(await page.locator('button[aria-label="撤销"]').evaluate((element) => !!element.closest("[inert]")), true, "其他工具继续背景隔离");
      await toggle.click();
      await expanded(false);
      await toggle.click();
      await expanded(true);
      await page.keyboard.press("Escape");
      await expanded(false);
      assert.equal(await toggle.evaluate((element) => element === document.activeElement), true);
      await page.screenshot({ path: path.join(output, `collapsed-${width}.png`) });
    }
    console.log("PASS 768/375 窄屏入口可见、抽屉 Escape 关闭与焦点返回");
    assert.deepEqual(errors, []);
    console.log("PASS 浏览器无运行时错误");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
