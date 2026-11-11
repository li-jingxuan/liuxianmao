// LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs LXM_BROWSER_CHANNEL=chrome node apps/website/tests/chord-library.browser.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createPortReservation } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const artifacts = path.resolve(process.env.LXM_CHORD_ARTIFACTS ?? path.resolve(website, "../../artifacts/chord-library"));
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
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "next/link"] },
  esbuild: { jsx: "automatic" },
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""' },
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "chord-library-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url === "/__chord_prototype__") {
        response.setHeader("Content-Type", "text/html");
        response.end(await readFile(path.resolve(website, "../../docs/design-v2/prototypes/chord-library/prototype.html"), "utf8"));
        return;
      }
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
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
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
  const library = page.getByRole("dialog", { name: /^和弦库/ });
  const custom = page.getByRole("dialog", { name: /^自定义指法/ });
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
  const modalSettled = async () => {
    // Let Ant's entrance animation finish: disabling it during its first frame
    // can capture a mask while the actual modal still has opacity zero.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => [...document.querySelectorAll(".ant-modal-wrap")].filter((wrap) => getComputedStyle(wrap).display !== "none").every((wrap) => {
      const modal = wrap.querySelector(".ant-modal");
      return modal && Number(getComputedStyle(modal).opacity) === 1 && !/(?:appear|enter|leave)(?:-active|-prepare)?(?:\s|$)/.test(modal.className);
    }));
    await page.locator(".ant-modal").evaluateAll(async (elements) => {
      await Promise.all(elements.flatMap((element) => element.getAnimations({ subtree: true })).filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
    });
  };
  const screenshot = async (name) => {
    await modalSettled();
    await page.locator(".ant-modal").evaluateAll((elements) => {
      for (const element of elements) for (const node of [element, ...element.querySelectorAll("*")]) {
        if (node.scrollTop) node.scrollTop = 0;
      }
    });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(artifacts, name), animations: "disabled" });
  };
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
    await page.waitForFunction(() => [...document.querySelectorAll(".ant-dropdown:not(.ant-dropdown-hidden)")].every((element) => getComputedStyle(element).opacity === "1" && !/(?:appear|enter)(?:-active|-prepare)?(?:\s|$)/.test(element.className)));
  };
  const openLibrary = async (root) => {
    await openMore(root);
    await popup.getByRole("button", { name: /^(浏览完整和弦库 →|完整和弦库)$/ }).click();
    await library.waitFor();
  };
  const choose = async (name = "Dm") => {
    await library.getByRole("tab", { name: "全部和弦", exact: true }).click();
    await library.getByLabel("和弦候选", { exact: true }).getByRole("button").filter({ has: page.getByText(name, { exact: true }) }).click();
  };
  const chooseOpenG = async () => {
    await choose("G");
    await library.getByLabel("选择指法版本", { exact: true }).getByRole("button").filter({ hasText: /开放/ }).click();
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

  const selectOption = async (control, label) => {
    await control.click();
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content').getByText(label, { exact: true }).click();
  };
  const confirmCMajor = async () => {
    await openLibrary(popover);
    await button(library, "设置曲谱调性").click();
    await settled();
    await selectOption(sidebar.locator("#settings-mode"), "大调");
    await sidebar.locator("#settings-tonic").fill("C");
    await sidebar.locator("#settings-tonic").press("Enter");
    await button(sidebar, "返回和弦编辑").click();
    await quickName.waitFor();
  };
  const viewports = [{ width: 1440, height: 1000 }, { width: 1440, height: 650 }, { width: 1400, height: 900 }];
  const screenshots = [];
  const captureScenes = async () => {
    // Put visual comparison back on the prototype's six default quick entries.
    // Preferences survive document reloads; restore through the same user flow.
    await initial();
    await openLibrary(popover);
    await library.getByRole("tab", { name: "常用配置", exact: true }).click();
    await button(library, "恢复默认 6 项").click();
    const testCollection = library.locator("details").filter({ has: page.getByText("我的指法与配置备份", { exact: true }) });
    const removeTestCollection = testCollection.locator("button").filter({ hasText: "移除收藏及常用引用" });
    if (await removeTestCollection.count()) {
      await testCollection.locator("summary").click();
      await removeTestCollection.click();
      await testCollection.locator("summary").click();
    }
    await button(library, "保存常用配置").click();
    await button(library, "取消").click();
    await settled();
    const prototype = await browser.newPage();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await initial();
      await confirmCMajor();
      const take = async (scene) => {
        const name = `product-${scene}-${viewport.width}x${viewport.height}.png`;
        await screenshot(name);
        screenshots.push(name);
      };
      await take("quick");
      await openMore(popover);
      if (viewport.height === 650) {
        await assertFooterReachable(popup, "浏览完整和弦库 →");
        await assertFooterReachable(popup, "配置常用");
      }
      await take("more");
      await button(popover, "更多和弦").click();
      await button(popover, "关闭快捷编辑").click();
      await quickName.waitFor({ state: "hidden" });
      assert.equal(await sideName.isVisible(), true, "closing Quick preserves the populated sidebar");
      await take("sidebar");
      await openLibrary(sidebar);
      await library.getByLabel("和弦候选", { exact: true }).getByRole("button").filter({ has: page.getByText("G", { exact: true }) }).click();
      await library.getByLabel("选择指法版本", { exact: true }).getByRole("button").filter({ hasText: /开放/ }).click();
      await take("keylib");
      await chooseOpenG();
      await take("alllib");
      await library.getByRole("tab", { name: "常用配置", exact: true }).click();
      await take("config");
      await chooseOpenG();
      await button(library, "基于此指法自定义").click();
      await custom.waitFor();
      await take("custom");
      await button(custom, "取消").click();
      await settled();

      await prototype.setViewportSize(viewport);
      await prototype.goto(new URL("/__chord_prototype__", url).href);
      const protoTake = async (scene) => {
        const name = `prototype-${scene}-${viewport.width}x${viewport.height}.png`;
        await prototype.locator(".modal").evaluateAll((elements) => {
          for (const element of elements) for (const node of [element, ...element.querySelectorAll("*")]) if (node.scrollTop) node.scrollTop = 0;
        });
        await prototype.screenshot({ path: path.join(artifacts, name), animations: "disabled" });
        screenshots.push(name);
      };
      await protoTake("quick");
      await prototype.locator('.quick-popup [data-more]').click();
      await protoTake("more");
      await prototype.locator('[data-hide-quick]').click();
      await prototype.locator('.app-head strong').click();
      await protoTake("sidebar");
      await prototype.locator('.side [data-library]').click();
      await protoTake("keylib");
      await prototype.locator('[data-lib-tab="all"]').click();
      await prototype.locator('#library-cards button').filter({ has: prototype.getByText("G", { exact: true }) }).click();
      await protoTake("alllib");
      await prototype.locator('[data-lib-tab="config"]').click();
      await protoTake("config");
      await prototype.locator('[data-lib-tab="all"]').click();
      await prototype.locator('#library-cards button').filter({ has: prototype.getByText("G", { exact: true }) }).click();
      await prototype.getByRole("button", { name: "基于此指法自定义", exact: true }).click();
      await protoTake("custom");
    }
    await prototype.close();
  };

  if (!process.env.LXM_CHORD_CAPTURE_ONLY) {

  stage = "quick library cancel, HTTP catalog and closing isolation";
  let { baseline, chord } = await initial();
  await quickName.fill("Unapplied quick chord");
  await openLibrary(popover);
  assert.equal(await sidebar.getAttribute("inert"), "");
  await library.getByRole("tab", { name: "全部和弦", exact: true }).click();
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
  await sidebar.getByRole("alertdialog", { name: "处理未应用的曲谱信息" }).getByRole("button", { name: "继续编辑设置", exact: true }).click();
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
    assert.equal(await button(popover, "应用删除").isEnabled(), true);
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
  await library.getByRole("tab", { name: "全部和弦", exact: true }).click();
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

  stage = "More Escape retains clean and dirty parent; direct library/custom entrances cancel";
  ({ baseline } = await initial());
  for (const name of ["G", "Escape dirty parent"]) {
    await quickName.fill(name);
    await openMore(popover);
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "搜索全部和弦");
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "hidden" });
    assert.equal(await quickName.isVisible(), true, "Escape closes More while retaining the chord editor");
    assert.equal(await quickName.inputValue(), name);
    assert.equal(await button(popover, "更多和弦").isVisible(), true);
    assert.deepEqual(await snapshot(), baseline);
  }
  await button(sidebar, "选择其他指法").click();
  await library.waitFor();
  await choose("Dm");
  await button(library, "取消").click();
  await settled();
  for (const [root, label] of [[popover, "编辑指法 →"], [sidebar, "编辑指法"]]) {
    await button(root, label).click();
    await custom.waitFor();
    await custom.getByRole("textbox", { name: "自定义和弦名称", exact: true }).fill("Direct custom cancelled");
    await button(custom, "取消").click();
    await settled();
    assert.equal(await quickName.inputValue(), "Escape dirty parent");
    assert.equal(await sideName.inputValue(), "Escape dirty parent");
    assert.deepEqual(await snapshot(), baseline);
  }
  checks.push("More Escape keeps clean/dirty chord editor; direct sidebar library and both custom entrances cancel without changing shared draft or history");

  stage = "confirmed C-major groups and temporary key browsing reset";
  await initial();
  await confirmCMajor();
  let confirmed = await snapshot();
  await page.setViewportSize({ width: 1440, height: 650 });
  for (const root of [popover, sidebar]) {
    await openMore(root);
    await assertFooterReachable(popup, "浏览完整和弦库 →");
    await assertFooterReachable(popup, "配置常用");
    await button(root, "更多和弦").click();
    await popup.waitFor({ state: "hidden" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push("Quick and sidebar More footer actions are initially visible and pointer-reachable at1440×650");
  await openLibrary(popover);
  const candidates = library.getByLabel("和弦候选", { exact: true });
  const groups = candidates.locator("section");
  const groupNames = (group) => group.locator("button b").allTextContents();
  assert.deepEqual(await groupNames(groups.nth(0)), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
  assert.deepEqual(await groupNames(groups.nth(1)), ["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7b5"]);
  await groups.nth(1).getByRole("button").filter({ has: page.getByText("G7", { exact: true }) }).click();
  assert.equal(await button(library, "选用此指法").isEnabled(), true);
  assert.equal(await library.getByRole("img", { name: "G7指法预览", exact: true }).isVisible(), true);
  await button(library, "浏览其他调").click();
  await selectOption(library.getByRole("combobox", { name: "临时浏览主音", exact: true }), "G");
  assert.deepEqual(await groupNames(groups.nth(0)), ["G", "Am", "Bm", "C", "D", "Em", "F#dim"]);
  await button(library, "跟随曲谱").click();
  assert.deepEqual(await groupNames(groups.nth(0)), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
  assert.deepEqual(await snapshot(), confirmed, "browsing and resetting key never transpose or write history");
  await chooseOpenG();
  const versions = library.getByLabel("选择指法版本", { exact: true }).getByRole("button");
  assert.ok(await versions.count() >= 2, "G exposes multiple visible fingering versions");
  const openDiagram = await library.getByRole("img", { name: "G指法预览", exact: true }).innerHTML();
  await versions.nth(1).click();
  assert.notEqual(await library.getByRole("img", { name: "G指法预览", exact: true }).innerHTML(), openDiagram, "version choice updates the actual preview");
  await button(library, "选用此指法").click();
  await settled();
  await button(popover, "应用和弦").click();
  assert.ok((await currentChord()).chord.diagram.barres.length > 0, "chosen G barre version reaches the score");
  await undo(confirmed);
  checks.push("Confirmed C major has seven natural triads and seven sevenths; temporary G browsing resets to score without writes", "Visible alternate voicing updates preview, backfills and applies the chosen barre diagram");

  stage = "graphical editing finger, string toggle, target size and saved mine search";
  await initial();
  await confirmCMajor();
  confirmed = await snapshot();
  const originalParentDiagram = await sidebar.getByRole("img", { name: "指法图预览", exact: true }).innerHTML();
  await openLibrary(sidebar);
  await chooseOpenG();
  await button(library, "基于此指法自定义").click();
  await custom.waitFor();
  const grid = custom.getByRole("grid", { name: "六弦品位网格", exact: true });
  const cells = grid.getByRole("gridcell");
  assert.equal(await cells.count(), 36, "six string toggles and thirty fret targets");
  await modalSettled();
  await cells.first().click({ trial: true });
  for (const box of await cells.evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }))) {
    assert.ok(box.width >= 32 && box.height >= 32, `every graphical target is at least 32×32 (actual ${box.width}×${box.height})`);
  }
  await custom.getByRole("textbox", { name: "观察窗口起始品位", exact: true }).fill("1");
  await custom.getByRole("combobox", { name: "新按点的手指", exact: true }).selectOption("4");
  const point = grid.getByRole("gridcell", { name: "第 6 弦 1 品", exact: true });
  await point.click();
  assert.equal(await point.getAttribute("aria-selected"), "true");
  assert.equal(await point.innerText(), "4", "selected finger is drawn inside the new point");
  await grid.getByRole("gridcell", { name: /^第 6 弦 .*点击切换/ }).click();
  assert.equal(await grid.getByRole("gridcell", { name: /^第 6 弦 空弦/ }).innerText(), "○");
  await grid.getByRole("gridcell", { name: /^第 6 弦 .*点击切换/ }).click();
  assert.equal(await grid.getByRole("gridcell", { name: /^第 6 弦 禁奏/ }).innerText(), "×");
  await button(custom, "撤销").click();
  await button(custom, "撤销").click();
  assert.equal(await point.innerText(), "4", "local undo restores the exact fingered point");
  await custom.getByRole("textbox", { name: "自定义和弦名称", exact: true }).fill("Parity saved G");
  await button(custom, "另存为我的指法").click();
  await custom.getByRole("status").filter({ hasText: /已保存|已收藏|已另存|已存入/ }).waitFor();
  await page.setViewportSize({ width: 1440, height: 650 });
  await assertFooterReachable(custom, "取消");
  await assertFooterReachable(custom, "完成编辑");
  await button(custom, "取消").click();
  await settled();
  assert.deepEqual(await snapshot(), confirmed, "custom save and cancel never write a score command or parent draft");
  assert.equal(await sideName.inputValue(), "G");
  assert.equal(await sidebar.getByRole("img", { name: "指法图预览", exact: true }).innerHTML(), originalParentDiagram, "custom cancel preserves the complete parent diagram, including fingers");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openLibrary(sidebar);
  await library.getByRole("tab", { name: "我的指法", exact: true }).click();
  const mineSearch = library.getByRole("textbox", { name: "搜索我的指法", exact: true });
  await mineSearch.fill("no matching parity voicing");
  assert.equal(await library.locator("button b").filter({ hasText: "Parity saved G" }).count(), 0);
  await mineSearch.fill("saved g");
  await library.getByRole("button").filter({ has: page.getByText("Parity saved G", { exact: true }) }).click();
  await button(library, "选用此指法").click();
  await settled();
  assert.equal(await sideName.inputValue(), "Parity saved G");
  assert.deepEqual(await snapshot(), confirmed, "mine search and selection only backfill the shared draft");
  checks.push("Custom finger placement, open/mute toggle and local undo work; all 36 targets meet 32px and 650px footer is reachable", "Save mine is independent of the score; case-insensitive mine search selects the saved diagram");

  stage = "configuration inline remove, add, reorder, live preview, cancel and save to both surfaces";
  const quickItems = (root) => root.getByLabel("我的常用和弦", { exact: true }).locator('button:not([aria-label="更多和弦"])').allTextContents();
  const quickBefore = await quickItems(sidebar);
  const parentDraft = await sideName.inputValue();
  await openLibrary(sidebar);
  await library.getByRole("tab", { name: "常用配置", exact: true }).click();
  const configList = library.getByLabel("常用配置列表", { exact: true });
  const configNames = () => configList.locator("b").allTextContents();
  const previewNames = () => library.getByLabel("常用入口实时预览", { exact: true }).locator(":scope > div > span").allTextContents();
  await button(configList, "移除常用6").click();
  await library.getByRole("textbox", { name: "搜索常用配置", exact: true }).fill("G7");
  await library.getByLabel("添加常用候选", { exact: true }).getByRole("button", { name: "+ G7", exact: true }).click();
  await button(configList, "上移第6项").click();
  const stagedQuick = [quickBefore[0], quickBefore[1], quickBefore[2], quickBefore[3], "G7", quickBefore[4]];
  assert.deepEqual(await configNames(), stagedQuick);
  assert.deepEqual(await previewNames(), stagedQuick, "entry preview follows every inline draft change");
  await button(library, "取消").click();
  await settled();
  assert.deepEqual(await quickItems(sidebar), quickBefore, "cancel discards preference draft");
  assert.equal(await sideName.inputValue(), parentDraft);
  assert.deepEqual(await snapshot(), confirmed);
  await openLibrary(sidebar);
  await library.getByRole("tab", { name: "常用配置", exact: true }).click();
  assert.deepEqual(await configNames(), quickBefore, "reopening configuration discards the cancelled preference draft");
  await button(configList, "移除常用6").click();
  await library.getByRole("textbox", { name: "搜索常用配置", exact: true }).fill("G7");
  await library.getByLabel("添加常用候选", { exact: true }).getByRole("button", { name: "+ G7", exact: true }).click();
  await button(configList, "上移第6项").click();
  await page.setViewportSize({ width: 1440, height: 650 });
  await assertFooterReachable(library, "保存常用配置");
  await button(library, "保存常用配置").click();
  assert.equal(await button(library, "保存常用配置").isDisabled(), true);
  await button(library, "取消").click();
  await settled();
  assert.deepEqual(await quickItems(sidebar), stagedQuick);
  assert.deepEqual(await quickItems(popover), stagedQuick, "saved order reaches quick and sidebar together");
  assert.equal(await quickName.inputValue(), parentDraft);
  assert.deepEqual(await snapshot(), confirmed, "saving preferences leaves score history and current chord draft alone");
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push("Configuration inline add/remove/reorder drives live preview; Cancel discards, Save synchronizes both surfaces without score commands");

  stage = "dirty settings discard restores the suspended chord";
  await openLibrary(popover);
  await button(library, "设置曲谱调性").click();
  await settled();
  await sidebar.locator("#settings-title").fill("Discarded parity title");
  await button(sidebar, "返回和弦编辑").click();
  await sidebar.getByRole("alertdialog", { name: "处理未应用的曲谱信息", exact: true }).getByRole("button", { name: "放弃设置修改并返回", exact: true }).click();
  await quickName.waitFor();
  assert.equal(await quickName.inputValue(), parentDraft);
  assert.deepEqual(await snapshot(), confirmed, "discarded song settings never add history or alter suspended chord");
  checks.push("Dirty song settings discard returns directly to the preserved chord draft without history");
  }
  stage = "product and prototype design parity screenshots";
  await captureScenes();
  assert.deepEqual(errors, []);
  assert.equal(downloads.length, 0);
  await screenshot("passed.png");
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({
    status: "passed",
    mode: process.env.LXM_CHORD_CAPTURE_ONLY ? "screenshots" : "integration-and-screenshots",
    createdAt: new Date().toISOString(),
    fixture: "tests/music-text-coexist.browser.tsx: real HomePage and coexistStore",
    browser: { version: browser.version(), channel: process.env.LXM_BROWSER_CHANNEL ?? "chromium" },
    viewports,
    checks: checks.map((label) => ({ label, status: "passed" })),
    screenshots,
    catalogResponses,
    pageErrors: errors,
    downloads,
  }, null, 2));
  console.log(`PASS chord-library ${process.env.LXM_CHORD_CAPTURE_ONLY ? "screenshots" : "product integration"}: ${checks.length} behavioral checks; ${screenshots.length} matching product/prototype scenes.`);
} catch (error) {
  console.error(`Chord-library integration failed during: ${stage}`);
  if (page) {
    await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
    await writeFile(path.join(artifacts, "failure.html"), await page.content()).catch(() => {});
    const state = await page.evaluate(() => ({
      document: window.coexistStore?.getState().document,
      history: window.coexistStore?.getState().historyDepth,
      activeElement: document.activeElement && {
        tag: document.activeElement.tagName,
        id: document.activeElement.id,
        label: document.activeElement.getAttribute("aria-label"),
        text: document.activeElement.textContent?.slice(0, 120),
      },
      popupLayers: [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")].map((popup) => {
        const rect = popup.getBoundingClientRect();
        const point = { x: rect.x + rect.width / 2, y: rect.y + Math.min(100, rect.height / 2) };
        const ancestors = [];
        for (let node = popup; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          ancestors.push({ tag: node.tagName, class: node.className, zIndex: style.zIndex, position: style.position, transform: style.transform, isolation: style.isolation, overflow: style.overflow });
        }
        return { ancestors, inert: popup.inert, ariaHidden: popup.getAttribute("aria-hidden"), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, point, hit: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 600) };
      }),
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
