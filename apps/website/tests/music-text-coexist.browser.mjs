// Optional: LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node <this file>
// Current spec13: one shared single-line draft; inline Apply; immediate rhythm;
// switching target/category discards text, closing lyric popover/collapsing preserves it.
import assert from "node:assert/strict";
import { selectScoreAction } from "./score-file-actions.browser.cjs";
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
const output = path.resolve(website, "../../output/playwright/music-text-coexist");
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/music-text-coexist-approved"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "music-text-coexist-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__coexist__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});
let browser;
let page;
const errors = [];
const checks = [];
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
    ...(process.env.LXM_BROWSER_CHANNEL ? { channel: process.env.LXM_BROWSER_CHANNEL } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__coexist__`, { waitUntil: "commit" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await sidebar.waitFor({ timeout: 90000 });
  const history = () => page.evaluate(() => window.coexistStore.getState().historyDepth);
  const snapshot = () => page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth }));
  const capture = name => page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
  const initialHistory = await history();
  for (const viewport of [{ width: 1400, height: 900 }, { width: 1920, height: 1080 }, { width: 1440, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const frame = await sidebar.boundingBox();
    const sidebarWidth = await sidebar.evaluate(node => Number.parseFloat(getComputedStyle(node).getPropertyValue("--sidebar-width")));
    assert.equal(frame.width, sidebarWidth, "sidebar follows the current responsive product token");
    for (const name of ["选区", "简谱与歌词", "和弦", "歌曲"]) {
      const tab = sidebar.getByRole("tab", { name, exact: true });
      assert.equal(await tab.isVisible(), true);
      const bounds = await tab.boundingBox();
      assert.ok(bounds.x >= frame.x && bounds.x + bounds.width <= frame.x + frame.width, `${name} stays in sidebar`);
    }
  }
  await sidebar.getByRole("tab", { name: "简谱与歌词", exact: true }).click();
  assert.equal(await sidebar.getByRole("textbox").count(), 0, "browsing a tab does not activate an editor");
  assert.deepEqual(await history(), initialHistory);
  checks.push("1400/1440/1920 sidebar matches responsive width token, all tabs fit, passive browsing does not write history");

  // Actual lyrics: simultaneous surfaces and explicit focus; no obsolete mode or full-settings button.
  await score.getByText("旋", { exact: true }).click();
  const popover = page.locator('[data-text-surface="popover"]');
  const fields = sidebar.locator("#music-text-fields");
  const sidebarInput = fields.getByRole("textbox", { name: "连续歌词", exact: true });
  const input = popover.getByRole("textbox", { name: "连续歌词", exact: true });
  const lyricApply = popover.getByRole("button", { name: "应用", exact: true });
  const confirmation = sidebar.getByRole("alertdialog");
  await input.waitFor();
  assert.equal(await sidebarInput.evaluate(node => node.tagName), "INPUT");
  assert.equal(await popover.locator("textarea, footer button").count(), 0);
  assert.equal(await fields.getByText("连续填词", { exact: true }).count(), 0);
  assert.deepEqual(await fields.locator("[data-editor-paragraph-switch] .ant-segmented-item-label").allTextContents(), ["简谱", "歌词"]);
  const lyricBaseline = await snapshot();
  await input.fill("旋律草稿");
  assert.equal(await sidebarInput.inputValue(), "旋律草稿");
  await page.getByRole("button", { name: "编辑面板", exact: true }).click();
  assert.equal(await sidebar.isVisible(), false);
  assert.equal(await input.inputValue(), "旋律草稿");
  const toggle = page.getByRole("button", { name: "编辑面板", exact: true });
  await toggle.focus();
  await toggle.press("Enter");
  assert.equal(await sidebarInput.inputValue(), "旋律草稿");
  await input.evaluate(node => { window.coexistInput = node; node.setSelectionRange(1, 3); });
  await sidebarInput.focus();
  assert.equal(await sidebarInput.evaluate(node => node === document.activeElement), true);
  await sidebarInput.fill("侧栏草稿");
  assert.equal(await input.inputValue(), "侧栏草稿");
  assert.equal(await input.evaluate(node => node === window.coexistInput), true, "sidebar changes keep the floating input mounted");
  assert.deepEqual(await snapshot(), lyricBaseline);
  await input.dispatchEvent("compositionstart");
  assert.equal(await lyricApply.isDisabled(), true);
  await sidebar.getByRole("tab", { name: "歌曲", exact: true }).click();
  assert.equal(await sidebarInput.isVisible(), true, "IME blocks category navigation");
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
  });
  assert.deepEqual(await snapshot(), lyricBaseline);
  await page.waitForFunction(() => document.querySelector('#music-text-edit-popover button[aria-label="应用"]')?.disabled === false);
  await popover.getByRole("button", { name: "关闭歌词浮窗", exact: true }).click();
  assert.equal(await popover.isVisible(), false);
  assert.equal(await sidebarInput.inputValue(), "侧栏草稿");
  await score.getByText("旋", { exact: true }).click();
  assert.equal(await input.inputValue(), "侧栏草稿", "reopening the same lyric preserves its session");
  await sidebar.getByRole("tab", { name: "歌曲", exact: true }).click();
  assert.equal(await confirmation.count(), 0);
  assert.equal(await popover.isVisible(), false);
  assert.deepEqual(await snapshot(), lyricBaseline);
  await score.getByText("旋", { exact: true }).click();
  assert.equal(await input.inputValue(), "旋", "category change discards unapplied lyric input");
  await input.fill("已应用歌词");
  await input.press("Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks.some(track => track.measures.some(measure => measure.lyrics.some(lyric => lyric.text === "已应用歌词"))));
  assert.equal((await history()).past, lyricBaseline.history.past + 1);
  await capture("lyrics-coexist");
  checks.push("lyric shared input/node identity/focus, collapse and close preserve session, category change discards, IME Enter/229/cooling guard, explicit Enter writes one history item");

  // Controlled legal score fixture keeps the real renderer, store, hit testing and edit surfaces.
  const historyBefore = await page.evaluate(() => {
    const state = window.coexistStore.getState();
    const document = structuredClone(state.document);
    const track = document.score.tracks[0];
    track.numberedMarks = [];
    track.techniques = [];
    const measure = track.measures[0];
    measure.lyrics = [];
    measure.tuplets = [];
    measure.beats = [0, 960, 1920, 2880].map((tick, index) => ({ id: `coexist-tab-${index}`, tick, kind: "rest", notes: [], rhythm: { base: "quarter", dots: 0 } }));
    measure.chordSymbols = measure.chordSymbols.slice(0, 1).map(chord => ({ ...chord, beatId: "coexist-tab-0" }));
    measure.numberedVoice = { events: [
      { id: "focus-five", kind: "notes", tick: 0, rhythm: { base: "eighth", dots: 0 }, items: [{ id: "focus-five-item", token: "5" }] },
      { id: "focus-three", kind: "notes", tick: 480, rhythm: { base: "eighth", dots: 0 }, items: [{ id: "focus-three-item", token: "3" }] },
      { id: "focus-seven", kind: "notes", tick: 960, rhythm: { base: "eighth", dots: 0 }, items: [{ id: "focus-seven-item", token: "7" }] },
    ], tuplets: [] };
    const result = state.replaceDocument(document);
    if (!result.ok) throw new Error(result.message);
    return window.coexistStore.getState().historyDepth;
  });
  const digit = id => score.locator(`[data-numbered-event="${id}"]`).first();
  const numberedInput = popover.getByRole("textbox", { name: "简谱内容", exact: true });
  const numberedSidebarInput = fields.getByRole("textbox", { name: "简谱内容", exact: true });
  const currentEvent = () => page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find(event => event.id === "focus-five"));
  const seventhToken = () => page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find(event => event.id === "focus-seven").items[0].token);
  const rhythm = popover.getByRole("group", { name: "常用时值" });
  await digit("focus-five").click();
  await numberedInput.waitFor();
  const firstBounds = await score.locator('[data-numbered-event-focus="focus-five"]').boundingBox();
  const beatBounds = await score.locator("[data-numbered-beat-context]").boundingBox();
  assert.ok(firstBounds.width < beatBounds.width);
  const firstArrow = await popover.getAttribute("style");
  await popover.getByRole("button", { name: "同拍下一个简谱音符", exact: true }).click();
  await score.locator('[data-numbered-event-focus="focus-three"]').waitFor();
  const secondBounds = await score.locator('[data-numbered-event-focus="focus-three"]').boundingBox();
  // Unified event bounds include stems/beams, so adjacent focus boxes may overlap.
  assert.ok(secondBounds.x + secondBounds.width / 2 > firstBounds.x + firstBounds.width / 2);
  assert.deepEqual(await score.locator("[data-numbered-beat-context]").boundingBox(), beatBounds);
  assert.equal(await numberedInput.inputValue(), "3");
  assert.notEqual(await popover.getAttribute("style"), firstArrow);
  assert.notEqual(await digit("focus-five").getAttribute("fill"), await digit("focus-three").getAttribute("fill"));
  await numberedSidebarInput.focus();
  assert.equal(await score.locator('[data-numbered-event-focus="focus-three"]').isVisible(), true);
  await capture("numbered-selection-pair");
  await digit("focus-seven").click();
  assert.equal(await score.locator("[data-numbered-beat-context]").count(), 0);
  assert.equal(await popover.getByRole("group", { name: "同拍简谱音符" }).count(), 0);
  assert.equal(await numberedInput.inputValue(), "7");
  await digit("focus-five").click();
  await numberedInput.fill("#5");
  assert.equal(await numberedSidebarInput.inputValue(), "#5");
  await numberedSidebarInput.fill("6");
  assert.equal(await numberedInput.inputValue(), "6");
  await numberedInput.dispatchEvent("compositionstart");
  assert.equal(await rhythm.getByRole("button", { name: "八分音符", exact: true }).isDisabled(), true);
  assert.equal(await sidebar.getByRole("button", { name: "应用简谱内容", exact: true }).isDisabled(), true);
  assert.equal(await popover.getByRole("button", { name: "同拍下一个简谱音符", exact: true }).isDisabled(), true);
  await numberedInput.dispatchEvent("compositionend");
  await page.waitForFunction(() => document.querySelector('button[aria-label="同拍下一个简谱音符"]')?.disabled === false);
  await popover.getByRole("button", { name: "同拍下一个简谱音符", exact: true }).click();
  assert.equal(await numberedInput.inputValue(), "3");
  assert.equal((await currentEvent()).items[0].token, "5");
  assert.equal(await confirmation.count(), 0);
  await numberedInput.fill("invalid");
  await popover.getByRole("button", { name: "同拍上一个简谱音符", exact: true }).click();
  assert.equal(await numberedInput.inputValue(), "5");
  assert.deepEqual(await history(), historyBefore, "target switching never submits drafts");
  checks.push("numbered shared input/focus, actual event selection vs TAB beat context, same-beat arrows and anchor, IME locks navigation, valid and invalid drafts discard without history");

  await numberedInput.fill("#4");
  await numberedInput.dispatchEvent("compositionstart");
  await numberedInput.press("Control+Enter");
  assert.equal((await currentEvent()).items[0].token, "5");
  await numberedInput.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  });
  assert.equal((await currentEvent()).items[0].token, "5");
  await page.waitForFunction(() => document.querySelector('#numbered-popover-content')?.parentElement.querySelector('button')?.disabled === false);
  await numberedInput.press("Control+Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find(event => event.id === "focus-five").items[0].token === "#4");
  assert.equal(await numberedSidebarInput.inputValue(), "#4");
  const afterEnter = await history();
  assert.equal(afterEnter.past, historyBefore.past + 1);
  await numberedInput.press("Control+Enter");
  assert.deepEqual(await history(), afterEnter);
  await numberedInput.fill("invalid");
  await numberedInput.press("Control+Enter");
  assert.equal((await currentEvent()).items[0].token, "#4");
  assert.deepEqual(await history(), afterEnter);
  await digit("focus-three").click();
  await digit("focus-five").click();
  assert.equal(await numberedInput.inputValue(), "#4");
  const iconNodes = rhythm.locator('button[aria-label$="音符"] span[style]');
  const icons = await iconNodes.evaluateAll(nodes => nodes.map(node => ({ mask: getComputedStyle(node).maskImage, width: getComputedStyle(node).width, height: getComputedStyle(node).height })));
  assert.equal(icons.length, 6);
  for (const icon of icons) {
    assert.equal(icon.width, icon.height);
    assert.match(icon.mask, /\/assets\/svg\/music-controls\/note-/);
    assert.equal((await page.request.get(icon.mask.match(/url\("?(.*?)"?\)/)[1])).ok(), true);
  }
  const beforeRhythm = await history();
  await rhythm.getByRole("button", { name: "十六分音符", exact: true }).click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find(event => event.id === "focus-five").rhythm.base === "sixteenth");
  assert.equal((await currentEvent()).items[0].token, "#4");
  assert.equal((await history()).past, beforeRhythm.past + 1);
  assert.equal(await fields.getByRole("group", { name: "常用时值" }).getByRole("button", { name: "十六分音符", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await popover.getByRole("button", { name: "应用时值", exact: true }).count(), 0, "current rhythm acts immediately");
  await page.evaluate(() => window.coexistStore.getState().undo());
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find(event => event.id === "focus-five").rhythm.base === "eighth");
  await capture("numbered-coexist");
  assert.deepEqual(await page.locator("[id]").evaluateAll(nodes => { const ids = nodes.map(node => node.id); return ids.filter((id, index) => ids.indexOf(id) !== index); }), []);
  checks.push("Ctrl+Enter IME/cooling, valid/no-op/invalid content history, six vector assets, immediate rhythm writes one command and syncs both surfaces, undo, unique DOM ids");

  // Spec13: dismissing the floating surface preserves its shared session;
  // target changes discard unapplied text, while Apply persists to the document.
  for (const exit of ["close", "escape", "target"]) {
    await digit("focus-seven").click();
    await numberedInput.fill("6");
    if (exit === "close") await popover.getByRole("button", { name: "结束文字编辑", exact: true }).click();
    else if (exit === "escape") await numberedInput.press("Escape");
    else await digit("focus-three").click();
    assert.equal(await seventhToken(), "7");
    await digit("focus-seven").click();
    assert.equal(await numberedInput.inputValue(), exit === "target" ? "7" : "6");
    await digit("focus-three").click();
    await digit("focus-seven").click();
    assert.equal(await numberedInput.inputValue(), "7", "changing targets discards the preserved floating draft");
  }
  await numberedInput.fill("6");
  await popover.getByRole("button", { name: "应用简谱内容", exact: true }).click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].numberedVoice.events.find(event => event.id === "focus-seven").items[0].token === "6");
  await page.evaluate(() => window.coexistStore.getState().undo());
  assert.equal(await seventhToken(), "7");
  await page.evaluate(() => window.coexistStore.getState().redo());
  assert.equal(await seventhToken(), "6");
  checks.push("numbered close/Escape preserve shared session, target change discards, inline Apply persists, undo/redo");

  // Settings keep their own draft/export gate; section label now saves on blur.
  await sidebar.getByRole("tab", { name: "歌曲", exact: true }).click();
  const capo = sidebar.getByRole("combobox", { name: "Capo", exact: true });
  await capo.click();
  await capo.press("Home");
  for (let index = 0; index < 3; index++) await capo.press("ArrowDown");
  await capo.press("Enter");
  await page.getByRole("button", { name: "编辑面板", exact: true }).click();
  await selectScoreAction(page, "导出", "JSON 曲谱");
  const blockedOutput = page.getByRole("dialog", { name: "先处理未应用的输入" });
  await blockedOutput.waitFor();
  await blockedOutput.getByRole("button", { name: "返回编辑", exact: true }).click();
  await blockedOutput.waitFor({ state: "hidden" });
  assert.equal(await sidebar.isVisible(), true);
  assert.equal(await sidebar.locator("#settings-capo").locator("..").getAttribute("title"), "3 品");
  await sidebar.getByRole("button", { name: "恢复本组", exact: true }).click();
  assert.equal(await blockedOutput.isVisible(), false);
  await sidebar.getByRole("tab", { name: "选区", exact: true }).click();
  await sidebar.getByRole("radio", { name: "小节", exact: true }).locator("..").click();
  const sectionInput = sidebar.locator("#settings-label");
  await sectionInput.fill("共存自动保存");
  const beforeLabel = await history();
  await sidebar.locator("#settings-copy-start").focus();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.some(measure => measure.sectionLabel === "共存自动保存"));
  assert.equal((await history()).past, beforeLabel.past + 1);
  const countBeforeCopy = await page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures.length);
  const copyHistoryBefore = await history();
  await sidebar.getByRole("button", { name: "应用复制小节范围", exact: true }).click();
  await page.waitForFunction(count => window.coexistStore.getState().document.score.tracks[0].measures.length === count + 1, countBeforeCopy);
  assert.equal((await history()).past, copyHistoryBefore.past + 1);
  checks.push("settings export gate survives sidebar collapse and restores panel with draft intact; restore clears gate; section label blur saves once; inline range copy writes once");

  await score.getByText("C", { exact: true }).first().click();
  const chordName = sidebar.getByRole("textbox", { name: "和弦名称", exact: true });
  await chordName.fill("我的和弦输入");
  await page.evaluate(() => {
    const state = window.coexistStore.getState();
    const track = state.document.score.tracks[0];
    const measure = track.measures.find(measure => measure.chordSymbols.some(chord => chord.chord.name === "C"));
    const chord = measure.chordSymbols.find(chord => chord.chord.name === "C");
    const result = state.execute({ type: "chordSymbol.set", trackId: track.id, measureId: measure.id, beatId: chord.beatId, chord: { ...chord.chord, name: "外部和弦更新" }, display: chord.display });
    if (!result?.ok) throw new Error(result?.message ?? "external chord command failed");
  });
  assert.equal(await chordName.inputValue(), "我的和弦输入");
  assert.equal(await sidebar.getByRole("button", { name: "应用和弦", exact: true }).isDisabled(), true);
  await chordName.fill("核对后的和弦");
  await sidebar.getByRole("button", { name: "应用和弦", exact: true }).click();
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures.some(measure => measure.chordSymbols.some(chord => chord.chord.name === "核对后的和弦")));
  checks.push("external chord edit retains draft and blocks stale apply until user edits again");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ checks, pageErrors: errors }, null, 2) + "\n");
  console.log("Music text coexistence passed:\n" + checks.join("\n"));
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  console.error("Page errors:", errors, "Page text:", await page?.locator("body").innerText());
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
