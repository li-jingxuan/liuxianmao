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
  browser = await chromium.launch({
    channel: process.env.LXM_BROWSER_CHANNEL,
    executablePath: process.env.LXM_CHROMIUM_EXECUTABLE,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(35000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
    if (message.type() === "error" && message.text().includes("flushSync")) errors.push(message.text());
  });
  stage = "load editor";
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug054-056__`, { waitUntil: "commit" });
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  await score.waitFor({ timeout: 120000 });
  const snapshot = () => page.evaluate(() => {
    const { document, historyDepth, selection } = window.bugFixStore.getState();
    return { document, past: historyDepth.past, beatId: selection?.focus.beatId };
  });
  const notes = async () => (await snapshot()).document.score.tracks[0].measures[0].beats
    .map((beat) => beat.notes[0]?.fret);
  const music = score.locator('[data-layer="score-music"]');
  // Control event spacing independently of the time Chrome spends rendering the changed score.
  const pressAt = (key, timeStamp) => score.evaluate((svg, { key, timeStamp }) => {
    svg.focus();
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
    svg.dispatchEvent(event);
    const { document, historyDepth } = window.bugFixStore.getState();
    return {
      frets: document.score.tracks[0].measures[0].beats.map((beat) => beat.notes[0]?.fret),
      past: historyDepth.past,
    };
  }, { key, timeStamp });
  const baseline = await snapshot();

  stage = "write the first digit synchronously and combine the second";
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const initialFretY = await music.getByText("10", { exact: true }).getAttribute("y");
  await score.evaluate((svg) => {
    const heights = [svg.getAttribute("height")];
    const observer = new MutationObserver(() => heights.push(svg.getAttribute("height")));
    observer.observe(svg, { attributes: true, attributeFilter: ["height"] });
    window.readFretScoreHeights = () => {
      observer.disconnect();
      return heights;
    };
  });
  const first = await pressAt("1", 1000);
  assert.equal(first.frets[0], 1, "the document changes inside the keydown event");
  assert.equal(first.past, baseline.past + 1);
  await music.getByText("1", { exact: true }).waitFor();
  assert.equal(await music.getByText("1", { exact: true }).getAttribute("y"), initialFretY);
  await music.getByText("10", { exact: true }).waitFor({ state: "detached" });
  assert.equal(await score.locator("[data-fret-draft-preview]").count(), 0);
  assert.equal(await page.getByText(/正在输入：|当前输入未应用/).count(), 0);
  const second = await pressAt("2", 1100);
  assert.equal(second.frets[0], 12);
  assert.equal(second.past, baseline.past + 1, "double digit uses one history entry");
  await music.getByText("12", { exact: true }).waitFor();
  assert.equal(await music.getByText("12", { exact: true }).getAttribute("y"), initialFretY);
  const heights = await page.evaluate(() => window.readFretScoreHeights());
  assert.equal(new Set(heights).size, 1, "fret-only changes keep the measured score height stable");
  await score.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  assert.equal((await notes())[0], 10);
  await score.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
  assert.equal((await notes())[0], 12);

  stage = "keep digits separate across cell changes, elapsed time and Escape";
  assert.equal((await pressAt("2", 2000)).frets[0], 2);
  await score.press("ArrowRight");
  assert.equal((await snapshot()).beatId, "beat-1");
  assert.deepEqual((await pressAt("1", 2100)).frets.slice(0, 2), [2, 1]);
  assert.equal((await pressAt("2", 2800)).frets[1], 2);
  await score.press("Escape");
  assert.equal((await notes())[1], 2, "Escape leaves the applied digit intact");
  assert.equal((await pressAt("4", 2900)).frets[1], 4);

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
  assert.equal((await pressAt("1", 4000)).frets[1], 1);
  assert.equal((await pressAt("0", 4100)).frets[1], 10);

  stage = "switch between empty numbered and lyric tabs";
  await sidebar.getByRole("tab", { name: "简谱与歌词", exact: true }).click();
  const numbered = score.locator('[data-paragraph-cell^="numbered/"]');
  const lyrics = score.locator('[data-paragraph-cell^="lyric/"]');
  assert.equal(await numbered.count(), 0);
  assert.equal(await lyrics.count(), 0);
  const beforeParagraph = await snapshot();
  await sidebar.getByRole("button", { name: "录入简谱", exact: true }).click();
  await numbered.first().waitFor();
  await sidebar.locator("#paragraph-tab-lyric").click();
  const startLyric = sidebar.getByRole("button", { name: "录入歌词", exact: true });
  await startLyric.waitFor();
  assert.ok(await numbered.count());
  assert.equal(await lyrics.count(), 0, "switching tabs leaves the unopened lyric row absent");
  assert.deepEqual(await snapshot(), beforeParagraph);

  await startLyric.click();
  await lyrics.first().waitFor();
  for (const kind of ["lyric", "numbered", "lyric"]) {
    await sidebar.locator(`#paragraph-tab-${kind}`).click();
    await score.locator(`[data-paragraph-focus="${kind}"]`).waitFor();
    assert.ok(await numbered.count());
    assert.ok(await lyrics.count());
  }
  const afterParagraph = await snapshot();
  assert.deepEqual(afterParagraph.document, beforeParagraph.document);
  assert.equal(afterParagraph.past, beforeParagraph.past);

  stage = "add, remove and re-add the numbered row without a focus error";
  await sidebar.locator("#paragraph-tab-numbered").click();
  const addNumbered = sidebar.getByRole("button", { name: "添加简谱行", exact: true });
  const numberedInput = sidebar.getByRole("textbox", { name: "简谱内容", exact: true });
  const expectNumberedFocus = () => page.waitForFunction(
    () => document.activeElement?.id === "numbered-sidebar-content",
  );
  await addNumbered.press("Enter");
  await numberedInput.waitFor();
  await expectNumberedFocus();
  const added = await snapshot();
  assert.equal(added.past, afterParagraph.past + 1);
  assert.equal(await addNumbered.getAttribute("aria-disabled"), "true");
  await addNumbered.press("Enter");
  await addNumbered.dispatchEvent("click");
  assert.deepEqual(await snapshot(), added, "repeated activation does not write another row");
  await sidebar.getByRole("button", { name: "简谱行操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除简谱行", exact: true }).click();
  await numberedInput.waitFor({ state: "detached" });
  assert.equal((await snapshot()).past, added.past + 1);
  await addNumbered.press("Enter");
  await expectNumberedFocus();
  assert.equal((await snapshot()).past, added.past + 2);

  stage = "start lyrics on a new score with only a TAB selection";
  await page.evaluate(() => window.bugFixOpenBlankScore());
  const blank = await snapshot();
  assert.equal(blank.beatId, "beat-1-1");
  await sidebar.getByRole("tab", { name: "简谱与歌词", exact: true }).click();
  await sidebar.locator("#paragraph-tab-lyric").click();
  await startLyric.waitFor();
  await sidebar.getByRole("heading", { name: "从当前谱面位置开始" }).waitFor();
  assert.equal(await numbered.count(), 0);
  assert.equal(await lyrics.count(), 0);
  assert.deepEqual(await snapshot(), blank);

  await page.evaluate(() => window.bugFixStore.getState().setSelection(null));
  await sidebar.getByRole("heading", { name: "从首个可录入位置开始" }).waitFor();
  const beforeLyricEntry = await snapshot();
  await startLyric.click();
  await score.locator('[data-paragraph-cell="lyric/measure-1/time-0-960/1"]').first().waitFor({ state: "attached" });
  const lyricInput = sidebar.getByRole("textbox", { name: "连续歌词", exact: true });
  await lyricInput.waitFor();
  await page.waitForFunction((id) => document.activeElement?.id === id, await lyricInput.getAttribute("id"));
  assert.equal(await numbered.count(), 0);
  assert.deepEqual(await snapshot(), beforeLyricEntry);
  assert.deepEqual(errors, []);
  console.log("BUG-054/055/056 browser passed: synchronous fret edits with grouped undo, Em/G fret windows, and empty rows created only by explicit editing.");
} catch (error) {
  throw new Error(`Browser regression failed at ${stage}${errors.length ? ` (${errors.join("; ")})` : ""}`, { cause: error });
} finally {
  await browser?.close();
  await server.close();
}
