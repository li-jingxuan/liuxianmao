// LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node apps/website/tests/lyric-lifecycle.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: website, configFile: false, cacheDir: path.resolve(website, "node_modules/.vite/lyric-lifecycle"),
  optimizeDeps: { entries: ["tests/lyric-lifecycle.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "lyric-lifecycle-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__lyrics__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/lyric-lifecycle.browser.tsx"></script>'));
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__lyrics__`);
  await page.waitForFunction(() => !!window.lyricTest?.controller.current);
  const sidebar = page.locator("#music-text-sidebar");
  const popover = page.locator("#music-text-edit-popover");
  const input = sidebar.getByRole("textbox", { name: "连续歌词", exact: true });
  const popInput = popover.getByRole("textbox", { name: "连续歌词", exact: true });
  const apply = sidebar.getByRole("button", { name: /^应\s*用$/ });
  const open = async (index = 0, verse = 1) => {
    await page.evaluate(({ index, verse }) => window.lyricTest.controller.current.open(window.lyricTest.target(index, verse)), { index, verse });
    try { await input.waitFor({ state: "visible", timeout: 10000 }); }
    catch (error) { console.error(await sidebar.innerText()); throw error; }
  };
  const snapshot = () => page.evaluate(() => {
    const state = window.lyricTest.session.getState();
    const m = state.document.score.tracks[0].measures[0];
    return { words: m.lyrics.map(({ eventId, verse, text }) => ({ eventId, verse, text })), events: m.numberedVoice.events.map(e => e.id), history: state.historyDepth.past, count: state.document.score.meta.lyricVerseCount, target: window.lyricActive };
  });
  const selectVerse = async (label) => {
    await sidebar.getByRole("combobox").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: label }).click();
  };
  await open();
  await popover.waitFor({ state: "visible" });
  assert.equal(await input.evaluate(node => node instanceof HTMLInputElement), true);
  assert.equal(await popInput.inputValue(), "原词");
  await sidebar.getByRole("combobox").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().waitFor();
  assert.equal(await page.locator(".ant-select-dropdown:visible .ant-select-item-option").count(), 1);
  await sidebar.getByRole("combobox").press("Escape");
  assert.equal(await apply.isDisabled(), true);
  assert.deepEqual((await popover.locator("footer button").allTextContents()).map(text => text.replaceAll(/\s/g, "")), ["应用"]);
  for (const name of ["歌词录入方式", "允许替换", "下一歌词位置", "完整设置", "应用并下一处", "移除歌词"]) assert.equal((await sidebar.innerText()).includes(name), false);
  await input.fill("风 _ 过");
  assert.equal(await popInput.inputValue(), "风 _ 过");
  assert.equal(await sidebar.getByLabel("清空为占位", { exact: true }).count(), 1);
  await popInput.press("Enter");
  await page.waitForFunction(() => window.lyricTest.session.getState().historyDepth.past === 1);
  let saved = await snapshot();
  assert.equal(saved.target.eventId, saved.events[0]);
  assert.deepEqual(saved.words.filter(w => w.verse === 1).map(w => w.text), ["风", "过"]);
  assert.equal(await apply.isDisabled(), true);
  await input.fill("恢复草稿");
  await sidebar.getByRole("button", { name: /^恢\s*复$/ }).click();
  assert.equal(await popInput.inputValue(), "风 _ 过");
  await input.fill("");
  await apply.click();
  saved = await snapshot();
  assert.equal(saved.words.some(w => w.eventId === saved.events[0] && w.verse === 1), false);
  assert.equal(saved.target.eventId, saved.events[0]);
  await page.evaluate(() => window.lyricTest.session.getState().undo());
  await page.waitForFunction(() => document.getElementById("lyric-body")?.value === "风");
  await input.fill("_");
  await popover.getByRole("button", { name: /^应\s*用$/ }).click();
  saved = await snapshot();
  assert.equal(saved.words.some(w => w.eventId === saved.events[0] && w.verse === 1), false);

  // Closing and collapsing preserve the same shared draft; changing targets discards it.
  await input.fill("保留草稿");
  await popover.getByRole("button", { name: "关闭歌词浮窗", exact: true }).click();
  assert.equal(await popover.isVisible(), false);
  await open();
  assert.equal(await popInput.inputValue(), "保留草稿");
  await page.evaluate(() => window.lyricTest.collapse(true));
  assert.equal(await popInput.inputValue(), "保留草稿");
  await page.evaluate(() => window.lyricTest.collapse(false));
  await open(2);
  assert.equal(await input.inputValue(), "过");
  await open();
  assert.equal(await input.inputValue(), "");
  await input.fill("类别草稿");
  await sidebar.locator("[data-editor-paragraph-switch]").getByText("简谱", { exact: true }).click();
  await sidebar.locator("[data-editor-paragraph-switch]").getByText("歌词", { exact: true }).click();
  assert.equal(await input.count(), 0);
  await open();
  assert.equal(await input.inputValue(), "");

  // Adding is document-wide and undoable, selects a blank verse at the same event.
  await input.fill("丢弃草稿");
  const beforeAdd = await snapshot();
  await sidebar.getByRole("button", { name: "添加段落", exact: true }).click();
  await page.waitForFunction(() => window.lyricActive?.verse === 2);
  assert.equal(await input.inputValue(), "");
  assert.equal(await popInput.inputValue(), "");
  saved = await snapshot();
  assert.equal(saved.target.eventId, beforeAdd.target.eventId);
  assert.equal(saved.history, beforeAdd.history + 1);
  await input.fill("第二段词");
  await apply.click();
  await selectVerse("第一段");
  assert.equal(await input.inputValue(), "");
  await input.fill("未应用第一段");
  await selectVerse("第二段");
  assert.equal(await input.inputValue(), "第二段词");
  await sidebar.getByRole("button", { name: "添加段落", exact: true }).click();
  await page.waitForFunction(() => window.lyricActive?.verse === 3);
  await sidebar.getByRole("button", { name: "添加段落", exact: true }).click();
  await page.waitForFunction(() => window.lyricActive?.verse === 4);
  assert.equal(await sidebar.getByRole("button", { name: "添加段落", exact: true }).isDisabled(), true);
  assert.equal(await sidebar.getByLabel("最多支持四段歌词", { exact: true }).count(), 1);
  await page.evaluate(() => window.lyricTest.session.getState().undo());
  await page.waitForFunction(() => window.lyricActive?.verse === 3);
  assert.equal(await input.inputValue(), "");
  await page.evaluate(() => window.lyricTest.session.getState().redo());
  await page.waitForFunction(() => window.lyricTest.session.getState().document.score.meta.lyricVerseCount === 4);
  await selectVerse("第四段");
  assert.equal(await popInput.inputValue(), "");

  // Native IME guards cover Enter during composition, keyCode 229 and cooling.
  await input.fill("输入法词");
  const history = (await snapshot()).history;
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  assert.equal((await snapshot()).history, history);
  assert.equal(await apply.isDisabled(), true);
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }));
  });
  assert.equal((await snapshot()).history, history);
  await page.waitForFunction(() => !document.querySelector('#music-text-sidebar [data-editor-form-actions] button:last-child')?.disabled);
  await input.press("Enter");
  await page.waitForFunction(history => window.lyricTest.session.getState().historyDepth.past === history + 1, history);
  assert.equal((await snapshot()).target.eventId, beforeAdd.target.eventId);
  assert.deepEqual(errors, []);
  console.log("Lyric lifecycle passed: shared single-line input, clear/overwrite, stationary Apply/Enter, close/collapse/target lifecycle, verse add/switch/cap/undo/redo, IME guards.");
} finally {
  await browser?.close();
  await server.close();
}
