import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(process.env.LXM_CHORD_ARTIFACTS ?? path.resolve(website, "../../output/playwright/req019-020-035"));
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/req019-020-035"),
  resolve: { dedupe: ["react", "react-dom"] }, esbuild: { jsx: "automatic" },
  optimizeDeps: { entries: ["tests/req019-030-chords.browser.tsx"], include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "next/link"] },
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "req019-020-035", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__recommendations__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/tests/req019-030-chords.browser.tsx"></script>'));
    });
  } }],
});
let browser;
const errors = [], checks = [];
const geometry = async (cards) => cards.evaluateAll(nodes => nodes.map(node => {
  const box = node.getBoundingClientRect();
  const diagram = node.querySelector("svg").getBoundingClientRect();
  const name = node.firstElementChild.getBoundingClientRect();
  return { x: Math.round(box.x), y: Math.round(box.y), height: box.height,
    nameAboveDiagram: name.bottom <= diagram.top,
    nameContained: name.left >= box.left && name.right <= box.right,
    fullTitle: node.title === node.getAttribute("aria-label") };
}));
const assertGrid = (cards) => {
  assert.equal(cards.length, 8);
  assert.equal(new Set(cards.map(card => card.x)).size, 4);
  assert.equal(new Set(cards.map(card => card.y)).size, 2);
  assert.ok(cards.every(card => card.height === 64 && card.nameAboveDiagram && card.nameContained && card.fullTitle), JSON.stringify(cards));
};
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.LXM_BROWSER_CHANNEL ?? "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  const button = (root, name) => root.getByRole("button", { name: /^\p{Script=Han}{2}$/u.test(name) ? new RegExp(`^${[...name].join("\\s*")}$`) : name, exact: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__recommendations__`, { waitUntil: "commit" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  await sidebar.waitFor({ timeout: 90000 });
  const snapshot = () => page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth }));
  const baseline = await snapshot();
  const chord = baseline.document.score.tracks[0].measures.flatMap(m => m.chordSymbols).find(c => c.chord.diagram);
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  await svg.getByText(chord.chord.name, { exact: true }).first().click();
  const popover = page.locator("#chord-edit-popover");
  const name = page.locator("#chord-popover-name");
  await name.waitFor();
  const sideGroup = sidebar.getByRole("group", { name: "本调常用和弦", exact: true });
  const popupGroup = popover.getByRole("group", { name: "本调常用和弦", exact: true });
  const sideCards = sideGroup.getByRole("button");
  const cardNames = cards => cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
  await sideCards.nth(7).waitFor();
  assertGrid(await geometry(sideCards));
  assertGrid(await geometry(popupGroup.getByRole("button")));
  assert.deepEqual(await cardNames(popupGroup.getByRole("button")), await cardNames(sideCards));
  const signature = `1=${baseline.document.score.keySignature}`;
  await popover.getByText(signature, { exact: true }).waitFor();
  await sidebar.getByRole("region", { name: "常用和弦", exact: true }).getByText(signature, { exact: true }).waitFor();
  const inputBox = await name.boundingBox();
  const applyBox = await button(popover, "应用").boundingBox();
  assert.equal(Math.round(inputBox.y), Math.round(applyBox.y));
  const [first, second, third] = await cardNames(sideCards);
  await button(sideGroup, second).click();
  assert.equal(await name.inputValue(), second);
  assert.equal(await button(popupGroup, second).getAttribute("aria-pressed"), "true");
  await button(popupGroup, third).click();
  assert.equal(await sidebar.getByRole("textbox", { name: "和弦名称", exact: true }).inputValue(), third);
  assert.equal(await button(sideGroup, third).getAttribute("aria-pressed"), "true");
  assert.deepEqual(await snapshot(), baseline);
  checks.push("两处4×2紧凑卡片上名下图，调号一致，选用同步更新草稿");
  await page.screenshot({ path: path.join(output, "sidebar-popover.png"), animations: "disabled" });
  const library = page.getByRole("dialog", { name: /^和弦库/ });
  for (const surface of [popover, sidebar, popover]) {
    const opener = button(surface, "和弦库");
    await opener.click();
    const search = library.getByRole("textbox", { name: "库内搜索全部和弦", exact: true });
    await search.fill("Bm");
    await library.getByTestId("chord-library-scroll").getByText("Bm", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await library.waitFor({ state: "hidden" });
    await page.waitForFunction(element => element === document.activeElement, await opener.elementHandle());
  }
  assert.deepEqual(await snapshot(), baseline);
  assert.equal(await name.inputValue(), third);
  await button(popover, "应用").click();
  const committed = await snapshot();
  assert.equal(committed.history.past, baseline.history.past + 1);
  assert.equal(committed.document.score.tracks[0].measures.flatMap(m => m.chordSymbols).find(c => c.id === chord.id).chord.name, third);
  await svg.focus();
  await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual((await snapshot()).document.score, baseline.document.score);
  checks.push("两处直达可搜索的完整库，关闭后恢复触发按钮焦点与草稿，应用只写一条可撤销历史");
  await page.setViewportSize({ width: 390, height: 640 });
  await popover.waitFor({ state: "hidden" });
  await sideGroup.scrollIntoViewIfNeeded();
  await button(sideGroup, first).click();
  const bounds = await sideGroup.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, JSON.stringify(bounds));
  assertGrid(await geometry(sideCards));
  assert.equal(await sidebar.getByRole("textbox", { name: "和弦名称", exact: true }).inputValue(), first);
  checks.push("390px 窄窗口可横向滚动到侧栏并使用四列卡片");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(document => {
    document.score.tracks[0].tuning.strings[5] = { index: 6, pitch: "D2", midi: 38 };
    const result = window.coexistStore.getState().replaceDocument(document);
    if (!result.ok) throw new Error(result.errors.join("；"));
  }, baseline.document);
  await svg.getByText(chord.chord.name, { exact: true }).first().click();
  const alternateTuning = await snapshot();
  for (const surface of [popover, sidebar]) {
    const cards = surface.getByRole("group", { name: "本调常用和弦", exact: true }).getByRole("button");
    assert.equal(await cards.count(), 8);
    assert.ok(await cards.evaluateAll(nodes => nodes.every(card => card.disabled)));
    await button(surface, "和弦库").click();
    await library.getByRole("textbox", { name: "库内搜索全部和弦", exact: true }).fill("Bm");
    await library.getByTestId("chord-library-scroll").getByText("Bm", { exact: true }).click();
    assert.equal(await button(library, "选用此指法").isDisabled(), true);
    await page.keyboard.press("Escape");
    await library.waitFor({ state: "hidden" });
  }
  assert.deepEqual(await snapshot(), alternateTuning);
  checks.push("非标准调弦仍可从两处浏览完整库，系统指法不可用于草稿");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors, output }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
