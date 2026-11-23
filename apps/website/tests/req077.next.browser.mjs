import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { confirmScoreImport, downloadScoreJson, openScoreImport } from "./score-file-actions.browser.cjs";

const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const Q = 960;
const rhythm = { base: "quarter", dots: 0 };
const examples = [
  { id: "m1", frets: [12, 3, 4, 5, 6, 7], leading: 14, trailing: 15, chord: "G",
    panel: "toolbar", template: "beat-strum-uud", offsets: [0, 480, 720],
    durations: ["eighth", "sixteenth", "sixteenth"], slots: ["up", "hold", "up", "down"] },
  { id: "m2", frets: [18, 8, 9, 10, 11, 13], leading: 16, trailing: 19, chord: "C",
    panel: "sidebar", template: "beat-strum-udud", offsets: [0, 240, 480, 720],
    durations: Array(4).fill("sixteenth"), slots: ["up", "down", "up", "down"] },
];
const glyphs = { up: "↓", down: "↑", hold: "–" };
const measure = ({ id, frets, leading, trailing, chord }, index) => ({
  id, timeSignature: { numerator: index === 0 ? 4 : 3, denominator: 4 }, barline: "single", tuplets: [],
  beats: [[leading], frets, [trailing], ...(index === 0 ? [[]] : [])].map((voicing, index) => ({
    id: `${id}-b${index}`, tick: Q * index, kind: "notes", rhythm,
    notes: voicing.map((fret, string) => ({
      id: `${id}-b${index}-n${string}`, string: string + 1, fret,
    })),
  })),
  chordSymbols: [{ id: `${id}-chord`, beatId: `${id}-b1`, display: "name", chord: { name: chord, diagram: null } }],
  numberedVoice: { events: [{ id: `${id}-event`, tick: 0, rhythm, kind: "notes", items: [{ id: `${id}-item`, token: "1" }] }], tuplets: [] },
  lyrics: [{ id: `${id}-lyric`, eventId: `${id}-event`, verse: 1, text: "词" }],
});
const fixture = {
  schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
  score: { id: "score", title: "扫弦模板验收", arranger: "", keySignature: "C", meta: {}, tracks: [{
    id: "track", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
    tuning: { strings: ["E4", "B3", "G3", "D3", "A2", "E2"].map((pitch, index) => ({
      index: index + 1, pitch, midi: [64, 59, 55, 50, 45, 40][index],
    })) },
    numberedMarks: [], techniques: examples.map(({ id }) => ({ id: `${id}-vibrato`, type: "vibrato", fromNoteId: `${id}-b2-n0` })),
    measures: examples.map(measure),
  }] },
};

// 两个小节使用相同的八分、十六分、十六分节奏。第二小节保留扫弦箭头，但使用无音高的休止拍。
const rangeFixture = structuredClone(fixture);
const rangeTrack = rangeFixture.score.tracks[0];
const rangeCases = rangeTrack.measures.map((measure, index) => {
  const [leading, source, ...trailing] = measure.beats;
  const hasVoicing = index === 0;
  const attackIds = [];
  const attacks = examples[0].offsets.map((offset, attack) => {
    const beatId = `${measure.id}-attack-${attack}`;
    const id = `${beatId}-strum`;
    attackIds.push(id);
    rangeTrack.techniques.push({
      type: "strum", id, beatId,
      stroke: ["up", "up", "down"][attack], minString: 1, maxString: 6, showFrets: true,
    });
    return {
      ...source, id: beatId, tick: Q + offset,
      kind: hasVoicing ? "notes" : "rest",
      rhythm: { base: examples[0].durations[attack], dots: 0 },
      notes: hasVoicing ? source.notes.map((note, string) => ({ ...note, id: `${beatId}-n${string}` })) : [],
    };
  });
  measure.beats = [leading, ...attacks, ...trailing];
  measure.chordSymbols[0].beatId = attacks[0].id;
  return { description: hasVoicing ? "pitched strums" : "strums on rests", attackIds };
});

try {
  await page.goto(process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor");
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const scoreMusic = score.locator('[data-layer="score-music"]');
  const panels = {
    toolbar: page.locator('[data-rhythm-pattern-panel][data-presentation="toolbar"]'),
    sidebar: page.getByRole("region", { name: "常见节奏型" }),
  };
  const trigger = page.locator('[data-tool-trigger="beat"]');
  const button = (panel, name) => panel.getByRole("button", { name, exact: true });
  const fret = (value) => scoreMusic.getByText(String(value), { exact: true });
  const card = (panel, id) => panel.locator(`button[data-strum-template="${id}"]`);
  const chooseCard = async (panel, id) => {
    if (!await card(panel, id).isVisible()) await panel.locator('[data-rhythm-toggle="strum"]').click();
    await card(panel, id).click();
  };
  const strumTab = panel => panel.getByRole("tab", { name: "扫弦节奏型", exact: true });
  const regularTab = panel => panel.getByRole("tab", { name: "普通节奏型", exact: true });
  const expectPanels = async (selectedTemplate) => {
    for (const panel of Object.values(panels)) {
      await panel.waitFor();
      assert.equal(await panel.getByRole("tab").count(), 2);
      assert.equal(await strumTab(panel).getAttribute("aria-selected"), "true");
      assert.equal(await panel.locator("[data-rhythm-template]:visible").count(), 0);
      for (const { template, slots } of examples) {
        await panel.locator(`button[data-strum-template="${template}"][aria-pressed="${template === selectedTemplate}"]`).waitFor({ state: "attached" });
        const cells = await card(panel, template).locator("[data-strum-stroke]").evaluateAll((elements) =>
          elements.map((element) => [element.dataset.strumStroke, element.textContent]));
        assert.deepEqual(cells, slots.map((stroke) => [stroke, glyphs[stroke]]));
      }
    }
  };
  const snap = (load) => score.evaluate((svg, load) => {
    const key = Object.keys(svg).find((name) => name.startsWith("__reactFiber$"));
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const state = fiber.memoizedProps?.session?.getState();
      if (!state?.document) continue;
      if (load) return state.replaceDocument(JSON.stringify(load), "file");
      return { document: state.document, selection: state.selection, history: state.pastEntries.length };
    }
    throw new Error("Editor session unavailable");
  }, load);
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    return svg && Object.keys(svg).some((key) => key.startsWith("__reactFiber$"));
  });
  assert.equal((await snap(fixture)).ok, true);
  for (const [index, example] of examples.entries()) {
    const { id, frets, leading, trailing, panel, template, offsets, durations, slots } = example;
    const firstString = fret(frets[0]);
    await firstString.click();
    const before = await snap();
    assert.deepEqual(before.selection.anchor, before.selection.focus);
    assert.equal(before.selection.focus.measureId, id);
    assert.equal(before.selection.focus.beatId, `${id}-b1`);
    assert.equal(before.selection.focus.string, 1);
    if (!(await panels.toolbar.isVisible())) await trigger.click();
    await regularTab(panels.toolbar).click();
    await panels.toolbar.locator("[data-rhythm-template]:visible").first().waitFor();
    assert.equal(await panels.toolbar.locator("[data-strum-template]:visible").count(), 0);
    await strumTab(panels.toolbar).click();
    await expectPanels();
    if (panel === "toolbar") {
      await chooseCard(panels.toolbar, template);
      await panels.toolbar.getByRole("button", { name: /^取\s*消$/ }).click();
      await panels.toolbar.waitFor({ state: "hidden" });
      assert.deepEqual(await snap(), before);
      await trigger.click();
      await expectPanels();
    }

    const source = panels[panel];
    await source.locator('[data-strum-template]:visible').first().waitFor();
    const toggle = source.locator('[data-rhythm-toggle="strum"]');
    if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
    assert.deepEqual(await source.locator('[data-strum-template]:visible').evaluateAll(cards => cards.map(card => card.dataset.strumTemplate)),
      ["d", "ddu", "dudu", "dud", "du", "dud-sync"].map(id => `beat-strum-${id}`));
    await source.locator('[data-rhythm-toggle="strum"]').click();
    assert.equal(await source.locator('[data-strum-template]:visible').count(), 12);
    await chooseCard(source, panel === "toolbar" ? examples[1].template : examples[0].template);
    await chooseCard(source, template);
    assert.deepEqual(await snap(), before, "Choosing a card must leave the beat and undo history untouched");
    await button(source, "应用").click();
    await firstString.nth(offsets.length - 1).waitFor();
    await source.locator(`[data-strum-template="${template}"][aria-pressed="true"]`).waitFor({ state: "attached" });
    if (panel === "sidebar" && !(await panels.toolbar.isVisible())) await trigger.click();
    await expectPanels(template);
    assert.equal(await page.locator('[aria-modal="true"]:visible').count(), 0);

    const after = await snap();
    const [track] = after.document.score.tracks;
    const [original] = before.document.score.tracks;
    assert.equal(after.history, before.history + 1);
    assert.equal(after.document.documentRevision, before.document.documentRevision + 1);
    const { beats, ...measureFields } = track.measures[index];
    const { beats: originalBeats, ...originalFields } = original.measures[index];
    const attacks = beats.filter(({ tick }) => tick >= Q && tick < 2 * Q);
    assert.deepEqual(attacks.map(({ tick }) => tick - Q), offsets);
    assert.deepEqual(attacks.map(({ rhythm }) => rhythm), durations.map((base) => ({ base, dots: 0 })));
    assert.equal(attacks[0].id, originalBeats[1].id);
    const voicing = frets.map((fret, index) => ({ string: index + 1, fret }));
    for (const { notes } of attacks) {
      assert.deepEqual(notes.map(({ string, fret }) => ({ string, fret })).sort((a, b) => a.string - b.string), voicing);
    }
    const strums = track.techniques.filter(({ type }) => type === "strum");
    assert.equal(strums.length, attacks.length);
    assert.deepEqual(attacks.map(({ id }) => {
      const mark = strums.find(({ beatId }) => beatId === id);
      assert.ok(mark, `Missing strum for ${id}`);
      const { stroke, minString, maxString, showFrets } = mark;
      return { stroke, minString, maxString, showFrets };
    }), slots.filter((stroke) => stroke !== "hold").map((stroke) => ({ stroke, minString: 1, maxString: 6, showFrets: true })));
    assert.deepEqual(track.techniques.filter(({ type }) => type !== "strum"), original.techniques);
    assert.deepEqual(beats.filter(({ tick }) => tick < Q || tick >= 2 * Q), originalBeats.filter(({ tick }) => tick !== Q));
    assert.deepEqual(measureFields, originalFields);
    assert.deepEqual(track.measures[1 - index], original.measures[1 - index]);
    assert.equal(await fret(leading).count(), 1);
    assert.equal(await fret(trailing).count(), 1);
    const attackXs = await firstString.evaluateAll(notes => notes.map(note => Number(note.getAttribute("x"))));
    const stringYs = await Promise.all(frets.map(async (value) => {
      const positions = await fret(value).evaluateAll((notes, xs) => notes.filter(note => xs.includes(Number(note.getAttribute("x")))).map(note => Number(note.getAttribute("y"))), attackXs);
      assert.equal(positions.length, offsets.length);
      return positions[0];
    }));
    assert.ok(stringYs.every((y, index) => index === 0 || y > stringYs[index - 1]), "TAB strings run from 1 at the top to 6 at the bottom");
    const arrowheads = await scoreMusic.locator('polygon:not([data-strum-hit])').evaluateAll(nodes => nodes.map(node => [...node.points].map(({x, y}) => [x, y])));
    const directions = attackXs.map(x => {
      const triangle = arrowheads.filter(points => points.length === 3 && points[1][0] < x && x - points[1][0] < 25 &&
        points[1][1] >= stringYs[0] - 12 && points[1][1] <= stringYs.at(-1) + 12).sort((a,b) => b[1][0] - a[1][0])[0];
      assert.ok(triangle, `Missing TAB arrow at attack ${x}`);
      return triangle[1][1] > triangle[0][1] ? "up" : "down";
    });
    assert.deepEqual(directions, slots.filter(stroke => stroke !== "hold"));

    if (panel === "toolbar") {
      await button(panels.toolbar, "在侧栏展开").click();
      await panels.toolbar.waitFor({ state: "hidden" });
      await page.waitForFunction(node => node === document.activeElement, await strumTab(panels.sidebar).elementHandle());
      // 展开卡片后，编辑反馈可能覆盖侧栏底部的撤销按钮。
      const feedback = page.getByRole("button", { name: "关闭编辑反馈", exact: true });
      if (await feedback.isVisible()) await feedback.click();
      await button(panels.sidebar, "撤销应用").click();
    } else {
      await button(page, "撤销").click();
    }
    await firstString.nth(1).waitFor({ state: "detached" });
    const undone = await snap();
    assert.deepEqual(undone.document.score, before.document.score);
    assert.equal(undone.history, before.history);
  }
  // Each input is the same second beat, reached by moving right from the first.
  for (const kind of ["empty", "rest", "single", "subdivided"]) {
    const input = structuredClone(fixture);
    const track = input.score.tracks[0];
    const m = track.measures[0];
    const beat = m.beats[1];
    beat.notes = kind === "single" || kind === "subdivided" ? beat.notes.slice(0, 1) : [];
    if (kind === "rest") beat.kind = "rest";
    if (kind === "subdivided") {
      beat.rhythm = { base: "eighth", dots: 0 };
      m.beats.splice(2, 0, { ...beat, id: "old-offbeat", tick: Q * 1.5,
        notes: [{ id: "old-note", string: 3, fret: 9 }] });
      track.techniques.push({ type: "vibrato", id: "old-vibrato", fromNoteId: "old-note" });
    }
    assert.equal((await snap(input)).ok, true);
    await fret(examples[0].leading).click();
    await score.press("ArrowRight");
    const before = await snap();
    assert.equal(before.selection.focus.beatId, beat.id);
    if (!(await panels.toolbar.isVisible())) await trigger.click();
    await strumTab(panels.toolbar).click();
    await chooseCard(panels.toolbar, examples[0].template);
    assert.deepEqual(await snap(), before);
    await button(panels.toolbar, "应用").click();
    assert.equal(await page.locator('[aria-modal="true"]:visible').count(), 0);
    const after = await snap();
    assert.equal(after.history, before.history + 1, kind);
    const result = after.document.score.tracks[0];
    const attacks = result.measures[0].beats.filter(b => b.tick >= Q && b.tick < 2 * Q);
    assert.deepEqual(attacks.map(b => b.tick - Q), examples[0].offsets);
    assert.ok(attacks.every(b => b.kind === "rest" && b.notes.length === 0), `${kind} uses arrows without invented frets`);
    assert.deepEqual(result.techniques.filter(t => t.type === "strum").map(t => t.stroke), ["up", "up", "down"]);
    const triangles = await scoreMusic.locator("polygon:not([data-strum-hit])").evaluateAll(nodes => nodes.filter(node => node.points.length === 3).length);
    assert.ok(triangles >= attacks.length, `Expected an arrowhead for every ${kind} attack`);
    assert.deepEqual(result.measures[0].beats.filter(b => b.tick < Q || b.tick >= 2 * Q), m.beats.filter(b => b.tick < Q || b.tick >= 2 * Q));
    assert.deepEqual(result.measures[1], track.measures[1]);
    await button(panels.toolbar, "撤销应用").click();
    assert.deepEqual((await snap()).document.score, before.document.score, kind);
  }

  const rangeLoad = await snap(rangeFixture);
  assert.equal(rangeLoad.ok, true, rangeLoad.errors?.join("\n"));
  const inspector = page.getByRole("region", { name: "扫弦范围", exact: true });
  const rangeEnd = (name) => inspector.getByRole("combobox", { name, exact: true });
  const top = rangeEnd("上端弦");
  const bottom = rangeEnd("下端弦");
  const historyTools = page.getByRole("group", { name: "历史", exact: true });
  const hitArrow = (id) => score.locator(`polygon[data-strum-hit="arrow"][data-strum-id="${id}"]`);
  const altClickStem = async (id) => {
    const stem = score.locator(`[data-strum-hit="stem"][data-strum-id="${id}"]`);
    // 竖直符干的 SVG 几何宽度为零，通过坐标点击描边中点，保留真实的指针命中测试。
    const { x, y } = await stem.evaluate((node) => {
      const point = new DOMPoint(node.x1.baseVal.value, (node.y1.baseVal.value + node.y2.baseVal.value) / 2)
        .matrixTransform(node.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.keyboard.down("Alt");
    try {
      await page.mouse.click(x, y);
    } finally {
      await page.keyboard.up("Alt");
    }
  };
  const handle = (end, id, string) => score.locator(
    `[data-strum-handle="${end}"][data-strum-id="${id}"][data-strum-string="${string}"]`,
  );
  const markedInkIds = (attribute) => score.locator(`[${attribute}][data-strum-id]:not([${attribute}="false"])`)
    .evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.strumId))].sort());
  const expectSelected = async (ids) => {
    assert.deepEqual(await markedInkIds("data-strum-selected"), [...ids].sort());
    const active = await markedInkIds("data-strum-active");
    assert.equal(active.length, 1);
    assert.ok(ids.includes(active[0]), `Unexpected active strum ${active[0]}`);
    return active[0];
  };
  const expectScore = async (expected, history, message) => {
    const actual = await snap();
    assert.deepEqual(actual.document.score, expected, message);
    assert.equal(actual.history, history, message);
    return actual;
  };
  const ink = (id) => scoreMusic.locator(`:is(path, polygon)[data-strum-id="${id}"]:not([data-strum-hit])`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("d") ?? node.getAttribute("points")));
  const direction = (id) => scoreMusic.locator(`polygon[data-strum-id="${id}"]:not([data-strum-hit])`)
    .evaluate((arrow) => arrow.points[1].y > arrow.points[0].y ? "up" : "down");

  for (const { description, attackIds: [first, middle, last] } of rangeCases) {
    const before = await snap();
    await hitArrow(first).click();
    await expectSelected([first]);
    await altClickStem(last);
    const active = await expectSelected([first, last]);
    await expectScore(before.document.score, before.history, `${description}: selection only`);

    // 比对整个曲谱，确保只改选中两支箭头的端点。中间箭头、方向、音高和其他小节都属于比较内容。
    const expectedRange = (maxString) => {
      const edited = structuredClone(before.document.score);
      for (const technique of edited.tracks[0].techniques) {
        if (technique.id !== first && technique.id !== last) continue;
        technique.minString = 2;
        technique.maxString = maxString;
      }
      return edited;
    };
    assert.equal(await top.inputValue(), "1");
    assert.equal(await bottom.inputValue(), "6");
    await top.selectOption("2");
    const sideEdit = await expectScore(expectedRange(6), before.history + 1, `${description}: sidebar endpoint`);
    assert.equal(sideEdit.document.documentRevision, before.document.documentRevision + 1);
    await expectSelected([first, last]);
    const attackIds = [first, middle, last];
    const originalInk = await Promise.all(attackIds.map(ink));
    const expectDirections = async () => {
      assert.deepEqual(await Promise.all(attackIds.map(direction)), ["up", "up", "down"], description);
    };
    await expectDirections();

    // 按活动箭头两端的屏幕坐标推算目标谱线，避免写死缩放比例或弦距。
    const beginDrag = async () => {
      const upper = await handle("minString", active, 2).boundingBox();
      const lower = await handle("maxString", active, 6).boundingBox();
      assert.ok(upper && lower, `${description}: active handles`);
      const x = lower.x + lower.width / 2;
      const y = lower.y + lower.height / 2;
      const targetY = (y + upper.y + upper.height / 2) / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, targetY, { steps: 5 });
      await handle("maxString", active, 4).waitFor();
      const previewInk = await Promise.all(attackIds.map(ink));
      assert.notDeepEqual(previewInk[0], originalInk[0], `${description}: first arrow previews the endpoint`);
      assert.deepEqual(previewInk[1], originalInk[1], `${description}: skipped arrow has no preview`);
      assert.notDeepEqual(previewInk[2], originalInk[2], `${description}: last arrow previews the endpoint`);
      await expectDirections();
      assert.deepEqual(await snap(), sideEdit, `${description}: drag preview leaves document and history untouched`);
    };

    await beginDrag();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await handle("maxString", active, 6).waitFor();
    assert.deepEqual(await Promise.all(attackIds.map(ink)), originalInk, `${description}: canceled preview restores the SVG`);
    assert.deepEqual(await snap(), sideEdit, `${description}: canceled drag leaves document and history untouched`);

    await beginDrag();
    await score.locator('[data-layer="strum-interaction"]').evaluate((capture) => {
      capture.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
    });
    await page.mouse.up();
    assert.deepEqual(await Promise.all(attackIds.map(ink)), originalInk);
    assert.deepEqual(await snap(), sideEdit, `${description}: pointer cancellation discards the entire preview`);

    await beginDrag();
    await page.mouse.up();
    const dragEdit = await expectScore(expectedRange(4), before.history + 2, `${description}: completed drag`);
    assert.equal(dragEdit.document.documentRevision, sideEdit.document.documentRevision + 1);
    await expectDirections();
    await button(historyTools, "撤销").click();
    await expectScore(expectedRange(6), before.history + 1, `${description}: undo drag`);
    await button(historyTools, "撤销").click();
    await expectScore(before.document.score, before.history, `${description}: undo sidebar edit`);
    await button(historyTools, "重做").click();
    await expectScore(expectedRange(6), before.history + 1, `${description}: redo sidebar edit`);
    await button(historyTools, "重做").click();
    await expectScore(expectedRange(4), before.history + 2, `${description}: redo drag`);

    await hitArrow(middle).click();
    await expectSelected([middle]);
    assert.equal(await top.inputValue(), "1");
    assert.equal(await bottom.inputValue(), "6");
    await expectScore(expectedRange(4), before.history + 2, `${description}: plain single click`);
  }

  // 跨小节混选不同范围时只统一当前端点；活动音符被移除后，手柄要跟随剩余的音符。
  const [pitched, rest] = rangeCases;
  const first = pitched.attackIds[0];
  const other = rest.attackIds[1];
  const beforeMixed = await snap();
  await hitArrow(first).click();
  await altClickStem(other);
  await expectSelected([first, other]);
  assert.equal(await top.inputValue(), "");
  assert.equal(await bottom.inputValue(), "");
  await top.selectOption("2");
  const mixedEdit = structuredClone(beforeMixed.document.score);
  mixedEdit.tracks[0].techniques.find(t => t.id === other).minString = 2;
  await expectScore(mixedEdit, beforeMixed.history + 1, "mixed edit preserves each opposite endpoint");
  await button(historyTools, "撤销").click();
  await expectScore(beforeMixed.document.score, beforeMixed.history, "undo restores individual mixed ranges");
  await altClickStem(first);
  await expectSelected([other]);
  await altClickStem(other);
  assert.deepEqual(await markedInkIds("data-strum-selected"), []);
  assert.equal(await inspector.count(), 0);

  // 原有 Shift 连选与从箭头拖出矩形仍按 TAB 弦格定位，中间的起音在这个连续选区内。
  const last = pitched.attackIds[2];
  const beatOf = id => rangeTrack.techniques.find(t => t.id === id).beatId;
  const expectTabRange = async () => {
    const { selection } = await snap();
    assert.equal(selection.anchor.beatId, beatOf(first));
    assert.equal(selection.focus.beatId, beatOf(last));
    assert.deepEqual(await markedInkIds("data-strum-selected"), []);
  };
  await hitArrow(first).click();
  await hitArrow(last).click({ modifiers: ["Shift"] });
  await expectTabRange();
  await hitArrow(first).dragTo(hitArrow(last));
  await expectTabRange();

  const editedScore = (await snap()).document.score;
  const exported = await downloadScoreJson(page);
  await page.reload();
  await openScoreImport(page, {
    name: exported.suggestedFilename(), mimeType: "application/json", buffer: await readFile(await exported.path()),
  });
  await confirmScoreImport(page);
  await expectScore(editedScore, 0, "edited ranges survive export, page reload and import");
  assert.deepEqual(errors, []);
  console.log("REQ-077 browser acceptance passed, including pitched and rest strum ranges and JSON reload");
} finally {
  await browser.close();
}
