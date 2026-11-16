import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const artifacts = path.resolve(website, "../../output/playwright/req031-039-product");
const server = await createServer({
  root: website, configFile: false, cacheDir: path.resolve(website, "node_modules/.vite/req032-036"),
  resolve: { dedupe: ["react", "react-dom"] }, esbuild: { jsx: "automatic" },
  optimizeDeps: { entries: ["tests/req019-030-chords.browser.tsx"], include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "next/link"] },
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""' },
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "req032-036", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__chords__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/req019-030-chords.browser.tsx"></script>'));
    });
  } }],
});
let browser;
const checks = [], errors = [];
try {
  await mkdir(artifacts, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.LXM_BROWSER_CHANNEL ?? "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  const button = (root, name) => root.getByRole("button", { name: /^\p{Script=Han}{2}$/u.test(name) ? new RegExp(`^${[...name].join("\\s*")}$`) : name, exact: true });
  const snapshot = () => page.evaluate(() => {
    const state = window.coexistStore.getState();
    return { document: state.document, history: state.historyDepth };
  });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  const custom = page.getByRole("dialog", { name: /^自定义指法/ });
  const library = page.getByRole("dialog", { name: /^和弦库/ });
  const sideName = sidebar.getByRole("textbox", { name: "和弦名称", exact: true });
  const customName = custom.getByRole("textbox", { name: "自定义和弦名称", exact: true });
  const start = custom.getByRole("textbox", { name: "观察窗口起始品位", exact: true });
  const openMine = () => custom.getByRole("button", { name: /查看我的指法/ }).click();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__chords__`, { waitUntil: "commit" });
  await sidebar.waitFor({ timeout: 90000 });
  const baseline = await snapshot();
  // 仅夹具选区由store建立，之后所有编辑/切拍经真实控件与键盘处理。
  await page.evaluate(() => {
    const state = window.coexistStore.getState(), track = state.document.score.tracks[0], measure = track.measures[0];
    const cell = { trackId: track.id, measureId: measure.id, beatId: measure.beats[0].id, string: 1 };
    state.setNumberedSelection(null); state.setSelection({ anchor: cell, focus: cell });
  });
  await sidebar.getByRole("tab", { name: "和弦", exact: true }).click();
  await sideName.waitFor();
  // 空拍保留顶部背景框，且不出现“未命名 / 尚未设置指法”的假内容。
  if (!(await sideName.inputValue())) {
    await sidebar.getByText("尚未配置和弦", { exact: true }).waitFor();
    const emptyPreview = sidebar.getByRole("region", { name: "和弦预览", exact: true });
    const emptyStyle = await emptyPreview.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, height: el.getBoundingClientRect().height }));
    assert.ok(emptyStyle.height >= 74);
    assert.notEqual(emptyStyle.background, "rgba(0, 0, 0, 0)");
    assert.equal(await emptyPreview.getByText("未命名", { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(artifacts, "empty-beat-sidebar.png"), animations: "disabled" });
  }
  assert.equal(await sidebar.getByRole("button", { name: "编辑当前拍和弦", exact: true }).count(), 0);
  await sideName.fill("同拍未应用");
  await svg.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await sideName.inputValue(), "同拍未应用");
  await sidebar.getByRole("tab", { name: "和弦", exact: true }).click();
  assert.equal(await sideName.inputValue(), "同拍未应用");
  await svg.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector('#music-text-sidebar input[aria-label="和弦名称"]')?.value !== "同拍未应用");
  assert.equal(await sideName.evaluate(node => node === document.activeElement), false);
  assert.deepEqual(await snapshot(), baseline);
  checks.push("进入和弦页签直接绑定；同拍跨弦/重复页签保留草稿；键盘换拍重新绑定且不抢输入焦点");
  await page.screenshot({ path: path.join(artifacts, "sidebar-auto-bind.png"), animations: "disabled" });

  // 拖选路径直接发布选区，范围必须立即解除单拍表单；恢复单拍自动出现空白表单。
  await page.evaluate(() => {
    const state = window.coexistStore.getState(), anchor = state.selection.focus;
    const measure = state.document.score.tracks[0].measures.find(m => m.id === anchor.measureId);
    const index = measure.beats.findIndex(b => b.id === anchor.beatId);
    state.setSelection({ anchor, focus: { ...anchor, beatId: measure.beats[index + 1].id } });
  });
  await sidebar.getByText("先选择单个 TAB 拍点", { exact: true }).waitFor();
  assert.equal(await sideName.count(), 0);
  await page.evaluate(() => {
    const state = window.coexistStore.getState(), cell = state.selection.anchor;
    state.setSelection({ anchor: cell, focus: cell });
  });
  await sideName.waitFor();
  checks.push("范围选区立即解除单拍表单，恢复单拍后自动绑定");

  await button(sidebar, "更多配置").click();
  await library.waitFor();
  const candidates = library.getByTestId("chord-library-scroll").getByRole("button");
  await candidates.first().waitFor();
  assert.equal(await candidates.count(), 192);
  assert.equal(await library.getByTestId("chord-library-scroll").locator("section").count(), 12);
  assert.equal(await library.getByText("其他和弦", { exact: true }).count(), 0);
  const firstGroup = library.getByTestId("chord-library-scroll").locator("section").first().getByRole("button");
  assert.equal(await firstGroup.count(), 16);
  const rows = await firstGroup.evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().y)));
  assert.equal(rows.filter(y => y === rows[0]).length, 5);
  const mineTab = library.getByRole("radio", { name: "我的指法", exact: true });
  await page.waitForFunction(() => !document.querySelector('.ant-zoom-appear,.ant-zoom-enter,.ant-zoom-leave'));
  const tabGeometry = await mineTab.locator("..").boundingBox();
  await mineTab.locator("..").hover();
  const hoveredGeometry = await mineTab.locator("..").boundingBox();
  assert.deepEqual(tabGeometry, hoveredGeometry);
  await candidates.filter({ has: page.getByText("F", { exact: true }) }).click();
  const detail = library.getByTestId("chord-library-detail");
  assert.equal((await detail.locator("h3").locator("..").textContent()).trim(), "FIV");
  await page.screenshot({ path: path.join(artifacts, "library-five-columns.png"), animations: "disabled" });
  await library.getByLabel("临时浏览主音", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("G", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="chord-library-detail"] h3')?.parentElement.textContent.includes("F♭VII"));
  const search = library.getByRole("textbox", { name: "库内搜索全部和弦", exact: true });
  await search.fill("C");
  const c = library.getByTestId("chord-library-scroll").getByRole("button").filter({ has: page.getByText("C", { exact: true }) });
  assert.equal(await c.getByText("IV", { exact: true }).count(), 1);
  await c.click();
  assert.equal((await detail.locator("h3").locator("..").textContent()).trim(), "CIV");
  await search.focus();
  const innerFocus = await search.evaluate(n => ({ border: getComputedStyle(n).borderWidth, shadow: getComputedStyle(n).boxShadow }));
  assert.deepEqual(innerFocus, { border: "0px", shadow: "none" });
  await button(library, "取消").click();
  await library.waitFor({ state: "hidden" });
  assert.deepEqual(await snapshot(), baseline);
  checks.push("正式编辑器192项12组、每组16项五列、默认页签hover无位移、详情级数随调性变化、搜索保留分组且浏览不改谱");

  await sidebar.getByRole("button", { name: /^(自定义指法|编辑指法)$/ }).click();
  await custom.waitFor();
  await customName.fill("往返收藏");
  await custom.getByRole("gridcell", { name: "第 1 弦 1 品", exact: true }).click();
  await button(custom, "另存为我的指法").click();
  await custom.getByText(/已保存到我的指法/).waitFor();
  await customName.fill("暂存编辑");
  await start.fill("invalid");
  assert.equal(await button(custom, "完成编辑").isDisabled(), true);
  await customName.evaluate(node => { window.__req033CustomInput = node; });
  await openMine();
  await library.waitFor();
  assert.equal(await custom.isVisible(), true);
  assert.equal(await custom.locator('input[aria-label="自定义和弦名称"]').evaluate(node => node === window.__req033CustomInput), true);
  assert.equal(await custom.locator('input[aria-label="自定义和弦名称"]').evaluate(node => !!node.closest("[inert]")), true);
  await page.waitForFunction(() => !document.querySelector('.ant-zoom-appear,.ant-zoom-enter,.ant-zoom-leave'));
  await page.screenshot({ path: path.join(artifacts, "library-over-custom.png"), animations: "disabled" });
  assert.equal(await library.getByRole("radio", { name: "我的指法", exact: true }).isChecked(), true);
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "搜索我的指法");
  await page.keyboard.press("Escape");
  await library.waitFor({ state: "hidden" });
  await custom.waitFor();
  assert.equal(await customName.evaluate(node => node === window.__req033CustomInput), true);
  assert.equal(await customName.inputValue(), "暂存编辑");
  assert.equal(await start.inputValue(), "invalid");
  await button(custom, "撤销").click();
  assert.notEqual(await start.inputValue(), "invalid");
  await button(custom, "重做").click();
  assert.equal(await start.inputValue(), "invalid");
  checks.push("我的指法覆盖仍挂载的自定义弹窗，底层inert；Esc仅关上层，同一输入DOM节点与无效输入及撤销重做保留");

  await openMine();
  await library.waitFor();
  await library.getByRole("button").filter({ has: page.getByText("往返收藏", { exact: true }) }).click();
  await button(library, "选用此指法").click();
  const replace = page.getByRole("dialog", { name: "替换当前自定义指法？", exact: true });
  await replace.waitFor();
  await replace.focus();
  await page.keyboard.press("Escape");
  await replace.waitFor({ state: "hidden" });
  assert.equal(await library.isVisible(), true);
  await button(library, "返回自定义").click();
  await library.waitFor({ state: "hidden" });
  await custom.waitFor();
  assert.equal(await start.inputValue(), "invalid");
  await openMine();
  await library.waitFor();
  await library.getByRole("button").filter({ has: page.getByText("往返收藏", { exact: true }) }).click();
  await button(library, "选用此指法").click();
  await replace.waitFor();
  await button(replace, "确认替换").click();
  await library.waitFor({ state: "hidden" });
  await custom.waitFor();
  assert.equal(await customName.inputValue(), "往返收藏");
  await button(custom, "撤销").click();
  assert.equal(await customName.inputValue(), "暂存编辑");
  assert.equal(await start.inputValue(), "invalid");
  await button(custom, "重做").click();
  assert.equal(await customName.inputValue(), "往返收藏");
  assert.deepEqual(await snapshot(), baseline);
  checks.push("选用前确认；Esc取消确认留在库；替换回自定义且可撤销，未自动写谱");

  const empty = custom.locator('[role="gridcell"][data-pressed="false"]').first();
  await empty.hover();
  const circle = await empty.evaluate(node => {
    const css = getComputedStyle(node, "::after");
    return { color: css.backgroundColor, width: css.width, height: css.height, radius: css.borderRadius, accent: getComputedStyle(node).getPropertyValue("--accent").trim() };
  });
  assert.equal(circle.width, "22px"); assert.equal(circle.height, "22px"); assert.equal(circle.radius, "50%");
  assert.notEqual(circle.color, "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: path.join(artifacts, "custom-solid-hover.png"), animations: "disabled" });
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'));
  await page.keyboard.press("Escape");
  const discard = page.getByRole("dialog", { name: "放弃本次修改？", exact: true });
  await discard.waitFor();
  const beforeDiscardShortcut = await custom.locator('input[aria-label="自定义和弦名称"]').inputValue();
  await button(discard, "继续编辑").focus();
  await page.keyboard.press("Meta+z");
  assert.equal(await custom.locator('input[aria-label="自定义和弦名称"]').inputValue(), beforeDiscardShortcut);
  await discard.focus();
  await page.keyboard.press("Escape");
  await discard.waitFor({ state: "hidden" });
  assert.equal(await custom.isVisible(), true);
  await button(custom, "完成编辑").click();
  await custom.waitFor({ state: "hidden" });
  assert.equal(await sideName.inputValue(), "往返收藏");
  assert.deepEqual(await snapshot(), baseline);
  await button(sidebar, "应用").click();
  assert.notDeepEqual(await snapshot(), baseline);
  checks.push("22px蓝色实心hover；dirty Esc确认且确认层Esc只继续；完成仅回填、应用才写谱");

  await sidebar.getByRole("tab", { name: "选区", exact: true }).click();
  await svg.focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await sidebar.getByRole("tab", { name: "选区", exact: true }).getAttribute("aria-selected"), "true");
  checks.push("其他页签选拍不会被和弦自动抢占");
  // 文档版本变化让会话失效时，宿主与其嵌套库必须一起清理。
  await sidebar.getByRole("tab", { name: "和弦", exact: true }).click();
  await sidebar.getByRole("button", { name: /^(自定义指法|编辑指法)$/ }).click();
  await custom.waitFor();await openMine();await library.waitFor();
  await page.evaluate(() => {
    const state = window.coexistStore.getState();
    state.undo();
  });
  await custom.waitFor({ state: "hidden" });
  await library.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("dialog").count(), 0);
  checks.push("外部文档版本失效时宿主与嵌套库一并卸载，不残留上层弹窗");
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify({ checks, errors, circle }, null, 2));
  await Promise.all(["failure.png", "failure.html"].map(file => rm(path.join(artifacts, file), { force: true })));
  console.log(JSON.stringify({ checks, errors, circle, artifacts }, null, 2));
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) console.log("failure focus", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 600)));
    if (page) { await page.screenshot({ path: path.join(artifacts, "failure.png") }); await writeFile(path.join(artifacts, "failure.html"), await page.content()); }
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await server.close();
}
