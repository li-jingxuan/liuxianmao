// Full Sidebar integration: a surviving first event/text cannot keep an obsolete lyric mapping alive.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(website, "../../artifacts/rhythm-sync-implementation");
await mkdir(output, { recursive: true });
const server = await createServer({
  root: website, configFile: false,
  cacheDir: path.resolve(website, "node_modules/.vite/rhythm-sync-draft"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "rhythm-sync-draft-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__rhythm-draft__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.LXM_BROWSER_CHANNEL, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__rhythm-draft__`);
  const sidebar = page.locator("#music-text-sidebar");
  await sidebar.waitFor({ timeout: 90000 });
  const fixture = JSON.parse(await readFile(path.resolve(website, "../../artifacts/rhythm-sync-20261109/A-after-eighths.lxm"), "utf8"));
  const measure = fixture.score.tracks[0].measures[0];
  // Keep the starting word and make the second actual lyric position writable without overwrite.
  measure.lyrics = [measure.lyrics[0]];
  fixture.score.title = "歌词映射细分回归";
  await page.locator('input[type="file"]').setInputFiles({ name: "lyric-mapping.lxm", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole("button", { name: "导入并替换", exact: true }).click();
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  await svg.getByText("歌词映射细分回归", { exact: true }).waitFor();
  await svg.getByText("轻", { exact: true }).click();
  const fields = sidebar.locator("#music-text-fields");
  await fields.getByText("连续填词", { exact: true }).click();
  const input = fields.getByRole("textbox", { name: "连续歌词", exact: true });
  await input.fill("轻 新");
  await fields.locator('[aria-label="音符与歌词映射"]').waitFor();
  const firstId = measure.numberedVoice.events[0].id;
  const external = await page.evaluate(() => {
    const state = window.coexistStore.getState();
    const track = state.document.score.tracks[0], measure = track.measures[0];
    const result = state.execute({ type: "numbered.range.alignToTab", trackId: track.id, measureId: measure.id, startTick: 0, endTick: 960, expectedRevision: state.document.documentRevision });
    if (!result?.ok) throw new Error(result?.message ?? "Missing external result");
    return { document: result.document, history: window.coexistStore.getState().historyDepth };
  });
  assert.equal(external.document.score.tracks[0].measures[0].numberedVoice.events[0].id, firstId);
  await fields.getByRole("status").filter({ hasText: /歌词位置或原内容已变化/ }).waitFor();
  assert.equal(await input.inputValue(), "轻 新");
  assert.equal(await fields.locator('[aria-label="音符与歌词映射"]').count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: /^应用歌词/ }).isDisabled(), true);
  await input.press("Enter");
  const snapshot = () => page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth }));
  assert.deepEqual(await snapshot(), external);
  await page.screenshot({ path: path.join(output, "lyric-mapping-invalidated.png") });
  await input.fill("轻 新词");
  await fields.locator('[aria-label="音符与歌词映射"]').waitFor();
  await input.press("Enter");
  await page.waitForFunction(() => window.coexistStore.getState().document.score.tracks[0].measures[0].lyrics.some((lyric) => lyric.text === "新词"));
  const saved = await snapshot(), savedMeasure = saved.document.score.tracks[0].measures[0];
  const newGap = savedMeasure.numberedVoice.events.find((event) => event.tick === 480);
  assert.ok(savedMeasure.lyrics.some((lyric) => lyric.eventId === newGap.id && lyric.text === "新词"));
  assert.ok(!savedMeasure.lyrics.some((lyric) => lyric.eventId === measure.numberedVoice.events[1].id && lyric.text === "新词"));
  assert.deepEqual(errors, []);
  console.log("PASS Sidebar: external split invalidates sequence mapping, retains typed text, blocks Enter, then remaps explicitly edited input to the new gap");
} finally {
  await browser?.close();
  await server.close();
}
