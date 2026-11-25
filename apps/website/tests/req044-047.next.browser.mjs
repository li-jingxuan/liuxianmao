import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(runtime.startsWith("/") ? pathToFileURL(runtime).href : runtime);
const browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(12000);
const output = process.env.REQ_BROWSER_OUTPUT
  ? pathToFileURL(`${resolve(process.env.REQ_BROWSER_OUTPUT)}/`)
  : new URL("../../../output/playwright/req044-047-product/", import.meta.url);
await mkdir(output, { recursive: true });
const checks = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
const rhythmSidebar = page.locator('[data-rhythm-pattern-panel][data-presentation="sidebar"]');
const rhythmPopup = page.locator('[data-rhythm-pattern-panel][data-presentation="toolbar"]');

async function state(action = "read", payload) {
  return page.evaluate(({ action, payload }) => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    const key = Object.keys(svg).find(key => key.startsWith("__reactFiber$"));
    let store;
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const candidate = fiber.memoizedProps?.session;
      if (candidate?.getState?.().document) { store = candidate; break; }
    }
    if (!store) throw Error("Real editor session missing");
    const current = store.getState();
    if (action === "replace") return current.replaceDocument(JSON.stringify(payload), "file");
    if (action === "undo") { current.undo(); return; }
    if (action === "selection") { current.setSelection(payload); return; }
    if (action === "point") {
      const visit = fiber => fiber && (fiber.memoizedProps?.layout?.systems?.[0]?.measures
        ? fiber.memoizedProps.layout : visit(fiber.child) ?? visit(fiber.sibling));
      let root = svg[key];
      while (root.return) root = root.return;
      const layout = visit(root.stateNode?.current ?? root);
      const measure = layout.systems.flatMap(s => s.measures).find(m => m.id === payload.measureId);
      const beat = measure.beats.find(b => b.id === payload.beatId);
      const point = new DOMPoint(beat.x, measure.strings[(payload.string ?? 1) - 1].y1).matrixTransform(svg.getScreenCTM());
      return { x: point.x, y: point.y };
    }
    return { document: current.document, selection: current.selection, history: current.historyDepth };
  }, { action, payload });
}
function fixture() {
  const rhythm = { base: "quarter", dots: 0 };
  return { schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
    score: { id: "req044-score", title: "工具栏与侧栏验收", arranger: "browser", keySignature: "C", meta: {},
      tracks: [{ id: "track", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
        tuning: { strings: ["E4", "B3", "G3", "D3", "A2", "E2"].map((pitch, i) => ({ index: i + 1, pitch, midi: [64, 59, 55, 50, 45, 40][i] })) },
        techniques: [], numberedMarks: [], measures: [0, 1, 2].map(m => ({ id: `m${m}`,
          timeSignature: { numerator: 4, denominator: 4 }, barline: "single", tuplets: [], lyrics: [], chordSymbols: [],
          beats: [0, 1, 2, 3].map(i => ({ id: `b${m}${i}`, tick: i * 960, kind: "notes", rhythm,
            notes: [{ id: `n${m}${i}`, string: 1, fret: i + 3 }] })),
          numberedVoice: { tuplets: [], events: [0, 1, 2, 3].map(i => ({ id: `e${m}${i}`, tick: i * 960, kind: "notes", rhythm, items: [{ id: `i${m}${i}`, token: String(i + 1) }] })) },
        })) }],
    } };
}
async function load(document = fixture()) {
  await page.keyboard.press("Escape");
  assert.equal((await state("replace", document)).ok, true);
  await page.waitForFunction(() => document.querySelector('text[data-numbered-event="e00"]'));
}
const ref = (m, b) => ({ trackId: "track", measureId: `m${m}`, beatId: `b${m}${b}`, string: 1 });
async function select(m = 0, b = 0) {
  const p = await state("point", ref(m, b));
  await page.mouse.click(p.x, p.y);
}
async function open(group) {
  const trigger = page.locator(`[data-tool-trigger="${group}"]`);
  if (await trigger.isVisible()) await trigger.click();
  else {
    await page.locator('[data-tool-trigger="more"]').click();
    await page.getByRole("button", { name: "节奏型工具", exact: true }).click();
  }
  await page.waitForTimeout(100);
}
async function check(name, run) { await run(); checks.push(name); }
async function shot(name) { await page.screenshot({ path: new URL(`${name}.png`, output).pathname, animations: "disabled" }); }

try {
  await page.goto(process.env.REQ_NEXT_URL ?? "http://localhost:3031/editor", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('svg[aria-label="六线谱编辑器"]').waitFor();
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    return svg && Object.keys(svg).some(key => key.startsWith("__reactFiber$"));
  });
  const toolbar = page.getByRole("toolbar", { name: "节奏、小节与历史工具" });
  const toolTrigger = id => toolbar.locator(`[data-tool-trigger="${id}"]`);
  const addChord = toolbar.getByRole("button", { name: "添加和弦", exact: true });
  await check("工具按七组显示，窄工具栏双行保留组内入口", async () => {
    const names = ["历史", "基础时值", "附点与休止", "演奏技巧", "节奏与连音", "小节", "和弦"];
    const groups = toolbar.locator('[data-toolbar-row] [role="group"]');
    assert.deepEqual(await groups.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))), names);
    assert.equal(await toolbar.getByRole("group", { name: "附点与休止" }).getByRole("button", { name: "切换休止" }).count(), 1);
    assert.equal(await toolbar.getByRole("group", { name: "演奏技巧" }).getByRole("button", { name: "所有技巧" }).count(), 1);
    const separation = () => groups.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderInlineStartWidth));
    assert.deepEqual(await separation(), ["0px", "1px", "1px", "1px", "1px", "1px", "1px"]);
    await toolbar.evaluate(el => { el.style.maxWidth = "460px"; });
    const rows = await toolbar.locator("[data-toolbar-row]").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    assert.ok(rows[1] > rows[0]);
    assert.deepEqual(await separation(), ["0px", "1px", "1px", "0px", "1px", "1px", "1px"]);
    for (const id of ["beat", "tuplet", "measure"]) assert.equal(await toolTrigger(id).isVisible(), true);
    await toolbar.evaluate(el => { el.style.removeProperty("max-width"); });
  });
  await check("无选区禁用五个桌面工具及更多菜单项，取消选区隐藏节奏型", async () => {
    await load();
    const invitation = page.getByText("点击谱面中的音符或小节开始编辑", { exact: true });
    await invitation.waitFor();
    assert.equal(await rhythmSidebar.count(), 0);
    for (const id of ["technique", "beat", "tuplet", "measure"])
      assert.equal(await toolTrigger(id).isDisabled(), true, id);
    assert.equal(await addChord.isDisabled(), true);
    await select();
    await rhythmSidebar.waitFor();
    for (const id of ["technique", "beat", "measure"])
      assert.equal(await toolTrigger(id).isEnabled(), true, id);
    assert.equal(await addChord.isEnabled(), true);
    assert.equal(await toolTrigger("tuplet").isDisabled(), true);
    await open("beat");
    await rhythmPopup.waitFor();
    await page.locator('svg[aria-label="六线谱编辑器"] text').filter({ hasText: /^工具栏与侧栏验收$/ }).click();
    await rhythmPopup.waitFor({ state: "hidden" });
    await invitation.waitFor();
    assert.equal(await rhythmSidebar.count(), 0);
    assert.equal(await toolTrigger("beat").isDisabled(), true);

    // 编辑器页面固定最小宽度，单独收窄工具栏以覆盖「更多」入口的容器查询。
    await toolbar.evaluate(el => { el.style.maxWidth = "920px"; });
    await page.locator('[data-tool-trigger="more"]').click();
    const more = page.getByRole("dialog", { name: "更多工具", exact: true });
    await more.waitFor();
    for (const name of ["节奏型工具", "连音工具", "小节工具"])
      assert.equal(await more.getByRole("button", { name, exact: true }).isDisabled(), true, name);
    await page.keyboard.press("Escape");
    await more.waitFor({ state: "hidden" });
    await state("selection", { anchor: ref(0, 0), focus: ref(0, 2) });
    await toolTrigger("more").click();
    for (const name of ["节奏型工具", "连音工具", "小节工具"])
      assert.equal(await more.getByRole("button", { name, exact: true }).isEnabled(), true, name);
    await page.keyboard.press("Escape");
    await more.waitFor({ state: "hidden" });
    await toolbar.evaluate(el => { el.style.removeProperty("max-width"); });
  });
  await check("清空或换成无效选区时关闭技巧、连音和小节面板", async () => {
    await load(); await select();
    for (const [id, name] of [["technique", "技巧"], ["tuplet", "连音"], ["measure", "小节"]]) {
      await state("selection", { anchor: ref(0, 0), focus: ref(0, 2) });
      await open(id);
      const dialog = page.getByRole("dialog", { name: `${name}工具参数`, exact: true });
      await dialog.waitFor();
      await state("selection", id === "tuplet" ? { anchor: ref(0, 0), focus: ref(1, 1) } : null);
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await toolTrigger(id).isDisabled(), true, id);
      if (id === "tuplet") {
        assert.equal(await toolTrigger("beat").isEnabled(), true);
        assert.equal(await rhythmSidebar.getByRole("tab", { name: "扫弦节奏型" }).count(), 0);
        assert.equal(await addChord.isDisabled(), true);
        assert.equal(await toolTrigger("measure").isEnabled(), true);
      }
    }
  });
  await check("没有可用技巧的休止拍与含延音横线的连音选区禁用对应工具", async () => {
    const document = fixture();
    const { beats } = document.score.tracks[0].measures[0];
    beats[1].notes[0].fret = "-";
    beats[3] = { ...beats[3], kind: "rest", notes: [] };
    await load(document);
    await select(0, 3);
    assert.equal(await toolTrigger("technique").isDisabled(), true);
    assert.equal(await addChord.isEnabled(), true);
    await state("selection", { anchor: ref(0, 0), focus: ref(0, 2) });
    assert.equal(await toolTrigger("tuplet").isDisabled(), true);
    assert.equal(await toolTrigger("technique").isEnabled(), true);
  });
  await load(); await select();
  await check("侧栏仅音符与小节；拍内模板默认两列并收起末两排", async () => {
    assert.equal(await page.getByRole("radio", { name: "音符", exact: true }).count(), 1);
    assert.equal(await page.getByRole("radio", { name: "小节", exact: true }).count(), 1);
    assert.equal(await page.getByRole("radio", { name: "连音", exact: true }).count(), 0);
    assert.equal(await rhythmSidebar.locator("[data-rhythm-template]").count(), 12);
    assert.equal(await rhythmSidebar.locator("[data-rhythm-template]:visible").count(), 8);
    assert.ok(!(await rhythmSidebar.innerText()).includes("三十二分细分"));
  });
  await check("工具栏与侧栏共享拍内模板和应用位置，应用可撤销", async () => {
    await rhythmSidebar.locator('[data-rhythm-template="eighths"]').click();
    await open("beat");
    assert.equal(await rhythmPopup.locator('[data-rhythm-template="eighths"]').getAttribute("aria-pressed"), "true");
    await rhythmPopup.getByRole("button", { name: "四个十六分", exact: true }).click();
    const chosen = await rhythmPopup.locator('[data-rhythm-template][aria-pressed="true"]').getAttribute("data-rhythm-template");
    assert.equal(await rhythmSidebar.locator(`[data-rhythm-template="${chosen}"]`).getAttribute("aria-pressed"), "true");
    await rhythmPopup.getByRole("button", { name: "应用节奏型", exact: true }).click();
    await rhythmPopup.waitFor({ state: "hidden" });
    assert.equal((await state()).document.score.tracks[0].measures[0].beats.length, 7);
    await state("undo");
    assert.equal((await state()).document.score.tracks[0].measures[0].beats.length, 4);
  });
  await check("应用节奏型保留颤音和跨拍滑音，只移除失效延音线，一次撤销恢复", async () => {
    const document = fixture();
    const track = document.score.tracks[0];
    track.measures[0].beats[1].notes[0].fret = 3;
    track.techniques = [
      { id: "tie", type: "tie", fromNoteId: "n00", toNoteId: "n01" },
      { id: "vibrato", type: "vibrato", fromNoteId: "n00" },
      { id: "slide", type: "slideUp", fromNoteId: "n01", toNoteId: "n02" },
    ];
    await load(document);
    await select();
    await open("beat");
    await rhythmPopup.locator('[data-rhythm-template="eighths"]').click();
    await rhythmPopup.getByText(/应用将移除：延音线/).waitFor();
    const before = await state();
    await rhythmPopup.getByRole("button", { name: "应用节奏型", exact: true }).click();
    await rhythmPopup.waitFor({ state: "hidden" });
    const after = await state();
    assert.deepEqual(after.document.score.tracks[0].techniques, track.techniques.slice(1));
    assert.equal(after.history.past, before.history.past + 1);
    await state("undo");
    assert.deepEqual((await state()).document.score, before.document.score);
  });
  await shot("sidebar-rhythm");
  await check("456px 气泡三列，整小节折叠、滚动、焦点与共享选择", async () => {
    await load(); await select(0, 1); await open("beat");
    await rhythmPopup.waitFor();
    const measure = (id) => rhythmPopup.locator(`[data-rhythm-measure-template="measure-44-${id}"]`);
    const toggle = rhythmPopup.locator('[data-rhythm-toggle="measure"]');
    assert.equal(await rhythmPopup.evaluate(el => el.offsetWidth), 456);
    assert.equal(await rhythmPopup.locator('[data-rhythm-template]:visible').count(), 6);
    assert.equal(await rhythmPopup.locator('[data-rhythm-measure-template]:visible').count(), 6);
    assert.ok(await measure("eighth-sixteenth").isVisible());
    assert.equal(await measure("quarter-eighth").isVisible(), false);
    assert.equal(await rhythmPopup.locator('[aria-label*="谱面，可横向滚动"]').count(), 0);
    await shot("req045-popup-collapsed");
    await toggle.click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-rhythm-measure-template") === "measure-44-quarter-eighth");
    assert.equal(await rhythmPopup.locator('[data-rhythm-measure-template]:visible').count(), 14);
    assert.equal(await rhythmPopup.locator('[data-rhythm-measure-template]').last().getAttribute('data-rhythm-measure-template'), 'measure-44-quarters');
    await measure("quarter-eighth").click();
    assert.equal(await rhythmSidebar.locator('[data-rhythm-measure-template="measure-44-quarter-eighth"]').getAttribute("aria-pressed"), "true");
    const templates = rhythmPopup.getByRole("tabpanel", { name: "普通节奏型" });
    const apply = rhythmPopup.getByRole("button", { name: "应用节奏型", exact: true });
    const footerBefore = await apply.boundingBox();
    assert.equal(await templates.evaluate(el => el.scrollHeight > el.clientHeight), true);
    await templates.evaluate(el => { el.scrollTop = 0; });
    assert.deepEqual(await apply.boundingBox(), footerBefore);
    await toggle.click();
    assert.equal(await measure("quarter-eighth").isVisible(), false);
    assert.match(await rhythmPopup.innerText(), /第 1 小节 · 整小节 · 四八交替/);
    assert.ok(await page.locator('[data-rhythm-pattern-scope]').isVisible());
    await page.keyboard.press("Escape");
    await rhythmPopup.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-tool-trigger") === "beat");
    await open("beat");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-rhythm-toggle") === "measure");
    await rhythmPopup.locator('[data-rhythm-measure-template="measure-44-alternating"]').click();
    await page.keyboard.press("Escape");
    await rhythmPopup.waitFor({ state: "hidden" });
    await open("beat");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-rhythm-measure-template") === "measure-44-alternating");
    await page.keyboard.press("Escape");
    await rhythmPopup.waitFor({ state: "hidden" });
  });
  await check("气泡与侧栏的拍内和整小节模板分别展开、收起，并保留各自状态", async () => {
    const closeRhythmPopup = async () => {
      await page.keyboard.press("Escape");
      await rhythmPopup.waitFor({ state: "hidden" });
    };
    for (const group of ["beat", "measure"]) {
      const sidebarToggle = rhythmSidebar.locator(`[data-rhythm-toggle="${group}"]`);
      const popupToggle = rhythmPopup.locator(`[data-rhythm-toggle="${group}"]`);
      assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
      await sidebarToggle.click();
      await open("beat");
      assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "true");
      assert.equal(await popupToggle.getAttribute("aria-expanded"), "false");

      await popupToggle.click();
      await closeRhythmPopup();
      await sidebarToggle.click();
      await open("beat");
      assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
      assert.equal(await popupToggle.getAttribute("aria-expanded"), "true");
      await popupToggle.click();
      assert.equal(await popupToggle.getAttribute("aria-expanded"), "false");
      assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
      await closeRhythmPopup();
    }
  });
  await check("侧栏节奏模板展开后随侧栏滚动，最后一条模板和应用按钮可到达", async () => {
    const templates = rhythmSidebar.getByRole("tabpanel", { name: "普通节奏型", exact: true });
    const beatToggle = rhythmSidebar.locator('[data-rhythm-toggle="beat"]');
    const measureToggle = rhythmSidebar.locator('[data-rhythm-toggle="measure"]');
    await beatToggle.click();
    await measureToggle.click();
    const apply = rhythmSidebar.getByRole("button", { name: "应用节奏型", exact: true });
    const last = templates.locator('[data-rhythm-measure-template="measure-44-quarters"]');
    await last.scrollIntoViewIfNeeded();
    assert.equal(await templates.evaluate(el => getComputedStyle(el).overflowY), "visible");
    assert.equal(await templates.evaluate(el => el.scrollHeight === el.clientHeight && el.scrollTop === 0), true);
    assert.equal(await last.evaluate(el => {
      const sidebar = el.closest('[data-rhythm-pattern-panel]').closest('[role="tabpanel"]');
      const row = el.getBoundingClientRect();
      const bounds = sidebar.getBoundingClientRect();
      return sidebar.scrollTop > 0 && row.top >= bounds.top && row.bottom <= bounds.bottom;
    }), true);
    await apply.click({ trial: true });
    await measureToggle.click();
    await beatToggle.click();
  });
  for (const layer of ["tab", "numbered"]) {
    await check(`整小节 ${layer} 超额提示、取消确认、逐拍应用和单次撤销`, async () => {
      const document = fixture();
      const measure = document.score.tracks[0].measures[0];
      const rhythm = { base: "eighth", dots: 0 };
      measure.beats[0].rhythm = rhythm;
      measure.beats.splice(1, 0, { id: "extra-beat", tick: 480, rhythm, kind: "notes", notes: [{ id: "extra-note", string: 1, fret: 5 }] });
      measure.chordSymbols = [{ id: "extra-chord", beatId: "extra-beat", display: "name", chord: { name: "G", diagram: null } }];
      measure.numberedVoice.events[0].rhythm = rhythm;
      measure.numberedVoice.events.splice(1, 0, { id: "extra-event", tick: 480, rhythm, kind: "notes", items: [{ id: "extra-item", token: "2" }] });
      measure.lyrics = [{ id: "extra-lyric", eventId: "extra-event", verse: 1, text: "雨" }];
      await load(document);
      if (layer === "tab") await select(0, 1);
      else await page.locator('text[data-numbered-event="e01"]').first().click();
      const before = await state();
      await open("beat");
      await rhythmPopup.locator('[data-rhythm-measure-template="measure-44-quarter-split"]').click();
      assert.match(await rhythmPopup.innerText(), new RegExp(`舍弃各拍末尾共 1 个内容。.*1 项${layer === "tab" ? "和弦" : "歌词"}`));
      const apply = rhythmPopup.getByRole("button", { name: "应用节奏型", exact: true });
      await apply.click();
      const dialog = page.getByRole("dialog", { name: "舍弃尾部内容？" });
      await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual((await state()).document, before.document);
      await apply.click();
      await dialog.getByRole("button", { name: "确认舍弃并应用" }).click();
      await rhythmPopup.waitFor({ state: "hidden" });
      const after = await state();
      const updated = after.document.score.tracks[0].measures[0];
      const events = layer === "tab" ? updated.beats : updated.numberedVoice.events;
      assert.deepEqual(events.map(({ tick }) => tick), [0, 960, 1440, 1680, 1920, 2880, 3360, 3600]);
      assert.equal(updated.lyrics.length, layer === "tab" ? 1 : 0);
      assert.equal(updated.chordSymbols.length, layer === "numbered" ? 1 : 0);
      assert.equal(after.history.past, before.history.past + 1);
      await state("undo");
      assert.deepEqual((await state()).document, before.document);
    });
  }
  await check("320px 与 375px 气泡两列，整小节单条一行，底部应用可见", async () => {
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 680 });
      await load();
      const cell = ref(0, 0);
      await state("selection", { anchor: cell, focus: cell });
      await open("beat");
      const panel = await rhythmPopup.boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= width, JSON.stringify({ width, panel }));
      assert.equal(await rhythmPopup.locator('[data-rhythm-template]:visible').count(), 8);
      const rows = await rhythmPopup.locator('[data-rhythm-measure-template]:visible').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      assert.equal(new Set(rows).size, 6);
      const button = await rhythmPopup.getByRole("button", { name: "应用节奏型", exact: true }).boundingBox();
      assert.ok(button.y + button.height < 680);
      await shot(`req045-popup-${width}`);
      await page.keyboard.press("Escape");
      await rhythmPopup.waitFor({ state: "hidden" });
    }
    await page.setViewportSize({ width: 1600, height: 1080 });
  });
  await load(); await select();
  await check("复制小节弹窗确认后只作用焦点，保持工具面板打开，撤销恢复", async () => {
    await state("selection", { anchor: ref(0, 0), focus: ref(1, 1) });
    await open("measure");
    await page.getByRole("button", { name: "复制当前小节", exact: true }).last().click();
    const destinations = page.getByRole("dialog", { name: "复制小节", exact: true });
    const copy = destinations.getByRole("button", { name: /^复\s*制$/ });
    assert.equal(await copy.isDisabled(), true);
    await destinations.getByRole("combobox", { name: "插入位置" }).selectOption({ label: "曲末" });
    assert.equal((await state()).document.score.tracks[0].measures.length, 3);
    await copy.click();
    await destinations.waitFor({ state: "hidden" });
    assert.equal((await state()).document.score.tracks[0].measures.length, 4);
    assert.ok(await page.getByRole("button", { name: "复制当前小节", exact: true }).last().isVisible());
    await state("undo");
    assert.equal((await state()).document.score.tracks[0].measures.length, 3);
  });
  await shot("measure-popup");
  await check("删除小节可取消，确认后提示原小节编号，可一次撤销", async () => {
    const before = await state();
    const remove = page.getByRole("button", { name: "删除当前小节", exact: true }).last();
    const confirmation = page.getByRole("dialog", { name: "删除小节", exact: true });
    await remove.click();
    await confirmation.getByText(/删除第 2 小节/).waitFor();
    await confirmation.getByRole("button", { name: /^取\s*消$/ }).and(page.locator(":focus")).waitFor();
    await page.keyboard.press("Escape");
    await confirmation.waitFor({ state: "hidden" });
    await remove.and(page.locator(":focus")).waitFor();
    assert.deepEqual((await state()).document, before.document);
    await remove.click();
    await confirmation.getByRole("button", { name: "确认删除", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    const after = await state();
    assert.deepEqual(after.document.score.tracks[0].measures.map(measure => measure.id), ["m0", "m2"]);
    assert.equal(after.history.past, before.history.past + 1);
    await page.locator(".ant-message-success").getByText("第 2 小节已删除", { exact: true }).waitFor();
    await state("undo");
    assert.deepEqual((await state()).document, before.document);
  });
  await load(); await select(1);
  await check("右侧小节属性使用同一复制和删除弹窗", async () => {
    const measureTab = page.getByRole("radio", { name: "小节", exact: true });
    await page.locator("label").filter({ has: measureTab }).click();
    const sidebar = page.getByRole("region", { name: "小节属性详情", exact: true });
    const copy = sidebar.getByRole("button", { name: "复制当前小节", exact: true });
    const destinations = page.getByRole("dialog", { name: "复制小节", exact: true });
    const before = (await state()).document;
    await copy.click();
    await destinations.getByRole("combobox", { name: "插入位置" }).selectOption({ label: "曲首" });
    await page.keyboard.press("Escape");
    await destinations.waitFor({ state: "hidden" });
    await copy.and(page.locator(":focus")).waitFor();
    assert.deepEqual((await state()).document, before);
    const confirmation = page.getByRole("dialog", { name: "删除小节", exact: true });
    await sidebar.getByRole("button", { name: "删除当前小节", exact: true }).click();
    await confirmation.getByRole("button", { name: "确认删除", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.deepEqual((await state()).document.score.tracks[0].measures.map(({ id }) => id), ["m0", "m2"]);
  });
  await page.keyboard.press("Escape"); await load(); await select();
  await check("全部十六技巧紧凑显示，应用删除撤销", async () => {
    await open("technique");
    const tool = page.locator('[aria-label="吉他技巧工具"]');
    assert.equal(await tool.locator("[data-technique-type]").count(), 16);
    await tool.getByRole("button", { name: "颤音", exact: true }).click();
    assert.equal((await state()).document.score.tracks[0].techniques.length, 1);
    await tool.getByRole("button", { name: "删除当前技巧", exact: true }).click();
    assert.equal((await state()).document.score.tracks[0].techniques.length, 0);
    await state("undo");
    assert.equal((await state()).document.score.tracks[0].techniques.length, 1);
  });
  await shot("technique-popup");
  await page.keyboard.press("Escape"); await load(); await select();
  await check("连音六图标；实际三拍点可创建与删除并撤销", async () => {
    await state("selection", { anchor: ref(0, 0), focus: ref(0, 2) });
    await open("tuplet");
    const tool = page.locator('[data-presentation="popover"][aria-label="连音工具"]');
    assert.equal(await tool.locator('button[aria-label*="（"]').count(), 6);
    await tool.getByRole("button", { name: /三连音/ }).click();
    assert.equal((await state()).document.score.tracks[0].measures[0].tuplets.length, 1);
    await page.getByRole("button", { name: "删除连音组", exact: true }).last().click();
    assert.equal((await state()).document.score.tracks[0].measures[0].tuplets.length, 0);
    await state("undo");
    assert.equal((await state()).document.score.tracks[0].measures[0].tuplets.length, 1);
  });
  await shot("tuplet-popup");
  await check("连音尺寸与5比率图标区分；Escape归还入口焦点", async () => {
    const tool = page.locator('[data-presentation="popover"][aria-label="连音工具"]');
    const geometry = await tool.evaluate(root => ({ width: root.closest('[role="dialog"]').getBoundingClientRect().width,
      heights: [...root.querySelectorAll('button[aria-label*="（"]')].map(b => b.getBoundingClientRect().height),
      fives: [...root.querySelectorAll('svg text')].map(t => t.textContent).filter(t => t.startsWith("5")) }));
    assert.equal(geometry.width, 300);
    assert.ok(geometry.heights.every(h => h === 34));
    assert.deepEqual(geometry.fives, ["5:4", "5:3"]);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-tool-trigger") === "tuplet");
    assert.equal(await page.locator('[data-tool-trigger="tuplet"]').evaluate(b => b === document.activeElement), true);
    await state("selection", { anchor: ref(0, 0), focus: ref(0, 1) });
    assert.equal(await toolTrigger("tuplet").isDisabled(), true);
    await state("selection", { anchor: ref(0, 0), focus: ref(0, 2) });
    assert.equal(await toolTrigger("tuplet").isEnabled(), true);
  });
  await load(); await select();
  await check("谱首反复独立切换；末小节禁止开始与双向反复", async () => {
    await open("measure");
    await page.getByRole("button", { name: "谱首反复", exact: true }).last().click();
    let track = (await state()).document.score.tracks[0];
    assert.equal(track.startBarline, "repeatStart");
    assert.equal(track.measures[0].barline, "single");
    await state("undo");
    await page.keyboard.press("Escape"); await select(2); await open("measure");
    for (const name of ["开始反复线", "双向反复线", "谱首反复"])
      assert.equal(await page.getByRole("button", { name, exact: true }).last().isDisabled(), true);
    const dimensions = await page.getByRole("group", { name: "当前小节操作" }).last().evaluate(root => ({
      group: root.offsetHeight, heights: [...root.querySelectorAll("button")].map(b => b.offsetHeight) }));
    assert.equal(dimensions.group, 37);
    assert.deepEqual(dimensions.heights, [29, 29, 29]);
  });
  await page.keyboard.press("Escape"); await load(); await select();
  await check("技巧离散参数即时更新同一对象，数字校验后Enter提交", async () => {
    await open("technique");
    const tool = page.locator('[aria-label="吉他技巧工具"]');
    await tool.locator('[data-technique-type="bend"]').click();
    await tool.getByRole("button", { name: "半音", exact: true }).click();
    let techniques = (await state()).document.score.tracks[0].techniques;
    assert.equal(techniques.length, 1); assert.equal(techniques[0].semitones, 1);
    const id = techniques[0].id;
    await tool.getByRole("button", { name: "全音", exact: true }).click();
    techniques = (await state()).document.score.tracks[0].techniques;
    assert.equal(techniques.length, 1); assert.equal(techniques[0].id, id); assert.equal(techniques[0].semitones, 2);
    await tool.locator('[data-technique-type="trill"]').click();
    const input = tool.getByRole("textbox", { name: "辅助品位" });
    await input.fill("4.5"); await input.press("Enter");
    assert.equal((await state()).document.score.tracks[0].techniques.length, 1);
    await input.fill("9"); await input.press("Enter");
    techniques = (await state()).document.score.tracks[0].techniques;
    assert.equal(techniques.length, 2);
    assert.equal(techniques.find(t => t.type === "trill").auxiliaryFret, 9);
    const geometry = await tool.evaluate(root => ({
      heights: [...root.querySelectorAll("[data-technique-type]")].map(b => b.getBoundingClientRect().height),
      border: getComputedStyle(root.querySelector('[aria-label="删除当前技巧"]')).borderTopWidth,
      background: getComputedStyle(root.querySelector('[aria-label="删除当前技巧"]')).backgroundColor }));
    assert.ok(geometry.heights.every(h => h === 36));
    assert.equal(geometry.border, "0px"); assert.equal(geometry.background, "rgba(0, 0, 0, 0)");
  });
  await shot("technique-parameters");
  await page.keyboard.press("Escape"); await load();
  await check("简谱单音和跨小节选区不沿用 TAB 连音范围，跨小节按焦点定位小节", async () => {
    await state("selection", { anchor: ref(0, 0), focus: ref(0, 2) });
    assert.equal(await toolTrigger("tuplet").isEnabled(), true);
    await page.locator('text[data-numbered-event="e00"]').first().click();
    for (const id of ["technique", "tuplet"]) assert.equal(await toolTrigger(id).isDisabled(), true, id);
    assert.equal(await addChord.isDisabled(), true);
    assert.equal(await toolTrigger("beat").isEnabled(), true);
    assert.equal(await toolTrigger("measure").isEnabled(), true);
    await page.locator('text[data-numbered-event="e10"]').first().click({ modifiers: ["Shift"] });
    assert.equal(await toolTrigger("tuplet").isDisabled(), true);
    assert.equal(await toolTrigger("beat").isEnabled(), true);
    assert.equal(await rhythmSidebar.getByRole("tab", { name: "扫弦节奏型" }).count(), 0);
    await open("measure");
    assert.match(await page.getByRole("dialog", { name: "小节工具参数" }).innerText(), /第 2 小节/);
    await page.keyboard.press("Escape");
  });
  await check("BUG-078 简谱提供六种比例，二连音校验余量，两种五连音时值不同", async () => {
    const ratios = [[2, 3], [3, 2], [4, 3], [5, 4], [5, 3], [6, 4]];
    const names = ["二", "三", "四", "五", "五", "六"];
    const score = page.getByRole("application", { name: "六线谱编辑器" });
    const makeEvents = (actual, blocked = false) => Array.from({ length: actual + 1 }, (_, index) => ({
      id: `e0${index}`, tick: index === actual && !blocked ? 1920 : index * 240,
      kind: "notes", rhythm: { base: "sixteenth", dots: 0 }, items: [{ id: `i0${index}`, token: "4" }],
    }));
    const selectRange = async (actual, blocked = false) => {
      const document = fixture();
      const measure = document.score.tracks[0].measures[0];
      measure.numberedVoice.events = makeEvents(actual, blocked);
      measure.lyrics = [{ id: "bug078-lyric", eventId: "e01", verse: 1, text: "词" }];
      await load(document);
      await score.locator('text[data-numbered-event="e00"]').click();
      await score.locator(`text[data-numbered-event="e0${actual - 1}"]`).click({ modifiers: ["Shift"] });
      await open("tuplet");
      return page.getByRole("group", { name: "简谱连音工具" });
    };
    for (const [index, [actual, normal]] of ratios.entries()) {
      const tool = await selectRange(actual);
      const grid = tool.getByRole("group", { name: "连音比例" });
      assert.equal(await grid.getByRole("button").count(), 6);
      assert.equal(await grid.getByRole("button", { disabled: false }).count(), actual === 5 ? 2 : 1);
      const name = `${names[index]}连音（${actual}:${normal}）`;
      const before = await state();
      await grid.getByRole("button", { name, exact: true }).click();
      const after = await state();
      const measure = after.document.score.tracks[0].measures[0];
      const group = measure.numberedVoice.tuplets[0];
      assert.deepEqual(group.ratio, { actual, normal });
      assert.deepEqual(measure.numberedVoice.events.map(({ tick }) => tick), [...Array.from({ length: actual }, (_, i) => i * 240 * normal / actual), 1920]);
      assert.deepEqual(measure.lyrics, before.document.score.tracks[0].measures[0].lyrics);
      const mark = `text[data-numbered-mark="${group.id}"]`;
      assert.equal(await score.locator(mark).textContent(), actual === 3 ? "3" : `${actual}:${normal}`);
      assert.equal(await page.locator(`[data-score-print-layer] ${mark}`).textContent(), actual === 3 ? "3" : `${actual}:${normal}`);
      assert.equal(await grid.getByRole("button", { name, exact: true }).getAttribute("aria-pressed"), "true");
      await tool.getByRole("button", { name: "删除连音组", exact: true }).click();
      assert.deepEqual((await state()).document.score, before.document.score);
    }
    const tool = await selectRange(2, true);
    const blocked = tool.getByRole("button", { name: "二连音（2:3）", exact: true });
    assert.equal(await blocked.isDisabled(), true);
    assert.match(await blocked.getAttribute("aria-description"), /连续空位不足/);
    const explanation = tool.locator('[data-tool-action="tuplet-actions"]');
    await explanation.focus();
    assert.match(await explanation.getAttribute("aria-label"), /连续空位不足/);
    await page.keyboard.press("Escape");
    await toolTrigger("tuplet").and(page.locator(":focus")).waitFor();
  });
  await check("《理想》第 32 小节三个简谱音符可用顶栏设置或删除三连音", async () => {
    const ideal = JSON.parse(await readFile(new URL("../../../packages/lxm-editor/example/ideal-score.lxm.json", import.meta.url), "utf8"));
    // 默认谱面已经编组，从历史小节状态开始才能通过顶栏完整验证新增、删除和撤销。
    const beforeTuplets = JSON.parse(await readFile(new URL("../../../packages/lxm-editor/tests/fixtures/ideal-measure-32-before-tuplets.json", import.meta.url), "utf8"));
    Object.assign(ideal.score.tracks[0].measures[31], beforeTuplets);
    assert.equal((await state("replace", ideal)).ok, true);
    const before = await state();
    const measure = before.document.score.tracks[0].measures[31];
    const notes = measure.numberedVoice.events.filter(event => event.kind === "notes").slice(0, 3);
    assert.deepEqual(notes.map(event => event.items[0].token), ["4", "4", "4"]);
    await page.locator(`text[data-numbered-event="${notes[0].id}"]`).first().click();
    await page.locator(`text[data-numbered-event="${notes[2].id}"]`).first().click({ modifiers: ["Shift"] });
    assert.equal(await toolTrigger("tuplet").isEnabled(), true);
    await open("tuplet");
    const tool = page.getByRole("group", { name: "简谱连音工具" });
    await tool.getByRole("button", { name: "三连音（3:2）" }).click();
    const after = await state();
    const updated = after.document.score.tracks[0].measures[31];
    assert.equal(after.history.past, before.history.past + 1);
    assert.equal(updated.numberedVoice.tuplets.length, 1);
    assert.deepEqual(updated.numberedVoice.tuplets[0].eventIds, notes.map(event => event.id));
    assert.deepEqual(updated.numberedVoice.events.slice(0, 3).map(event => event.tick), [0, 320, 640]);
    assert.deepEqual(updated.numberedVoice.events.slice(3), measure.numberedVoice.events.slice(3));
    assert.deepEqual(updated.beats, measure.beats);
    assert.deepEqual(updated.lyrics, measure.lyrics);
    const mark = `[data-numbered-mark="${updated.numberedVoice.tuplets[0].id}"]`;
    const score = page.locator('svg[aria-label="六线谱编辑器"]');
    assert.match(await score.locator(`path${mark}`).getAttribute("d"), /^M .* Q .* M .* Q /);
    assert.equal(await score.locator(`text${mark}`).textContent(), "3");
    await shot("numbered-triplet");
    if (!(await tool.isVisible())) await open("tuplet");
    await tool.getByRole("button", { name: "删除连音组" }).click();
    assert.deepEqual((await state()).document.score.tracks[0].measures[31], measure);
    await state("undo");
    assert.deepEqual((await state()).document, after.document);
    await state("undo");
    assert.deepEqual((await state()).document, before.document);
  });
  await check("BUG-080 简谱末拍预览均分三连音，保留歌词且可一次撤销", async () => {
    for (const hasThirdNote of [true, false]) {
      const document = fixture();
      const measure = document.score.tracks[0].measures[0];
      const ids = ["triplet-a", "triplet-b", ...(hasThirdNote ? ["triplet-c"] : [])];
      const lastBeat = ids.map((id, index) => ({
        id, tick: [2880, 3360, 3600][index], kind: "notes",
        rhythm: { base: hasThirdNote && index !== 0 ? "sixteenth" : "eighth", dots: 0 },
        items: [{ id: `${id}-note`, token: String(index + 4) }],
      }));
      measure.numberedVoice.events.splice(3, 1, ...lastBeat);
      measure.lyrics = [{ id: "triplet-lyric", eventId: ids[1], verse: 1, text: "盛" }];
      await load(document);
      const before = await state();
      await page.locator(`text[data-numbered-event="${ids[1]}"]`).first().click();
      await open("tuplet");
      const tool = page.getByRole("group", { name: "简谱连音工具" });
      await tool.getByRole("button", { name: "在本拍创建三连音" }).click();
      const preview = tool.getByRole("group", { name: "本拍三连音预览" });
      assert.match(await preview.innerText(), /第 1 小节 · 第 4 拍/);
      const slots = preview.getByRole("group", { name: "三个等分八分音槽位" });
      assert.deepEqual(await slots.locator("span").allTextContents(), ["4", "5", hasThirdNote ? "6" : "空位"]);
      assert.equal((await state()).history.past, before.history.past);
      await preview.getByRole("button", { name: /^取\s*消$/ }).click();
      assert.equal(await preview.count(), 0);
      await tool.getByRole("button", { name: "在本拍创建三连音" }).click();
      await preview.getByRole("button", { name: /^应\s*用$/ }).click();
      await preview.waitFor({ state: "detached" });
      const after = await state();
      const updated = after.document.score.tracks[0].measures[0];
      const converted = updated.numberedVoice.events.slice(3);
      assert.deepEqual(converted.map(({ tick, rhythm }) => [tick, rhythm.base]), [[2880, "eighth"], [3200, "eighth"], [3520, "eighth"]]);
      assert.deepEqual(converted.slice(0, ids.length).map(({ id, items }) => ({ id, items })), lastBeat.map(({ id, items }) => ({ id, items })));
      assert.equal(converted[2].kind, hasThirdNote ? "notes" : "gap");
      assert.deepEqual(updated.lyrics, measure.lyrics);
      assert.equal(after.history.past, before.history.past + 1);
      await state("undo");
      assert.deepEqual((await state()).document, before.document);
      if (!hasThirdNote) {
        await load(after.document);
        const score = page.getByRole("application", { name: "六线谱编辑器" });
        const placeholder = score.locator(`[data-paragraph-cell="numbered/m0/${converted[2].id}/3840"]`);
        const point = await placeholder.evaluate((node) => {
          const box = node.getBBox();
          const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(node.getScreenCTM());
          return { x: center.x, y: center.y };
        });
        await page.mouse.click(point.x, point.y);
        const input = page.locator("[id$=music-text-edit-popover]").getByRole("textbox", { name: "简谱内容", exact: true });
        await input.fill("6");
        await input.press("Enter");
        const filled = (await state()).document.score.tracks[0].measures[0];
        const third = filled.numberedVoice.events.find(({ id }) => id === converted[2].id);
        assert.equal(third.items[0].token, "6");
        assert.equal(third.tick, 3520);
        assert.deepEqual(filled.numberedVoice.tuplets, updated.numberedVoice.tuplets);
      }
    }
  });
  await check("BUG-079 反向跨小节选择可合组，保留首音、歌词及选区并可拆组", async () => {
    const document = fixture();
    const [first, next] = document.score.tracks[0].measures;
    const eighth = { base: "eighth", dots: 0 };
    const note = (id, tick, token) => ({ id, tick, rhythm: eighth, kind: "notes", items: [{ id: `${id}-note`, token }] });
    first.numberedVoice.events.splice(3, 1, note("across-a", 2880, "3"), note("across-b", 3360, "1"));
    next.numberedVoice.events.splice(0, 1, note("across-c", 0, "3"));
    next.lyrics = [{ id: "across-lyric", eventId: "across-c", verse: 1, text: "年" }];
    await load(document);
    const before = await state();
    await page.locator('text[data-numbered-event="across-c"]').first().click();
    await page.locator('text[data-numbered-event="across-a"]').first().click({ modifiers: ["Shift"] });
    assert.equal(await toolTrigger("tuplet").isEnabled(), true);
    await open("tuplet");
    const tool = page.getByRole("group", { name: "简谱连音工具" });
    await tool.getByRole("button", { name: "三连音（3:2）" }).click();
    const after = await state();
    const [updatedFirst, updatedNext] = after.document.score.tracks[0].measures;
    const [group] = updatedFirst.numberedVoice.tuplets;
    assert.deepEqual(group.eventIds, ["across-a", "across-b", "across-c"]);
    assert.deepEqual(updatedFirst.numberedVoice.events.slice(-3).map(({ tick }) => tick), [2880, 3200, 3520]);
    assert.deepEqual(updatedFirst.lyrics, next.lyrics);
    assert.deepEqual(updatedNext.lyrics, []);
    assert.equal(after.history.past, before.history.past + 1);
    const score = page.locator('svg[aria-label="六线谱编辑器"]');
    assert.equal(await score.locator(`text[data-numbered-mark="${group.id}"]`).textContent(), "3");
    if (!(await tool.isVisible())) await open("tuplet");
    await tool.getByRole("button", { name: "删除连音组" }).click();
    assert.deepEqual((await state()).document.score.tracks[0].measures, before.document.score.tracks[0].measures);
    await state("undo");
    assert.deepEqual((await state()).document, after.document);
    await state("undo");
    assert.deepEqual((await state()).document, before.document);
  });
  await check("选中歌词或和弦时，TAB 工具禁用且保留对应的小节和和弦操作", async () => {
    const document = fixture();
    const measure = document.score.tracks[0].measures[0];
    measure.lyrics = [{ id: "lyric", eventId: "e00", verse: 1, text: "雨" }];
    measure.chordSymbols = [{ id: "chord", beatId: "b00", display: "name", chord: { name: "G", diagram: null } }];
    await load(document);
    await state("selection", { anchor: ref(0, 0), focus: ref(0, 2) });
    const svg = page.locator('svg[aria-label="六线谱编辑器"]');
    await svg.getByText("雨", { exact: true }).click();
    for (const id of ["technique", "beat", "tuplet"]) assert.equal(await toolTrigger(id).isDisabled(), true, id);
    assert.equal(await addChord.isDisabled(), true);
    assert.equal(await toolTrigger("measure").isEnabled(), true);
    await svg.getByText("G", { exact: true }).click();
    for (const id of ["technique", "beat", "tuplet"]) assert.equal(await toolTrigger(id).isDisabled(), true, id);
    assert.equal(await toolTrigger("measure").isEnabled(), true);
    assert.equal(await toolbar.getByRole("button", { name: "编辑和弦", exact: true }).isEnabled(), true);
  });
  await check("同一谱面切换到 3/4 和 6/8 目标小节，按真实拍号切换目录并应用", async () => {
    const document = fixture();
    const [, triple, compound] = document.score.tracks[0].measures;
    triple.timeSignature = { numerator: 3, denominator: 4 };
    triple.beats = triple.beats.slice(0, 3);
    triple.numberedVoice.events = triple.numberedVoice.events.slice(0, 3);
    compound.timeSignature = { numerator: 6, denominator: 8 };
    compound.beats = compound.beats.slice(0, 2).map((beat, i) => ({ ...beat, tick: i * 1440, rhythm: { base: "quarter", dots: 1 } }));
    compound.numberedVoice.events = compound.numberedVoice.events.slice(0, 2).map((event, i) => ({ ...event, tick: i * 1440, rhythm: { base: "quarter", dots: 1 } }));
    await load(document);
    await select(1);
    assert.equal(await rhythmSidebar.locator("[data-rhythm-template]").count(), 12);
    assert.equal(await rhythmSidebar.locator("[data-rhythm-measure-template]:visible").count(), 10);
    assert.equal(await rhythmSidebar.locator("[data-rhythm-measure-template]").last().getAttribute("data-rhythm-measure-template"), "measure-34-quarters");
    await select(2);
    assert.equal(await rhythmSidebar.locator("[data-rhythm-template]").count(), 9);
    assert.equal(await rhythmSidebar.locator("[data-rhythm-measure-template]:visible").count(), 10);
    const before = await state();
    await rhythmSidebar.locator('[data-rhythm-measure-template="measure-68-alternating"]').click();
    assert.match(await rhythmSidebar.innerText(), /第 3 小节 · 整小节 · 长短交替/);
    await rhythmSidebar.getByRole("button", { name: "应用节奏型", exact: true }).click();
    const after = await state();
    assert.deepEqual(after.document.score.tracks[0].measures[2].beats.map(({ tick }) => tick), [0, 960, 1440, 1920]);
    assert.equal(after.history.past, before.history.past + 1);
    await state("undo");
    assert.deepEqual((await state()).document, before.document);
  });
  assert.deepEqual(errors, []);
  await writeFile(new URL("result.json", output), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
  await shot("failure").catch(() => {});
  await writeFile(new URL("result.json", output), JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
