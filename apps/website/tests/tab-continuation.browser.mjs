// LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs LXM_BROWSER_CHANNEL=chrome node apps/website/tests/tab-continuation.browser.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: website, configFile: false,
  cacheDir: path.resolve(website, "node_modules/.vite/tab-continuation"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "tab-continuation-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__tab_continuation__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
    ...(process.env.LXM_BROWSER_CHANNEL ? { channel: process.env.LXM_BROWSER_CHANNEL } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__tab_continuation__`);
  // 首次启动需编译完整编辑器，后续交互仍保持 15 秒超时。
  await page.getByRole("application").waitFor({ timeout: 90000 });
  const initial = await page.evaluate(() => {
    const state = window.coexistStore.getState();
    const track = state.document.score.tracks[0];
    const measure = track.measures.at(-1);
    const beat = measure.beats.at(-1);
    const cell = { trackId: track.id, measureId: measure.id, beatId: beat.id, string: 4 };
    const before = structuredClone(state.document);
    state.setSelection({ anchor: cell, focus: cell });
    return { before, cell };
  });
  const current = () => page.evaluate(() => ({
    document: window.coexistStore.getState().document,
    history: window.coexistStore.getState().historyDepth,
  }));
  const caret = page.locator('rect[class*="focusCaret"]').first();
  await caret.scrollIntoViewIfNeeded();
  const bounds = await caret.boundingBox();
  assert(bounds);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  assert.deepEqual(await page.evaluate(() => window.coexistStore.getState().selection.focus), initial.cell);
  await page.keyboard.press("-");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.at(-1).beats.at(-1).notes.some((note) => note.string === 4 && note.fret === "-"));
  const after = await current();
  assert.equal(after.history.past, 1);
  const beforeMeasure = initial.before.score.tracks[0].measures.at(-1);
  const afterMeasure = after.document.score.tracks[0].measures.at(-1);
  assert.deepEqual(afterMeasure.numberedVoice, beforeMeasure.numberedVoice);
  assert.deepEqual(afterMeasure.lyrics, beforeMeasure.lyrics);
  assert.deepEqual(afterMeasure.beats.slice(0, -1), beforeMeasure.beats.slice(0, -1));
  assert.deepEqual(afterMeasure.beats.at(-1).rhythm, { base: "quarter", dots: 0 });
  // 简谱也有延音横线，只核对 TAB 图元，不依赖具体字号。
  const glyph = page.locator('[role="application"] [data-layer="score-music"] text:not([data-numbered-event])').filter({ hasText: /^-$/ });
  await glyph.waitFor({ state: "visible" });
  assert.match(await page.getByRole("complementary", { name: "编辑器属性" }).innerText(), /- 延音标记/);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.deepEqual((await current()).document, initial.before);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.deepEqual((await current()).document, after.document);

  await page.getByRole("application").focus();
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.at(-1).beats.at(-1).notes.length === 0);
  await page.getByRole("button", { name: "设为 - 延音标记", exact: true }).click();
  await glyph.waitFor({ state: "visible" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出曲谱", exact: true }).click(),
  ]);
  const saved = JSON.parse(await readFile(await download.path(), "utf8"));
  assert(saved.score.tracks[0].measures.at(-1).beats.at(-1).notes.some((note) => note.string === 4 && note.fret === "-"));
  assert.deepEqual(errors, []);
  console.log("PASS TAB 末拍键盘横线、可见图元、属性入口、删除、撤销重做和原生文件导出");
} finally {
  await browser?.close();
  await server.close();
}
