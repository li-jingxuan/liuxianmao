// LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs LXM_BROWSER_CHANNEL=chrome node apps/website/tests/chord-library.browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createPortReservation } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const artifacts = path.resolve(website, "../../artifacts/chord-library");
const reservation = createPortReservation();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
const server = await createServer({
  root: website,
  configFile: false,
  cacheDir: path.resolve(website, "node_modules/.vite/chord-library"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""' },
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "chord-library-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__chord_library__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});

let browser, page;
const errors = [], downloads = [], catalogResponses = [], checks = [];
let stage = "startup";
try {
  await mkdir(artifacts, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
    ...(process.env.LXM_BROWSER_CHANNEL ? { channel: process.env.LXM_BROWSER_CHANNEL } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  page.on("response", (response) => {
    if (/\/assets\/chords\/.+\.json$/.test(response.url())) catalogResponses.push({ url: response.url(), status: response.status() });
  });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__chord_library__`;
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  const toolbar = page.getByRole("toolbar", { name: "节奏、小节与历史工具" });
  const popover = page.locator("#chord-edit-popover");
  const quickName = page.locator("#chord-popover-name");
  const sideName = sidebar.getByRole("textbox", { name: "和弦名称", exact: true });
  const popup = page.locator(".ant-dropdown:not(.ant-dropdown-hidden)");
  const library = page.getByRole("dialog", { name: "和弦库", exact: true });
  const custom = page.getByRole("dialog", { name: "自定义指法", exact: true });
  const button = (root, name) => root.getByRole("button", {
    name: /^\p{Script=Han}{2}$/u.test(name) ? new RegExp(`^${[...name].join("\\s*")}$`) : name,
    exact: true,
  });
  const snapshot = () => page.evaluate(() => {
    const state = window.coexistStore.getState();
    return { document: state.document, history: state.historyDepth, entries: state.history.pastEntries };
  });
  const currentChord = () => page.evaluate(() => {
    const state = window.coexistStore.getState(), target = state.selection.focus;
    return state.document.score.tracks.find((track) => track.id === target.trackId).measures.find((measure) => measure.id === target.measureId).chordSymbols.find((chord) => chord.beatId === target.beatId);
  });
  const settled = () => page.waitForFunction(() => !document.querySelector("#music-text-sidebar[inert]"));
  const screenshot = (name) => page.screenshot({ path: path.join(artifacts, name), animations: "disabled" });
  const assertFooterReachable = async (root, label) => {
    const footerButton = button(root, label);
    const box = await footerButton.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 650, `${label} stays in the 650px viewport`);
    await footerButton.click({ trial: true });
  };
  const undo = async (baseline) => {
    await button(toolbar, "撤销").click();
    assert.deepEqual((await snapshot()).document, baseline.document, "undo restores the complete document");
  };
  const openMore = async (root) => {
    assert.match(await button(root, "更多和弦").innerText(), /更多/);
    await button(root, "更多和弦").click();
    await popup.getByRole("textbox", { name: "搜索全部和弦", exact: true }).waitFor();
  };
  const openLibrary = async (root) => {
    await openMore(root);
    await button(popup, "完整和弦库").click();
    await library.waitFor();
  };
  const choose = async (name = "Dm") => {
    await library.getByRole("tab", { name: "全部", exact: true }).click();
    await library.getByLabel("和弦候选", { exact: true }).getByRole("button", { name, exact: true }).click();
  };
  const initial = async () => {
    await page.goto(url, { waitUntil: "commit" });
    await sidebar.waitFor({ timeout: 90000 });
    const chord = await page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures.flatMap((measure) => measure.chordSymbols).find((symbol) => symbol.chord.diagram));
    await svg.getByText(chord.chord.name, { exact: true }).first().click();
    await quickName.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('#chord-edit-popover [aria-label="我的常用和弦"] button')].some((element) => !element.disabled && element.textContent === "C"));
    return { baseline: await snapshot(), chord: await currentChord() };
  };
  // Trigger background handlers directly as well as native keys: inert DOM alone
  // does not prove that application history/output guards reject delayed events.
  const assertModalIsolation = async (baseline) => {
    await page.keyboard.press("Meta+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Delete");
    await button(toolbar, "撤销").dispatchEvent("click");
    assert.deepEqual(await snapshot(), baseline, "modal blocks background edits, history and output");
    assert.equal(downloads.length, 0);
    assert.equal(await page.getByRole("dialog").count(), 1, "output never opens a second modal");
  };
  // Keep the transition probe in a Playwright handle; only the fixture exposes a
  // window global. The observer runs while the owner is actually closing.
  const watchClosing = (probeOutput = false) => page.evaluateHandle((probeOutput) => {
    const probe = { observed: false, snapshot: null };
    const observer = new MutationObserver(() => {
      const closing = document.querySelector(".ant-modal-wrap")?.style.display === "none" || document.querySelector('[class*="ant-zoom-leave"]');
      if (!probe.observed && closing && document.querySelector("#music-text-sidebar[inert]")) {
        probe.observed = true;
        const toolbar = document.querySelector('[role="toolbar"][aria-label="节奏、小节与历史工具"]');
        [...toolbar.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "撤销" || button.textContent.trim() === "撤销")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        if (probeOutput) for (const label of ["导出曲谱", "导出 A4 图片"]) {
          [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === label || button.textContent.trim() === label)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
        const state = window.coexistStore.getState();
        probe.snapshot = { document: state.document, history: state.historyDepth, entries: state.history.pastEntries };
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, childList: true });
    return { probe, observer };
  }, probeOutput);
  const assertClosing = async (handle, baseline) => {
    const result = await handle.evaluate(({ probe, observer }) => { observer.disconnect(); return probe; });
    await handle.dispose();
    assert.equal(result.observed, true, "background stays inert during real exit animation");
    assert.deepEqual(result.snapshot, baseline, "closing still blocks background undo and export");
    assert.equal(await page.getByRole("dialog", { name: "先处理未应用的输入", exact: true }).count(), 0, "closing blocks additional output modals");
    assert.equal(downloads.length, 0);
  };

  stage = "quick library cancel, HTTP catalog and closing isolation";
  let { baseline, chord } = await initial();
  await quickName.fill("Unapplied quick chord");
  await openLibrary(popover);
  assert.equal(await sidebar.getAttribute("inert"), "");
  await library.getByRole("tab", { name: "全部", exact: true }).click();
  assert.equal(await library.getByLabel("和弦候选", { exact: true }).getByRole("button").count(), 192);
  assert.ok(catalogResponses.some((response) => response.url.endsWith("manifest.json") && response.status === 200));
  assert.ok(catalogResponses.some((response) => /catalog-[\d.]+\.json$/.test(response.url) && response.status === 200));
  await choose("Dm");
  await screenshot("catalog.png");
  await page.setViewportSize({ width: 1440, height: 650 });
  await assertFooterReachable(library, "取消");
  await assertFooterReachable(library, "选用此指法");
  checks.push("Real same-origin HTTP manifest/catalog 200 and 192 candidates", "Library footer reachable at 1440×650");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await assertModalIsolation(baseline);
  await choose("Dm");
  const cancelProbe = await watchClosing();
  await button(library, "取消").click();
  await library.waitFor({ state: "hidden" });
  await settled();
  assert.equal(await quickName.inputValue(), "Unapplied quick chord");
  assert.deepEqual(await snapshot(), baseline, "cancel discards modal candidate and preserves the dirty parent");
  await assertClosing(cancelProbe, baseline);
  checks.push("Quick fixed More opens library; cancel preserves dirty parent", "Modal and actual closing transition block background editing/undo");

  stage = "library choice backfills quick parent, one SetChord and undo";
  await openLibrary(popover);
  await choose("Dm");
  await button(library, "选用此指法").click();
  await settled();
  assert.equal(await quickName.inputValue(), "Dm");
  assert.equal(await sideName.inputValue(), "Dm", "quick and sidebar share the parent draft");
  assert.deepEqual(await snapshot(), baseline, "library choice only backfills parent");
  await button(popover, "应用和弦").click();
  let applied = await snapshot();
  assert.equal(applied.history.past, baseline.history.past + 1);
  assert.equal(applied.entries.at(-1).label, "设置和弦");
  assert.equal((await currentChord()).chord.name, "Dm");
  await undo(baseline);
  checks.push("Library choice only backfills shared quick/sidebar draft; Apply creates one SetChordSymbol and undo restores document");

  stage = "sidebar fixed More and library-custom handoff cancellation";
  await sideName.fill("Sidebar original dirty");
  await openLibrary(sidebar);
  await choose("G7");
  await button(library, "基于此指法自定义").click();
  await custom.waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await custom.getByRole("textbox", { name: "自定义和弦名称", exact: true }).inputValue(), "G7");
  await page.setViewportSize({ width: 1440, height: 650 });
  await assertFooterReachable(custom, "取消");
  await assertFooterReachable(custom, "完成编辑");
  await screenshot("custom.png");
  checks.push("Custom editor footer reachable at 1440×650");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await custom.getByRole("textbox", { name: "自定义和弦名称", exact: true }).fill("Cancelled custom");
  await button(custom, "取消").click();
  await settled();
  assert.equal(await sideName.inputValue(), "Sidebar original dirty");
  assert.equal(await quickName.inputValue(), "Sidebar original dirty");
  assert.deepEqual((await snapshot()).document, baseline.document);
  assert.equal((await snapshot()).history.past, baseline.history.past);
  checks.push("Sidebar fixed More and library→custom handoff; cancel preserves original parent draft");

  stage = "custom completion backfills parent, Enter applies one command";
  await openLibrary(sidebar);
  await choose("G7");
  await button(library, "基于此指法自定义").click();
  await custom.waitFor();
  await custom.getByRole("textbox", { name: "自定义和弦名称", exact: true }).fill("Product G7");
  await button(custom, "完成编辑").click();
  await settled();
  assert.equal(await sideName.inputValue(), "Product G7");
  assert.deepEqual((await snapshot()).document, baseline.document);
  assert.equal((await snapshot()).history.past, baseline.history.past);
  await sideName.press("Enter");
  applied = await snapshot();
  assert.equal(applied.history.past, baseline.history.past + 1);
  assert.equal(applied.entries.at(-1).label, "设置和弦");
  assert.equal((await currentChord()).chord.name, "Product G7");
  await undo(baseline);
  checks.push("Custom complete only backfills parent; ordinary Enter creates one SetChordSymbol and undo restores document");

  stage = "settings handoff suspends and resumes dirty chord without changes";
  await quickName.fill("Suspended chord draft");
  await openLibrary(popover);
  const oldRecommendation = await library.getByLabel("和弦候选", { exact: true }).innerText();
  await button(library, "设置曲谱调性").click();
  await settled();
  const resume = button(sidebar, "返回和弦编辑");
  await resume.waitFor();
  const suspendedBefore = await snapshot();
  await button(toolbar, "撤销").dispatchEvent("click");
  await svg.dispatchEvent("keydown", { key: "z", metaKey: true, bubbles: true });
  assert.deepEqual(await snapshot(), suspendedBefore, "suspended dirty chord blocks background undo");
  assert.deepEqual((await snapshot()).document, baseline.document);
  assert.equal((await snapshot()).history.past, baseline.history.past);
  await resume.click();
  await quickName.waitFor();
  assert.equal(await quickName.inputValue(), "Suspended chord draft");
  await openLibrary(popover);
  assert.equal(await library.getByLabel("和弦候选", { exact: true }).innerText(), oldRecommendation);
  checks.push("Settings handoff suspends/resumes dirty chord without writes and blocks background undo");
  await button(library, "设置曲谱调性").click();
  await settled();

  stage = "settings info-only Enter commits SetScoreInfo, then recommendations update";
  await sidebar.locator("#settings-title").fill("Chord integration song");
  await sidebar.locator("#settings-mode").click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content').getByText("小调", { exact: true }).click();
  await sidebar.locator("#settings-tonic").fill("A");
  assert.deepEqual((await snapshot()).document, baseline.document, "unapplied tonality is absent from committed document");
  assert.equal((await snapshot()).history.past, baseline.history.past);
  assert.equal(await sidebar.getByText(/^和弦草稿已暂停并保留；/).count(), 1);
  assert.equal(await button(sidebar, "应用歌词").count(), 0, "suspended chord never exposes lyric draft actions");
  assert.equal(await button(sidebar, "应用和弦").count(), 0, "suspended chord applies only after return");
  await screenshot("settings.png");
  await resume.click();
  assert.equal(await resume.isVisible(), true, "dirty info must be applied before resuming the chord");
  await sidebar.locator("#settings-tonic").press("Enter");
  applied = await snapshot();
  assert.equal(applied.history.past, baseline.history.past + 1);
  assert.equal(applied.entries.at(-1).label, "修改曲谱信息");
  assert.equal(applied.document.score.title, "Chord integration song");
  assert.deepEqual(applied.document.score.meta["lxm:tonality"], { version: 1, tonic: "A", mode: "minor", minorTonicDegree: 6 });
  assert.deepEqual(applied.document.score.tracks, baseline.document.score.tracks, "settings commit never applies the suspended chord");
  await resume.click();
  await quickName.waitFor();
  assert.equal(await quickName.inputValue(), "Suspended chord draft");
  checks.push("Info-only Enter applies one SetScoreInfo; recommendations use committed tonality and suspended chord survives");
  await openLibrary(popover);
  assert.match(await library.innerText(), /曲谱 A小调/);
  assert.notEqual(await library.getByLabel("和弦候选", { exact: true }).innerText(), oldRecommendation);
  assert.match(await library.getByLabel("和弦候选", { exact: true }).innerText(), /和声小调/);
  await button(library, "取消").click();
  await settled();
  assert.equal(await quickName.inputValue(), "Suspended chord draft");

  stage = "empty-name deletion remains available after modal return";
  ({ baseline, chord } = await initial());
  for (const value of ["", "   "]) {
    await quickName.fill(value);
    assert.equal(await button(popover, "应用和弦").isEnabled(), true);
    await quickName.press("Enter");
    assert.equal(await currentChord(), undefined);
    applied = await snapshot();
    assert.equal(applied.history.past, baseline.history.past + 1);
    assert.equal(applied.entries.at(-1).label, "删除和弦");
    await undo(baseline);
    assert.deepEqual(await currentChord(), chord);
  }
  checks.push("Empty and whitespace names delete the selected chord through Enter, one command and full undo");

  stage = "Escape closes inner select before dismissing library";
  await openLibrary(popover);
  await library.getByRole("tab", { name: "全部", exact: true }).click();
  await library.getByRole("combobox", { name: "筛选根音", exact: true }).click();
  const selectPopup = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
  await selectPopup.waitFor();
  await page.keyboard.press("Escape");
  await selectPopup.waitFor({ state: "hidden" });
  assert.equal(await library.isVisible(), true, "first Escape closes only the inner select");
  await page.keyboard.press("Escape");
  await library.waitFor({ state: "hidden" });
  await settled();
  checks.push("Inner select consumes first Escape; next Escape dismisses library");
  stage = "background output remains blocked during library modal";
  await openLibrary(popover);
  const beforeOutput = await snapshot();
  await button(page, "导出曲谱").dispatchEvent("click");
  await button(page, "导出 A4 图片").dispatchEvent("click");
  assert.deepEqual(await snapshot(), beforeOutput);
  assert.equal(downloads.length, 0);
  assert.equal(await page.getByRole("dialog").count(), 1, "output never opens a second modal");
  const outputProbe = await watchClosing(true);
  await button(library, "取消").click();
  await settled();
  await assertClosing(outputProbe, beforeOutput);
  checks.push("Modal and real closing transition block delayed score/image output without extra modal or download");
  assert.deepEqual(errors, []);
  assert.equal(downloads.length, 0);
  await screenshot("passed.png");
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({
    status: "passed",
    createdAt: new Date().toISOString(),
    fixture: "tests/music-text-coexist.browser.tsx: real HomePage and coexistStore",
    browser: { version: browser.version(), channel: process.env.LXM_BROWSER_CHANNEL ?? "chromium" },
    viewports: [{ width: 1440, height: 1000 }, { width: 1440, height: 650 }],
    checks: checks.map((label) => ({ label, status: "passed" })),
    screenshots: ["catalog.png", "custom.png", "settings.png"],
    catalogResponses,
    pageErrors: errors,
    downloads,
  }, null, 2));
  console.log("PASS chord-library product integration: real HTTP 192 catalog, quick/sidebar More, dirty cancel, choose/custom backfill, handoff cancellation, one-command Apply/Enter + undo, settings suspend/resume + info-only tonality commit, modal/closing guards, empty-name deletion.");
} catch (error) {
  console.error(`Chord-library integration failed during: ${stage}`);
  if (page) {
    await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
    await writeFile(path.join(artifacts, "failure.html"), await page.content()).catch(() => {});
    const state = await page.evaluate(() => ({
      document: window.coexistStore?.getState().document,
      history: window.coexistStore?.getState().historyDepth,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((element) => ({
        label: element.getAttribute("aria-label") ?? document.getElementById(element.getAttribute("aria-labelledby"))?.textContent,
        inert: element.inert,
        hidden: element.getAttribute("aria-hidden"),
      })),
    })).catch(() => null);
    await writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ stage, errors, catalogResponses, downloads, state }, null, 2)).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
