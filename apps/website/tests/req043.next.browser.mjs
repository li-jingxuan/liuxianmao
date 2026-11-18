import assert from "node:assert/strict";
import { downloadScoreJson } from "./score-file-actions.browser.cjs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Run against the real Next editor. No prototype, adapter replacement or product hooks.
const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(runtime.startsWith("/") ? pathToFileURL(runtime).href : runtime);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.setDefaultTimeout(12000);
const output = new URL("../../../output/playwright/req043-product/", import.meta.url);
const url = process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor";
const filter = process.env.REQ043_CHECK_FILTER ? new RegExp(process.env.REQ043_CHECK_FILTER) : null;
const previous = filter ? await readFile(new URL("result.json", output), "utf8").then(JSON.parse).catch(() => null) : null;
const pageErrors = [], consoleErrors = [], checks = previous?.checks?.filter(check => !filter.test(check.name)) ?? [], screenshots = previous?.screenshots ? [...previous.screenshots] : [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const panel = page.locator("[data-rhythm-pattern-panel]");
const trigger = page.locator("[data-tool-trigger=beat]");
const Q = 960;
const rhythm = (base = "quarter", dots = 0) => ({ base, dots });
const event = (id, tick, base = "quarter", token = "1", kind = "notes", dots = 0) => ({
  id, tick, kind, rhythm: rhythm(base, dots), items: kind === "gap" ? [] : [{ id: `${id}-i`, token }],
});
const beat = (id, tick, base = "quarter", frets = [3], dots = 0) => ({
  id, tick, kind: "notes", rhythm: rhythm(base, dots), notes: frets.map((fret, i) => ({ id: `${id}-n${i}`, string: i + 1, fret })),
});
function fixture(signature = "4/4") {
  const compound = signature === "6/8", count = compound ? 2 : signature === "3/4" ? 3 : 4;
  const step = compound ? Q * 1.5 : Q;
  return { schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
    score: { id: "req043-score", title: "REQ043 节奏型真实验收", arranger: "browser", keySignature: "C", meta: {},
      tracks: [{ id: "track", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
        tuning: { strings: ["E4", "B3", "G3", "D3", "A2", "E2"].map((pitch, i) => ({ index: i + 1, pitch, midi: [64, 59, 55, 50, 45, 40][i] })) },
        techniques: [], numberedMarks: [], measures: [{ id: "measure", timeSignature: { numerator: compound ? 6 : count, denominator: compound ? 8 : 4 },
          barline: "single", tuplets: [], lyrics: [1, 2, 3, 4].map(verse => ({ id: `lyric${verse}`, eventId: "e0", verse, text: `词${verse}` })),
          chordSymbols: [{ id: "chord", beatId: "b0", display: "name", chord: { name: "C", diagram: null } }],
          beats: Array.from({ length: count }, (_, i) => beat(`b${i}`, i * step, "quarter", [i, i + 1, i + 2, i + 3, i + 4, i + 5], compound ? 1 : 0)),
          numberedVoice: { tuplets: [], events: Array.from({ length: count }, (_, i) => event(`e${i}`, i * step, "quarter", String(i + 1), "notes", compound ? 1 : 0)) },
        }] }],
    },
  };
}
const measureOf = document => document.score.tracks[0].measures[0];
async function state(action = "read", payload) {
  return page.evaluate(({ action, payload }) => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    if (!svg) throw new Error("Real editor SVG missing");
    const key = Object.keys(svg).find(key => key.startsWith("__reactFiber$"));
    let store;
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const candidate = fiber.memoizedProps?.session;
      if (typeof candidate?.getState === "function" && candidate.getState().document) { store = candidate; break; }
    }
    if (!store) throw new Error("Real editor session missing");
    const current = store.getState();
    if (action === "replace") {
      const result = current.replaceDocument(typeof payload === "string" ? payload : JSON.stringify(payload), "file");
      return { ok: result.ok, errors: result.errors };
    }
    if (action === "execute") return current.execute(payload);
    if (action === "undo") { current.undo(); return; }
    if (action === "selection") { current.setSelection(payload); return; }
    if (action === "numberedRhythm") { current.setNumberedInputRhythm(payload); return; }
    if (action === "inputState") return { numberedInputRhythm: current.numberedInputRhythm, numberedInputRhythmExplicit: current.numberedInputRhythmExplicit, tabInputRhythmOverrides: current.tabInputRhythmOverrides };
    if (action === "point") {
      const visit = fiber => {
        if (!fiber) return null;
        const layout = fiber.memoizedProps?.layout;
        if (layout?.systems?.[0]?.measures) return layout;
        return visit(fiber.child) ?? visit(fiber.sibling);
      };
      let root = svg[key];
      while (root.return) root = root.return;
      const layout = visit(root.stateNode?.current ?? root);
      if (!layout) throw new Error("Rendered layout unavailable");
      const m = layout.systems.flatMap(system => system.measures).find(m => m.id === (payload.measureId ?? "measure"));
      let x, y;
      if (payload.layer === "tab") {
        const b = m.beats.find(b => b.id === payload.id);
        x = b.x; y = m.strings[(payload.string ?? 1) - 1].y1;
      } else {
        const slot = m.numberedInputSlots?.find(s => s.target.eventId === payload.id || s.startTick === payload.tick);
        if (!slot) throw new Error(`Rendered numbered gap missing: ${JSON.stringify(payload)}`);
        x = slot.anchorX; y = slot.y + slot.height / 2;
      }
      const point = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
      return { x: point.x, y: point.y };
    }
    return { document: current.document, history: current.historyDepth, selection: current.selection, numberedSelection: current.numberedSelection };
  }, { action, payload });
}
async function shot(name) {
  await page.screenshot({ path: new URL(`${name}.png`, output).pathname, animations: "disabled" });
  screenshots.push(`${name}.png`);
}
async function close() {
  if (await panel.count()) { await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" }); }
}
async function load(document = fixture()) {
  await close();
  const loaded = await state("replace", document);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
  await page.locator('svg[aria-label="六线谱编辑器"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-layer="score-music"]'));
}
async function numbered(id = "e0", modifiers = []) {
  const glyph = page.locator(`text[data-numbered-event="${id}"]`).first();
  await glyph.waitFor();
  await glyph.click({ modifiers });
}
async function gap(tick) {
  const point = await state("point", { layer: "numbered", tick });
  await page.mouse.click(point.x, point.y);
}
async function tab(id = "b0", modifiers = []) {
  const point = await state("point", { layer: "tab", id });
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.mouse.click(point.x, point.y);
  for (const modifier of modifiers) await page.keyboard.up(modifier);
}
async function open(template) {
  await trigger.click(); await panel.waitFor();
  // The host measures its portal and schedules autofocus in requestAnimationFrame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (template) await panel.locator(`[data-rhythm-template="${template}"]`).click();
}
async function apply() {
  const button = panel.getByRole("button", { name: "应用节奏型", exact: true });
  assert.equal(await button.isDisabled(), false, await panel.innerText());
  await button.click();
  await panel.waitFor({ state: "hidden" });
  await triggerFocus();
}
async function triggerFocus() {
  await page.waitForFunction(() => document.activeElement?.matches('[data-tool-trigger="beat"]'), undefined, { timeout: 2500 });
}
async function saveReload(filename) {
  const committed = (await state()).document;
  const download = await downloadScoreJson(page), path = new URL(filename, output).pathname;
  await download.saveAs(path);
  const serialized = await readFile(path, "utf8");
  assert.deepEqual(JSON.parse(serialized), committed);
  await load(serialized);
  assert.deepEqual((await state()).document, committed);
  return committed;
}
async function fillNumberedGap(tick, token) {
  await gap(tick);
  const input = page.getByRole("textbox", { name: "简谱内容", exact: true }).filter({ visible: true }).first();
  await input.waitFor(); await input.fill(token);
  await page.getByRole("button", { name: "应用简谱内容", exact: true }).filter({ visible: true }).first().click();
  await page.waitForFunction(({ tick, token }) => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    for (let f = svg[Object.keys(svg).find(k => k.startsWith("__reactFiber$"))]; f; f = f.return) {
      const s = f.memoizedProps?.session?.getState?.();
      if (s?.document) return s.document.score.tracks[0].measures[0].numberedVoice.events.some(e => e.tick === tick && e.items.some(i => i.token === token));
    }
  }, { tick, token });
}
async function check(name, work) {
  if (filter && !filter.test(name)) return;
  try { const evidence = await work(); checks.push({ name, passed: true, ...(evidence ? { evidence } : {}) }); }
  catch (error) {
    const activeElement = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, id: el.id, label: el.getAttribute("aria-label"), html: el.outerHTML.slice(0, 500) } : null;
    }).catch(() => null);
    checks.push({ name, passed: false, error: error.stack ?? String(error), activeElement });
    await shot(`failure-${checks.length}`).catch(() => {});
    console.error(`FAIL ${name}: ${error.message}`);
  }
  console.log(`${checks.at(-1).passed ? "PASS" : "FAIL"} ${name}`);
}
const shape = events => events.map(e => [e.tick, e.kind, e.rhythm.base, e.rhythm.dots]);
const duration = e => ({ whole: 3840, half: 1920, quarter: 960, eighth: 480, sixteenth: 240, thirtySecond: 120 }[e.rhythm.base] * (e.rhythm.dots ? 1.5 : 1));
try {
  await mkdir(output, { recursive: true });
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("application", { name: "六线谱编辑器" }).waitFor();

  await check("无目标时按当前拍号浏览 12/5 模板，应用保持禁用", async () => {
    for (const [signature, count] of [["4/4", 12], ["6/8", 5]]) {
      await load(fixture(signature)); await open();
      assert.equal(await panel.locator("[data-rhythm-template]").count(), count);
      assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
      await panel.locator("[data-rhythm-template]").last().click();
      assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
      assert.equal((await state()).history.past, 0);
      await shot(`00-browse-without-target-${signature.replace("/", "-")}`);
      await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" }); await triggerFocus();
    }
  });

  await check("简谱直接点击后可打开并应用节奏型（干净编辑浮层不阻塞）", async () => {
    await load(); await numbered("e0"); await open();
    await shot("00-direct-numbered-click-ready");
    await apply();
    assert.equal((await state()).history.past, 1);
    await page.getByRole("button", { name: "操作历史", exact: true }).click();
    await page.locator("[data-history-panel]").getByText("应用节奏型", { exact: true }).waitFor();
    await shot("00b-rhythm-history-label");
    await page.getByRole("button", { name: "关闭操作历史", exact: true }).click();
  });

  await check("真实入口、12 模板、四分音符生成八分与两个十六分空位、歌词四段与和弦隔离", async () => {
    const original = fixture(); await load(original); await numbered(); await open();
    assert.equal(await trigger.getAttribute("aria-label"), "节奏型工具");
    assert.equal(await panel.locator("[data-rhythm-template]").count(), 12);
    assert.match(await panel.innerText(), /第 1 小节 · 第 1 拍/);
    assert.match(await panel.getByRole("img", { name: /^应用后简谱/ }).getAttribute("aria-label"), /1，1\/8；待填空位，1\/16；待填空位，1\/16/);
    assert.equal((await state()).history.past, 0);
    await shot("01-numbered-quarter-preview-1440x1000");
    await apply();
    const result = await state(), m = measureOf(result.document);
    assert.deepEqual(shape(m.numberedVoice.events.slice(0, 3)), [[0, "notes", "eighth", 0], [480, "gap", "sixteenth", 0], [720, "gap", "sixteenth", 0]]);
    assert.deepEqual(m.numberedVoice.events[0].items, measureOf(original).numberedVoice.events[0].items);
    for (const key of ["beats", "lyrics", "chordSymbols"]) assert.deepEqual(m[key], measureOf(original)[key]);
    assert.equal(result.history.past, 1);
    await state("undo"); assert.deepEqual((await state()).document, original);
  });

  await check("双八音按顺序只保留一次，复音不拆分", async () => {
    const d = fixture(), m = measureOf(d);
    m.numberedVoice.events.splice(0, 1, event("first", 0, "eighth", "#4'"), event("second", 480, "eighth", "6."));
    m.numberedVoice.events[0].items.push({ id: "poly", token: "3" });
    m.lyrics.forEach(lyric => { lyric.eventId = "first"; });
    await load(d); await numbered("first"); await open(); await apply();
    const events = measureOf((await state()).document).numberedVoice.events.slice(0, 3);
    assert.deepEqual(events.slice(0, 2).map(e => [e.id, e.tick, e.items]), m.numberedVoice.events.slice(0, 2).map((e, i) => [e.id, i * 480, e.items]));
    assert.deepEqual(events.map(e => e.rhythm.base), ["eighth", "sixteenth", "sixteenth"]);
    assert.equal(events[2].kind, "gap");
  });

  await check("12 个 4/4 模板逐个真实应用，包括小切分和四类三十二分", async () => {
    const expected = {
      quarter: [960], eighths: [480, 480], "eight-sixteen": [480, 240, 240], "sixteen-eight": [240, 240, 480],
      sixteenths: [240, 240, 240, 240], "dotted-eight": [720, 240], "small-syncopation": [240, 480, 240], "reverse-dotted": [240, 720],
      "dotted-two-thirtyseconds": [720, 120, 120], "two-thirtyseconds-dotted": [120, 120, 720],
      "eighth-four-thirtyseconds": [480, 120, 120, 120, 120], "four-thirtyseconds-eighth": [120, 120, 120, 120, 480],
    };
    const failures = [];
    for (const [id, durations] of Object.entries(expected)) {
      try {
      await load(); await numbered(); await open(id);
      if (id === "small-syncopation") await shot("02-small-syncopation");
      if (id === "eighth-four-thirtyseconds") await shot("03-thirtyseconds");
      await apply();
      const result = await state(), events = measureOf(result.document).numberedVoice.events.filter(e => e.tick < Q);
      assert.deepEqual(events.map(duration), durations, id);
      assert.equal(events.filter(e => e.kind === "notes").length, 1, id);
      assert.equal(events[0].id, "e0", id);
      assert.equal(result.history.past, id === "quarter" ? 0 : 1, id);
      } catch (error) {
        failures.push({ id, message: error.message });
        await shot(`failure-template-${id}`);
      }
    }
    assert.deepEqual(failures, []);
    return Object.keys(expected);
  });

  await check("6/8 仅五模板，附点四分演奏拍时值正确", async () => {
    const expected = { "dotted-quarter": [1440], "three-eighths": [480, 480, 480], "quarter-eight": [960, 480], "eight-quarter": [480, 960], "six-sixteenths": [240, 240, 240, 240, 240, 240] };
    for (const [id, durations] of Object.entries(expected)) {
      await load(fixture("6/8")); await numbered(); await open(id);
      assert.deepEqual(await panel.locator("[data-rhythm-template]").evaluateAll(nodes => nodes.map(node => node.dataset.rhythmTemplate)), Object.keys(expected));
      if (id === "three-eighths") await shot("04-compound-6-8-five-templates");
      await apply();
      assert.deepEqual(measureOf((await state()).document).numberedVoice.events.filter(e => e.tick < 1440).map(duration), durations, id);
    }
  });

  await check("标记先应用进入确认，返回与取消零写入，确认单历史且撤销恢复", async () => {
    const d = fixture(); d.score.tracks[0].numberedMarks = [
      { id: "tie", type: "tie", fromItemId: "e0-i", toItemId: "e1-i" },
      { id: "slur", type: "slur", fromEventId: "e0", toEventId: "e2" },
      { id: "fermata", type: "fermata", eventId: "e0" },
      { id: "outside", type: "fermata", eventId: "e3" },
    ];
    measureOf(d).numberedVoice.events[1].items[0].token = "1";
    await load(d); await numbered(); await open(); const before = await state();
    await panel.getByRole("button", { name: "应用节奏型", exact: true }).click();
    await panel.getByRole("button", { name: "确认调整", exact: true }).waitFor();
    assert.match(await panel.innerText(), /延音线（跨范围）.*圆滑线（跨范围）.*延长记号/);
    assert.deepEqual(await state(), before);
    await shot("05-marks-confirm-no-write");
    await panel.getByRole("button", { name: "返回预览", exact: true }).click();
    await panel.getByRole("button", { name: /^取\s*消$/ }).click();
    await panel.waitFor({ state: "hidden" }); await triggerFocus();
    assert.deepEqual(await state(), before);
    await open(); await panel.getByRole("button", { name: "应用节奏型", exact: true }).click();
    await panel.getByRole("button", { name: "确认调整", exact: true }).click(); await panel.waitFor({ state: "hidden" });
    await triggerFocus();
    assert.equal((await state()).history.past, 1);
    assert.deepEqual((await state()).document.score.tracks[0].numberedMarks.map(mark => mark.id), ["outside"]);
    await state("undo"); assert.deepEqual((await state()).document, d);
  });

  await check("简谱真实 Shift 连选多拍后逐拍保留内容，单次历史", async () => {
    await load(); await numbered("e0"); await numbered("e2", ["Shift"]); await open();
    assert.match(await panel.innerText(), /第 1–3 拍/);
    await shot("06-numbered-shift-three-beats"); await apply();
    const s = await state(), events = measureOf(s.document).numberedVoice.events;
    for (let i = 0; i < 3; i++) {
      const perBeat = events.filter(e => e.tick >= i * Q && e.tick < (i + 1) * Q);
      assert.deepEqual(perBeat.map(e => [e.tick - i * Q, e.kind]), [[0, "notes"], [480, "gap"], [720, "gap"]]);
      assert.equal(perBeat[0].id, `e${i}`);
      assert.equal(perBeat[0].items[0].token, String(i + 1));
    }
    assert.equal(s.history.past, 1);
  });

  await check("超额内容与跨界长音阻止应用且文档历史不变", async () => {
    const overflow = fixture(), m = measureOf(overflow);
    m.numberedVoice.events.splice(0, 1, ...[0, 1, 2, 3].map(i => event(`dense${i}`, i * 240, "sixteenth", String(i + 1))));
    m.lyrics = [];
    await load(overflow); await numbered("dense0"); await open();
    assert.match(await panel.innerText(), /第 1 拍有 4 个内容/);
    assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
    assert.deepEqual((await state()).document, overflow); assert.equal((await state()).history.past, 0);
    await shot("07-overflow-blocked");
    const crossing = fixture(); measureOf(crossing).numberedVoice.events.splice(0, 2, event("long", 0, "half")); measureOf(crossing).lyrics = [];
    await load(crossing); await numbered("long"); await open();
    assert.match(await panel.innerText(), /跨.*范围|扩大选区/);
    assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
    assert.deepEqual((await state()).document, crossing); assert.equal((await state()).history.past, 0);
  });

  await check("真实 Shift 跨小节选区阻止应用，不写文档或历史", async () => {
    const d = fixture(), outside = structuredClone(measureOf(d));
    outside.id = "outside"; outside.lyrics = []; outside.chordSymbols = [];
    outside.numberedVoice.events.forEach(e => { e.id = `outside-${e.id}`; e.items.forEach(i => { i.id = `outside-${i.id}`; }); });
    outside.beats.forEach(b => { b.id = `outside-${b.id}`; b.notes.forEach(n => { n.id = `outside-${n.id}`; }); });
    d.score.tracks[0].measures.push(outside);
    await load(d); await numbered("e3"); await numbered("outside-e0", ["Shift"]); await open();
    assert.match(await panel.innerText(), /跨越小节/);
    assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
    assert.deepEqual((await state()).document, d); assert.equal((await state()).history.past, 0);
    await shot("07b-cross-measure-blocked");
  });

  await check("TAB 真实点击与 Shift 多拍，六弦内容保留且不改简谱歌词和弦", async () => {
    const d = fixture(); await load(d); await tab("b0"); await tab("b1", ["Shift"]); await open();
    assert.match(await panel.innerText(), /六线谱 · 第 1 小节 · 第 1–2 拍/);
    await shot("08-tab-two-beats-six-strings"); await apply();
    const s = await state(), m = measureOf(s.document);
    for (const key of ["numberedVoice", "lyrics", "chordSymbols"]) assert.deepEqual(m[key], measureOf(d)[key]);
    for (let i = 0; i < 2; i++) {
      const perBeat = m.beats.filter(b => b.tick >= i * Q && b.tick < (i + 1) * Q);
      assert.deepEqual(perBeat.map(b => [b.tick - i * Q, b.rhythm.base, b.notes.length]), [[0, "eighth", 6], [480, "sixteenth", 0], [720, "sixteenth", 0]]);
      assert.deepEqual(perBeat[0].notes, measureOf(d).beats[i].notes);
    }
    assert.equal(s.history.past, 1);
  });

  await check("目标与选区改变使旧预览失效，重新计算才可应用", async () => {
    await load(); await tab(); await open();
    const cell = { trackId: "track", measureId: "measure", beatId: "b1", string: 1 };
    await state("selection", { anchor: cell, focus: cell });
    await panel.getByRole("button", { name: "重新计算预览", exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
    assert.equal((await state()).history.past, 0);
    await shot("09-stale-selection");
    await panel.getByRole("button", { name: "重新计算预览", exact: true }).click();
    assert.match(await panel.innerText(), /第 2 拍/); await apply();
    assert.equal(measureOf((await state()).document).beats.find(b => b.id === "b0").rhythm.base, "quarter");
    assert.equal(measureOf((await state()).document).beats.find(b => b.id === "b1").rhythm.base, "eighth");
  });

  await check("TAB 重排后预览和弦跟随真实新 beat tick", async () => {
    const d = fixture(), m = measureOf(d);
    m.beats.splice(0, 1, beat("b0", 0, "eighth", [0, 1, 2, 3, 4, 5]), beat("chord-beat", 480, "eighth", [5, 4, 3, 2, 1, 0]));
    m.chordSymbols[0].beatId = "chord-beat";
    await load(d); await tab("b0"); await open("sixteen-eight");
    const chordX = label => panel.getByRole("img", { name: new RegExp(`^${label}六线谱`) }).locator("text").filter({ hasText: /^C$/ }).getAttribute("x");
    assert.equal(Number(await chordX("当前")), 155);
    assert.equal(Number(await chordX("应用后")), 87.5);
    await shot("08b-tab-preview-chord-new-tick"); await apply();
    const next = measureOf((await state()).document);
    assert.equal(next.beats.find(b => b.id === "chord-beat").tick, 240);
    assert.deepEqual(next.chordSymbols, m.chordSymbols);
    assert.deepEqual(next.numberedVoice, m.numberedVoice);
    assert.deepEqual(next.lyrics, m.lyrics);
  });

  await check("undo 与文档改变使旧预览失效，重新计算恢复", async () => {
    await load();
    assert.equal((await state("execute", { type: "score.setInfo", title: "外部已提交", arranger: "browser", keySignature: "C" })).ok, true);
    await numbered(); await open(); await state("undo");
    await panel.getByRole("button", { name: "重新计算预览", exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
    await panel.getByRole("button", { name: "重新计算预览", exact: true }).click();
    assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), false);
    assert.equal((await state("execute", { type: "score.setInfo", title: "预览后改变", arranger: "browser", keySignature: "C" })).ok, true);
    await panel.getByRole("button", { name: "重新计算预览", exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
    await panel.getByRole("button", { name: "重新计算预览", exact: true }).click(); await apply();
    assert.equal((await state()).document.score.title, "预览后改变");
  });

  await check("双击与重复应用不产生额外历史", async () => {
    await load(); await numbered(); await open();
    await panel.getByRole("button", { name: "应用节奏型", exact: true }).dblclick();
    await panel.waitFor({ state: "hidden" });
    await triggerFocus();
    assert.equal((await state()).history.past, 1);
    await numbered(); await open(); await apply();
    assert.equal((await state()).history.past, 1);
  });

  await check("键盘 Escape 关闭并返回节奏型入口焦点", async () => {
    await load(); await tab();
    await open(); await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" });
    await triggerFocus();
    return await trigger.evaluate(el => ({ focused: document.activeElement === el, active: document.activeElement?.outerHTML }));
  });

  await check("真实导出文件保存重载后 UI 点击空位补音继承十六分", async () => {
    await load(); await numbered(); await open(); await apply();
    const committed = (await state()).document;
    const download = await downloadScoreJson(page), path = new URL("saved-score.lxm.json", output).pathname;
    await download.saveAs(path);
    const serialized = await readFile(path, "utf8"), parsed = JSON.parse(serialized);
    assert.deepEqual(parsed, committed);
    await load(serialized); assert.deepEqual((await state()).document, committed);
    await gap(480);
    const input = page.getByRole("textbox", { name: "简谱内容", exact: true }).filter({ visible: true }).first();
    await input.waitFor(); await input.fill("7");
    await page.getByRole("button", { name: "应用简谱内容", exact: true }).filter({ visible: true }).first().click();
    await page.waitForFunction(() => {
      const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
      for (let f = svg[Object.keys(svg).find(k => k.startsWith("__reactFiber$"))]; f; f = f.return) {
        const s = f.memoizedProps?.session?.getState?.();
        if (s?.document) return s.document.score.tracks[0].measures[0].numberedVoice.events.some(e => e.tick === 480 && e.items.some(i => i.token === "7"));
      }
    });
    const m = measureOf((await state()).document), filled = m.numberedVoice.events.find(e => e.tick === 480);
    assert.equal(filled.kind, "notes"); assert.deepEqual(filled.rhythm, rhythm("sixteenth"));
    assert.deepEqual(m.lyrics, measureOf(committed).lyrics);
    assert.deepEqual(m.chordSymbols, measureOf(committed).chordSymbols);
    await shot("10-export-reload-gap-filled");
    return { saved: "saved-score.lxm.json", filledTick: 480, rhythm: filled.rhythm };
  });

  await check("旧显式二分偏好不覆盖保存重载后的简谱十六分空位，其余空位不变", async () => {
    await load();
    await state("numberedRhythm", rhythm("half"));
    assert.equal((await state("inputState")).numberedInputRhythmExplicit, true);
    await numbered(); await open(); await apply();
    const committed = await saveReload("saved-numbered-explicit-rhythm.lxm.json");
    // File import intentionally resets session preferences: restore the user's old
    // explicit preference before clicking the saved score's real input slot.
    await state("numberedRhythm", rhythm("half"));
    assert.deepEqual((await state("inputState")).numberedInputRhythm, rhythm("half"));
    const before = measureOf(committed);
    await fillNumberedGap(480, "7");
    const next = measureOf((await state()).document), filled = next.numberedVoice.events.find(e => e.tick === 480);
    assert.equal(filled.id, before.numberedVoice.events.find(e => e.tick === 480).id);
    assert.equal(filled.kind, "notes"); assert.deepEqual(filled.rhythm, rhythm("sixteenth"));
    assert.deepEqual(next.numberedVoice.events.filter(e => e.tick !== 480), before.numberedVoice.events.filter(e => e.tick !== 480));
    for (const key of ["beats", "lyrics", "chordSymbols"]) assert.deepEqual(next[key], before[key]);
    assert.equal((await state()).history.past, 1);
    await shot("12-numbered-gap-old-explicit-half");
    return { explicitPreference: "half", filledTick: 480, savedRhythm: "sixteenth", allOtherEventsUnchanged: true };
  });

  await check("TAB 三十二分/十六分空拍保存重载后 UI 补音保持时值，不继承同tick简谱四分", async () => {
    const cases = [];
    for (const [templateId, fillTick, expectedBase] of [["two-thirtyseconds-dotted", 120, "thirtySecond"], ["eight-sixteen", 480, "sixteenth"]]) {
      const d = fixture(), m = measureOf(d);
      // One retained TAB group creates empty template beats. A numbered quarter
      // starts exactly at the gap and would otherwise swallow its later slots.
      m.chordSymbols = []; m.lyrics = [];
      m.numberedVoice.events = [event("conflicting-numbered", fillTick, "quarter", "6")];
      await load(d); await tab("b0"); await open(templateId); await apply();
      const committed = await saveReload(`saved-tab-${templateId}.lxm.json`), before = measureOf(committed);
      const empty = before.beats.find(b => b.tick === fillTick);
      assert.equal(empty.notes.length, 0); assert.deepEqual(empty.rhythm, rhythm(expectedBase));
      assert.equal(empty.preserveInputRhythm, true);
      assert.deepEqual((await state("inputState")).tabInputRhythmOverrides, []);
      await tab(empty.id);
      await page.getByRole("application", { name: "六线谱编辑器" }).press("7");
      await page.waitForFunction(id => {
        const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
        for (let f = svg[Object.keys(svg).find(k => k.startsWith("__reactFiber$"))]; f; f = f.return) {
          const s = f.memoizedProps?.session?.getState?.();
          if (s?.document) return s.document.score.tracks[0].measures[0].beats.find(b => b.id === id)?.notes.some(n => n.string === 1 && n.fret === 7);
        }
      }, empty.id);
      const next = measureOf((await state()).document), filled = next.beats.find(b => b.id === empty.id);
      assert.equal(filled.tick, fillTick); assert.deepEqual(filled.rhythm, rhythm(expectedBase));
      assert.equal(filled.preserveInputRhythm, true);
      assert.deepEqual(next.beats.filter(b => b.id !== empty.id), before.beats.filter(b => b.id !== empty.id));
      for (const key of ["numberedVoice", "lyrics", "chordSymbols"]) assert.deepEqual(next[key], before[key]);
      assert.equal((await state()).history.past, 1);
      await shot(`13-tab-gap-preserved-${expectedBase}`);
      cases.push({ templateId, fillTick, expectedBase, preservedAcrossFile: true, sameTickNumbered: "quarter", allOtherBeatsUnchanged: true });
    }
    return cases;
  });

  await check("1440×1000 与 1400×720 紧凑布局，面板及操作区无裁切溢出", async () => {
    const measurements = [];
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1400, height: 720 }]) {
      await page.setViewportSize(viewport); await load(); await numbered(); await open();
      const result = await panel.evaluate(el => {
        const r = el.getBoundingClientRect(), footer = el.querySelector("footer").getBoundingClientRect();
        const cards = [...el.querySelectorAll("[data-rhythm-template]")];
        return { panel: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
          footer: { bottom: footer.bottom, top: footer.top }, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          pageScrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportHeight: innerHeight,
          cardRows: new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size,
          overflowingCards: cards.filter(card => card.scrollWidth > card.clientWidth + 1).length };
      });
      assert.ok(result.panel.x >= 0 && result.panel.y >= 0 && result.panel.right <= viewport.width + 1 && result.panel.bottom <= viewport.height + 1, JSON.stringify(result));
      assert.ok(result.footer.bottom <= viewport.height + 1, JSON.stringify(result));
      assert.ok(result.scrollWidth <= result.clientWidth + 1, JSON.stringify(result));
      assert.ok(result.pageScrollWidth <= viewport.width + 1, JSON.stringify(result));
      assert.equal(result.overflowingCards, 0, JSON.stringify(result));
      assert.ok(result.cardRows <= 3);
      measurements.push({ viewport, ...result }); await shot(`11-layout-${viewport.width}x${viewport.height}`);
    }
    return measurements;
  });

  await check("TAB 延音横线不被短模板改写，保留单位拍模板可正常应用", async () => {
    const d = fixture(), m = measureOf(d);
    m.beats[0].notes = [{ id: "continuation-note", string: 3, fret: "-" }];
    await load(d); await tab("b0"); await open("eight-sixteen");
    assert.match(await panel.innerText(), /延音横线须保持一个单位拍/);
    assert.equal(await panel.getByRole("button", { name: "应用节奏型", exact: true }).isDisabled(), true);
    assert.equal((await state()).history.past, 0);
    assert.deepEqual(measureOf((await state()).document).beats, m.beats);
    await shot("14-tab-continuation-fixed-rhythm");
    await panel.locator('[data-rhythm-template="quarter"]').click();
    await apply();
    assert.equal((await state()).history.past, 0);
    assert.deepEqual(measureOf((await state()).document).beats, m.beats);
  });

  await check("真实 Next 无 pageerror", async () => { assert.deepEqual(pageErrors, []); });
} catch (error) {
  checks.push({ name: "browser setup", passed: false, error: error.stack ?? String(error) });
  await shot("failure-setup").catch(() => {});
} finally {
  const result = { passed: checks.length > 0 && checks.every(check => check.passed) && pageErrors.length === 0, url, implementation: "Real Next UI and real React fiber session; fixtures loaded by production replaceDocument/loader; no product hooks or adapter injection", checks, pageErrors, consoleErrors, screenshots: [...new Set(screenshots)],
    ...(filter ? { incrementalVerification: { filter: filter.source, retainedPreviousChecks: previous?.checks?.filter(check => !filter.test(check.name)).length ?? 0 } } : {}),
    limitations: ["Adapter failure/retry injection intentionally omitted: no stable public failure adapter is exposed; no production test hooks added."] };
  await writeFile(new URL("result.json", output), JSON.stringify(result, null, 2));
  // This dedicated directory contains only this script's evidence. Keep the
  // most recent run's screenshots so old failures cannot be mistaken for current.
  for (const file of await readdir(output)) {
    if (file.endsWith(".png") && !screenshots.includes(file)) await unlink(new URL(file, output));
  }
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!result.passed) process.exitCode = 1;
}
