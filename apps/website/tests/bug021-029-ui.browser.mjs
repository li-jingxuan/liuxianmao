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
const output = path.resolve(website, "../../output/playwright/bug021-029-ui");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/bug021-029-ui"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
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
  const sidebar = page.locator("#music-text-sidebar");
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score.waitFor({ timeout: 90000 });
  const history = () => page.evaluate(() => window.coexistStore.getState().historyDepth.past);
  const sameRow = async (left, right) => {
    const a = await left.boundingBox(), b = await right.boundingBox();
    assert.ok(a && b && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= 2, "输入与操作应垂直居中且同一行");
    assert.ok(a.x + a.width <= b.x + 1, "同行控件不可重叠");
  };
  const screenshot = async name => page.screenshot({ path: path.join(output, name), animations: "disabled" });

  // BUG026 / BUG027: actual shared draft, inline apply, IME and failure feedback.
  await score.getByText("轻", { exact: true }).first().click();
  const input = sidebar.getByRole("textbox", { name: "连续歌词", exact: true });
  const popover = page.locator('#music-text-edit-popover');
  const floatingInput = popover.getByRole("textbox", { name: "连续歌词", exact: true });
  const apply = sidebar.getByRole("button", { name: "应用", exact: true });
  const floatingApply = popover.getByRole("button", { name: "应用", exact: true });
  await input.waitFor();
  await floatingInput.waitFor();
  await sameRow(input, apply);
  await sameRow(floatingInput, floatingApply);
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
  await page.waitForFunction(() => !document.querySelector('#lyric-body')?.parentElement?.querySelector('button')?.disabled);
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
  await input.press("Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.some(measure => measure.lyrics.some(lyric => lyric.text === "键")));
  await input.evaluate(element => {
    const data = new DataTransfer(); data.setData("text", "两行\n歌词");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.equal(await sidebar.getByText("请粘贴单行文本。", { exact: true }).isVisible(), true);
  assert.equal(await input.inputValue(), "键");
  await input.fill("和 声");
  await screenshot("bug026-027-lyrics-1400.png");
  await floatingApply.click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.some(measure => measure.lyrics.some(lyric => lyric.text === "和")));
  results.push("BUG026/027: both inline rows, one shared draft, disabled no-op Apply, IME guard, sidebar click, popover click, Enter, undo and paste failure feedback");

  // BUG021: same production preset component on both chord surfaces.
  await score.getByText("G", { exact: true }).first().click();
  const chordPopover = page.locator("#chord-edit-popover");
  for (const surface of [sidebar, chordPopover]) {
    const more = surface.getByRole("button", { name: "更多和弦", exact: true });
    await more.waitFor();
    const alignment = await more.evaluate(button => {
      const text = button.querySelector("span:not(.anticon)").getBoundingClientRect();
      const icon = button.querySelector("svg").getBoundingClientRect();
      return Math.abs(text.y + text.height / 2 - icon.y - icon.height / 2);
    });
    assert.ok(alignment <= 2, `更多图标应居中，实际偏差 ${alignment}`);
    await more.click();
    const search = surface.getByRole("textbox", { name: "搜索全部和弦", exact: true });
    await search.waitFor();
    await search.press("Escape");
    await search.waitFor({ state: "hidden" });
  }
  await screenshot("bug021-chord-1400.png");
  results.push("BUG021: sidebar and chord popover chevrons centered within 2px, both dropdowns open and Escape closes");

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
  const start = sidebar.locator("#settings-copy-start");
  const end = sidebar.locator("#settings-copy-end");
  const after = sidebar.locator("#settings-copy-after");
  const confirm = sidebar.getByRole("button", { name: "确认复制", exact: true });
  await start.waitFor();
  assert.equal(await start.evaluate(element => !!element.closest("details")), false);
  await sameRow(start.locator(".."), end.locator(".."));
  await sameRow(end.locator(".."), after.locator(".."));
  assert.equal(await confirm.evaluate(element => element.closest('form')?.dataset.settingsGroup), "copy");
  assert.equal(await sidebar.locator('[data-editor-actions-host]').innerText(), "");
  const count = () => page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures.length);
  const originalCount = await count();
  await screenshot("bug029-copy-range-1400.png");
  await confirm.click();
  await page.waitForFunction(original => window.coexistStore.getState().document.score.tracks[0].measures.length === original + 1, originalCount);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForFunction(original => window.coexistStore.getState().document.score.tracks[0].measures.length === original, originalCount);
  for (const width of [1400, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await sameRow(start.locator(".."), end.locator(".."));
    await sameRow(end.locator(".."), after.locator(".."));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await screenshot("bug029-copy-range-1600.png");
  results.push("BUG029: copy range permanently open, range and insertion share a row at 1400/1600, local confirmation, no bottom copy toolbar, actual measure count +1 and undo");
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
