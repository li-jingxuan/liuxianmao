// LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node apps/website/tests/lyric-lifecycle.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: website, configFile: false, cacheDir: path.resolve(website, "node_modules/.vite/lyric-lifecycle"),
  define: { ...nextBrowserDefines, "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify("") },
  optimizeDeps: { entries: ["tests/lyric-lifecycle.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "lyric-lifecycle-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url?.split("?")[0] !== "/__lyrics__") return next();
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
  const advance = scope => scope.getByRole("checkbox", { name: "应用后跳转到下一处", exact: true });
  const add = sidebar.getByRole("button", { name: "添加歌词行", exact: true });
  const removeVerse = async () => {
    await sidebar.getByRole("button", { name: "歌词段落操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "删除当前段", exact: true }).click();
  };
  const open = async (index = 0, verse = 1) => {
    const target = await page.evaluate(({ index, verse }) => {
      const target = window.lyricTest.target(index, verse);
      window.lyricTest.controller.current.open(target);
      return target;
    }, { index, verse });
    await page.waitForFunction(target => window.lyricActive?.eventId === target.eventId && window.lyricActive?.verse === target.verse, target);
    try { await input.waitFor({ state: "visible", timeout: 10000 }); }
    catch (error) { console.error(await sidebar.ariaSnapshot()); throw error; }
  };
  const snapshot = () => page.evaluate(() => {
    const state = window.lyricTest.session.getState();
    const m = state.document.score.tracks[0].measures[0];
    return { words: m.lyrics.map(({ eventId, verse, text }) => ({ eventId, verse, text })), events: m.numberedVoice.events.map(e => e.id), history: state.historyDepth.past, count: state.document.score.meta.lyricVerseCount, target: window.lyricActive };
  });
  const selectVerse = async (label) => {
    await sidebar.getByRole("combobox").click();
    const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: label });
    await option.waitFor();
    await option.dispatchEvent("click");
    const verse = ["第一段", "第二段", "第三段", "第四段"].indexOf(label) + 1;
    await page.waitForFunction(verse => window.lyricActive?.verse === verse, verse);
  };
  await open();
  await popover.waitFor({ state: "visible" });
  assert.equal(await advance(popover).isChecked(), true);
  await advance(sidebar).uncheck();
  assert.equal(await advance(popover).isChecked(), false);
  for (const field of [input, popInput]) {
    assert.equal(await field.evaluate(node => node instanceof HTMLTextAreaElement && node.rows === 2), true);
    assert.equal(await field.evaluate(node => getComputedStyle(node).resize), "none");
  }
  assert.equal(await popInput.inputValue(), "原词");
  await sidebar.getByRole("combobox").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().waitFor();
  assert.equal(await page.locator(".ant-select-dropdown:visible .ant-select-item-option").count(), 1);
  await sidebar.getByRole("combobox").press("Escape");
  assert.equal(await apply.isDisabled(), true);
  assert.equal(await popover.locator("footer button").count(), 0);
  assert.equal(await popover.getByRole("button", { name: /^应\s*用$/ }).count(), 1);
  for (const name of ["歌词录入方式", "允许替换", "下一歌词位置", "完整设置", "应用并下一处", "移除歌词"]) assert.equal((await sidebar.innerText()).includes(name), false);

  // 草稿更新立即同步两个输入和拍位预览。同一拍位的文字变化不重新发布谱面目标。
  const updates = () => page.evaluate(() => window.lyricTargetUpdates);
  const beforeTyping = await updates();
  await input.fill("风 _");
  assert.equal(await popInput.inputValue(), "风 _");
  assert.equal(await updates(), beforeTyping);
  const mapping = sidebar.getByRole("region", { name: "音符与歌词映射" });
  await mapping.getByRole("button").nth(1).click();
  assert.equal(await updates(), beforeTyping + 1);
  await popInput.press("End");
  await popInput.press("Enter");
  await popInput.pressSequentially("过");
  assert.equal(await updates(), beforeTyping + 2);
  assert.equal(await popInput.evaluate(node => node.selectionStart), "风 _\n过".length);
  assert.equal(await popInput.inputValue(), "风 _\n过");
  assert.equal(await input.inputValue(), "风 _\n过");
  assert.equal(await sidebar.getByLabel("清空为占位", { exact: true }).count(), 1);
  assert.equal((await snapshot()).history, 0);
  await popover.getByRole("button", { name: /^应\s*用$/ }).click();
  await page.waitForFunction(() => window.lyricTest.session.getState().historyDepth.past === 1);
  let saved = await snapshot();
  assert.equal(saved.target.eventId, saved.events[0]);
  assert.deepEqual(saved.words.filter(w => w.verse === 1).map(w => w.text), ["风", "过"]);
  assert.equal(await apply.isDisabled(), true);
  assert.equal(await sidebar.getByRole("button", { name: /^恢\s*复$/ }).count(), 0);

  // 多行歌词保持浏览器原生光标和滚动，草稿仍不进入历史。
  const longDraft = Array.from({ length: 20 }, () => "词").join("\n");
  await input.fill(longDraft);
  const beforeEdit = await input.evaluate(node => {
    node.setSelectionRange(node.value.length - 1, node.value.length - 1);
    node.scrollTop = node.scrollHeight;
    return { scrollTop: node.scrollTop, caret: node.selectionStart };
  });
  assert.ok(beforeEdit.scrollTop > 0);
  await page.keyboard.insertText("字");
  assert.deepEqual(await input.evaluate(node => ({ scrollTop: node.scrollTop, caret: node.selectionStart })), {
    scrollTop: beforeEdit.scrollTop, caret: beforeEdit.caret + 1,
  });
  assert.equal(await popInput.inputValue(), `${longDraft.slice(0, -1)}字词`);
  assert.equal((await snapshot()).history, saved.history);
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
  // 同位置切回歌词沿用拍点，重新读取已提交的值。
  assert.equal(await input.inputValue(), "");
  await open(2);
  await open();

  // Adding is document-wide and undoable, selects a blank verse at the same event.
  await input.fill("丢弃草稿");
  const beforeAdd = await snapshot();
  const position = sidebar.getByLabel("当前编辑对象");
  assert.equal(await position.getByRole("button", { name: "添加歌词行", exact: true }).count(), 1);
  const [locationBounds, addBounds] = await Promise.all([position.locator("strong").boundingBox(), add.boundingBox()]);
  assert.ok(Math.abs(locationBounds.y + locationBounds.height / 2 - addBounds.y - addBounds.height / 2) <= 1);
  await add.press("Enter");
  await page.getByRole("dialog", { name: "当前草稿尚未应用" }).getByRole("button", { name: "放弃并切换" }).click();
  await page.waitForFunction(() => window.lyricActive?.verse === 2);
  await page.waitForFunction(() => document.activeElement?.id === "lyric-body");
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
  await add.click();
  await page.waitForFunction(() => window.lyricActive?.verse === 3);
  await add.click();
  await page.waitForFunction(() => window.lyricActive?.verse === 4);
  assert.equal(await add.isDisabled(), true);
  assert.equal(await add.getAttribute("aria-description"), "最多支持四段歌词");
  await page.evaluate(() => window.lyricTest.session.getState().undo());
  await page.waitForFunction(() => window.lyricActive?.verse === 3);
  assert.equal(await input.inputValue(), "");
  await page.evaluate(() => window.lyricTest.session.getState().redo());
  await page.waitForFunction(() => window.lyricTest.session.getState().document.score.meta.lyricVerseCount === 4);
  await selectVerse("第四段");
  assert.equal(await popInput.inputValue(), "");

  const empty = await snapshot();
  await removeVerse();
  await page.waitForFunction(() => window.lyricActive?.verse === 3);
  assert.equal((await snapshot()).history, empty.history + 1);
  assert.equal(await page.getByRole("dialog", { name: /删除第/ }).count(), 0);
  await selectVerse("第二段");
  await input.fill("删除前的草稿");
  await removeVerse();
  const draftGate = page.getByRole("dialog", { name: "当前草稿尚未应用" });
  await draftGate.getByRole("button", { name: "继续编辑" }).click();
  assert.equal(await input.inputValue(), "删除前的草稿");
  await removeVerse();
  await draftGate.getByRole("button", { name: "放弃并切换" }).click();
  const dialog = page.getByRole("dialog", { name: "删除第 2 段歌词？" });
  await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await snapshot()).history, empty.history + 1);
  await removeVerse();
  await draftGate.getByRole("button", { name: "放弃并切换" }).click();
  await dialog.getByRole("button", { name: /^删\s*除$/ }).click();
  await dialog.waitFor({ state: "hidden" });
  saved = await snapshot();
  assert.equal(saved.count, 2);
  assert.equal(saved.history, empty.history + 2);
  assert.equal(saved.words.some(word => word.text === "第二段词"), false);
  assert.equal(await input.inputValue(), "");
  await page.evaluate(() => window.lyricTest.session.getState().undo());
  await page.waitForFunction(() => document.getElementById("lyric-body")?.value === "第二段词");

  // Native IME guards cover Enter during composition, keyCode 229 and cooling.
  await input.fill("输入法词");
  const history = (await snapshot()).history;
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  assert.equal((await snapshot()).history, history);
  assert.equal(await input.inputValue(), "输入法词");
  assert.equal(await apply.isDisabled(), true);
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }));
  });
  assert.equal((await snapshot()).history, history);
  await page.waitForFunction(() => !document.querySelector('#music-text-sidebar button[aria-label="应用"]')?.disabled);
  await apply.click();
  await page.waitForFunction(history => window.lyricTest.session.getState().historyDepth.past === history + 1, history);
  assert.equal((await snapshot()).target.eventId, beforeAdd.target.eventId);

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__lyrics__?advance`);
  await page.waitForFunction(() => !!window.lyricTest?.controller.current);
  const openAt = async (kind, measureIndex, position) => page.evaluate(({ kind, measureIndex, position }) => {
    const { session, controller } = window.lyricTest;
    const [track] = session.getState().document.score.tracks;
    controller.current.open({ kind, trackId: track.id, measureId: track.measures[measureIndex].id,
      ...(kind === "lyric" ? { verse: 1 } : {}), ...position });
  }, { kind, measureIndex, position });
  const popNumbered = popover.getByRole("textbox", { name: "简谱内容", exact: true });
  const sideNumbered = sidebar.getByRole("textbox", { name: "简谱内容", exact: true });
  await openAt("numbered", 0, { tick: 1920, endTick: 2880 });
  await popNumbered.fill("5 _");
  await popNumbered.press("Enter");
  await page.waitForFunction(() => window.lyricActive?.eventId === "advance-gap" && document.activeElement?.id === "numbered-popover-content");
  assert.equal(await popNumbered.inputValue(), "");
  assert.equal(await advance(sidebar).isChecked(), true);

  await advance(sidebar).uncheck();
  assert.equal(await advance(popover).isChecked(), false);
  await openAt("numbered", 0, { tick: 0, endTick: 960 });
  await page.waitForFunction(() => window.lyricActive?.kind === "numbered" && window.lyricActive?.tick === 0);
  await popNumbered.fill("6");
  await popover.getByRole("button", { name: "应用简谱内容", exact: true }).click();
  await page.waitForFunction(() => window.lyricActive?.kind === "numbered" && !!window.lyricActive?.eventId && document.activeElement?.id === "numbered-popover-content");
  assert.equal(await popNumbered.inputValue(), "6");
  assert.equal(await page.evaluate(() => window.lyricTest.session.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].id), (await snapshot()).target.eventId);
  await openAt("lyric", 0, { tick: 1920, endTick: 2880 });
  await popInput.waitFor();
  assert.equal(await advance(popover).isChecked(), false);
  await advance(popover).check();
  assert.equal(await advance(sidebar).isChecked(), true);
  await input.fill("风 _ 云");
  await input.press("Control+Enter");
  await page.waitForFunction(() => window.lyricActive?.eventId === "advance-gap" && document.activeElement?.id === "lyric-body");
  assert.equal(await popover.isVisible(), false);
  assert.equal(await input.inputValue(), "");
  await input.fill("尾");
  await apply.click();
  await page.waitForFunction(() => window.lyricActive?.eventId === "advance-end" && document.activeElement?.id === "lyric-body");
  await input.fill("末");
  await apply.click();
  await page.waitForFunction(() => document.activeElement?.id === "lyric-body");
  assert.equal((await snapshot()).target.eventId, "advance-end");
  await input.fill("末 ");
  await input.press("Control+Enter");
  assert.equal((await snapshot()).target.eventId, "advance-end");
  await input.fill("_");
  await apply.click();
  assert.equal((await snapshot()).target.eventId, "advance-end");

  await openAt("numbered", 1, { eventId: "advance-end" });
  await sideNumbered.fill("6");
  await sidebar.getByRole("button", { name: "应用简谱内容", exact: true }).click();
  assert.equal((await snapshot()).target.eventId, "advance-end");
  await sideNumbered.fill("7 8");
  await sideNumbered.press("Enter");
  assert.equal((await snapshot()).target.eventId, "advance-end");
  assert.deepEqual(errors, []);
  console.log("Lyric lifecycle, BUG-066 and BUG-072 passed: stable preview targets, shared edits and caret/scroll, apply and advance, draft lifecycle and IME guards.");
} finally {
  await browser?.close();
  await server.close();
}
