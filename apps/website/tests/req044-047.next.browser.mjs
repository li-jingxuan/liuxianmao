import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(runtime.startsWith("/") ? pathToFileURL(runtime).href : runtime);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(12000);
const output = new URL("../../../output/playwright/req044-047-product/", import.meta.url);
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
async function load() {
  await page.keyboard.press("Escape");
  assert.equal((await state("replace", fixture())).ok, true);
  await page.waitForFunction(() => document.querySelector('text[data-numbered-event="e00"]'));
}
const ref = (m, b) => ({ trackId: "track", measureId: `m${m}`, beatId: `b${m}${b}`, string: 1 });
async function select(m = 0, b = 0) {
  const p = await state("point", ref(m, b));
  await page.mouse.click(p.x, p.y);
}
async function open(group) {
  await page.locator(`[data-tool-trigger="${group}"]`).click();
  await page.waitForTimeout(100);
}
async function check(name, run) { await run(); checks.push(name); }
async function shot(name) { await page.screenshot({ path: new URL(`${name}.png`, output).pathname, animations: "disabled" }); }

try {
  await page.goto(process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor");
  await page.locator('svg[aria-label="六线谱编辑器"]').waitFor();
  await load(); await select();
  await check("侧栏仅音符与小节；十二模板平铺", async () => {
    assert.equal(await page.getByRole("radio", { name: "音符", exact: true }).count(), 1);
    assert.equal(await page.getByRole("radio", { name: "小节", exact: true }).count(), 1);
    assert.equal(await page.getByRole("radio", { name: "连音", exact: true }).count(), 0);
    assert.equal(await rhythmSidebar.locator("[data-rhythm-template]").count(), 12);
    assert.ok(!(await rhythmSidebar.innerText()).includes("三十二分细分"));
  });
  await check("工具栏与侧栏共享模板和预览，应用可撤销", async () => {
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
  await shot("sidebar-rhythm");
  await check("小节复制只作用焦点，保持浮层打开，撤销恢复", async () => {
    await state("selection", { anchor: ref(0, 0), focus: ref(1, 1) });
    await open("measure");
    await page.getByRole("button", { name: "复制当前小节", exact: true }).last().click();
    assert.equal((await state()).document.score.tracks[0].measures.length, 4);
    assert.ok(await page.getByRole("button", { name: "复制当前小节", exact: true }).last().isVisible());
    await state("undo");
    assert.equal((await state()).document.score.tracks[0].measures.length, 3);
  });
  await shot("measure-popup");
  await check("删除区内确认与取消；确认一次提交且无第二弹窗", async () => {
    await page.getByRole("button", { name: "删除当前小节", exact: true }).last().click();
    const confirm = page.getByRole("region", { name: "删除当前小节确认" });
    await confirm.getByRole("button", { name: /取\s*消/ }).click();
    assert.equal((await state()).document.score.tracks[0].measures.length, 3);
    await page.getByRole("button", { name: "删除当前小节", exact: true }).last().click();
    await confirm.getByRole("button", { name: /确认删除第/ }).click();
    assert.equal(await page.locator('.ant-modal').count(), 0);
    assert.equal((await state()).document.score.tracks[0].measures.length, 2);
    await state("undo");
    assert.equal((await state()).document.score.tracks[0].measures.length, 3);
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
      group: root.getBoundingClientRect().height, heights: [...root.querySelectorAll("button")].map(b => b.getBoundingClientRect().height) }));
    assert.equal(dimensions.group, 44);
    assert.deepEqual(dimensions.heights, [36, 36, 36]);
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
  await check("激活简谱后连音不沿用残留TAB选区；6/8只显示五模板", async () => {
    await select();
    await page.locator('text[data-numbered-event="e00"]').first().click();
    await open("tuplet");
    const tool = page.locator('[data-presentation="popover"][aria-label="连音工具"]');
    assert.equal(await tool.locator("button:enabled").count(), 0);
    await page.keyboard.press("Escape");
    const compound = fixture();
    for (const measure of compound.score.tracks[0].measures) {
      measure.timeSignature = { numerator: 6, denominator: 8 };
      measure.beats = measure.beats.slice(0, 2).map((b, i) => ({ ...b, tick: i * 1440, rhythm: { base: "quarter", dots: 1 } }));
      measure.numberedVoice.events = measure.numberedVoice.events.slice(0, 2).map((e, i) => ({ ...e, tick: i * 1440, rhythm: { base: "quarter", dots: 1 } }));
    }
    assert.equal((await state("replace", compound)).ok, true);
    await select();
    assert.equal(await rhythmSidebar.locator("[data-rhythm-template]").count(), 5);
  });
  assert.deepEqual(errors, []);
  await writeFile(new URL("result.json", output), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
  await shot("failure").catch(() => {});
  await writeFile(new URL("result.json", output), JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
