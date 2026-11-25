import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const output = process.env.LXM_CHORD_ARTIFACTS ?? path.resolve(website, "../../output/playwright/bug021-029-ui");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/bug021-029-ui"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug021-029-ui", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bug021-029-ui__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});
let browser;
let page;
const errors = [];
const results = [];
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug021-029-ui__`);
  const sidebar = page.locator("[data-music-text-sidebar]");
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score.waitFor({ timeout: 90000 });
  const history = () => page.evaluate(() => window.coexistStore.getState().historyDepth.past);
  const sameRow = async (left, right) => {
    const a = await left.boundingBox(), b = await right.boundingBox();
    assert.ok(a && b && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= 2, "输入与操作应垂直居中且同一行");
    assert.ok(a.x + a.width <= b.x + 1, "同行控件不可重叠");
  };
  const screenshot = async name => page.screenshot({ path: path.join(output, name), animations: "disabled" });

  const belowRight = async (field, button) => {
    const a = await field.boundingBox(), b = await button.boundingBox();
    assert.ok(a && b && b.y >= a.y + a.height, "应用按钮应在输入框下方");
    assert.ok(Math.abs(a.x + a.width - b.x - b.width) <= 2, "应用按钮应右对齐");
  };

  // BUG026 / BUG027: shared draft, Apply on both surfaces and IME protection.
  await score.getByText("个", { exact: true }).first().click();
  const input = sidebar.getByRole("textbox", { name: "连续歌词", exact: true });
  const popover = page.locator('[id$=music-text-edit-popover]');
  const floatingInput = popover.getByRole("textbox", { name: "连续歌词", exact: true });
  const apply = sidebar.getByRole("button", { name: "应用", exact: true });
  const floatingApply = popover.getByRole("button", { name: "应用", exact: true });
  await input.waitFor();
  await floatingInput.waitFor();
  await belowRight(input, apply);
  await belowRight(floatingInput, floatingApply);
  assert.equal(await popover.getByText("时值", { exact: true }).count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: "恢复", exact: true }).count(), 0);
  assert.equal(await apply.isDisabled(), true);
  const originalText = await input.inputValue();
  await floatingInput.fill("新 歌");
  assert.equal(await input.inputValue(), "新 歌");
  assert.equal(await apply.isEnabled(), true);
  await input.dispatchEvent("compositionstart", { data: "词" });
  assert.equal(await apply.isDisabled(), true);
  await input.dispatchEvent("compositionend", { data: "词" });
  await page.waitForFunction(() => document.querySelector('[data-music-text-sidebar] button[aria-label="应用"]')?.disabled === false);
  assert.equal(await input.inputValue(), "新 歌", "IME结束应保留草稿");
  assert.equal(await apply.isEnabled(), true);
  const before = await history();
  await apply.click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.some(measure => measure.lyrics.some(lyric => lyric.text === "新")));
  assert.equal(await history(), before + 1);
  assert.equal(await floatingApply.isDisabled(), true);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForFunction(text => document.getElementById("lyric-body")?.value === text, originalText);
  await input.fill("键");
  const beforeEnter = await history();
  await input.press("End");
  await input.press("Enter");
  assert.equal(await input.inputValue(), "键\n");
  assert.equal(await floatingInput.inputValue(), "键\n");
  assert.equal(await history(), beforeEnter);
  await apply.click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.some(measure => measure.lyrics.some(lyric => lyric.text === "键")));
  assert.equal(await input.evaluate(element => {
    const data = new DataTransfer(); data.setData("text", "两行\n歌词");
    return element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }), true, "多行粘贴不应被拦截");
  await input.fill("和 声");
  await screenshot("bug026-027-lyrics-1400.png");
  await floatingApply.click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.some(measure => measure.lyrics.some(lyric => lyric.text === "和")));
  results.push("BUG026/027: right-aligned Apply on both surfaces, shared draft, disabled no-op Apply, IME guard, Enter newline, undo and multiline paste allowed");

  // BUG021: same production preset component on both chord surfaces.
  await score.getByText("G", { exact: true }).first().click();
  const chordPopover = page.locator("[id$=chord-edit-popover]");
  const chordLibrary = page.getByRole("dialog", { name: /^和弦库/ });
  for (const surface of [sidebar, chordPopover]) {
    const opener = surface.getByRole("button", { name: "和弦库", exact: true });
    await opener.waitFor();
    const alignment = await opener.evaluate(button => {
      const text = button.querySelector("span:not(.anticon)").getBoundingClientRect();
      const icon = button.querySelector("svg").getBoundingClientRect();
      return Math.abs(text.y + text.height / 2 - icon.y - icon.height / 2);
    });
    assert.ok(alignment <= 2, `和弦库图标应居中，实际偏差 ${alignment}`);
    await opener.click();
    const search = chordLibrary.getByRole("textbox", { name: "库内搜索全部和弦", exact: true });
    await search.waitFor();
    await search.press("Escape");
    await chordLibrary.waitFor({ state: "hidden" });
  }
  await screenshot("bug021-chord-1400.png");
  results.push("BUG021: sidebar and chord popover chevrons centered within 2px, both open the library and Escape closes it");

  // BUG028: all sidebar task tabs retain position text and omit the locate action.
  for (const name of ["选区", "简谱与歌词", "和弦", "歌曲"]) {
    await sidebar.getByRole("tab", { name, exact: true }).click();
    assert.equal(await sidebar.getByRole("button", { name: "定位谱面", exact: true }).count(), 0);
    assert.ok((await sidebar.getByLabel("当前编辑对象", { exact: true }).innerText()).trim().length > 0);
  }
  results.push("BUG028: all four sidebar tabs omit Locate and retain context text");

  // BUG029: permanently visible copy range; real command and undo; no footer toolbar.
  await sidebar.getByRole("tab", { name: "选区", exact: true }).click();
  await sidebar.getByRole("radio", { name: "小节", exact: true }).locator("..").click();
  const start = sidebar.locator("[id$=settings-copy-start]");
  const after = sidebar.locator("[id$=settings-copy-after]");
  const confirm = sidebar.getByRole("button", { name: "应用复制小节范围", exact: true });
  const copyForm = sidebar.locator('[data-settings-group="copy"]');
  const startControl = copyForm.locator(".ant-select").filter({ has: page.locator("[id$=settings-copy-start]") });
  const endControl = copyForm.locator(".ant-select").filter({ has: page.locator("[id$=settings-copy-end]") });
  const afterControl = copyForm.locator(".ant-select").filter({ has: page.locator("[id$=settings-copy-after]") });
  await start.waitFor();
  assert.equal(await start.evaluate(element => !!element.closest("details")), false);
  assert.equal((await confirm.innerText()).replace(/\s/g, ""), "应用");
  assert.equal(await confirm.evaluate(element => element.closest('form')?.dataset.settingsGroup), "copy");
  assert.equal(await sidebar.locator('[data-editor-actions-host] > *').count(), 0);
  const verifyCopyLayout = async () => {
    await sameRow(startControl, endControl);
    await sameRow(afterControl, confirm);
    const rangeLabel = await copyForm.getByText("复制范围", { exact: true }).boundingBox();
    const insertionLabel = await copyForm.locator('label[for$="settings-copy-after"]').boundingBox();
    const a = await startControl.boundingBox(), b = await endControl.boundingBox();
    const c = await afterControl.boundingBox(), button = await confirm.boundingBox();
    const form = await copyForm.boundingBox();
    assert.ok(rangeLabel && insertionLabel && a && b && c && button && form);
    assert.ok(rangeLabel.y + rangeLabel.height <= a.y, "复制范围标签位于第一行选择器上方");
    assert.ok(insertionLabel.y >= a.y + a.height && insertionLabel.y + insertionLabel.height <= c.y, "插入位置独立第二行，标签在选择器上方");
    assert.ok(Math.abs(a.x - c.x) <= 1 && Math.abs(b.x + b.width - button.x - button.width) <= 1, "两行左右对齐");
    assert.ok(c.width > a.width, "插入位置使用比起止小节更宽的选择器");
    const separator = await copyForm.locator('[role="group"] [aria-hidden="true"]').filter({ hasText: "–" }).boundingBox();
    assert.ok(separator && separator.x >= a.x + a.width && separator.x + separator.width <= b.x, "短横位于两个选择器之间");
    for (const control of [startControl, endControl, afterControl]) {
      const bounds = await control.boundingBox();
      assert.ok(bounds.x >= form.x && bounds.x + bounds.width <= form.x + form.width + 1, "控件位于复制区内");
      assert.equal(await control.locator(".ant-select-content").evaluate(element => element.scrollWidth <= element.clientWidth), true, "选中值完整可读");
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  };
  const count = () => page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures.length);
  const originalCount = await count();
  await after.click();
  const insertionOption = page.locator(".ant-select-dropdown:visible").getByText("第2小节后", { exact: true });
  await insertionOption.click();
  for (const width of [1400, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await verifyCopyLayout();
    await screenshot(`bug029-copy-range-${width}.png`);
  }
  const originalDocument = await page.evaluate(() => window.coexistStore.getState().document);
  const originalHistory = await history();
  await confirm.click();
  await page.waitForFunction(original => window.coexistStore.getState().document.score.tracks[0].measures.length === original + 1, originalCount);
  assert.equal(await history(), originalHistory + 1, "复制只新增一条历史");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForFunction(original => window.coexistStore.getState().document.score.tracks[0].measures.length === original, originalCount);
  assert.deepEqual(await page.evaluate(() => window.coexistStore.getState().document), originalDocument, "撤销完整恢复复制前文档");
  results.push("BUG029: permanently open two-row layout at 1400/1600; labeled start/end with separator; wide insertion selector and visible 应用 button share second row; readable values, no overflow or bottom toolbar; real copy adds one measure/history entry, undo restores full document");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ viewport: [1400, 1600], results, pageErrors: errors }, null, 2) + "\n");
  console.log(results.join("\n"));
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  console.error("Page errors:", errors, "Page text:", await page?.locator("body").innerText());
  console.error("Inert elements:", await page?.locator('[inert]').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, id: node.id, cls: node.className, text: node.textContent?.slice(0, 80) }))));
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
