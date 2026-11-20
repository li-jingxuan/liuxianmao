import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const entry = "tests/bug054-056.browser.tsx";
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.join(website, "node_modules/.vite/bug054-056"),
  optimizeDeps: { entries: [entry], include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "next/link"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug054-056-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bug054-056__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, `<!doctype html><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/${entry}"></script>`));
    });
  } }],
});

let browser;
let stage = "start browser";
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(35000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  stage = "load editor";
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug054-056__`, { waitUntil: "commit" });
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  await score.waitFor({ timeout: 90000 });
  const snapshot = () => page.evaluate(() => {
    const { document, historyDepth, selection } = window.bugFixStore.getState();
    return { document, past: historyDepth.past, beatId: selection?.focus.beatId };
  });
  const notes = async () => (await snapshot()).document.score.tracks[0].measures[0].beats
    .map((beat) => beat.notes[0]?.fret);
  const preview = score.locator("[data-fret-draft-preview] text");
  const holdFretTimers = () => page.evaluate(() => {
    const setTimeout = window.setTimeout;
    const clearTimeout = window.clearTimeout;
    const pending = new Map();
    let nextId = -1;
    window.setTimeout = (callback, delay, ...args) => {
      if (delay !== 600) return setTimeout(callback, delay, ...args);
      const id = nextId--;
      pending.set(id, () => callback(...args));
      return id;
    };
    window.clearTimeout = (id) => {
      if (!pending.delete(id)) clearTimeout(id);
    };
    window.releaseFretTimers = () => {
      for (const [id, callback] of pending) {
        pending.delete(id);
        callback();
      }
    };
    window.restoreFretTimers = () => Object.assign(window, { setTimeout, clearTimeout });
  });
  stage = "hold fret commit timers";
  await holdFretTimers();
  const baseline = await snapshot();

  stage = "preview first fret digit";
  await score.press("1");
  await preview.waitFor();
  assert.equal(await preview.textContent(), "1");
  assert.deepEqual(await snapshot(), baseline, "preview appears with the commit clock paused");
  stage = "commit second fret digit";
  await score.press("2");
  assert.equal((await notes())[0], 12);
  assert.equal((await snapshot()).past, baseline.past + 1, "double digit uses one history entry");
  await preview.waitFor({ state: "detached" });

  stage = "commit on navigation and timeout, cancel on Escape";
  await score.press("2");
  await score.press("ArrowRight");
  assert.equal((await notes())[0], 2, "navigating commits the digit on the old cell");
  assert.equal((await snapshot()).beatId, "beat-1");
  await score.press("1");
  assert.equal((await notes())[1], undefined);
  await page.evaluate(() => window.releaseFretTimers());
  assert.deepEqual((await notes()).slice(0, 2), [2, 1]);
  assert.equal((await snapshot()).past, baseline.past + 3);
  await score.press("2");
  await score.press("Escape");
  await page.evaluate(() => window.releaseFretTimers());
  assert.deepEqual((await notes()).slice(0, 2), [2, 1]);
  assert.equal((await snapshot()).past, baseline.past + 3, "Escape cancels the pending digit");
  await page.evaluate(() => window.restoreFretTimers());

  stage = "apply Em and G recommendations";
  await sidebar.getByRole("tab", { name: "和弦", exact: true }).click();
  for (const name of ["Em", "G"]) {
    await sidebar.getByRole("button", { name, exact: true }).click();
    await sidebar.getByRole("button", { name: "编辑指法", exact: true }).click();
    const custom = page.getByRole("dialog", { name: /^自定义指法/ });
    const startFret = custom.getByRole("textbox", { name: "观察窗口起始品位", exact: true });
    await startFret.waitFor();
    assert.equal(await startFret.inputValue(), "1");
    await custom.getByRole("button", { name: /^取\s*消$/ }).click();
    await custom.waitFor({ state: "hidden" });
    await sidebar.getByRole("button", { name: /^应\s*用$/ }).click();
    const { document } = await snapshot();
    const [symbol] = document.score.tracks[0].measures[0].chordSymbols;
    assert.equal(symbol.chord.name, name);
    assert.equal(symbol.chord.diagram.startFret, 1);
  }

  stage = "enter a fret with the chord sidebar visible";
  await holdFretTimers();
  await score.press("1");
  await score.press("0");
  assert.equal((await notes())[1], 10);
  await page.evaluate(() => window.restoreFretTimers());

  stage = "switch between empty numbered and lyric tabs";
  await sidebar.getByRole("tab", { name: "简谱与歌词", exact: true }).click();
  const numbered = score.locator('[data-paragraph-cell^="numbered/"]');
  const lyrics = score.locator('[data-paragraph-cell^="lyric/"]');
  assert.equal(await numbered.count(), 0);
  assert.equal(await lyrics.count(), 0);
  const beforeParagraph = await snapshot();
  await sidebar.getByRole("button", { name: "录入简谱", exact: true }).click();
  await numbered.first().waitFor();
  for (const kind of ["lyric", "numbered", "lyric"]) {
    await sidebar.locator(`#paragraph-tab-${kind}`).click();
    await score.locator(`[data-paragraph-focus="${kind}"]`).waitFor();
    assert.ok(await numbered.count());
    assert.ok(await lyrics.count());
  }
  const afterParagraph = await snapshot();
  assert.deepEqual(afterParagraph.document, beforeParagraph.document);
  assert.equal(afterParagraph.past, beforeParagraph.past);
  assert.deepEqual(errors, []);
  console.log("BUG-054/055/056 browser passed: immediate fret preview, single undo entry per input, Em/G fret windows, and both empty paragraph rows surviving tab switches.");
} catch (error) {
  throw new Error(`Browser regression failed at ${stage}${errors.length ? ` (${errors.join("; ")})` : ""}`, { cause: error });
} finally {
  await browser?.close();
  await server.close();
}
