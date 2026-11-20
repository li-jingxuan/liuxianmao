import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(website, "../../output/playwright/lyrics-numbered-approved");
await mkdir(output, { recursive: true });
const server = await createServer({
  root: website, configFile: false,
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""' },
  cacheDir: path.resolve(website, "node_modules/.vite/lyrics-numbered-approved"),
  optimizeDeps: { entries: ["tests/lyrics-numbered-approved.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "approved-editor", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__approved__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/lyrics-numbered-approved.browser.tsx"></script>'));
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE, channel: process.env.LXM_BROWSER_CHANNEL });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__approved__`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const sidebar = page.locator("#music-text-sidebar");
  await sidebar.waitFor({ timeout: 60000 }).catch(async error => {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
    console.error("Page errors:", errors, "Page text:", await page.locator("body").innerText());
    throw error;
  });
  await sidebar.getByRole("tab", { name: "简谱与歌词", exact: true }).click();
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score.getByText("3", { exact: true }).click();
  const input = sidebar.getByRole("textbox", { name: "简谱内容", exact: true });
  await input.waitFor();
  assert.equal(await input.evaluate(node => node.tagName), "INPUT");
  assert.equal(await input.inputValue(), "1+3");
  assert.equal(await sidebar.getByRole("button", { name: "应用简谱内容", exact: true }).count(), 1);
  assert.equal(await sidebar.getByText("拆分与合并", { exact: true }).count(), 0);
  assert.equal(await sidebar.getByText("复制与粘贴", { exact: true }).count(), 0);
  assert.equal(await sidebar.getByText("录入方式", { exact: true }).count(), 0);
  const events = () => page.evaluate(() => window.approvedEditor.getState().document.score.tracks[0].measures[0].numberedVoice.events);
  const history = () => page.evaluate(() => window.approvedEditor.getState().historyDepth.past);
  const accidental = sidebar.getByRole("button", { name: /升号/ });
  await accidental.click();
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.tracks[0].measures[0].numberedVoice.events[2].items[1].token === "#3");
  assert.deepEqual((await events())[2].items.map(item => item.token), ["1", "#3"]);
  assert.equal(await input.inputValue(), "1+#3");
  await input.fill("5 6");
  assert.equal(await accidental.isDisabled(), true);
  const popover = page.locator('[data-text-surface="popover"]');
  assert.equal(await popover.getByRole("textbox", { name: "简谱内容", exact: true }).inputValue(), "5 6");
  await input.press("Enter");
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.tracks[0].measures[0].numberedVoice.events[2].items[0].token === "5");
  assert.equal(await input.inputValue(), "5 6");
  await sidebar.getByRole("button", { name: "延音", exact: true }).click();
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.tracks[0].measures[0].numberedVoice.events[2].items[0].token === "-");
  assert.equal(await input.inputValue(), "-");
  await page.evaluate(() => window.approvedEditor.getState().undo());
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.tracks[0].measures[0].numberedVoice.events[2].items[0].token === "5");
  await page.waitForFunction(() => document.getElementById("numbered-sidebar-content")?.value === "5");
  assert.equal(await sidebar.getByRole("button", { name: "延音", exact: true }).isVisible(), true);
  assert.equal(await sidebar.getByText("原编辑位置已失效", { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(output, "numbered-desktop.png"), animations: "disabled" });

  await score.getByText("风", { exact: true }).click();
  const lyric = sidebar.getByRole("textbox", { name: "连续歌词", exact: true });
  await lyric.waitFor();
  assert.equal(await lyric.evaluate(node => node.tagName), "TEXTAREA");
  const lyrics = () => page.evaluate(() => window.approvedEditor.getState().document.score.tracks[0].measures[0].lyrics);
  const applyLyric = sidebar.getByRole("button", { name: "应用", exact: true });
  await lyric.fill("风 _\n多字");
  await applyLyric.click();
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.tracks[0].measures[0].lyrics.some(item => item.text === "多字"));
  assert.equal((await lyrics()).some(item => item.text === "吹"), false);
  assert.equal((await lyrics()).some(item => item.text === "多字"), true);
  await lyric.fill("");
  await applyLyric.click();
  await page.waitForFunction(() => !window.approvedEditor.getState().document.score.tracks[0].measures[0].lyrics.some(item => item.eventId === "approved-event-0"));
  const beforeVerse = await history();
  await sidebar.getByRole("button", { name: "添加歌词行", exact: true }).click();
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.meta.lyricVerseCount === 2);
  assert.equal(await lyric.inputValue(), "");
  assert.equal(await history(), beforeVerse + 1);
  await page.evaluate(() => window.approvedEditor.getState().undo());
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.meta.lyricVerseCount === 1);
  await page.evaluate(() => window.approvedEditor.getState().redo());
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.meta.lyricVerseCount === 2);
  await page.screenshot({ path: path.join(output, "lyrics-desktop.png"), animations: "disabled" });
  for (const width of [720, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // ResizeObserver updates panel mode after layout; inspect the settled mode.
    if (width === 720) await page.waitForFunction(() => document.querySelector('[aria-label="编辑面板"]')?.getAttribute("aria-expanded") === "false");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const panelToggle = page.getByRole("button", { name: "编辑面板", exact: true });
    if (await panelToggle.getAttribute("aria-expanded") === "false") await panelToggle.click();
    await sidebar.getByRole("button", { name: "添加歌词行", exact: true }).waitFor().catch(async error => {
      await page.screenshot({ path: path.join(output, `failed-${width}.png`) });
      console.error("Responsive state", width, await panelToggle.getAttribute("aria-expanded"), await sidebar.innerText());
      throw error;
    });
    const bounds = await sidebar.getByRole("button", { name: "添加歌词行", exact: true }).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `lyrics-${width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await sidebar.locator("[data-editor-paragraph-switch]").getByText("简谱", { exact: true }).click();
  const addNumbered = sidebar.getByRole("button", { name: "添加简谱行", exact: true });
  assert.equal(await addNumbered.isDisabled(), true);
  assert.equal(await addNumbered.getAttribute("aria-description"), "曲谱已有简谱行");
  const beforeDelete = await history();
  const savedEvents = await events();
  const savedLyrics = await lyrics();
  const removeNumbered = async () => {
    await sidebar.getByRole("button", { name: "简谱行操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "删除简谱行", exact: true }).click();
  };
  const rowDialog = page.getByRole("dialog", { name: "删除简谱行？" });
  await removeNumbered();
  await rowDialog.getByRole("button", { name: /^取\s*消$/ }).click();
  await rowDialog.waitFor({ state: "hidden" });
  assert.equal(await history(), beforeDelete);
  assert.deepEqual(await events(), savedEvents);
  await removeNumbered();
  await rowDialog.getByRole("button", { name: /^删\s*除$/ }).click();
  await rowDialog.waitFor({ state: "hidden" });
  assert.equal(await history(), beforeDelete + 1);
  assert.ok((await events()).every(event => event.kind === "gap"));
  assert.deepEqual(await lyrics(), savedLyrics);
  assert.equal(await input.count(), 0);
  assert.equal(await addNumbered.isEnabled(), true);
  await page.evaluate(() => window.approvedEditor.getState().undo());
  await page.waitForFunction(() => window.approvedEditor.getState().document.score.tracks[0].measures[0].numberedVoice.events.some(event => event.kind === "notes"));
  assert.deepEqual(await events(), savedEvents);
  await page.evaluate(() => window.approvedEditor.getState().redo());
  await addNumbered.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "numbered-sidebar-content");
  assert.equal(await addNumbered.isDisabled(), true);
  assert.deepEqual(await lyrics(), savedLyrics);
  assert.deepEqual(errors, []);
  console.log("Approved lyrics/numbered browser: selected chord member, shared draft, dirty guards, inline Apply, continuation, undo, lyric blanks, whole words, verse history and responsive screens passed.");
} finally {
  await browser?.close();
  await server.close();
}
