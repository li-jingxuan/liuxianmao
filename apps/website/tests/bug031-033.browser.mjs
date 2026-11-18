import assert from "node:assert/strict";
import { openScorePng } from "./score-file-actions.browser.cjs";
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
const output = process.env.LXM_CHORD_ARTIFACTS ?? path.resolve(website, "../../output/playwright/bug031-033");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/bug031-033"),
  resolve: { dedupe: ["react", "react-dom"] }, esbuild: { jsx: "automatic" },
  optimizeDeps: { entries: ["tests/req019-030-chords.browser.tsx"], include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "next/link"] },
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug031-033", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bugs__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/tests/req019-030-chords.browser.tsx"></script>'));
    });
  } }],
});
let browser, page;
const errors = [], checks = [];
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.LXM_BROWSER_CHANNEL ?? "chrome" });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bugs__`, { waitUntil: "commit" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  const popover = page.locator("#chord-edit-popover");
  const library = page.getByRole("dialog", { name: /^和弦库/ });
  const search = library.getByRole("textbox", { name: "库内搜索全部和弦", exact: true });
  const button = (root, name) => root.getByRole("button", { name: /^\p{Script=Han}{2}$/u.test(name) ? new RegExp(`^${[...name].join("\\s*")}$`) : name, exact: true });
  await sidebar.waitFor({ timeout: 90000 });
  const snapshot = () => page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth }));
  const baseline = await snapshot();
  const chord = baseline.document.score.tracks[0].measures.flatMap(m => m.chordSymbols).find(c => c.chord.diagram);
  const open = async () => {
    await svg.getByText(chord.chord.name, { exact: true }).first().click();
    await page.locator("#chord-popover-name").waitFor();
  };
  const opener = button(popover, "和弦库");
  await open();
  await opener.click();
  await search.fill("Bm");
  await library.getByTestId("chord-library-scroll").getByText("Bm", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "chord-library-search.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await library.waitFor({ state: "hidden" });
  await page.waitForFunction(node => node === document.activeElement, await opener.elementHandle());
  assert.deepEqual(await snapshot(), baseline);
  checks.push("和弦库可搜索，Escape 关闭并恢复触发按钮焦点，文档与历史不变");
  await opener.click();
  await library.waitFor();
  await library.evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  await page.waitForFunction(node => node === document.activeElement, await search.elementHandle());
  await library.getByLabel("临时浏览主音", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("D", { exact: true }).click();
  await library.getByLabel("临时浏览大小调", { exact: true }).click();
  await library.getByLabel("临时浏览大小调", { exact: true }).press("ArrowDown");
  await library.getByLabel("临时浏览大小调", { exact: true }).press("Enter");
  await button(library, "取消").click();
  await library.waitFor({ state: "hidden" });
  checks.push("快捷入口打开和弦库，Select 弹层与取消恢复正常");
  for (let i = 0; i < 3; i++) {
    await opener.click();
    await search.waitFor();
    await page.keyboard.press("Escape");
    await library.waitFor({ state: "hidden" });
    await button(popover, "关闭快捷编辑").click();
    await page.locator("#chord-popover-name").waitFor({ state: "detached" });
    await open();
  }
  checks.push("反复退出和弦库、关闭并重新打开快捷编辑");
  await sidebar.getByRole("tab", { name: "歌曲", exact: true }).click();
  await page.locator("#chord-popover-name").waitFor({ state: "detached" });
  await open();
  assert.deepEqual(await snapshot(), baseline);
  checks.push("切换侧栏再进入和弦编辑，草稿链路与历史正常");
  const renderedChords = () => page.evaluate(() => {
    const svg = document.querySelector('svg[role="application"]');
    const key = Object.keys(svg).find(key => key.startsWith("__reactFiber$"));
    const find = fiber => !fiber ? null : fiber.memoizedProps?.layout?.systems ? fiber.memoizedProps.layout : find(fiber.child) ?? find(fiber.sibling);
    return find(svg[key]).systems.flatMap(s => s.measures.flatMap(m => m.chordSymbols ?? [])).map(c => ({ id: c.id, name: c.label.text, diagram: !!c.diagram }));
  });
  const originalChords = await renderedChords();
  const diagramCount = originalChords.filter(c => c.diagram).length;
  assert.ok(diagramCount > 1);
  const editCircles = await svg.locator("circle").count();
  await page.locator('[data-score-print-layer][data-print-ready="true"]').waitFor({ state: "attached" });
  const printCircles = await page.locator("[data-score-print-layer] circle").count();
  const sideName = sidebar.getByRole("textbox", { name: "和弦名称", exact: true });
  await sideName.fill("尚未应用的名称");
  await sidebar.getByRole("radio", { name: "仅名称", exact: true }).check();
  await page.waitForFunction(before => document.querySelectorAll('svg[role="application"] circle').length < before, editCircles);
  assert.deepEqual(await renderedChords(), originalChords.map(c => ({ ...c, diagram: false })));
  assert.equal(await sideName.inputValue(), "尚未应用的名称");
  await sidebar.getByText("Tips: 谱面显示配置全局生效。", { exact: true }).waitFor();
  await page.waitForFunction(before => document.querySelector('[data-score-print-layer][data-print-ready="true"]') && document.querySelectorAll('[data-score-print-layer] circle').length < before, printCircles);
  assert.deepEqual(await snapshot(), baseline);
  await page.screenshot({ path: path.join(output, "names-only.png"), animations: "disabled" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: path.join(output, "names-only-print.pdf"), format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" });
  checks.push("仅名称立即隐藏全谱指法图，名称、未提交草稿、文档与历史保持，打印层同步更新");
  // Clear the name draft before opening the real PNG output surface.
  await sideName.fill(chord.chord.name);
  await openScorePng(page);
  const exportDialog = page.getByRole("dialog").filter({ has: page.locator("[data-image-export-status]") });
  await exportDialog.locator('[data-image-export-status="ready"]').waitFor();
  await exportDialog.getByRole("button", { name: "仅生成当前页", exact: true }).click();
  await exportDialog.locator('[data-image-export-status="generated"]').waitFor({ timeout: 60000 });
  const [download] = await Promise.all([page.waitForEvent("download"), exportDialog.getByRole("link", { name: "下载图片", exact: true }).click()]);
  await download.saveAs(path.join(output, "names-only-export.png"));
  await exportDialog.getByRole("button", { name: "关闭预览", exact: true }).click();
  assert.deepEqual(await snapshot(), baseline);
  checks.push("仅名称配置可生成并下载真实 A4 PNG，导出不写文档与历史");
  await svg.getByText(chord.chord.name, { exact: true }).first().click();
  await sidebar.getByRole("radio", { name: "名称与指法", exact: true }).check();
  await page.waitForFunction(expected => document.querySelectorAll('svg[role="application"] circle').length === expected, editCircles);
  assert.deepEqual(await renderedChords(), originalChords);
  await page.waitForFunction(expected => document.querySelector('[data-score-print-layer][data-print-ready="true"]') && document.querySelectorAll('[data-score-print-layer] circle').length === expected, printCircles);
  await page.screenshot({ path: path.join(output, "names-and-diagrams.png"), animations: "disabled" });
  assert.deepEqual(await snapshot(), baseline);
  checks.push("名称与指法立即恢复所有原指法，打印层同步，文档与历史不变");
  await writeFile(path.join(output, "result.json"), JSON.stringify({ checks, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors, output }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" }).catch(() => {});
  console.error({ checks, errors });
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
