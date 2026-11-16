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
  const name = node.lastElementChild.getBoundingClientRect();
  return { x: Math.round(box.x), y: Math.round(box.y), height: box.height,
    diagramAboveName: diagram.bottom <= name.top,
    nameContained: name.left >= box.left && name.right <= box.right,
    fullTitle: node.title === node.getAttribute("aria-label") };
}));
const assertGrid = (cards) => {
  assert.equal(cards.length, 8);
  assert.equal(new Set(cards.map(card => card.x)).size, 4);
  assert.equal(new Set(cards.map(card => card.y)).size, 2);
  assert.ok(cards.every(card => card.height === 78 && card.diagramAboveName && card.nameContained && card.fullTitle), JSON.stringify(cards));
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
  const sideCards = sidebar.getByLabel("本调常用和弦", { exact: true }).getByRole("button");
  await sideCards.nth(7).waitFor();
  assertGrid(await geometry(sideCards));
  const inputBox = await name.boundingBox();
  const applyBox = await button(popover, "应用").boundingBox();
  assert.equal(Math.round(inputBox.y), Math.round(applyBox.y));
  await sidebar.getByLabel("本调常用和弦", { exact: true }).getByRole("button", { name: "Am", exact: true }).click();
  assert.equal(await name.inputValue(), "Am");
  assert.deepEqual(await snapshot(), baseline);
  checks.push("侧栏4×2紧凑卡片上图下名，title提供全名；选用仅更新共享草稿；名称与应用同行");
  await page.screenshot({ path: path.join(output, "sidebar-popover.png"), animations: "disabled" });
  await button(popover, "更多和弦").click();
  const popup = page.locator(".ant-dropdown:not(.ant-dropdown-hidden)");
  const search = popup.getByRole("textbox", { name: "搜索全部和弦", exact: true });
  await search.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden)')].every(node => getComputedStyle(node).opacity === "1" && !/(?:appear|enter)(?:-active|-prepare)?(?:\s|$)/.test(node.className)));
  const popupCards = popup.getByRole("button").filter({ has: page.getByRole("img", { name: "指法图预览", exact: true }) });
  assertGrid(await geometry(popupCards));
  assert.equal(await popup.getByText("浏览完整和弦库", { exact: true }).count(), 0);
  const recommendationBox = await popup.getByText("C大调·和弦推荐", { exact: true }).boundingBox();
  const libraryBox = await button(popup, "和弦库").boundingBox();
  assert.ok(Math.abs(recommendationBox.y - libraryBox.y) <= 2);
  await page.screenshot({ path: path.join(output, "more-recommendations.png"), animations: "disabled" });
  checks.push("更多下拉搜索下方同排推荐与库入口，推荐共用4×2卡片，移除底部入口");
  await search.fill("Bm");
  await popup.getByRole("button", { name: "Bm", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  assert.equal(await button(popover, "更多和弦").evaluate(node => node === document.activeElement), true);
  await button(popover, "更多和弦").click();
  await search.waitFor();
  await button(popup, "和弦库").click();
  const library = page.getByRole("dialog", { name: /^和弦库/ });
  await library.waitFor();
  await button(library, "取消").click();
  await library.waitFor({ state: "hidden" });
  for (let i = 0; i < 3; i++) {
    await button(popover, "更多和弦").click();
    await search.waitFor();
    await button(popover, "关闭快捷编辑").click();
    await name.waitFor({ state: "detached" });
    await svg.getByText(chord.chord.name, { exact: true }).first().click();
    await name.waitFor();
  }
  assert.deepEqual(await snapshot(), baseline);
  assert.deepEqual(errors, []);
  checks.push("搜索与Escape焦点恢复、库入口、嵌套下拉反复关闭重开均正常，文档及历史保持");
  await writeFile(path.join(output, "result.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors, output }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
