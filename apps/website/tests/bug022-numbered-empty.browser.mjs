import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(website, "../../output/playwright/bug021-029/numbered-empty");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/bug022-numbered-empty"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug022", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bug022__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});
let browser;
let page;
const errors = [];
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}) });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug022__`);
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score.waitFor({ timeout: 90000 });
  await page.evaluate(() => {
    const document = structuredClone(window.coexistStore.getState().document);
    const track = document.score.tracks[0];
    document.score.tracks = [track];
    track.techniques = []; track.numberedMarks = [];
    const measure = track.measures[0];
    track.measures = [measure];
    measure.timeSignature = { numerator: 4, denominator: 4 };
    measure.chordSymbols = []; measure.tuplets = [];
    measure.beats = [0, 960, 1920, 2880].map((tick, index) => ({ id: `empty-tab-${index}`, tick, kind: "notes", notes: [], rhythm: { base: "quarter", dots: 0 } }));
    measure.numberedVoice = { tuplets: [], events: [0, 960, 1920, 2880].map((tick, index) => ({
      id: `empty-event-${index}`, tick, kind: "notes", rhythm: { base: "quarter", dots: 0 }, items: [{ id: `empty-item-${index}`, token: `${index + 1}` }],
    })) };
    measure.lyrics = [{ id: "empty-lyric", eventId: "empty-event-0", verse: 1, text: "留" }];
    const result = window.coexistStore.getState().replaceDocument(document);
    if (!result.ok) throw new Error(result.errors.join("; "));
  });
  await score.locator('text[data-numbered-event="empty-event-0"], [data-numbered-event="empty-event-0"] text').first().click();
  const sidebar = page.locator("#music-text-sidebar");
  await sidebar.getByRole("tab", { name: "简谱与歌词", exact: true }).click();
  const input = sidebar.getByRole("textbox", { name: "简谱内容", exact: true });
  const popover = page.locator('[data-text-surface="popover"]');
  const floatingInput = popover.getByRole("textbox", { name: "简谱内容", exact: true });
  const snapshot = () => page.evaluate(() => ({ measure: window.coexistStore.getState().document.score.tracks[0].measures[0], history: window.coexistStore.getState().historyDepth.past }));
  const before = await snapshot();
  await input.fill("8");
  await sidebar.getByText("简谱输入错误", { exact: true }).waitFor();
  assert.equal(await input.getAttribute("aria-invalid"), "true");
  assert.equal(await floatingInput.inputValue(), "8");
  assert.equal(await sidebar.getByRole("button", { name: "应用简谱内容", exact: true }).isDisabled(), true);
  await input.press("Enter");
  assert.deepEqual(await snapshot(), before);
  await page.screenshot({ path: path.join(output, "invalid-input.png"), animations: "disabled" });

  // A whitespace draft clears exactly the current event, through the shared
  // popover owner, while retaining the time slot, lyric anchor and later notes.
  await floatingInput.fill("　 ");
  assert.equal(await input.inputValue(), "　 ");
  await popover.getByRole("button", { name: "应用简谱内容", exact: true }).click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].kind === "gap");
  const cleared = await snapshot();
  assert.equal(cleared.history, before.history + 1);
  assert.deepEqual(cleared.measure.numberedVoice.events[0], { ...before.measure.numberedVoice.events[0], kind: "gap", items: [] });
  assert.deepEqual(cleared.measure.numberedVoice.events.slice(1), before.measure.numberedVoice.events.slice(1));
  assert.deepEqual(cleared.measure.lyrics, before.measure.lyrics);
  assert.ok(await score.locator('[data-paragraph-cell*="empty-event-0"][data-paragraph-placeholder="box"]').count());
  assert.equal(await sidebar.getByText("简谱输入错误", { exact: true }).count(), 0);
  await floatingInput.press("Enter");
  assert.equal((await snapshot()).history, cleared.history);
  await page.screenshot({ path: path.join(output, "empty-placeholder.png"), animations: "disabled" });
  await page.evaluate(() => window.coexistStore.getState().undo());
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].kind === "notes");
  assert.deepEqual((await snapshot()).measure, before.measure);
  await page.evaluate(() => window.coexistStore.getState().redo());
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].kind === "gap");
  assert.deepEqual((await snapshot()).measure, cleared.measure);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ passed: true, assertions: ["concise invalid feedback", "invalid input rejected", "shared popover/sidebar draft", "empty applies to gap", "visible placeholder box", "preserves time and lyrics", "repeated Enter no history", "undo/redo"], before, cleared }, null, 2));
  await rm(path.join(output, "failure.png"), { force: true });
  console.log("BUG-022 browser passed: invalid feedback, shared empty draft, placeholder, timing, lyrics, repeat Enter and undo/redo.");
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" });
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
