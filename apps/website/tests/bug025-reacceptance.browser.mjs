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
const output = path.resolve(website, "../../output/playwright/bug025-reacceptance");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/bug025-reacceptance"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug025-reacceptance", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bug025__") return next();
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
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug025__`);
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
    measure.beats = [0, 960, 1920, 2880].map((tick, index) => ({ id: `recheck-tab-${index}`, tick, kind: "notes", notes: [], rhythm: { base: "quarter", dots: 0 } }));
    measure.numberedVoice = { tuplets: [], events: [0, 960, 1920, 2880].map((tick, index) => ({
      id: `recheck-event-${index}`, tick, kind: "notes", rhythm: { base: "quarter", dots: 0 }, items: [{ id: `recheck-item-${index}`, token: `${index + 1}` }],
    })) };
    measure.lyrics = [{ id: "recheck-lyric", eventId: "recheck-event-0", verse: 1, text: "留" }];
    const result = window.coexistStore.getState().replaceDocument(document);
    if (!result.ok) throw new Error(result.errors.join("; "));
  });
  const snapshot = () => page.evaluate(() => ({ measure: window.coexistStore.getState().document.score.tracks[0].measures[0], history: window.coexistStore.getState().historyDepth.past }));
  const popover = page.locator('[data-text-surface="popover"]');
  const firstNote = score.locator('[data-numbered-event="recheck-event-0"]').first();
  await firstNote.click();
  const before = await snapshot();
  await popover.getByRole("button", { name: "十六分音符", exact: true }).click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].rhythm.base === "sixteenth");
  const shortened = await snapshot();
  const blanks = shortened.measure.numberedVoice.events.filter(event => event.kind === "gap" && event.tick < 960);
  assert.deepEqual(blanks.map(event => [event.tick, event.rhythm]), [240, 480, 720].map(tick => [tick, { base: "sixteenth", dots: 0 }]));
  assert.equal(shortened.history, before.history + 1);
  assert.deepEqual(shortened.measure.numberedVoice.events.filter(event => event.tick >= 960), before.measure.numberedVoice.events.slice(1));
  assert.deepEqual(shortened.measure.lyrics, before.measure.lyrics);
  const placeholders = score.locator('[data-paragraph-cell^="numbered/"][data-paragraph-placeholder]');
  assert.equal(await placeholders.count(), 3, "three independent empty positions follow the retained note");
  const geometry = await placeholders.evaluateAll(nodes => nodes.map(node => ({ kind: node.getAttribute("data-paragraph-placeholder"), x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })));
  assert.ok(geometry.every((bounds, index) => index === 0 || bounds.x > geometry[index - 1].x + geometry[index - 1].width));
  await page.screenshot({ path: path.join(output, "quarter-to-sixteenth-1400.png"), animations: "disabled" });
  await page.evaluate(() => window.coexistStore.getState().undo());
  assert.deepEqual((await snapshot()).measure, before.measure);
  await page.evaluate(() => window.coexistStore.getState().redo());
  assert.deepEqual((await snapshot()).measure, shortened.measure);

  // Fill every visible position through the actual renderer hit target and editor.
  for (const [index, gap] of blanks.entries()) {
    const placeholder = score.locator(`[data-paragraph-cell^="numbered/"][data-paragraph-cell*="/${gap.id}/"]`);
    const bounds = await placeholder.boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const input = popover.getByRole("textbox", { name: "简谱内容", exact: true });
    await input.waitFor();
    assert.equal(await popover.getByRole("button", { name: "十六分音符", exact: true }).getAttribute("aria-pressed"), "true");
    await input.fill(String(index + 2));
    await popover.getByRole("button", { name: "应用简谱内容", exact: true }).click();
    await page.waitForFunction(id => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find(event => event.id === id)?.kind === "notes", gap.id);
  }
  const filled = await snapshot();
  assert.deepEqual(filled.measure.numberedVoice.events.filter(event => event.tick < 960).map(event => [event.tick, event.items[0]?.token, event.rhythm.base]), [[0, "1", "sixteenth"], [240, "2", "sixteenth"], [480, "3", "sixteenth"], [720, "4", "sixteenth"]]);
  assert.deepEqual(filled.measure.numberedVoice.events.filter(event => event.tick >= 960), before.measure.numberedVoice.events.slice(1));
  assert.equal(filled.history, shortened.history + 3);
  await page.screenshot({ path: path.join(output, "three-gaps-filled-1400.png"), animations: "disabled" });

  // Undo the three inserts, then use continuous entry from the original event.
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.coexistStore.getState().undo(); });
  await firstNote.click();
  const sequenceInput = popover.getByRole("textbox", { name: "简谱内容", exact: true });
  await sequenceInput.fill("5 6 7 1");
  await sequenceInput.press("Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].items[0].token === "5");
  const sequence = await snapshot();
  assert.deepEqual(sequence.measure.numberedVoice.events.filter(event => event.tick < 960).map(event => [event.tick, event.items[0]?.token]), [[0, "5"], [240, "6"], [480, "7"], [720, "1"]]);
  assert.deepEqual(sequence.measure.numberedVoice.events.filter(event => event.tick >= 960), before.measure.numberedVoice.events.slice(1));
  await sequenceInput.press("Enter");
  assert.equal((await snapshot()).history, sequence.history);
  await page.evaluate(() => { window.coexistStore.getState().undo(); window.coexistStore.getState().undo(); });
  await firstNote.click();
  await popover.getByRole("button", { name: "三十二分音符", exact: true }).click();
  await popover.getByRole("button", { name: "单附点", exact: true }).click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].rhythm.dots === 1);
  const dotted = await snapshot();
  assert.deepEqual(dotted.measure.numberedVoice.events[0].rhythm, { base: "thirtySecond", dots: 1 });
  assert.deepEqual(dotted.measure.numberedVoice.events.filter(event => event.tick >= 960), before.measure.numberedVoice.events.slice(1));
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ passed: true, checks: ["quarter to sixteenth retains note plus three independent gaps", "three visible non-overlapping positions", "shortening is one undoable command", "each gap clickable and inherits sixteenth", "individual input preserves later notes and lyrics", "continuous input fills exactly four positions", "repeated Enter adds no history", "quarter to thirty-second then dot remains valid with exact implicit remainder"], pageErrors: errors, geometry }, null, 2) + "\n");
  await rm(path.join(output, "failure.png"), { force: true });
  console.log("BUG-025 reacceptance passed: three editable gaps, click/fill, continuous input, fixed later ticks and undo/redo.");
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" });
  console.error("Browser errors:", errors, "Body:", await page?.locator("body").innerText());
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
