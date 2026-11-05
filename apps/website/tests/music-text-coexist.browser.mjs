// Optional: LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node <this file>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: website,
  configFile: false,
  cacheDir: path.resolve(website, "node_modules/.vite/coexist-v2"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{
    name: "music-text-coexist-fixture",
    configureServer(dev) {
      dev.middlewares.use(async (request, response, next) => {
        if (request.url !== "/__coexist__") return next();
        response.setHeader("Content-Type", "text/html");
        response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
    ...(process.env.LXM_BROWSER_CHANNEL ? { channel: process.env.LXM_BROWSER_CHANNEL } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__coexist__`, { waitUntil: "commit" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  // 首次启动需等待 Vite 编译完整编辑器，后续交互仍使用 20 秒超时。
  await sidebar.waitFor({ state: "visible", timeout: 90000 });
  const sidebarBefore = await sidebar.boundingBox();
  assert.equal(sidebarBefore.width, 400);
  for (const viewport of [{width:1920,height:1080},{width:1440,height:720},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    assert.equal((await sidebar.boundingBox()).width, 400);
    assert.equal(await sidebar.getByRole("tab", {name:"简谱与歌词",exact:true}).isVisible(), true);
  }
  const initialHistory = await page.evaluate(() => window.coexistStore.getState().historyDepth);
  await sidebar.getByRole("tab", {name:"简谱与歌词",exact:true}).click();
  assert.equal(await sidebar.getByRole("button", {name:/添加歌词行|添加简谱行|打开简谱编辑浮窗/}).count(),0);
  assert.equal(await sidebar.getByRole("button", {name:"在当前位置录入简谱",exact:true}).count(),0);
  await page.getByRole("application", {name:"六线谱编辑器"}).getByText("14", {exact:true}).first().click();
  await sidebar.getByRole("button", {name:"在当前位置录入简谱",exact:true}).waitFor({state:"visible"});
  await page.screenshot({path:path.resolve(website,"../../artifacts/sidebar-v2-writing-entry.png"), animations: "disabled"});
  await sidebar.getByRole("button", {name:"在当前位置录入简谱",exact:true}).click();
  await sidebar.getByRole("textbox", {name:/音符内容|单音组简谱/}).waitFor({state:"visible"});
  await page.screenshot({path:path.resolve(website,"../../artifacts/sidebar-v2-numbered.png"), animations:"disabled"});
  assert.deepEqual(await page.evaluate(() => window.coexistStore.getState().historyDepth),initialHistory);
  await page.locator('[data-text-surface="popover"]').getByRole("button", {name:"结束文字编辑",exact:true}).click();
  await page.getByRole("application", { name: "六线谱编辑器" }).getByText("旋", { exact: true }).click();
  const popover = page.locator('[data-text-surface="popover"]');
  await popover.waitFor({ state: "visible" });
  await page.screenshot({ path: path.resolve(website, "../../artifacts/music-text-sidebar-coexist.png"), animations: "disabled" });
  for (const viewport of [{width:1440,height:900},{width:1920,height:1080},{width:1440,height:720}]) {
    await page.setViewportSize(viewport);
    assert.equal((await sidebar.boundingBox()).width, 400);
    await page.screenshot({ path: path.resolve(website, `../../artifacts/sidebar-v2-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
  }
  await page.setViewportSize({width:1440,height:900});
  for (const name of ["选区", "简谱与歌词", "和弦", "歌曲"]) {
    assert.equal(await sidebar.getByRole("tab", { name: new RegExp(name) }).isVisible(), true, `${name} tab remains visible`);
    const tabBox = await sidebar.getByRole("tab", { name: new RegExp(name) }).boundingBox();
    const frameBox = await sidebar.boundingBox();
    assert.ok(tabBox.x >= frameBox.x && tabBox.x + tabBox.width <= frameBox.x + frameBox.width, `${name} tab stays within 400px sidebar`);
  }
  const sidebarAfter = await sidebar.boundingBox();
  assert.equal(sidebarAfter.x, sidebarBefore.x);
  assert.equal(sidebarAfter.width, sidebarBefore.width);
  assert.equal(sidebarAfter.y, sidebarBefore.y);
  assert.equal(await page.getByRole("button", { name: "在侧栏展开", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "回到气泡", exact: true }).count(), 0);
  const fields = sidebar.locator("#music-text-fields");
  await fields.getByText("连续填词", { exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === "lyric-body" && document.activeElement instanceof HTMLTextAreaElement);
  await fields.getByText("单个位置", { exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === "lyric-body" && document.activeElement instanceof HTMLInputElement);
  const sidebarInput = fields.getByRole("textbox", { name: "歌词文本", exact: true });
  assert.equal(await sidebarInput.isVisible(), true);
  assert.equal(await fields.getByRole("button", { name: /添加简谱行|添加歌词行/ }).count(), 0);
  assert.deepEqual(await fields.locator("[data-editor-paragraph-switch] .ant-segmented-item-label").allTextContents(), ["简谱", "歌词"]);
  const input = popover.getByRole("textbox", { name: "歌词文本", exact: true });
  const lyricBaseline = await page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth }));
  await input.fill("旋律草稿");
  assert.equal(await sidebarInput.inputValue(), "旋律草稿");
  await sidebar.getByRole("button", {name:"收起编辑台",exact:true}).click();
  assert.equal(await sidebar.isVisible(), false);
  assert.equal(await popover.isVisible(), true);
  assert.equal(await input.inputValue(), "旋律草稿");
  const openSidebar = page.getByRole("button", {name:"打开编辑台",exact:true});
  await openSidebar.focus();
  await openSidebar.press("Enter");
  assert.equal(await sidebarInput.inputValue(), "旋律草稿");
  await input.evaluate((node) => node.setSelectionRange(1,3));
  await popover.getByRole("button", {name:"完整设置",exact:true}).click();
  await page.waitForFunction(() => document.activeElement?.id === "lyric-body");
  assert.deepEqual(await sidebarInput.evaluate((node) => [node.selectionStart,node.selectionEnd]), [1,3]);
  assert.deepEqual(await page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth })), lyricBaseline);
  await input.dispatchEvent("compositionstart");
  assert.equal(await popover.getByRole("button", { name: "更多编辑" }).count(), 0);
  assert.equal(await popover.locator("footer button").first().isDisabled(), true);
  await sidebar.getByRole("tab", { name: /歌曲/ }).click();
  assert.equal(await sidebar.getByRole("alertdialog").count(), 0);
  assert.equal(await sidebarInput.isVisible(), true);
  await input.dispatchEvent("compositionend");
  await page.waitForFunction(() => document.querySelector('[data-text-surface="popover"] footer button')?.disabled === false);
  await input.evaluate((node) => {
    window.coexistInput = node;
    node.setSelectionRange(1, 3);
  });
  await sidebarInput.focus();
  assert.equal(await sidebarInput.evaluate((node) => node === document.activeElement), true);
  assert.equal(await popover.isVisible(), true);
  await sidebarInput.fill("侧栏草稿");
  assert.equal(await input.inputValue(), "侧栏草稿");
  assert.equal(await input.evaluate((node) => node === window.coexistInput), true);
  await sidebar.getByRole("tab", { name: /歌曲/ }).click();
  const confirmation = sidebar.getByRole("alertdialog");
  assert.equal(await confirmation.count(), 0);
  assert.equal(await popover.isVisible(), false);
  assert.deepEqual(await page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth })), lyricBaseline);
  await page.getByRole("application", { name: "六线谱编辑器" }).getByText("旋", { exact: true }).click();
  assert.equal(await input.inputValue(), "旋");
  await input.fill("词".repeat(65));
  await sidebar.getByRole("tab", { name: /歌曲/ }).click();
  assert.equal(await confirmation.count(), 0);
  assert.equal(await popover.isVisible(), false);
  assert.deepEqual(await page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth })), lyricBaseline);
  await page.getByRole("application", { name: "六线谱编辑器" }).getByText("旋", { exact: true }).click();
  assert.equal(await input.inputValue(), "旋");
  await input.fill("已应用歌词");
  await input.press("Enter");
  assert.equal(await page.evaluate(() => window.coexistStore.getState().document.score.tracks.some((track) => track.measures.some((measure) => measure.lyrics.some((lyric) => lyric.text === "已应用歌词")))), true);
  await sidebar.getByRole("tab", { name: /歌曲/ }).click();
  assert.equal(await confirmation.count(), 0);

  await page.getByRole("application", { name: "六线谱编辑器" }).locator('[data-system-index="0"]').getByText("1", { exact: true }).first().click();
  await popover.waitFor({ state: "visible" });
  const numberedInput = popover.getByRole("textbox");
  const numberedSidebarInput = fields.getByRole("textbox", { name: /音符内容|单音组简谱/ });
  assert.equal(await numberedSidebarInput.isVisible(), true);
   assert.equal(await fields.getByLabel("简谱节奏模板").isVisible(), false);
  await page.waitForFunction(() => document.activeElement?.closest('[data-text-surface="popover"]') && document.activeElement instanceof HTMLInputElement);
  await fields.locator("summary").filter({ hasText: "节奏与范围" }).click();
  assert.equal(await fields.getByLabel("简谱节奏模板").isVisible(), true);
  assert.equal(await popover.locator("textarea").count(), 0);
  assert.equal(await popover.getByRole("button", { name: "更多编辑" }).count(), 0);
  assert.equal(await popover.getByText("正在编辑", { exact: true }).count(), 0);
  await numberedInput.fill("#5");
  assert.equal(await numberedSidebarInput.inputValue(), "#5");
  await numberedSidebarInput.fill("6");
  assert.equal(await numberedInput.inputValue(), "6");
  const rhythm = popover.getByRole("group", { name: "常用时值" });
  const icons = await rhythm.locator("button span[style]").evaluateAll((nodes) => nodes.map((node) => ({
    mask: getComputedStyle(node).maskImage,
    width: getComputedStyle(node).width,
    height: getComputedStyle(node).height,
  })));
  assert.equal(icons.length, 6);
  for (const icon of icons) {
    assert.equal(icon.width, "20px");
    assert.equal(icon.height, "20px");
    assert.match(icon.mask, /\/assets\/svg\/music-controls\/note-/);
    const assetUrl = icon.mask.match(/url\("?(.*?)"?\)/)[1];
    assert.equal((await page.request.get(assetUrl)).ok(), true);
  }
  await numberedInput.dispatchEvent("compositionstart");
  assert.equal(await rhythm.getByRole("button", { name: "八分音符", exact: true }).isDisabled(), true);
  assert.equal(await sidebar.getByRole("button", { name: "应用简谱内容", exact: true }).isDisabled(), true);
  await numberedInput.dispatchEvent("compositionend");
  await page.waitForFunction(() => !document.querySelector('[data-text-surface="popover"] button[aria-label="八分音符"]')?.disabled);
  await rhythm.getByRole("button", { name: "八分音符", exact: true }).click();
  assert.equal(await fields.getByLabel("简谱时值", { exact: true }).evaluate((node) => node.closest(".ant-select").textContent.includes("八分")), true);
  await numberedSidebarInput.focus();
  assert.equal(await numberedSidebarInput.evaluate((node) => node === document.activeElement), true);
  assert.equal(await popover.isVisible(), true);
  assert.deepEqual(await page.locator("[id]").evaluateAll((nodes) => {
    const ids = nodes.map((node) => node.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  }), []);
  await page.screenshot({ path: path.resolve(website, "../../artifacts/music-text-sidebar-coexist.png") });
  await fields.getByLabel("简谱时值附点", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("双附点", { exact: true }).click();
  assert.equal(await fields.getByLabel("简谱时值附点", { exact: true }).evaluate((node) => node === document.activeElement), true);
  await page.setViewportSize({ width: 1000, height: 900 });
  assert.equal(await numberedSidebarInput.isVisible(), true);
  assert.equal(await numberedSidebarInput.inputValue(), "6");
  assert.equal(await fields.getByRole("button", { name: /添加简谱行|添加歌词行/ }).count(), 0);
  await page.setViewportSize({ width: 1700, height: 350 });
  await popover.waitFor({ state: "hidden" });
  assert.equal(await numberedSidebarInput.isVisible(), true);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await popover.waitFor({ state: "visible" });
  assert.equal(await numberedInput.inputValue(), "6");

  const historyBefore = await page.evaluate(() => {
    const state = window.coexistStore.getState();
    const document = structuredClone(state.document);
    const track = document.score.tracks[0];
    track.numberedMarks = [];
    const measure = track.measures[0];
    measure.lyrics = [];
    measure.numberedVoice = {
      events: [
        { id: "focus-five", kind: "notes", tick: 0, rhythm: { base: "eighth", dots: 0 }, items: [{ id: "focus-five-item", token: "5" }] },
        { id: "focus-three", kind: "notes", tick: 480, rhythm: { base: "eighth", dots: 0 }, items: [{ id: "focus-three-item", token: "3" }] },
        { id: "focus-seven", kind: "notes", tick: 960, rhythm: { base: "eighth", dots: 0 }, items: [{ id: "focus-seven-item", token: "7" }] },
      ],
      tuplets: [],
    };
    const result = state.replaceDocument(document);
    if (!result.ok) throw new Error(result.message);
    return window.coexistStore.getState().historyDepth;
  });
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const digit = (id) => score.locator(`[data-numbered-event="${id}"]`).first();
  const captureNoteSelection = async (filename) => {
    const panel = await popover.boundingBox();
    const focus = await score.locator("[data-numbered-event-focus]").boundingBox();
    const x = Math.max(0, Math.min(panel.x, focus.x) - 24);
    const y = Math.max(0, Math.min(panel.y, focus.y) - 85);
    await page.screenshot({
      path: path.resolve(website, `../../artifacts/${filename}.png`),
      animations: "disabled",
      clip: { x, y, width: Math.max(panel.x + panel.width, focus.x + focus.width) + 24 - x,
        height: Math.max(panel.y + panel.height, focus.y + focus.height) + 24 - y },
    });
  };
  await digit("focus-five").click();
  await popover.waitFor({ state: "visible" });
  const eventFocus = score.locator('[data-numbered-event-focus="focus-five"]');
  const firstBounds = await eventFocus.boundingBox();
  const beatBounds = await score.locator("[data-numbered-beat-context]").boundingBox();
  assert.ok(firstBounds.width < beatBounds.width);
  const firstArrow = await popover.getAttribute("style");
  await popover.getByRole("button", { name: "同拍下一个简谱音符", exact: true }).click();
  await score.locator('[data-numbered-event-focus="focus-three"]').waitFor();
  const secondBounds = await score.locator('[data-numbered-event-focus="focus-three"]').boundingBox();
  assert.ok(secondBounds.x > firstBounds.x);
  assert.ok(secondBounds.x >= firstBounds.x + firstBounds.width);
  assert.deepEqual(await score.locator("[data-numbered-beat-context]").boundingBox(), beatBounds);
  assert.equal(await popover.getByRole("textbox").inputValue(), "3");
  assert.equal(await popover.locator("[data-numbered-active-target]").getAttribute("data-numbered-active-target"), "focus-three");
  assert.equal(await popover.getByRole("button", { name: "同拍下一个简谱音符", exact: true }).isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('[data-text-surface="popover"]')?.style.getPropertyValue("--popover-arrow-offset") !== "");
  assert.notEqual(await popover.getAttribute("style"), firstArrow);
  assert.notEqual(await digit("focus-five").getAttribute("fill"), await digit("focus-three").getAttribute("fill"));
  const sharedLine = score.locator('[data-system-index="0"] line[stroke-width="1.1"]').first();
  assert.equal(await sharedLine.getAttribute("stroke"), "#000");
  await popover.getByRole("textbox").focus();
  assert.equal(await score.locator('[data-numbered-event-focus="focus-three"]').isVisible(), true);
  await captureNoteSelection("numbered-selection-pair");
  await digit("focus-seven").click();
  await score.locator('[data-numbered-event-focus="focus-seven"]').waitFor();
  assert.equal(await score.locator("[data-numbered-beat-context]").count(), 0);
  assert.equal(await popover.getByRole("group", { name: "同拍简谱音符" }).count(), 0);
  assert.equal(await popover.getByRole("textbox").inputValue(), "7");
  await captureNoteSelection("numbered-selection-single");
  await digit("focus-five").click();
  await popover.getByRole("textbox").fill("#5");
  await popover.getByRole("textbox").dispatchEvent("compositionstart");
  assert.equal(await popover.getByRole("button", { name: "同拍下一个简谱音符", exact: true }).isDisabled(), true);
  await popover.getByRole("textbox").dispatchEvent("compositionend");
  await page.waitForFunction(() => !document.querySelector('button[aria-label="同拍下一个简谱音符"]')?.disabled);
  await popover.getByRole("button", { name: "同拍下一个简谱音符", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-text-surface="popover"] [data-numbered-active-target]')?.getAttribute("data-numbered-active-target") === "focus-three");
  assert.equal(await popover.getByRole("textbox").inputValue(), "3");
  const currentEvent = () => page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find((event) => event.id === "focus-five"));
  assert.equal((await currentEvent()).items[0].token, "5");
  assert.equal(await sidebar.getByRole("alertdialog").count(), 0);
  assert.equal(await sidebar.getByText(/暂存|返回编辑|本次编辑不再提示/).count(), 0);
  await popover.getByRole("textbox").fill("2");
  await popover.getByRole("button", { name: "同拍上一个简谱音符", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-text-surface="popover"] [data-numbered-active-target]')?.getAttribute("data-numbered-active-target") === "focus-five");
  assert.equal(await popover.getByRole("textbox").inputValue(), "5");
  assert.equal(await page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find((event) => event.id === "focus-three").items[0].token), "3");
  const historyAfterSwitch = await page.evaluate(() => window.coexistStore.getState().historyDepth);
  assert.deepEqual(historyAfterSwitch, historyBefore);
  await popover.getByRole("textbox").fill("#4");
  await popover.getByRole("textbox").dispatchEvent("compositionstart");
  await popover.getByRole("textbox").press("Control+Enter");
  assert.equal((await currentEvent()).items[0].token, "5");
  await popover.getByRole("textbox").evaluate((node) => {
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  });
  assert.equal((await currentEvent()).items[0].token, "5");
  await page.waitForFunction(() => !document.querySelector('[data-text-surface="popover"] button[aria-label="应用"]')?.disabled);
  await popover.getByRole("textbox").press("Control+Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find((event) => event.id === "focus-five").items[0].token === "#4");
  assert.equal(await numberedSidebarInput.inputValue(), "#4");
  const historyAfterEnter = await page.evaluate(() => window.coexistStore.getState().historyDepth);
  assert.equal(historyAfterEnter.past, historyAfterSwitch.past + 1);
  await popover.getByRole("textbox").press("Control+Enter");
  assert.deepEqual(await page.evaluate(() => window.coexistStore.getState().historyDepth), historyAfterEnter);
  await popover.getByRole("textbox").fill("invalid");
  await popover.getByRole("textbox").press("Control+Enter");
  assert.equal((await currentEvent()).items[0].token, "#4");
  assert.deepEqual(await page.evaluate(() => window.coexistStore.getState().historyDepth), historyAfterEnter);
  await popover.getByRole("button", { name: "同拍下一个简谱音符", exact: true }).click();
  assert.equal(await confirmation.count(), 0);
  assert.equal(await popover.getByRole("textbox").inputValue(), "3");
  await digit("focus-five").click();
  assert.equal(await popover.getByRole("textbox").inputValue(), "#4");
  await popover.getByRole("group", { name: "常用时值" }).getByRole("button", { name: "十六分音符", exact: true }).click();
  const applyRhythm = popover.getByRole("button", { name: "应用时值", exact: true });
  const rhythmRow = await applyRhythm.evaluate((node) => {
    const toolbar = node.parentElement.querySelector('[role="group"]');
    const toolbarBounds = toolbar.getBoundingClientRect();
    const buttonBounds = node.getBoundingClientRect();
    return { sameLine: Math.abs(toolbarBounds.y + toolbarBounds.height / 2 - buttonBounds.y - buttonBounds.height / 2) < 2,
      noOverlap: toolbarBounds.right <= buttonBounds.left,
      fits: node.parentElement.scrollWidth <= node.parentElement.clientWidth };
  });
  assert.deepEqual(rhythmRow, { sameLine: true, noOverlap: true, fits: true });
  await captureNoteSelection("numbered-popover-rhythm-inline");
  await applyRhythm.click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find((event) => event.id === "focus-five").rhythm.base === "sixteenth");
  assert.equal((await currentEvent()).items[0].token, "#4");
  await digit("focus-seven").click();
  await popover.getByRole("textbox").fill("6");
  await popover.getByRole("button", { name: "结束文字编辑", exact: true }).click();
  await popover.waitFor({ state: "hidden" });
  const seventhToken = () => page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find((event) => event.id === "focus-seven").items[0].token);
  assert.equal(await seventhToken(), "7");
  await digit("focus-seven").click();
  assert.equal(await popover.getByRole("textbox").inputValue(), "7");
  await popover.getByRole("textbox").fill("6");
  await popover.getByRole("textbox").press("Escape");
  await popover.waitFor({ state: "hidden" });
  assert.equal(await seventhToken(), "7");
  await digit("focus-seven").click();
  await popover.getByRole("textbox").fill("6");
  await digit("focus-three").click();
  await page.waitForFunction(() => document.querySelector('[data-text-surface="popover"] [data-numbered-active-target]')?.getAttribute("data-numbered-active-target") === "focus-three");
  assert.equal(await seventhToken(), "7");
  assert.equal(await confirmation.count(), 0);
  await digit("focus-seven").click();
  assert.equal(await popover.getByRole("textbox").inputValue(), "7");
  await popover.getByRole("textbox").fill("6");
  await popover.getByRole("button", { name: "应用", exact: true }).click();
  assert.equal(await seventhToken(), "6");
  await popover.getByRole("textbox").fill("2");
  await popover.getByRole("button", { name: "结束文字编辑", exact: true }).click();
  await popover.waitFor({ state: "hidden" });
  await page.evaluate(() => window.coexistStore.getState().undo());
  assert.equal(await seventhToken(), "7");
  await page.evaluate(() => window.coexistStore.getState().redo());
  assert.equal(await seventhToken(), "6");
  await digit("focus-seven").click();
  await popover.getByRole("textbox").fill("4");
  await popover.getByRole("group", { name: "常用时值" }).getByRole("button", { name: "十六分音符", exact: true }).click();
  await digit("focus-three").click();
  assert.equal(await confirmation.count(), 0);
  assert.equal(await score.locator('[data-numbered-event-focus="focus-three"]').count(), 1);
  assert.equal(await seventhToken(), "6");
  await digit("focus-seven").click();
  assert.equal(await popover.getByRole("textbox").inputValue(), "6");
  assert.equal(await popover.getByRole("group", { name: "常用时值" }).getByRole("button", { name: "八分音符", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await sidebar.getByText(/暂存|返回编辑|本次编辑不再提示/).count(), 0);
  await sidebar.getByRole("tab", {name:"歌曲",exact:true}).click();
  await sidebar.getByRole("combobox", {name:"Capo",exact:true}).click();
  // 键盘选择不依赖长侧栏滚动后的下拉弹层坐标。
  await sidebar.getByRole("combobox", {name:"Capo",exact:true}).press("Home");
  for (let index = 0; index < 3; index++) await sidebar.getByRole("combobox", {name:"Capo",exact:true}).press("ArrowDown");
  await sidebar.getByRole("combobox", {name:"Capo",exact:true}).press("Enter");
  await page.getByRole("button", {name:"收起编辑台",exact:true}).click();
  await page.getByRole("button", {name:"导出曲谱",exact:true}).click();
  const blockedOutput = page.getByRole("dialog", {name:"先处理未应用的输入"});
  await blockedOutput.waitFor({state:"visible"});
  await blockedOutput.getByRole("button", {name:"返回编辑",exact:true}).click();
  await page.waitForFunction(() => document.activeElement?.id === "settings-capo");
  assert.equal(await sidebar.isVisible(), true);
  assert.equal(await sidebar.locator("#settings-capo").locator("..").getAttribute("title"), "3 品");
  await sidebar.getByRole("button", {name:"恢复本组",exact:true}).click();
  assert.equal(await blockedOutput.isVisible(), false);
  await sidebar.getByRole("button", {name:/^编辑当前小节/}).click();
  const sectionInput = sidebar.locator("#settings-label");
  await sectionInput.fill("原小节草稿");
  assert.equal(await page.locator("#settings-label").count(), 1);
  await page.getByRole("button", {name:"导出曲谱",exact:true}).click();
  await blockedOutput.waitFor({state:"visible"});
  await blockedOutput.getByRole("button", {name:"返回编辑",exact:true}).click();
  await page.waitForFunction(() => document.activeElement?.id === "settings-label");
  assert.equal(await sectionInput.inputValue(), "原小节草稿");
  await sidebar.getByRole("button", {name:"收起编辑台",exact:true}).click();
  await digit("focus-three").click();
  await confirmation.waitFor({state:"visible"});
  assert.equal(await sidebar.isVisible(), true);
  await confirmation.getByRole("button", {name:"继续编辑",exact:true}).click();
  assert.equal(await sectionInput.inputValue(), "原小节草稿");
  await sidebar.getByRole("button", {name:"恢复本组",exact:true}).click();
  const countBeforeCopy = await page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures.length);
  const copyHistoryBefore = await page.evaluate(() => window.coexistStore.getState().historyDepth.past);
  await sidebar.locator("summary").filter({ hasText: "复制小节范围" }).click();
  await sidebar.locator("#settings-copy-start").focus();
  await sidebar.getByRole("button", {name:"复制小节范围",exact:true}).click();
  await page.waitForFunction((count) => window.coexistStore.getState().document.score.tracks[0].measures.length === count + 1, countBeforeCopy);
  assert.equal(await page.evaluate(() => window.coexistStore.getState().historyDepth.past), copyHistoryBefore + 1);
  await score.getByText("C", {exact:true}).first().click();
  const chordName = sidebar.getByRole("textbox", {name:"和弦名称",exact:true});
  await chordName.fill("我的和弦输入");
  await page.evaluate(() => {
    const state = window.coexistStore.getState();
    const track = state.document.score.tracks[0];
    const measure = track.measures.find((measure) => measure.chordSymbols.some((chord) => chord.chord.name === "C"));
    const chord = measure.chordSymbols.find((chord) => chord.chord.name === "C");
    const result = state.execute({ type:"chordSymbol.set", trackId:track.id, measureId:measure.id, beatId:chord.beatId,
      chord:{...chord.chord,name:"外部和弦更新"},display:chord.display });
    if (!result?.ok) throw new Error(result?.message ?? "外部和弦命令失败");
  });
  assert.equal(await chordName.inputValue(), "我的和弦输入");
  assert.equal(await sidebar.getByRole("button", {name:"应用和弦",exact:true}).isDisabled(), true);
  await chordName.fill("核对后的和弦");
  await sidebar.getByRole("button", {name:"应用和弦",exact:true}).click();
  assert.equal(await page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures.some((measure) => measure.chordSymbols.some((chord) => chord.chord.name === "核对后的和弦"))), true);
  assert.deepEqual(errors, []);
  console.log("Music text coexistence passed: no cached drafts or automatic submission; valid/invalid/multiple-group edits discarded on navigation; explicit Enter/apply retained; close/cancel/Escape discard; undo/redo, IME and inline rhythm.");
} finally {
  await browser?.close();
  await server.close();
}
