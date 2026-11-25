import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(runtime.startsWith("/") ? pathToFileURL(runtime).href : runtime);
const browser = await chromium.launch({
  channel: process.env.LXM_BROWSER_CHANNEL,
  executablePath: process.env.LXM_BROWSER_EXECUTABLE,
});
const viewport = { width: 1440, height: 900 };
const rhythm = { base: "quarter", dots: 0 };
const tuning = ["E4", "B3", "G3", "D3", "A2", "E2"].map((pitch, index) => ({
  index: index + 1, pitch, midi: [64, 59, 55, 50, 45, 40][index],
}));
const title = "谱面右键菜单验收";
const ref = (measure, beat) => ({
  trackId: "track", measureId: `m${measure}`, beatId: `b${measure}-${beat}`, string: 1,
});
const fixture = {
  schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
  score: { id: "req069", title, arranger: "", keySignature: "C", meta: {}, tracks: [{
    id: "track", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
    tuning: { strings: tuning }, numberedMarks: [], techniques: [],
    measures: Array.from({ length: 4 }, (_, measure) => ({
      id: ref(measure, 0).measureId, timeSignature: { numerator: 4, denominator: 4 },
      barline: "single", tuplets: [], chordSymbols: [], lyrics: [],
      beats: Array.from({ length: 4 }, (_, beat) => ({
        id: ref(measure, beat).beatId, tick: beat * 960, kind: "notes", rhythm,
        notes: [{ id: `n${measure}-${beat}`, string: 1, fret: 2 + measure * 4 + beat }],
      })),
      numberedVoice: { events: [], tuplets: [] },
    })),
  }] },
};

try {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor");

  const score = page.locator('svg[aria-label="六线谱编辑器"]');
  const music = score.locator('[data-layer="score-music"]');
  // 拍号和品位可能同为「4」。使用 TAB 品位的描边文本定位实际点击目标。
  const fret = value => music.locator('text[stroke-width="0.8"]').filter({ hasText: new RegExp(`^${value}$`) });
  const menu = page.getByRole("menu", { name: "谱面工具", exact: true })
    .and(page.locator("[data-score-context-menu], [data-score-context-menu] *"));
  const menuItem = name => menu.getByRole("menuitem", { name, exact: true });
  const chord = /^(添加|编辑)和弦$/;
  const copy = "复制当前小节";
  const destinations = page.getByRole("dialog", { name: "复制小节", exact: true });
  const destinationField = destinations.getByRole("combobox", { name: "插入位置" });
  const copyTo = async (label) => {
    await destinationField.selectOption({ label });
    await destinations.getByRole("button", { name: /^复\s*制$/ }).click();
  };
  const tools = [
    { entry: "小节工具", popup: page.getByRole("dialog", { name: "小节工具参数", exact: true }) },
    { entry: "节奏型", popup: page.getByRole("dialog", { name: "节奏型工具参数", exact: true }) },
    { entry: "技巧", popup: page.getByRole("dialog", { name: "技巧工具参数", exact: true }) },
    { entry: chord, popup: page.locator("[id$=chord-edit-popover]") },
  ];

  const snapshot = load => score.evaluate((svg, load) => {
    const key = Object.keys(svg).find(name => name.startsWith("__reactFiber$"));
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const state = fiber.memoizedProps?.session?.getState();
      if (!state?.document) continue;
      if (load) return state.replaceDocument(JSON.stringify(load), "file");
      const track = state.document.score.tracks[0];
      return { measures: track.measures, techniques: track.techniques, selection: state.selection, history: state.pastEntries.length };
    }
    throw new Error("Editor session unavailable");
  }, load);
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    return svg && Object.keys(svg).some(name => name.startsWith("__reactFiber$"));
  });
  assert.equal((await snapshot(fixture)).ok, true);
  await fret(2).waitFor();

  const expectMenu = async () => {
    await menu.waitFor();
    const rows = menu.getByRole("menuitem");
    assert.equal(await rows.count(), 6);
    for (const label of [...tools.map(({ entry }) => entry), "反复与跳转…", copy]) {
      assert.equal(await menuItem(label).count(), 1, String(label));
    }
  };
  const expectSelection = async (anchor, focus = anchor) => {
    const { selection } = await snapshot();
    assert.deepEqual(selection?.anchor, anchor);
    assert.deepEqual(selection?.focus, focus);
  };
  const expectScoreFocus = () => score.and(page.locator(":focus")).waitFor();
  const escapeMenu = async () => {
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await expectScoreFocus();
  };
  const rightClick = async target => {
    await target.click({ button: "right" });
    await expectMenu();
  };

  await fret(2).click();
  await fret(4).click({ modifiers: ["Shift"] });
  await expectSelection(ref(0, 0), ref(0, 2));
  await rightClick(fret(3));
  await expectSelection(ref(0, 0), ref(0, 2));
  assert.equal(await menuItem(chord).isDisabled(), true, "和弦需要单一拍点");
  await escapeMenu();

  await rightClick(fret(7));
  await expectSelection(ref(1, 1));
  assert.equal(await menuItem("添加和弦").isEnabled(), true);
  await escapeMenu();

  await score.focus();
  await page.keyboard.press("Shift+F10");
  await expectMenu();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  const chordPanel = page.locator('[data-score-context-panel="chord"]');
  const name = chordPanel.getByRole("textbox", { name: "和弦名称" });
  await name.and(page.locator(":focus")).waitFor();
  await name.fill("Cmaj7");
  await name.press("Enter");
  await chordPanel.waitFor({ state: "hidden" });
  await menuItem("编辑和弦").and(page.locator(":focus")).waitFor();
  await expectSelection(ref(1, 1));
  await escapeMenu();

  const blank = score.locator("text").filter({ hasText: new RegExp(`^${title}$`) });
  await blank.click({ button: "right" });
  assert.equal(await menu.isVisible(), false, "谱面空白没有 TAB 右键菜单");
  await expectSelection(ref(1, 1));

  for (const side of ["right", "left"]) {
    let target = fret(2);
    if (side === "left") {
      const zoomIn = page.getByRole("button", { name: "放大谱面", exact: true });
      while (await zoomIn.isEnabled()) await zoomIn.click();
      await page.locator('[data-score-zoom="200"]').waitFor();
      const viewportElement = page.locator("[data-score-viewport]");
      await viewportElement.evaluate((element) => element.scrollTo({ left: 0, top: 0, behavior: "instant" }));
      const view = await viewportElement.boundingBox();
      const fretPositions = await Promise.all(Array.from({ length: 16 }, async (_, index) => ({
        value: index + 2, bounds: await fret(index + 2).boundingBox(),
      })));
      // 选择真正露在滚动视口内的最右拍点，否则 Playwright 会在点击前自动滚动谱面。
      const rightmost = fretPositions.filter(({ bounds }) => bounds && view && bounds.x + bounds.width < view.x + view.width && bounds.y < view.y + view.height)
        .sort((left, right) => right.bounds.x - left.bounds.x)[0];
      assert.ok(rightmost && rightmost.bounds.x > 800, `最右拍点应留出不足以右侧展开的空间 ${JSON.stringify(rightmost)}`);
      target = fret(rightmost.value);
    }
    for (const { entry, popup } of [...tools, { entry: copy, popup: destinations }]) {
      await rightClick(target);
      const item = menuItem(entry);
      const menuBounds = await menu.boundingBox();
      assert.ok(menuBounds, "谱面菜单可见");
      await item.click();
      await popup.waitFor();
      if (entry === copy) await destinationField.and(page.locator(":focus")).waitFor();
      const label = `${String(entry)} (${side})`;
      // 浮层挂载后才进入缩放动画。保留满足条件的那次测量，避免等待结束与再次读取之间取到动画起始的零尺寸。
      const popupElement = await popup.elementHandle();
      const rect = await page.waitForFunction((panel) => {
        const next = panel.getBoundingClientRect();
        if (next.width <= 100 || next.height <= 50 || panel.closest(".ant-popover")?.getAnimations().some(animation => animation.playState === "running")) return false;
        return { x: next.x, y: next.y, width: next.width, height: next.height };
      }, popupElement);
      const bounds = await rect.jsonValue();
      assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `${label} ${JSON.stringify(bounds)}`);
      assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1
        && bounds.y + bounds.height <= viewport.height + 1, `${label} 在视口内 ${JSON.stringify(bounds)}`);
      assert.equal(await menu.isVisible(), true, `${label} 保留右键菜单`);
      if (entry === copy) {
        assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 4, `${label} 复制弹窗水平居中 ${JSON.stringify(bounds)}`);
      } else if (side === "right") {
        assert.ok(bounds.x >= menuBounds.x + menuBounds.width - 1, `${label} 位于菜单右侧 ${JSON.stringify({ bounds, menuBounds })}`);
      } else {
        assert.ok(bounds.x + bounds.width <= menuBounds.x + 1, `${label} 翻转到菜单左侧 ${JSON.stringify({ bounds, menuBounds })}`);
      }
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "hidden" });
      await item.and(page.locator(":focus")).waitFor();
      await escapeMenu();
    }
  }

  const before = await snapshot();
  // 跨小节范围内右键时，复制的是拖选终点的小节。副本应保留同拍和弦且获得新 ID。
  await fret(5).click();
  await fret(7).click({ modifiers: ["Shift"] });
  await rightClick(fret(5));
  await expectSelection(ref(0, 3), ref(1, 1));
  await menuItem(copy).click();
  await destinationField.and(page.locator(":focus")).waitFor();
  assert.match(await destinations.innerText(), /来源 · 第 2 小节/);
  assert.equal((await snapshot()).history, before.history);
  await page.keyboard.press("Escape");
  await destinations.waitFor({ state: "hidden" });
  await menuItem(copy).and(page.locator(":focus")).waitFor();
  await page.keyboard.press("ArrowRight");
  await copyTo("曲首");
  await menu.waitFor({ state: "hidden" });
  const measureNumbers = score.locator("[data-measure-number]");
  await measureNumbers.filter({ hasText: /^5$/ }).waitFor();
  const after = await snapshot();
  const [duplicate, first, source, ...remaining] = after.measures;
  assert.deepEqual([first, source, ...remaining], before.measures);
  assert.notEqual(duplicate.id, source.id);
  assert.deepEqual(duplicate.beats.map(beat => [beat.tick, beat.rhythm, beat.notes.map(note => [note.string, note.fret])]),
    source.beats.map(beat => [beat.tick, beat.rhythm, beat.notes.map(note => [note.string, note.fret])]));
  assert.equal(duplicate.chordSymbols[0]?.chord.name, "Cmaj7");
  assert.notEqual(duplicate.chordSymbols[0]?.id, source.chordSymbols[0]?.id);
  assert.equal(after.selection?.focus.measureId, duplicate.id);
  assert.equal(after.history, before.history + 1, "复制只创建一条撤销记录");
  await expectScoreFocus();
  await page.keyboard.press("ControlOrMeta+z");
  await measureNumbers.filter({ hasText: /^5$/ }).waitFor({ state: "hidden" });
  const undone = await snapshot();
  assert.deepEqual(undone.measures, before.measures);
  assert.equal(undone.history, before.history);

  // 工具栏也用同一位置表单。任意小节后插入时只关闭弹窗，保留小节工具。
  await fret(7).click();
  await page.locator('[data-tool-trigger="measure"]').click();
  const measurePanel = tools[0].popup;
  const copyButton = measurePanel.getByRole("button", { name: copy, exact: true });
  await copyButton.click();
  await copyTo("第 3 小节后");
  await destinations.waitFor({ state: "hidden" });
  assert.ok(await measurePanel.isVisible());
  const inserted = await snapshot();
  assert.equal(inserted.measures.length, 5);
  assert.deepEqual(inserted.measures[3].beats.map(beat => beat.notes.map(note => note.fret)), before.measures[1].beats.map(beat => beat.notes.map(note => note.fret)));
  await page.keyboard.press("Escape");
  await measurePanel.waitFor({ state: "hidden" });
  await score.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await measureNumbers.filter({ hasText: /^5$/ }).waitFor({ state: "hidden" });

  await fret(7).click();
  await score.evaluate((svg, cell) => {
    const key = Object.keys(svg).find(name => name.startsWith("__reactFiber$"));
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const state = fiber.memoizedProps?.session?.getState();
      if (!state?.document) continue;
      state.setSelection({ anchor: cell, focus: { ...cell, string: 3 } });
      return;
    }
  }, ref(1, 1));
  await rightClick(fret(7));
  await menuItem("技巧").click();
  const techniquePanel = tools[2].popup;
  const strum = techniquePanel.locator('[data-technique-type="strum"]');
  const strumDirection = page.getByRole("dialog", { name: "扫弦方向", exact: true });
  const techniqueHistory = (await snapshot()).history;
  await strum.click();
  await strumDirection.getByRole("button", { name: "向下", exact: true }).and(page.locator(":focus")).waitFor();
  assert.match(await strumDirection.innerText(), /第 2 小节第 2 拍 · 第 1–3 弦/);
  assert.equal((await snapshot()).history, techniqueHistory);
  await page.keyboard.press("Escape");
  await strumDirection.waitFor({ state: "hidden" });
  await strum.and(page.locator(":focus")).waitFor();
  await strum.click();
  await strumDirection.getByRole("button", { name: "向上", exact: true }).click();
  await strumDirection.waitFor({ state: "hidden" });
  assert.equal((await snapshot()).techniques[0]?.stroke, "up");
  assert.ok(await techniquePanel.isVisible());
  await strum.click();
  assert.equal(await strumDirection.getByRole("button", { name: "向上", exact: true }).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await techniquePanel.waitFor({ state: "hidden" });
  await escapeMenu();

  await page.keyboard.press("ControlOrMeta+z");
  await page.locator('[data-tool-trigger="technique"]').click();
  await techniquePanel.locator('[data-technique-type="arpeggio"]').click();
  const arpeggioDirection = page.getByRole("dialog", { name: "琶音方向", exact: true });
  await arpeggioDirection.getByRole("button", { name: "上行", exact: true }).click();
  await arpeggioDirection.waitFor({ state: "hidden" });
  assert.equal((await snapshot()).techniques[0]?.direction, "ascending");
  assert.ok(await techniquePanel.isVisible());

  await page.keyboard.press("Escape");
  await techniquePanel.waitFor({ state: "hidden" });
  const withCrossMeasureTechnique = structuredClone(fixture);
  withCrossMeasureTechnique.score.tracks[0].techniques.push({
    id: "cross-measure", type: "letRing", fromBeatId: ref(1, 0).beatId, toBeatId: ref(2, 0).beatId,
  });
  assert.equal((await snapshot(withCrossMeasureTechnique)).ok, true);
  await fret(7).click();
  await page.locator('[data-tool-trigger="measure"]').click();
  await copyButton.click();
  const impact = page.getByRole("dialog", { name: "小节范围复制影响确认", exact: true });
  assert.equal((await snapshot()).techniques[0]?.id, "cross-measure");
  assert.match(await destinations.innerText(), /来源 · 第 2 小节/);
  await copyTo("曲首");
  await impact.getByRole("button", { name: /^取\s*消$/ }).click();
  await destinationField.and(page.locator(":focus")).waitFor();
  assert.equal(await destinationField.locator("option:checked").textContent(), "曲首");
  assert.equal((await snapshot()).measures.length, 4);
  await copyTo("曲末");
  await impact.getByRole("button", { name: "确认修改", exact: true }).click();
  await measureNumbers.filter({ hasText: /^5$/ }).waitFor();
  await destinations.waitFor({ state: "hidden" });
  const confirmed = await snapshot();
  assert.equal(confirmed.measures[4].beats[1].notes[0].fret, 7);
  assert.equal(confirmed.techniques.length, 1);
  assert.equal(confirmed.history, 1);
  await impact.waitFor({ state: "hidden" });
  await page.locator('[data-tool-trigger="measure"]').click();
  await measurePanel.waitFor({ state: "hidden" });
  assert.equal((await snapshot(withCrossMeasureTechnique)).ok, true);
  await rightClick(fret(7));
  await menuItem(copy).click();
  await copyTo("曲末");
  await impact.getByRole("button", { name: "确认修改", exact: true }).click();
  await impact.waitFor({ state: "hidden" });
  await measureNumbers.filter({ hasText: /^5$/ }).waitFor();
  await expectScoreFocus();
  assert.deepEqual(errors, []);
  console.log("Browser passed: score menu positioning, both copy entries, copy confirmation and undo, and both technique direction bubbles.");
} finally {
  await browser.close();
}
