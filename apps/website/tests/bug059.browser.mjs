import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const entry = "tests/bug059.browser.tsx";
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.join(website, "node_modules/.vite/bug059"),
  optimizeDeps: { entries: [entry], include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "next/link"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug059-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bug059__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, `<!doctype html><div id="root"></div><script type="module" src="/${entry}"></script>`));
    });
  } }],
});

let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug059__`, { waitUntil: "commit" });
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score.waitFor({ timeout: 90000 });
  const toolbar = page.getByRole("toolbar", { name: "节奏、小节与历史工具" });
  const toolbarButton = name => toolbar.getByRole("button", { name, exact: true });
  const sweep = toolbarButton("下扫");
  const undo = toolbarButton("撤销");
  // 切换焦点时，上一个提示可能仍在执行退场动画。按操作名定位本次提示，再精确校验内容。
  const tooltipFor = name => page.getByRole("tooltip").filter({ hasText: name });
  const checkFocusedHint = async (button, disabled, name, keys = []) => {
    assert.equal(await button.isDisabled(), disabled);
    const trigger = disabled ? button.locator("..") : button;
    const tooltip = tooltipFor(name);
    if (disabled) assert.equal(await trigger.getAttribute("tabindex"), "0");
    await trigger.focus();
    await tooltip.waitFor();
    assert.deepEqual(await tooltip.locator("kbd").allTextContents(), keys);
    assert.equal(await tooltip.evaluate(el => {
      const copy = el.cloneNode(true);
      for (const key of copy.querySelectorAll("kbd")) key.remove();
      return copy.textContent.trim();
    }), name);
    await page.keyboard.press("Escape");
    await tooltip.waitFor({ state: "hidden" });
    await trigger.and(page.locator(":focus")).waitFor();
  };
  const tie = page.getByRole("button", { name: "延音线", exact: true });
  const allTechniques = page.getByRole("button", { name: "所有技巧", exact: true });
  const rangeTechnique = (type) => page.locator(`[data-technique-type="${type}"]`);
  const state = () => page.evaluate(() => {
    const { document, selection, selectedTechniqueId, historyDepth } = window.traversalRangeStore.getState();
    const track = document.score.tracks[0];
    return { selection, selectedTechniqueId, techniques: track.techniques, beats: track.measures[0].beats, historyDepth };
  });
  const point = (index, string = 2) => score.evaluate((svg, { index, string }) => {
    const key = Object.keys(svg).find((key) => key.startsWith("__reactFiber$"));
    let root = svg[key];
    while (root.return) root = root.return;
    const find = (fiber) => fiber && (fiber.memoizedProps?.layout?.systems ? fiber.memoizedProps.layout : find(fiber.child) ?? find(fiber.sibling));
    const measure = find(root.stateNode.current).systems[0].measures[0];
    const p = new DOMPoint(measure.beats[index].x, measure.strings[string - 1].y1).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, { index, string });
  const drag = async (from, to, fromString = 2, toString = fromString) => {
    const a = await point(from, fromString), b = await point(to, toString);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
  };
  const assertRange = async (from, to) => {
    const snapshot = await state();
    assert.equal(snapshot.selectedTechniqueId, null);
    assert.equal(snapshot.selection.anchor.beatId, snapshot.beats[from].id);
    assert.equal(snapshot.selection.focus.beatId, snapshot.beats[to].id);
    assert.equal(snapshot.selection.anchor.string, 2);
    assert.equal(snapshot.selection.focus.string, 2);
  };

  const first = await point(0);
  await page.mouse.click(first.x, first.y);
  assert.equal((await state()).selectedTechniqueId, "strum-down");
  const second = await point(1);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await assertRange(0, 1);

  // 跨拍选择仍禁用扫弦和琶音。聚焦禁用按钮的外层也能看到操作名称并按 Esc 收起提示。
  const historyKeys = await page.evaluate(() => [/mac|iphone|ipad|ipod/i.test(navigator.platform) ? "⌘" : "Ctrl", "Z"]);
  await checkFocusedHint(undo, true, "撤销", historyKeys);
  for (const name of ["下扫", "上扫", "下琶音", "上琶音"])
    await checkFocusedHint(toolbarButton(name), true, name);

  const before = await state();
  for (const [from, to] of [[0, 1], [2, 1]]) {
    await drag(from, to);
    await assertRange(from, to);
    assert.equal(await tie.isEnabled(), true);
    await tie.click();
    const applied = await state();
    assert.deepEqual(applied.techniques.slice(0, 4), before.techniques);
    assert.deepEqual(applied.beats, before.beats);
    assert.deepEqual(applied.techniques.slice(4).map(({ id, ...technique }) => technique), [{
      type: "tie", fromNoteId: `note-${Math.min(from, to)}`, toNoteId: `note-${Math.max(from, to)}`,
    }]);
    assert.equal(await tie.getAttribute("aria-pressed"), "true");
    await tie.click();
    assert.deepEqual((await state()).techniques, before.techniques);
  }
  await checkFocusedHint(undo, false, "撤销", historyKeys);

  await drag(3, 2);
  await assertRange(3, 2);
  assert.equal(await tie.isEnabled(), true);
  await tie.click();
  assert.deepEqual((await state()).beats, before.beats);
  assert.deepEqual((await state()).techniques.slice(4).map(({ id, ...technique }) => technique), [{
    type: "traversalTie", fromBeatId: before.beats[2].id, toBeatId: before.beats[3].id,
  }]);
  assert.equal(await tie.getAttribute("aria-pressed"), "true");
  await tie.click();
  assert.deepEqual((await state()).techniques, before.techniques);
  assert.equal((await state()).historyDepth.past, before.historyDepth.past + 6);

  await allTechniques.click();
  for (const type of ["letRing", "palmMute"])
    assert.equal(await rangeTechnique(type).getAttribute("aria-disabled"), "true");
  await page.getByRole("button", { name: "关闭所有技巧" }).click();

  for (const type of ["letRing", "palmMute"]) {
    await drag(2, 0);
    await assertRange(2, 0);
    await allTechniques.click();
    assert.equal(await rangeTechnique(type).getAttribute("aria-disabled"), "false");
    await rangeTechnique(type).click();
    const applied = await state();
    assert.deepEqual(applied.techniques.slice(0, 4), before.techniques);
    assert.deepEqual(applied.techniques.slice(4).map(({ id, ...technique }) => technique), [{
      type, fromBeatId: before.beats[0].id, toBeatId: before.beats[2].id,
    }]);
    await page.getByRole("button", { name: "关闭所有技巧" }).click();
    await score.press("ControlOrMeta+z");
    assert.deepEqual((await state()).techniques, before.techniques);
  }

  const twoRestSweeps = await page.evaluate(() => {
    const session = window.traversalRangeStore.getState();
    const document = structuredClone(session.document);
    const track = document.score.tracks[0];
    for (const beat of track.measures[0].beats.slice(0, 2)) {
      beat.kind = "rest";
      beat.notes = [];
    }
    return session.replaceDocument(document).ok;
  });
  assert.equal(twoRestSweeps, true);
  await drag(0, 1);
  await assertRange(0, 1);
  await tie.click();
  const restTie = await state();
  assert.deepEqual(restTie.beats.slice(0, 2).map(({ kind, notes }) => ({ kind, notes })), [
    { kind: "rest", notes: [] }, { kind: "rest", notes: [] },
  ]);
  assert.deepEqual(restTie.techniques.slice(4).map(({ id, ...technique }) => technique), [{
    type: "traversalTie", fromBeatId: restTie.beats[0].id, toBeatId: restTie.beats[1].id,
  }]);
  await score.press("ControlOrMeta+z");
  assert.deepEqual((await state()).techniques, before.techniques);
  await score.press("ControlOrMeta+Shift+z");
  assert.deepEqual((await state()).techniques, restTie.techniques);

  const arcPath = (id) => score.evaluate((svg, id) => {
    const key = Object.keys(svg).find((key) => key.startsWith("__reactFiber$"));
    let root = svg[key];
    while (root.return) root = root.return;
    const find = (fiber) => fiber && (fiber.memoizedProps?.layout?.systems ? fiber.memoizedProps.layout : find(fiber.child) ?? find(fiber.sibling));
    return find(root.stateNode.current).systems[0].techniques.find((segment) => segment.techniqueId === id)?.path.d;
  }, id);
  const arc = await arcPath(restTie.techniques[4].id);
  assert.match(arc, / Q /);
  await score.locator(`path[d="${arc}"]`).waitFor();

  const twoSweepSounds = await page.evaluate(([from, to]) => window.planCurrentScore().sounds
    .filter(({ beatId }) => beatId === from || beatId === to)
    .map(({ beatId, string, endTick }) => [beatId, string, endTick]), restTie.beats.slice(0, 2).map(({ id }) => id));
  assert.deepEqual(twoSweepSounds, [4, 3, 2, 1].map((string) => [restTie.beats[0].id, string, 1920]));

  // 套用实际节奏模板，再从空拍添加扫弦，复现验收图中的两拍选择。
  const replaced = await page.evaluate(() => {
    const session = window.traversalRangeStore.getState();
    const document = structuredClone(session.document);
    const track = document.score.tracks[0];
    track.techniques = [];
    for (const beat of track.measures[0].beats) {
      beat.kind = "notes";
      beat.notes = [];
    }
    return session.replaceDocument(document).ok;
  });
  assert.equal(replaced, true);
  const start = await point(0);
  await page.mouse.click(start.x, start.y);
  await page.locator('[data-tool-trigger="beat"]').click();
  const rhythmPanel = page.locator('[data-rhythm-pattern-panel][data-presentation="toolbar"]');
  await rhythmPanel.locator('[data-rhythm-template="eight-sixteen"]').click();
  await rhythmPanel.getByRole("button", { name: "应用节奏型", exact: true }).click();
  await rhythmPanel.waitFor({ state: "hidden" });
  const patterned = (await state()).beats.slice(0, 3);
  assert.deepEqual(patterned.map(({ rhythm, kind, notes }) => [rhythm.base, kind, notes]), [
    ["eighth", "notes", []], ["sixteenth", "notes", []], ["sixteenth", "notes", []],
  ]);

  for (const index of [0, 1, 2]) {
    await drag(index, index, 2, 5);
    if (index === 0) {
      // 同拍跨弦选择已启用时，鼠标悬停与键盘焦点显示同样的短名称。
      const tooltip = tooltipFor("下扫");
      await sweep.hover();
      await tooltip.waitFor();
      assert.equal(await tooltip.innerText(), "下扫");
      await page.mouse.move(20, 30);
      await tooltip.waitFor({ state: "hidden" });
      await checkFocusedHint(sweep, false, "下扫");
      await checkFocusedHint(toolbarButton("下琶音"), false, "下琶音");
    }
    await sweep.click();
  }
  const sweepIds = patterned.map(({ id }) => id);
  const sweepSounds = () => page.evaluate((ids) => window.planCurrentScore().sounds
    .filter(({ beatId }) => ids.includes(beatId))
    .map(({ beatId, string, endTick }) => ({ beatId, string, endTick })), sweepIds);
  const untied = await sweepSounds();
  assert.deepEqual(sweepIds.map((id) => untied.filter(({ beatId }) => beatId === id).length), [4, 4, 4]);
  await drag(2, 1);
  await assertRange(2, 1);
  await tie.click();
  const tiedPattern = await state();
  assert.deepEqual(tiedPattern.beats.slice(0, 3), patterned);
  const { id: patternTieId, ...patternTie } = tiedPattern.techniques.at(-1);
  assert.deepEqual(patternTie, { type: "traversalTie", fromBeatId: sweepIds[1], toBeatId: sweepIds[2] });
  await score.locator(`path[d="${await arcPath(patternTieId)}"]`).waitFor();
  const tiedSounds = await sweepSounds();
  assert.deepEqual(tiedSounds, untied.filter(({ beatId }) => beatId !== sweepIds[2]).map((sound) => (
    sound.beatId === sweepIds[1] ? { ...sound, endTick: 960 } : sound
  )));
  await tie.click();
  assert.deepEqual(await sweepSounds(), untied);

  const errorText = "编辑操作测试错误";
  const reportError = () => page.evaluate((text) => window.traversalRangeStore.getState().setErrorMessage(text), errorText);
  const errorToast = page.locator(".ant-message-error").getByText(errorText, { exact: true });
  await reportError();
  await errorToast.waitFor();
  await errorToast.waitFor({ state: "hidden" });
  await reportError();
  await errorToast.waitFor();
  assert.deepEqual(errors, []);
  console.log("BUG-059: traversal selection, regular ties, Let Ring, P.M., and stored-rest tie editing, notation and playback plan passed");
  console.log("BUG-059: trailing sixteenth-note sweeps from the rhythm template tie and sustain without adding TAB notes");
  console.log("REQ-079: repeated editor errors reopen the Ant Design Message");
} finally {
  await browser?.close();
  await server.close();
}
