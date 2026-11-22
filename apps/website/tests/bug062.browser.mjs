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
const entry = "tests/bug059.browser.tsx";
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.join(website, "node_modules/.vite/bug062"),
  optimizeDeps: { entries: [entry], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug062-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bug062__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, `<!doctype html><div id="root"></div><script type="module" src="/${entry}"></script>`));
    });
  } }],
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug062__`);
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score.waitFor({ timeout: 90000 });
  const rest = page.getByRole("button", { name: "切换休止", exact: true });
  const snapshot = () => page.evaluate(() => {
    const { document, selection, selectedTraversalIds, historyDepth } = window.traversalRangeStore.getState();
    const track = document.score.tracks[0];
    return { document, selection, selectedTraversalIds, historyDepth, techniques: track.techniques, measure: track.measures[0] };
  });
  await page.evaluate(() => {
    const store = window.traversalRangeStore;
    const document = structuredClone(store.getState().document);
    const track = document.score.tracks[0];
    const { beats } = track.measures[0];
    // 截图里的扫弦由和弦拍发音，底层 Beat 已是 rest。保留第三拍的逐弦音以覆盖混合内容。
    for (const beat of beats.slice(0, 2)) {
      beat.kind = "rest";
      beat.notes = [];
    }
    track.techniques.push({ id: "dependent", type: "traversalTie", fromBeatId: beats[0].id, toBeatId: beats[1].id });
    const result = store.getState().replaceDocument(document);
    if (!result.ok) throw new Error(JSON.stringify(result));
  });

  const inspectLayout = (request) => score.evaluate((svg, { index, string, arpeggio, readRests }) => {
    const key = Object.keys(svg).find((name) => name.startsWith("__reactFiber$"));
    let root = svg[key];
    while (root.return) root = root.return;
    const find = (fiber) => fiber && (fiber.memoizedProps?.layout?.systems ? fiber.memoizedProps.layout : find(fiber.child) ?? find(fiber.sibling));
    const system = find(root.stateNode.current).systems[0];
    const measure = system.measures[0];
    if (readRests) return measure.restMarks.map(({ beatId }) => beatId);
    const x = arpeggio ? system.techniques.find(({ techniqueId }) => techniqueId === "arpeggio-down").focusEndpoints.start.x : measure.beats[index].x;
    const p = new DOMPoint(x, measure.strings[string - 1].y1).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, request);
  const point = (index, string, arpeggio = false) => inspectLayout({ index, string, arpeggio });
  const restMarks = () => inspectLayout({ readRests: true });
  const click = async (index, string, arpeggio) => {
    const p = await point(index, string, arpeggio);
    await page.mouse.click(p.x, p.y);
  };
  const undo = async (before) => {
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.deepEqual((await snapshot()).document, before.document);
  };

  const before = await snapshot();
  // 截图路径：从首弦拖到末弦框选相邻扫弦，再点顶部休止符。
  const first = await point(0, 1);
  const last = await point(1, 6);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 12 });
  await page.mouse.up();
  const rectangular = await snapshot();
  assert.equal(rectangular.selection.anchor.beatId, before.measure.beats[0].id);
  assert.equal(rectangular.selection.focus.beatId, before.measure.beats[1].id);
  assert.equal(rectangular.selection.anchor.string, 1);
  assert.equal(rectangular.selection.focus.string, 6);
  assert.deepEqual(rectangular.selectedTraversalIds, []);
  assert.equal(await rest.getAttribute("aria-pressed"), "false");
  assert.deepEqual(await restMarks(), []);
  await rest.click();
  assert.equal(await rest.getAttribute("aria-pressed"), "true");
  await score.locator('[data-strum-id="strum-down"]').first().waitFor({ state: "detached" });
  let after = await snapshot();
  assert.deepEqual(after.techniques.map(({ id }) => id), ["arpeggio-down", "arpeggio-up"]);
  assert.deepEqual(after.measure, before.measure);
  assert.deepEqual(await restMarks(), before.measure.beats.slice(0, 2).map(({ id }) => id));
  assert.equal(after.historyDepth.past, before.historyDepth.past + 1);
  await score.focus();
  await page.keyboard.press("Shift+R");
  const restored = await snapshot();
  assert.deepEqual(restored.measure.beats.slice(0, 2).map(({ kind, notes }) => ({ kind, notes })), [
    { kind: "notes", notes: [] }, { kind: "notes", notes: [] },
  ]);
  assert.deepEqual(await restMarks(), []);
  await undo(after);
  await undo(before);

  for (const entry of ["sidebar", "shortcut"]) {
    const fromArpeggio = entry === "shortcut";
    await click(fromArpeggio ? 2 : 0, 2, fromArpeggio);
    await page.keyboard.down("Alt");
    await click(fromArpeggio ? 0 : 2, 2, !fromArpeggio);
    await page.keyboard.up("Alt");
    assert.deepEqual((await snapshot()).selectedTraversalIds, ["strum-down", "arpeggio-down"]);
    if (fromArpeggio) {
      await page.keyboard.press("Escape");
      assert.deepEqual((await snapshot()).selectedTraversalIds, ["arpeggio-down"]);
      await page.keyboard.down("Alt");
      await click(0, 2);
      await page.keyboard.up("Alt");
    }
    if (entry === "sidebar") await page.getByRole("button", { name: "整拍休止", exact: true }).click();
    else await page.keyboard.press("r");
    after = await snapshot();
    assert.deepEqual(after.techniques.map(({ id }) => id), ["strum-up", "arpeggio-up"]);
    assert.deepEqual(after.measure.beats[1], before.measure.beats[1]);
    assert.deepEqual(after.measure.beats[2], { ...before.measure.beats[2], kind: "rest", notes: [] });
    assert.equal(after.historyDepth.past, before.historyDepth.past + 1);
    await undo(before);
  }
  assert.deepEqual(errors, []);
  console.log("Verified rectangle toolbar, mixed Alt-click sidebar and shortcut, dependent ties and atomic undo.");
} finally {
  await browser?.close();
  await server.close();
}
