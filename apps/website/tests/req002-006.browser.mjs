// 中文说明：挂载真实编辑器检查缩放、详情面板与音乐命令的集成，不使用设计稿演示逻辑。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const artifacts = path.resolve(website, "../../output/playwright/req002-006-product");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/req002-006"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "req002-006-product", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__req002-006__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url,
        '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});

let browser;
try {
  await mkdir(artifacts, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
    ...(process.env.LXM_BROWSER_CHANNEL ? { channel: process.env.LXM_BROWSER_CHANNEL } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__req002-006__`);
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  const sidebar = page.locator("#music-text-sidebar");
  await svg.waitFor({ timeout: 90000 });
  const snapshot = () => page.evaluate(() => {
    const state = window.coexistStore.getState();
    return { score: state.document.score, history: state.historyDepth, selection: state.selection };
  });
  const baseline = await snapshot();
  // 夹具仅设置合法业务选区；编辑行为全部点击真实控件，通过实际适配器提交。
  const select = (measureIndex, start = 0, end = start) => page.evaluate(({ measureIndex, start, end }) => {
    const store = window.coexistStore;
    const track = store.getState().document.score.tracks[0];
    const measure = track.measures[measureIndex];
    const ref = index => ({ trackId: track.id, measureId: measure.id, beatId: measure.beats[index].id, string: 1 });
    store.getState().setNumberedSelection(null);
    store.getState().setSelection({ anchor: ref(start), focus: ref(end) });
  }, { measureIndex, start, end });
  const task = async name => {
    await sidebar.getByRole("tab", { name: "选区", exact: true }).click();
    await sidebar.getByRole("radio", { name, exact: true }).locator("..").click();
  };
  const capture = async name => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(20, 30);
    await page.locator(".ant-tooltip:visible").waitFor({ state: "hidden" });
    await page.screenshot({ path: path.join(artifacts, `${name}.png`), animations: "disabled" });
  };

  for (const name of ["前往谱面选择", "浏览简谱与歌词", "查看歌曲设置", "浏览小节工具"])
    assert.equal(await sidebar.getByRole("button", { name, exact: true }).count(), 0);
  await select(0);
  await task("音符");
  const selectionBeforeZoom = (await snapshot()).selection;
  const zoomControl = page.getByRole("group", { name: "谱面缩放" });
  await zoomControl.waitFor();
  assert.match(await zoomControl.innerText(), /125%/);
  for (const zoom of [100, 125, 150, 200]) {
    await zoomControl.getByRole("button", { name: /^谱面缩放：/ }).click();
    await page.getByRole("menuitem", { name: `${zoom}%`, exact: true }).click();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await page.waitForFunction(scale => Number(document.querySelector("[data-score-scale]").dataset.scoreScale) === scale, zoom / 100);
    const current = await snapshot();
    assert.deepEqual(current.score, baseline.score, "缩放不修改音乐");
    assert.deepEqual(current.history, baseline.history, "缩放不写历史");
    assert.deepEqual(current.selection, selectionBeforeZoom, "缩放按钮不清选区");
  }
  assert.equal(await zoomControl.getByRole("button", { name: "放大谱面" }).isDisabled(), true);

  // 沿真实选区光标找首拍，避免把和弦指法数字误当 TAB 品位而命中优先级更高的技巧。
  for (const zoom of [100, 125, 150, 200]) {
    await zoomControl.getByRole("button", { name: /^谱面缩放：/ }).click();
    await page.getByRole("menuitem", { name: `${zoom}%`, exact: true }).click();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await page.waitForFunction(scale => Number(document.querySelector("[data-score-scale]").dataset.scoreScale) === scale, zoom / 100);
    await select(0);
    await svg.locator('rect[class*="focusCaret"]').waitFor();
    await page.locator("[data-score-viewport]").evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
    const point = await svg.evaluate(el => {
      const caret = el.querySelector('rect[class*="focusCaret"]');
      const p = new DOMPoint(+caret.getAttribute("x") + +caret.getAttribute("width") / 2,
        +caret.getAttribute("y") + +caret.getAttribute("height") / 2).matrixTransform(el.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    await page.evaluate(() => window.coexistStore.getState().setSelection(null));
    await page.mouse.click(point.x, point.y);
    assert.deepEqual((await snapshot()).selection, selectionBeforeZoom, `${zoom}% 实际点击命中首拍首弦`);
  }
  await zoomControl.getByRole("button", { name: /^谱面缩放：/ }).click();
  await page.getByRole("menuitem", { name: "125%", exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await select(0);
  await task("音符");
  const notes = sidebar.locator('[data-selection-detail="note"]');
  const dots = await notes.getByRole("group", { name: "音符附点" }).getByRole("button").all();
  const states = await notes.getByRole("group", { name: "音符状态" }).getByRole("button").all();
  assert.equal(dots.length, 3);
  assert.equal(states.length, 3);
  for (let column = 0; column < 3; column++) {
    const dot = await dots[column].boundingBox(), state = await states[column].boundingBox();
    assert.ok(Math.abs(dot.x - state.x) < 1 && Math.abs(dot.width - state.width) < 1, "附点和状态按钮逐列对齐");
    assert.ok(Math.abs(state.y - (await states[0].boundingBox()).y) < 1, "三个状态按钮同一行");
  }
  await select(0, 0, 1);
  const disabledDot = notes.getByRole("button", { name: "附点", exact: true });
  assert.equal(await disabledDot.isDisabled(), true);
  await disabledDot.locator("..").focus();
  await page.getByRole("tooltip").filter({ hasText: "时值与附点需要单拍选区" }).waitFor();
  await select(0);
  await notes.getByRole("button", { name: "弹奏标记", exact: true }).click();
  assert.equal((await snapshot()).score.tracks[0].measures[0].beats[0].notes.find(n => n.string === 1).fret, "x");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.deepEqual((await snapshot()).score, baseline.score);
  await capture("note");

  await select(0, 1, 3);
  await task("连音");
  const tuplets = sidebar.locator('[data-selection-detail="tuplet"]');
  for (const name of ["二连音", "三连音", "四连音", "五连音（5:4）", "五连音（5:3）", "六连音"])
    assert.equal(await tuplets.getByRole("button", { name, exact: true }).count(), 1);
  const beforeDraft = await snapshot();
  await tuplets.getByRole("button", { name: "三连音", exact: true }).click();
  assert.deepEqual(await snapshot(), beforeDraft, "待应用类型不写入音乐与历史");
  await tuplets.getByRole("button", { name: "应用三连音", exact: true }).click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].tuplets.length === 1);
  await page.waitForFunction(() => {
    const type = document.querySelector('[data-selection-detail="tuplet"] button[aria-label="三连音"]');
    return type?.disabled === false && type.getAttribute("aria-pressed") === "true" &&
      !document.querySelector('[data-selection-detail="tuplet"] [role="status"]');
  });
  assert.deepEqual((await snapshot()).score.tracks[0].measures[0].tuplets[0].ratio, { actual: 3, normal: 2 });
  await capture("tuplet");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.deepEqual((await snapshot()).score, baseline.score);

  const lastMeasure = baseline.score.tracks[0].measures.length - 1;
  await select(lastMeasure);
  // 真实点击通过 controller 清理此前工具固定的小节目标，单改 store 不会执行这一步。
  const lastCaret = svg.locator('rect[class*="focusCaret"]');
  await lastCaret.scrollIntoViewIfNeeded();
  const lastPoint = await lastCaret.boundingBox();
  await page.mouse.click(lastPoint.x + lastPoint.width / 2, lastPoint.y + lastPoint.height / 2);
  await task("小节");
  const measures = sidebar.locator('[data-selection-detail="measure"]');
  const boundaries = measures.getByRole("group", { name: "六类小节线" });
  if (!(await boundaries.isVisible())) await measures.locator("summary").filter({ hasText: "小节线与反复" }).click();
  assert.equal(await boundaries.getByRole("button", { name: "开始反复线", exact: true }).isDisabled(), true);
  assert.equal(await boundaries.getByRole("button", { name: "双向反复线", exact: true }).isDisabled(), true);
  await boundaries.getByRole("button", { name: "开始反复线", exact: true }).locator("..").focus();
  await page.getByRole("tooltip").filter({ hasText: "谱尾右边界没有下一小节，不能开始反复" }).waitFor();
  // 从真实谱面空白清选区，不能仅清 store 却留下工具的显式小节目标。
  await page.locator("[data-score-viewport]").click({ position: { x: 5, y: 5 } });
  await page.waitForFunction(() => window.coexistStore.getState().selection === null);
  assert.equal(await sidebar.locator("[data-editor-actions-host]").isVisible(), false);
  assert.equal(await sidebar.getByRole("button", { name: "应用段落标记", exact: true }).count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: "恢复本组", exact: true }).count(), 0);
  await select(lastMeasure);
  await task("小节");
  assert.equal(await sidebar.getByRole("button", { name: "应用段落标记", exact: true }).isVisible(), true);
  if (!(await boundaries.isVisible())) await measures.locator("summary").filter({ hasText: "小节线与反复" }).click();
  await capture("measure");

  // 缩放只重测真实歌词气泡，保留同一输入节点与未应用文本。
  await zoomControl.getByRole("button", { name: /^谱面缩放：/ }).click();
  await page.getByRole("menuitem", { name: "100%", exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await svg.getByText("旋", { exact: true }).click();
  const popover = page.locator('[data-text-surface="popover"]');
  const lyric = popover.getByRole("textbox", { name: "歌词文本", exact: true });
  await lyric.fill("缩放保留歌词草稿");
  await lyric.evaluate(el => { window.zoomDraftInput = el; });
  const beforeDraftZoom = await snapshot();
  const beforeBubble = await popover.boundingBox();
  await zoomControl.getByRole("button", { name: "放大谱面", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-score-zoom]").dataset.scoreZoom === "125");
  await page.waitForFunction(previous => {
    const box = document.querySelector('[data-text-surface="popover"]').getBoundingClientRect();
    return Math.abs(box.x - previous.x) + Math.abs(box.y - previous.y) > 1;
  }, beforeBubble);
  assert.equal(await lyric.inputValue(), "缩放保留歌词草稿");
  assert.equal(await lyric.evaluate(el => el === window.zoomDraftInput), true);
  assert.deepEqual(await snapshot(), beforeDraftZoom);
  assert.equal(await popover.isVisible(), true);
  await popover.getByRole("button", { name: "结束文字编辑", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  assert.equal(await zoomControl.isVisible(), false);
  assert.equal(await svg.isVisible(), false);
  assert.equal(await page.locator("[data-score-print-layer]").isVisible(), true);
  assert.deepEqual(errors, []);
  console.log("PASS REQ002–006：真实编辑器缩放/命中、空状态、音符与撤销、连音待选/提交、谱尾边界、打印隔离");
} finally {
  await browser?.close();
  await server.close();
}
