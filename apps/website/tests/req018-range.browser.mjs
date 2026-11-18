import assert from "node:assert/strict";
import { selectScoreAction } from "./score-file-actions.browser.cjs";
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
const output = path.resolve(website, "../../output/playwright/req017-030");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/req018-range"),
  optimizeDeps: { entries: ["tests/req018-range.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "req018-editor", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__req018__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/req018-range.browser.tsx"></script>'));
    });
  } }],
});
const results = [], errors = [];
let browser;
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__req018__`);
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score.waitFor({ timeout: 90000 });
  async function point(index, kind = "numbered", verse = 1) {
    return page.evaluate(({ index, kind, verse }) => {
      const api = window.rangeReview;
      const document = api.store.getState().document;
      const trackId = document.score.tracks[0].id;
      const slots = api.collectMusicTextRangeSlots(document, { trackId, kind, verse });
      const slot = slots[index];
      const svg = window.document.querySelector('svg[role="application"]');
      const key = Object.keys(svg).find(key => key.startsWith("__reactFiber$"));
      const find = fiber => fiber && (fiber.memoizedProps?.layout?.systems ? fiber.memoizedProps.layout : find(fiber.child) ?? find(fiber.sibling));
      let root = svg[key];
      while (root.return) root = root.return;
      const layout = find(root.stateNode.current);
      const hitBounds = kind === "numbered"
        ? layout.hitIndex.numberedBounds.find(b => b.target.measureId === slot.measureId && (slot.eventId ? b.target.eventId === slot.eventId : b.target.tick === slot.tick))
        : layout.hitIndex.musicTextBounds.find(b => b.kind === "lyric" && b.measureId === slot.measureId && (b.verse ?? 1) === verse && (slot.eventId ? b.eventId === slot.eventId : b.tick === slot.tick));
      const bounds = hitBounds ?? api.layoutParagraphFocus(layout, { ...slot, trackId, kind, verse });
      if (!bounds) throw new Error(`Missing paragraph bounds ${kind}/${index}`);
      const p = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y, slot, count: slots.length,
        action: api.resolveScorePointerAction(document, layout, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, api.store.getState().selection, false),
        element: window.document.elementFromPoint(p.x, p.y)?.outerHTML.slice(0, 300) };
    }, { index, kind, verse });
  }
  async function select(first, last, kind = "numbered", verse = 1) {
    const a = await point(first, kind, verse);
    await page.mouse.click(a.x, a.y);
    const b = await point(last, kind, verse);
    await page.keyboard.down("Shift");
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up("Shift");
    try { await page.locator("[data-music-text-range-editor]").waitFor(); }
    catch (error) {
      await page.screenshot({ path: path.join(output, "range-selection-failure.png") });
      console.log({ a, b, errors, text: (await page.locator("body").innerText()).slice(-5000) });
      throw error;
    }
  }
  const baseline = await page.evaluate(() => structuredClone(window.rangeReview.store.getState().document));
  await select(0, 2);
  assert.equal(await page.locator("[data-music-text-range-cell]").count(), 3);
  results.push("Shift点击按完整事件选择三个位置");
  const input = page.getByRole("textbox", { name: "范围内容", exact: true });
  await input.fill("6 7");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  const after = await page.evaluate(() => {
    const { store, collectMusicTextRangeSlots } = window.rangeReview;
    const document = store.getState().document, track = document.score.tracks[0];
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "numbered" }).slice(0, 3);
    return { events: slots.map(slot => track.measures.find(m => m.id === slot.measureId).numberedVoice.events.find(e => e.id === slot.eventId)), history: store.getState().pastEntries.length };
  });
  assert.deepEqual(after.events.map(e => e.items.map(i => i.token).join("+")), ["6", "7", ""]);
  assert.equal(after.history, 1);
  results.push("短输入清空余位且只写一条历史");
  await input.fill("1 2 3 4");
  assert.equal(await page.getByRole("button", { name: "应用范围", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.rangeReview.store.getState().pastEntries.length), 1);
  results.push("超界禁用并保留输入及乐谱");
  await page.getByRole("button", { name: "恢复范围内容", exact: true }).click();
  await score.focus();
  await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual(await page.evaluate(() => window.rangeReview.store.getState().document.score), baseline.score);
  results.push("一次撤销完整恢复范围内容与锚点");
  await score.focus();
  await page.keyboard.press("Shift+ArrowRight");
  assert.equal(await page.locator("[data-music-text-range-cell]").count(), 4);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-music-text-range-cell]").count(), 1);
  results.push("键盘扩选与Esc折叠焦点");
  const a = await point(0), b = await point(5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
  assert.equal(await page.locator("[data-music-text-range-cell]").count(), 6);
  results.push("拖选连续六事件，输入框不抢焦点");
  await page.screenshot({ path: path.join(output, "range-1600.png") });
  await input.fill("");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  await score.focus();
  await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual(await page.evaluate(() => window.rangeReview.store.getState().document.score), baseline.score);
  results.push("空输入清空选区，撤销保留原时值与歌词");
  await select(0, 2, "lyric");
  await input.fill("轻 _ 唱");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  await page.screenshot({ path: path.join(output, "lyrics-range-1600.png") });
  const words = await page.evaluate(() => {
    const api = window.rangeReview, doc = api.store.getState().document, track = doc.score.tracks[0];
    return api.collectMusicTextRangeSlots(doc, { trackId: track.id, kind: "lyric", verse: 1 }).slice(0, 3).map(slot => track.measures.find(m => m.id === slot.measureId).lyrics.find(l => l.eventId === slot.eventId && l.verse === 1)?.text ?? "");
  });
  assert.deepEqual(words, ["轻", "", "唱"]);
  results.push("同段歌词范围映射与下划线清空");
  const boundary = await page.evaluate(() => {
    const api = window.rangeReview, doc = api.store.getState().document, track = doc.score.tracks[0];
    return api.collectMusicTextRangeSlots(doc, { trackId: track.id, kind: "numbered" }).findIndex(slot => slot.measureId === track.measures[5].id);
  });
  await select(boundary - 2, boundary + 2);
  assert.equal(await page.locator("[data-music-text-range-cell]").count(), 5);
  const ys = await page.locator("[data-music-text-range-cell]").evaluateAll(nodes => nodes.map(n => +n.getAttribute("y")));
  assert.ok(Math.max(...ys) - Math.min(...ys) > 50);
  results.push("跨小节与跨排版行按事件连续高亮");
  await page.screenshot({ path: path.join(output, "range-cross-line-1600.png") });
  await page.setViewportSize({ width: 1400, height: 720 });
  await score.focus();
  await page.keyboard.press("Shift+ArrowRight");
  const visibleFocus = await page.locator("[data-range-focus]").boundingBox();
  assert.ok(visibleFocus.y >= 102 && visibleFocus.y + visibleFocus.height < 720);
  await page.screenshot({ path: path.join(output, "range-1400x720.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  results.push("1400×720无横溢出，扩选焦点随谱面视口可见");
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.evaluate(baseline => {
    const doc = structuredClone(baseline), track = doc.score.tracks[0], events = track.measures[0].numberedVoice.events;
    track.numberedMarks.push({ id: "req018-slur", type: "slur", fromEventId: events[0].id, toEventId: events[1].id });
    const loaded = window.rangeReview.store.getState().replaceDocument(doc);
    if (!loaded.ok) throw new Error(loaded.errors.join("；"));
  }, baseline);
  await score.waitFor();
  await select(0, 1);
  await input.fill("6 7");
  await input.dispatchEvent("compositionstart", { data: "唱" });
  await score.getByText("G", { exact: true }).first().click();
  assert.equal(await page.locator("[data-music-text-range-editor]").count(), 1);
  assert.equal(await input.inputValue(), "6 7");
  assert.equal(await page.locator("#chord-edit-popover").count(), 0);
  await input.dispatchEvent("compositionend", { data: "唱" });
  await score.getByText("G", { exact: true }).first().click();
  assert.equal(await page.locator("[data-music-text-range-editor]").count(), 1);
  await page.getByRole("button", { name: "应用范围", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="应用范围"]').disabled);
  results.push("范围组词及结束冷却期间点击和弦保留输入与选区");
  await input.fill("");
  assert.equal(await page.getByRole("button", { name: "应用范围", exact: true }).isDisabled(), false);
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  const impact = page.getByRole("dialog", { name: "范围内容影响确认" });
  await impact.waitFor();
  await page.screenshot({ path: path.join(output, "range-impact-confirmation.png") });
  await impact.getByRole("button", { name: /^取\s*消$/ }).click();
  await impact.waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "");
  assert.equal(await page.evaluate(() => window.rangeReview.store.getState().document.score.tracks[0].numberedMarks.length), 1);
  results.push("涉及连接先确认，取消保留范围输入及连线");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  await impact.getByRole("button", { name: "确认修改", exact: true }).click();
  await impact.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.rangeReview.store.getState().document.score.tracks[0].numberedMarks.length), 0);
  assert.equal(await page.evaluate(() => window.rangeReview.store.getState().pastEntries.length), 1);
  await score.focus();
  await page.keyboard.press("ControlOrMeta+z");
  assert.equal(await page.evaluate(() => window.rangeReview.store.getState().document.score.tracks[0].numberedMarks.length), 1);
  results.push("确认后清空与移除连线同条历史，撤销同时恢复");
  await input.fill("6 7");
  await page.getByRole("button", { name: "编辑面板", exact: true }).click();
  await page.locator("[data-music-text-range-editor]").waitFor({ state: "hidden" });
  await selectScoreAction(page, "导出", "JSON 曲谱");
  const blocked = page.getByRole("dialog", { name: "先处理未应用的输入", exact: true });
  await blocked.waitFor();
  await blocked.getByRole("button", { name: "返回编辑", exact: true }).click();
  await blocked.waitFor({ state: "hidden" });
  await page.locator("[data-music-text-range-editor]").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "范围内容");
  assert.equal(await input.inputValue(), "6 7");
  results.push("收起带草稿范围后导出阻断，返回编辑展开侧栏并恢复输入焦点");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "range-results.json"), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ passed: results.length, results, errors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
