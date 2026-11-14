// 在真实编辑器中复核连续简谱输入、TAB 入口及拍点延音，夹具只替换合法文档和选区。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const artifacts = path.resolve(website, "../../output/playwright/bug017-020");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/bug017-020"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug017-020", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bug017-020__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url,
        '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});

let browser;
let page;
const errors = [];
try {
  await mkdir(artifacts, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug017-020__`);
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const sidebar = page.locator("#music-text-sidebar");
  await score.waitFor({ timeout: Number(process.env.LXM_BROWSER_READY_TIMEOUT ?? 90000) });
  const baseline = await page.evaluate(() => window.coexistStore.getState().document);
  const reset = async (scenario) => {
    await page.evaluate(({ baseline, scenario }) => {
      const document = structuredClone(baseline);
      const track = document.score.tracks[0];
      document.score.tracks = [track];
      track.techniques = [];
      track.numberedMarks = [];
      const measure = track.measures[0];
      track.measures = [measure];
      measure.timeSignature = scenario === "six-eight" ? { numerator: 6, denominator: 8 } : { numerator: 4, denominator: 4 };
      measure.chordSymbols = [];
      measure.lyrics = [];
      measure.tuplets = [];
      const sixteenths = scenario === "sixteenths";
      const starts = scenario === "six-eight" ? [0, 480, 960, 1440, 1920, 2400]
        : sixteenths ? [0, 240, 480, 720, 960, 1920, 2880] : [0, 480, 720, 960, 1920, 2880];
      measure.beats = starts.map((tick, index) => ({
        id: `bug-tab-${index}`, tick, kind: "notes", notes: [],
        rhythm: { base: scenario === "six-eight" ? "eighth" : tick >= 960 ? "quarter" : sixteenths || tick > 0 ? "sixteenth" : "eighth", dots: 0 },
      }));
      const event = (tick, base, index) => ({
        id: `bug-event-${index}`, tick, kind: "notes", rhythm: { base, dots: 0 },
        items: [{ id: `bug-item-${index}`, token: "1" }],
      });
      measure.numberedVoice = { tuplets: [], events: scenario === "six-eight" ? []
        : scenario === "inside" ? [0, 960, 1920, 2880].map((tick, index) => event(tick, "quarter", index))
          : sixteenths ? [0, 240, 480, 720, 960, 1920, 2880].map((tick, index) => event(tick, tick < 960 ? "sixteenth" : "quarter", index))
            : [event(0, "eighth", 0), ...[960, 1920, 2880].map((tick, index) => event(tick, "quarter", index + 1))] };
      const loaded = window.coexistStore.getState().replaceDocument(document);
      if (!loaded.ok) throw new Error(loaded.errors.join("; "));
    }, { baseline, scenario });
    await page.waitForFunction(() => !!window.coexistStore.getState().document.score.tracks[0].measures[0].beats.find((beat) => beat.id === "bug-tab-0"));
  };
  const snapshot = () => page.evaluate(() => {
    const state = window.coexistStore.getState();
    return { measure: state.document.score.tracks[0].measures[0], history: state.historyDepth, numberedSelection: state.numberedSelection };
  });
  const editFirst = async () => {
    await score.locator('text[data-numbered-event="bug-event-0"], [data-numbered-event="bug-event-0"] text').first().click();
    await sidebar.getByRole("tab", { name: "简谱与歌词", exact: true }).click();
    const input = sidebar.getByRole("textbox", { name: "音符内容", exact: true });
    if (!(await input.count())) {
      const mode = sidebar.getByRole("radio", { name: "连续输入", exact: true });
      await mode.locator("..").click();
    }
    return sidebar.getByRole("textbox", { name: "音符内容", exact: true });
  };
  const summaries = [];

  await reset("mixed");
  let input = await editFirst();
  await input.fill("5 6 7");
  await input.press("Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].items[0].token === "5");
  let state = await snapshot();
  assert.deepEqual(state.measure.numberedVoice.events.slice(0, 3).map((event) => [event.tick, event.rhythm.base, event.items[0].token]), [[0, "eighth", "5"], [480, "sixteenth", "6"], [720, "sixteenth", "7"]]);
  assert.equal(state.measure.numberedVoice.events.find((event) => event.tick === 960).items[0].token, "1");
  const appliedHistory = state.history.past;
  await input.press("Enter");
  assert.equal((await snapshot()).history.past, appliedHistory, "重复Enter不生成重复历史");
  await input.fill("2 3 4");
  await input.press("Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].items[0].token === "2");
  state = await snapshot();
  assert.deepEqual(state.measure.numberedVoice.events.slice(0, 3).map((event) => event.tick), [0, 480, 720]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.deepEqual((await snapshot()).measure.numberedVoice.events.slice(0, 3).map((event) => event.items[0].token), ["5", "6", "7"]);
  summaries.push("BUG-017 mixed slots, repeated Enter, reapply at original position, undo");
  await page.screenshot({ path: path.join(artifacts, "bug017.png"), animations: "disabled" });
  const eventSelector = sidebar.getByLabel("当前简谱事件", { exact: true });
  const advanced = sidebar.locator("details").filter({ has: page.getByLabel("当前简谱事件", { exact: true }) }).last();
  if ((await advanced.getAttribute("open")) === null) await advanced.locator("summary").first().click();
  await eventSelector.click();
  await page.getByText("新增时间范围", { exact: true }).last().click();
  await page.waitForFunction(() => document.querySelector('[aria-label="当前简谱事件"]')?.closest(".ant-select")?.textContent.includes("新增时间范围"));
  assert.equal((await snapshot()).measure.numberedVoice.events[0].tick, 0, "切换范围不修改现有音符");
  summaries.push("BUG-019 existing-event advanced range switch preserves time target");

  await reset("sixteenths");
  input = await editFirst();
  await input.fill("2 3 3");
  await input.press("Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events[0].items[0].token === "2");
  state = await snapshot();
  assert.deepEqual(state.measure.numberedVoice.events.slice(0, 5).map((event) => [event.tick, event.items[0].token]), [[0, "2"], [240, "3"], [480, "3"], [720, "1"], [960, "1"]]);
  summaries.push("BUG-020 real sixteenth targets preserve fourth and next beat");

  await reset("inside");
  await page.evaluate(() => {
    const store = window.coexistStore;
    const track = store.getState().document.score.tracks[0];
    const measure = track.measures[0];
    const cell = { trackId: track.id, measureId: measure.id, beatId: "bug-tab-1", string: 4 };
    store.getState().setSelection({ anchor: cell, focus: cell });
  });
  await sidebar.getByRole("tab", { name: "简谱与歌词", exact: true }).click();
  await sidebar.getByRole("button", { name: "在当前位置录入简谱", exact: true }).click();
  await page.waitForFunction(() => window.coexistStore.getState().numberedSelection?.eventId === "bug-event-0");
  assert.equal((await snapshot()).measure.numberedVoice.events.length, 4);
  assert.equal((await snapshot()).history.past, 0, "只打开入口不写入文档历史");
  summaries.push("BUG-019 TAB interior opens covering event without phantom or history");

  for (const scenario of ["inside", "six-eight"]) {
    await reset(scenario);
    await page.evaluate(() => {
      const store = window.coexistStore;
      const track = store.getState().document.score.tracks[0];
      const measure = track.measures[0];
      const cell = { trackId: track.id, measureId: measure.id, beatId: "bug-tab-0", string: 6 };
      store.getState().setSelection({ anchor: cell, focus: cell });
    });
    await sidebar.getByRole("tab", { name: "选区", exact: true }).click();
    await sidebar.getByRole("radio", { name: "音符", exact: true }).locator("..").click();
    await sidebar.getByRole("button", { name: "延音标记", exact: true }).click();
    await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].beats[0].notes.some((note) => note.fret === "-"));
    state = await snapshot();
    assert.deepEqual(state.measure.beats[0].rhythm, { base: scenario === "six-eight" ? "eighth" : "quarter", dots: 0 });
    assert.equal(state.measure.beats[0].notes.length, 1);
    const history = state.history.past;
    await sidebar.getByRole("button", { name: "延音标记", exact: true }).click();
    assert.equal((await snapshot()).history.past, history);
    const markerCount = await score.locator('line[stroke-width="1.6"]').evaluateAll((lines) => lines.filter((line) =>
      Number(line.getAttribute("y1")) === Number(line.getAttribute("y2")) &&
      Math.abs(Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) - 12) < 0.01).length);
    assert.equal(markerCount, 1, "只绘制一个居中延音横线");
    await page.evaluate(() => {
      const store = window.coexistStore;
      const selected = store.getState().selection;
      store.getState().setSelection({ anchor: { ...selected.anchor, string: 1 }, focus: { ...selected.focus, string: 1 } });
    });
    await score.focus();
    await page.keyboard.press("Delete");
    await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].beats[0].notes.length === 0);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal((await snapshot()).measure.beats[0].notes.length, 1, "任意弦删除可一次撤销恢复");
    await page.screenshot({ path: path.join(artifacts, `bug018-${scenario}.png`), animations: "disabled" });
    summaries.push(`BUG-018 ${scenario}: one marker from string 6, unit duration, repeated command no-op, delete from string 1 and undo`);
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ passed: summaries, pageErrors: errors }, null, 2));
  await Promise.all(["failure.png", "failure.html"].map((file) => rm(path.join(artifacts, file), { force: true })));
  console.log(JSON.stringify({ passed: summaries, artifacts }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(artifacts, "failure.png"), animations: "disabled" });
    await writeFile(path.join(artifacts, "failure.html"), await page.content());
    console.error(JSON.stringify({ pageErrors: errors, body: (await page.locator("body").innerText()).slice(0, 6000) }, null, 2));
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
