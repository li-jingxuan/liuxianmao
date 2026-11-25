import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { downloadScoreJson } from "./score-file-actions.browser.cjs";

assert.ok(process.env.REQ_NEXT_ORIGIN, "请通过 REQ_NEXT_ORIGIN 指定网站生产构建端口");
const origin = process.env.REQ_NEXT_ORIGIN.replace(/\/$/, "");
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
const fixture = {
  schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
  score: {
    id: "req105-practice", title: "跳转练习谱", arranger: "", keySignature: "C", meta: {}, tempoBpm: 300,
    tracks: [{
      id: "track", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
      tuning: { strings: ["E4", "B3", "G3", "D3", "A2", "E2"].map((pitch, i) => ({
        index: i + 1, pitch, midi: [64, 59, 55, 50, 45, 40][i],
      })) },
      techniques: [], numberedMarks: [],
      measures: Array.from({ length: 8 }, (_, i) => ({
        id: `m${i + 1}`, timeSignature: { numerator: 4, denominator: 4 }, barline: "single",
        tuplets: [], chordSymbols: [], numberedVoice: { events: [], tuplets: [] }, lyrics: [],
        beats: [{ id: `b${i + 1}`, tick: 0, kind: "notes", rhythm: { base: "whole", dots: 0 },
          notes: [{ id: `n${i + 1}`, string: 1, fret: i }] }],
      })),
    }],
  },
};

const importScore = async (page, buffer, name = "practice.lxm") => {
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60000 });
  const trigger = page.getByRole("button", { name: "导入曲谱", exact: true });
  const element = await trigger.elementHandle();
  await page.waitForFunction((node) => Object.keys(node).some((key) => key.startsWith("__reactProps$")), element);
  await element.dispose();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "导入曲谱" });
  await dialog.getByLabel("选择六线猫曲谱文件").setInputFiles({ name, mimeType: "application/json", buffer });
  await dialog.getByRole("button", { name: "打开曲谱", exact: true }).click();
  await page.waitForURL(`${origin}/editor`);
};
const viewport = { width: 1440, height: 900 };
const labels = new Map([
  ["反复房子", "反复房子"], ["Segno", "回跳记号"], ["D.S.", "回到记号"],
  ["D.S. al Coda", "记号至尾声"], ["To Coda", "跳到尾声"], ["Coda", "尾声记号"],
  ["D.C.", "回到曲首"], ["Fine", "结束记号"], ["D.C. al Fine", "曲首至结束"],
  ["D.S. al Fine", "记号至结束"], ["D.C. al Coda", "曲首至尾声"], ["单小节重复", "小节重复"],
]);
const scoreSvg = (page) => page.locator('svg[aria-label="六线谱编辑器"]');
const markTarget = (score, number, label) => score.getByRole("button", { name: `编辑第 ${number} 小节的 ${label} 记号`, exact: true });
const buttonIn = (root, name) => root.getByRole("button", {
  name: typeof name === "string" && /^\p{Script=Han}{2}$/u.test(name) ? new RegExp(`^${name[0]}\\s*${name[1]}$`) : name,
  exact: true,
});
const undo = async (page) => {
  const score = scoreSvg(page);
  await score.and(page.locator(":not([inert] *)")).waitFor();
  await score.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
};

const pointIn = async (page, number) => {
  // 谱例每小节有一个不同品位的音符。用音符坐标选小节，避免 Segno/Coda 改变小节号的排版位置。
  const note = scoreSvg(page).locator('[data-layer="score-music"] text:not([data-numbered-event])').filter({ hasText: new RegExp(`^${number - 1}$`) });
  await note.scrollIntoViewIfNeeded();
  return note.evaluate((element) => {
    const x = Number(element.getAttribute("x"));
    const y = Number(element.getAttribute("y"));
    const point = new DOMPoint(x, y).matrixTransform(element.getScreenCTM());
    return { x: point.x, y: point.y };
  });
};
const openMeasureTools = async (page, number, entry = "context") => {
  const point = await pointIn(page, number);
  await page.mouse.click(point.x, point.y, { button: entry === "context" ? "right" : "left" });
  if (entry === "toolbar") {
    await buttonIn(page.getByRole("toolbar", { name: "节奏、小节与历史工具" }), "小节工具").click();
  } else {
    if (entry === "keyboard") await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: /反复与跳转/ }).click();
  }
  return page.getByRole("dialog", { name: "小节工具参数", exact: true });
};
const symbolRow = (root) => root.getByRole("region", { name: "反复与跳转", exact: true });
const symbolName = (kind) => labels.get(kind) === kind ? kind : `${labels.get(kind)}（${kind}）`;
const symbol = (root, kind) => buttonIn(root, symbolName(kind));
const sidebarSymbols = (page) => symbolRow(page.locator('[data-selection-detail="measure"]'))
  .filter({ has: symbol(page, "Segno") });
const parameterDialog = (page, name) => page.getByRole("dialog", {
  name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: .+说明)?$`),
});
const openSidebarMeasure = async (page, number) => {
  const { x, y } = await pointIn(page, number);
  await page.mouse.click(x, y);
  const measureTab = page.getByRole("radio", { name: "小节", exact: true });
  await page.locator("label").filter({ has: measureTab }).click();
  await page.getByRole("region", { name: "小节属性详情" }).getByText(`从第 ${number} 小节开始`, { exact: true }).waitFor();
  return sidebarSymbols(page);
};
const auditionFromHead = async (page) => {
  await buttonIn(page, "木吉他试听").click();
  await page.getByRole("combobox", { name: "播放起点", exact: true }).click();
  await page.locator(".ant-select-item-option-content").getByText("从头开始", { exact: true }).click();
};

const waitForEntrance = (locator) => locator.evaluate(async (element) => {
    const animations = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      animations.push(...ancestor.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime)));
    }
    await Promise.allSettled(animations.map((animation) => animation.finished));
});

async function checkSymbolGrid(row) {
  await row.waitFor();
  const items = row.getByRole("button");
  await waitForEntrance(symbol(row, "反复房子"));
  const lines = await row.locator("..").getByRole("group", { name: "小节线与反复", exact: true })
    .getByRole("button").evaluateAll((buttons) => buttons.map((item) => {
      const { width, height } = getComputedStyle(item);
      const { left, right } = item.getBoundingClientRect();
      return { width, height, left, right };
    }));
  assert.equal(lines.length, 7);
  for (const line of lines) {
    assert.equal(line.width, "40px");
    assert.equal(line.height, "30px");
    assert.ok(line.left >= 0 && line.right <= viewport.width, `小节线按钮在视口内 ${JSON.stringify(line)}`);
  }
  const bounds = await items.evaluateAll((buttons) => buttons.map((item) => {
    const { top, left, width, right } = item.getBoundingClientRect();
    return { top, left, width, right };
  }));
  assert.equal(bounds.length, 12);
  for (const [index, [kind, label]] of [...labels].entries()) {
    const item = items.nth(index);
    assert.equal(await item.getAttribute("aria-label"), symbolName(kind));
    const caption = row.getByText(label, { exact: true });
    await caption.waitFor();
    assert.ok(await caption.evaluate((node) => {
      const captionBounds = node.getBoundingClientRect();
      const button = node.closest("button") ?? node.parentElement.querySelector("button");
      const buttonBounds = button.getBoundingClientRect();
      return captionBounds.top >= buttonBounds.bottom - 1 &&
        Math.abs((captionBounds.left + captionBounds.right) - (buttonBounds.left + buttonBounds.right)) < 2;
    }), `${label} 的常显标签位于图标下方`);
    const { top, left, width, right } = bounds[index];
    assert.ok(left >= 0 && right <= viewport.width && width > 0, `${label} 在视口内 ${JSON.stringify(bounds[index])}`);
    assert.ok(Math.abs(top - bounds[index < 6 ? 0 : 6].top) < 1, `${label} 在第 ${index < 6 ? 1 : 2} 排`);
    assert.ok(Math.abs(width - bounds[0].width) < 1 && Math.abs(left - bounds[index % 6].left) < 1, `${label} 网格等宽对齐`);
    if (index % 6 !== 0) assert.ok(left >= bounds[index - 1].right, `${label} 位于独立列`);
  }
  assert.ok(bounds[6].top > bounds[0].top, "两排记号纵向分开");
}

async function checkRepeatEndings(page) {
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await importScore(page, Buffer.from(JSON.stringify(fixture)), "repeat-endings.lxm");
  const score = scoreSvg(page);
  const roomTarget = () => score.locator("[data-repeat-ending-target]");
  const addDialog = parameterDialog(page, "添加反复房子");
  const editDialog = parameterDialog(page, "编辑反复房子");
  const field = (dialog, label) => dialog.getByRole("combobox", { name: label, exact: true });
  const apply = (dialog) => buttonIn(dialog, "应用");
  const rowAt = (dialog, row) => dialog.getByRole("group", { name: `房子 ${row}`, exact: true });
  const pass = (row, number) => row.getByRole("checkbox", { name: `第 ${number} 遍`, exact: true });
  const readGroups = async () => {
    const download = await downloadScoreJson(page);
    return JSON.parse(await readFile(await download.path())).score.tracks[0].repeatEndingGroups ?? [];
  };
  const roomRanges = (group) => [...group.endings].sort((a, b) => a.startMeasureId.localeCompare(b.startMeasureId))
    .map(({ startMeasureId, passes }) => [startMeasureId, passes]);
  const removeRoomDraft = async (row) => {
    await buttonIn(rowAt(editDialog, row), `删除房子 ${row}`).click();
    const confirm = parameterDialog(page, `删除房子 ${row}`);
    await confirm.getByText(/应用后.*将缺房/).waitFor();
    await buttonIn(confirm, "从草稿移除").click();
    await editDialog.waitFor();
  };

  const tools = await openMeasureTools(page, 4, "toolbar");
  await symbol(symbolRow(tools), "反复房子").click();
  await addDialog.waitFor();
  await tools.waitFor({ state: "hidden" });
  const help = buttonIn(addDialog, "反复房子说明");
  const tip = addDialog.getByRole("tooltip").filter({ hasText: "总遍数含首遍" });
  await waitForEntrance(help);
  await help.hover();
  await tip.waitFor();
  await help.focus();
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "hidden" });
  assert.equal(await addDialog.isVisible(), true);
  await field(addDialog, "反复起点").focus();
  await help.focus();
  await tip.waitFor();
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "hidden" });

  assert.equal(await field(addDialog, "所属反复组").inputValue(), "");
  assert.equal(await field(addDialog, "共享段末小节").inputValue(), "m3");
  await field(addDialog, "反复起点").selectOption("m3");
  await field(addDialog, "结尾区末小节").selectOption("m6");
  await buttonIn(addDialog, "添加房子").click();
  assert.equal(await field(rowAt(addDialog, 2), "起始小节").inputValue(), "m5");
  assert.equal(await pass(rowAt(addDialog, 2), 2).isChecked(), true);
  await addDialog.getByText("2 遍 · 2 个房子", { exact: true }).waitFor();
  await buttonIn(addDialog, "展开演奏详情").click();
  const preview = addDialog.getByRole("region", { name: "演奏预览", exact: true });
  await preview.getByText(/共同出口\s*第 7 小节/).waitFor();
  await preview.getByText(/第 1 遍.*第 4 小节.*回到第 3 小节/).waitFor();
  await preview.getByText(/第 2 遍.*第 5 小节.*第 7 小节/).waitFor();
  await apply(addDialog).click();
  await addDialog.waitFor({ state: "hidden" });
  const [original] = await readGroups();
  assert.deepEqual([original.startMeasureId, original.sharedEndMeasureId, original.endMeasureId, original.passCount], ["m3", "m3", "m6", 2]);
  assert.deepEqual(original.endings.map(({ startMeasureId, endMeasureId, passes }) => [startMeasureId, endMeasureId, passes]), [
    ["m4", "m4", [1]], ["m5", "m5", [2]],
  ]);

  // 相交是房子结构错误。提示只标记需要改动的边界，应用后仍留在表单。
  await symbol(await openSidebarMeasure(page, 2), "反复房子").click();
  await field(addDialog, "结尾区末小节").selectOption("m3");
  const overlap = addDialog.getByRole("alert").filter({ hasText: /与既有反复组.*相交.*第 2 小节或更早/ });
  await overlap.waitFor();
  assert.equal(await field(addDialog, "结尾区末小节").getAttribute("aria-invalid"), "true");
  assert.equal(await addDialog.locator('[aria-invalid="true"]').count(), 1);
  await apply(addDialog).click();
  await overlap.waitFor();
  await buttonIn(addDialog, "取消").click();
  await addDialog.waitFor({ state: "hidden" });

  const editGroup = async () => {
    await roomTarget().first().click();
    await editDialog.waitFor();
    assert.equal(await field(editDialog, "所属反复组").inputValue(), original.id);
  };
  await editGroup();
  await field(editDialog, "总遍数").selectOption("3");
  await pass(rowAt(editDialog, 2), 3).check();
  await score.locator("[data-repeat-ending-preview]").first().waitFor();
  await buttonIn(editDialog, "取消").click();
  await editDialog.waitFor({ state: "hidden" });
  await score.locator("[data-repeat-ending-preview]").first().waitFor({ state: "hidden" });
  assert.deepEqual(await readGroups(), [original]);

  const editLeavingThirdPassMissing = async () => {
    await editGroup();
    await field(editDialog, "总遍数").selectOption("3");
    await removeRoomDraft(2);
    await buttonIn(editDialog, "添加房子").click();
    const second = rowAt(editDialog, 2);
    await field(second, "结束小节").selectOption("m6");
    await field(second, "起始小节").selectOption("m6");
    await editDialog.getByText("第 3 遍还没选房子，可稍后补", { exact: true }).waitFor();
    assert.equal(await apply(editDialog).isEnabled(), true);
    await apply(editDialog).click();
    await editDialog.waitFor({ state: "hidden" });
  };
  await editLeavingThirdPassMissing();
  const [incomplete] = await readGroups();
  assert.equal(incomplete.passCount, 3);
  assert.deepEqual(roomRanges(incomplete), [["m4", [1]], ["m6", [2]]]);
  await undo(page);
  assert.deepEqual(await readGroups(), [original], "一次撤销恢复遍数和两个房子的完整记录");

  await editLeavingThirdPassMissing();
  await auditionFromHead(page);
  await buttonIn(page, "播放").click();
  const missingRoom = page.locator("[data-repeat-ending-playback-issue]");
  await missingRoom.getByText(/第 3 小节已暂停.*第 3 遍没有反复房子/).waitFor();
  await score.locator('[data-playback-cursor][data-paused="true"][data-playback-measure="m3"]').waitFor();
  await buttonIn(missingRoom, "返回编辑反复房子").click();
  assert.equal(await field(editDialog, "所属反复组").inputValue(), original.id);
  const third = rowAt(editDialog, 3);
  assert.equal(await field(third, "起始小节").inputValue(), "m5");
  assert.equal(await pass(third, 3).isChecked(), true);
  await apply(editDialog).click();
  await editDialog.waitFor({ state: "hidden" });
  const [repaired] = await readGroups();
  assert.deepEqual(roomRanges(repaired), [["m4", [1]], ["m5", [3]], ["m6", [2]]]);

  // 跳转与共享段末共址可保存。实际到访时暂停，并定位到待修复的原记号。
  await symbol(await openSidebarMeasure(page, 3), "D.C.").click();
  await markTarget(score, 3, "D.C.").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  const conflictingFile = await downloadScoreJson(page);
  const conflictingTrack = JSON.parse(await readFile(await conflictingFile.path())).score.tracks[0];
  assert.equal(conflictingTrack.measures[2].jumpMarks[0].kind, "dc");
  assert.equal(conflictingTrack.repeatEndingGroups[0].sharedEndMeasureId, "m3");
  await auditionFromHead(page);
  await buttonIn(page, "播放").click();
  const jumpIssue = page.locator("[data-jump-playback-issue]");
  await jumpIssue.getByText(/第 3 小节已暂停.*跳转.*反复房子.*冲突/).waitFor();
  await buttonIn(jumpIssue, "返回编辑并定位").click();
  const jumpEdit = parameterDialog(page, "编辑 D.C.");
  await buttonIn(jumpEdit, "删除记号").click();
  await buttonIn(page.getByRole("dialog", { name: /删除第 3 小节 D.C./ }), "删除").click();
  await markTarget(score, 3, "D.C.").waitFor({ state: "hidden" });
  await auditionFromHead(page);
  assert.deepEqual(await page.locator("[data-jump-visit] [data-visit-measure]").allTextContents(),
    ["1", "2", "3", "4", "3", "6", "3", "5", "7", "8"]);
  assert.equal(await missingRoom.count() + await jumpIssue.count(), 0);
  await buttonIn(page, "退出试听").click();

  await editGroup();
  for (const row of [3, 2, 1]) await removeRoomDraft(row);
  await buttonIn(editDialog, "删除反复组").click();
  await buttonIn(parameterDialog(page, "删除反复组"), "确认删除").click();
  await roomTarget().first().waitFor({ state: "hidden" });
  assert.deepEqual(await readGroups(), []);
  await undo(page);
  assert.deepEqual(await readGroups(), [repaired], "一次撤销还原整组和全部房子");
  assert.deepEqual(errors, []);
}

try {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.audioStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const result = start.apply(this, args);
      window.audioStarts++;
      return result;
    };
  });
  await importScore(page, Buffer.from(JSON.stringify(fixture)));
  const score = scoreSvg(page);
  const button = (name, root = page) => buttonIn(root, name);
  const jumpForm = (mode) => page.getByRole("dialog").filter({ has: page.getByRole("form", { name: mode, exact: true }) });
  const inspector = jumpForm(/^(插入|编辑)记号$/);
  const select = async (label, value) => {
    await inspector.getByRole("combobox", { name: label, exact: true }).click();
    await page.locator(".ant-select-item-option-content").getByText(value, { exact: true }).click();
  };
  const activateMark = async (number, kind, entry) => {
    const tools = await openMeasureTools(page, number, entry);
    await symbol(symbolRow(tools), kind).click();
    return tools;
  };
  const target = (number, kind) => markTarget(score, number, kind);
  const add = async (number, kind, entry, paired = false) => {
    const tools = await activateMark(number, kind, entry);
    if (paired) {
      await parameterDialog(page, `添加 ${kind}`).waitFor();
      await tools.waitFor({ state: "hidden" });
      await button("应用", inspector).click();
    }
    await target(number, kind).waitFor();
    if (paired) await inspector.waitFor({ state: "hidden" });
    else assert.equal(await inspector.isVisible(), false, "普通记号直接落谱");
  };

  const tools = await openMeasureTools(page, 1, "toolbar");
  const symbols = symbolRow(tools);
  await checkSymbolGrid(symbols);
  assert.equal(await symbols.evaluate((node) => getComputedStyle(node).borderTopWidth), "1px");
  const repeat = symbol(symbols, "单小节重复");
  assert.equal(await repeat.getAttribute("aria-disabled"), "true");
  await repeat.focus();
  await page.getByRole("tooltip", { name: /^小节重复.*第 1 小节没有前一小节/ }).waitFor();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("[data-measure-repeat-inspector]").count(), 0);
  await symbol(symbols, "Fine").hover();
  await page.getByRole("tooltip", { name: /^Fine.*首遍顺行/ }).waitFor();
  await symbol(symbols, "Fine").focus();
  await page.keyboard.press("Escape");
  assert.equal(await tools.isVisible(), true);
  await page.keyboard.press("Escape");
  await tools.waitFor({ state: "hidden" });

  // 小节重复需要替换确认。取消后保留小节选区，方向键不会落到隐藏的 TAB 拍位。
  await activateMark(2, "单小节重复", "toolbar");
  const repeatDialog = parameterDialog(page, "替换为单小节重复");
  await repeatDialog.waitFor();
  await button("取消", repeatDialog).click();
  await repeatDialog.waitFor({ state: "hidden" });
  await score.locator('[data-whole-measure-selection="m2"]').waitFor();
  await score.focus();
  await page.keyboard.press("ArrowRight");
  await score.locator('[data-whole-measure-selection="m3"]').waitFor();
  await page.keyboard.press("ArrowLeft");
  await score.locator('[data-whole-measure-selection="m2"]').waitFor();
  await checkSymbolGrid(await openSidebarMeasure(page, 2));

  await add(2, "Segno", "keyboard");
  await add(8, "Coda", "toolbar");
  await add(4, "To Coda", "context", true);
  await add(1, "Segno");
  await symbol(await openSidebarMeasure(page, 6), "D.S. al Coda").click();
  await parameterDialog(page, "添加 D.S. al Coda").waitFor();
  await inspector.getByText(/有 2 个 Segno/).waitFor();
  await select("回到 Segno", "第 2 小节 Segno");
  await button("应用", inspector).click();
  await target(6, "D.S. al Coda").waitFor();
  await inspector.waitFor({ state: "hidden" });
  await activateMark(2, "Segno", "toolbar");
  await parameterDialog(page, "编辑 Segno").waitFor();
  await select("位置小节", "第 3 小节");
  await score.locator('[data-jump-mark-draft="m3"]').waitFor();
  await page.keyboard.press("Escape");
  await score.locator("[data-jump-mark-draft]").waitFor({ state: "hidden" });
  await inspector.waitFor({ state: "hidden" });
  await target(2, "Segno").click();
  await select("位置小节", "第 3 小节");
  await button("应用", inspector).click();
  await target(3, "Segno").waitFor();
  await score.locator("[data-jump-mark-draft]").waitFor({ state: "hidden" });
  await inspector.waitFor({ state: "hidden" });
  await undo(page);
  await target(2, "Segno").waitFor();

  const download = await downloadScoreJson(page);
  const saved = await readFile(await download.path());
  const marks = JSON.parse(saved).score.tracks[0].measures.map((measure) => measure.jumpMarks?.[0]);
  assert.equal(marks[5].segnoId, marks[1].id);
  assert.equal(marks[5].toCodaId, marks[3].id);
  assert.equal(marks[3].codaId, marks[7].id);

  const audition = page.locator("[data-jump-audition]");
  const order = () => audition.locator("[data-jump-visit] [data-visit-measure]").allTextContents();
  const auditionJump = async (name) => {
    await button("试听单次跳转").click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  const cursor = score.locator("[data-playback-cursor]");
  await auditionFromHead(page);
  assert.deepEqual(await order(), ["1", "2", "3", "4", "5", "6", "2", "3", "4", "8"]);
  assert.deepEqual(await audition.locator("[data-jump-transition] strong").allTextContents(), ["6 → 2", "4 → 8"]);
  const firstVisit = audition.locator('[data-jump-visit="1"]');
  const beforeFirst = await page.evaluate(() => window.audioStarts);
  await firstVisit.click();
  await cursor.and(score.locator('[data-playback-visit="1"][data-playback-measure="m2"][data-playback-measure-end="true"]')).waitFor();
  assert.ok(await page.evaluate((before) => window.audioStarts > before, beforeFirst));
  assert.equal(await audition.locator('[aria-current="step"]').getAttribute("data-jump-visit"), "1");
  const repeated = audition.locator('[data-jump-visit="6"][data-revisited]');
  const beforeSecond = await page.evaluate(() => window.audioStarts);
  await repeated.focus();
  await repeated.press("Enter");
  await cursor.and(score.locator('[data-playback-visit="6"][data-playback-measure="m2"][data-playback-measure-end="true"]')).waitFor();
  assert.ok(await page.evaluate((before) => window.audioStarts > before, beforeSecond));
  assert.equal(await audition.locator('[aria-current="step"]').getAttribute("data-jump-visit"), "6");
  assert.equal(await audition.locator('[data-jump-visit="1"]').getAttribute("aria-current"), null);
  assert.equal(await repeated.evaluate((item) => document.activeElement === item), true);
  await button("下一步").click();
  await cursor.and(score.locator('[data-playback-visit="7"][data-playback-measure-end="true"]')).waitFor();
  await auditionJump("D.S. al Coda · 6 → 2");
  await cursor.and(score.locator('[data-playback-visit="6"][data-playback-measure="m2"]')).waitFor();
  assert.ok(await page.evaluate(() => window.audioStarts >= 2));
  await auditionJump("To Coda · 4 → 8");
  await cursor.and(score.locator('[data-playback-visit="9"][data-playback-measure="m8"]')).waitFor();
  await button("退出试听").click();

  await add(7, "Coda");
  await target(8, "Coda").click();
  await button("删除记号", inspector).click();
  const deletion = page.getByRole("dialog", { name: /删除第 8 小节 Coda/ });
  await deletion.getByText("第 4 小节 To Coda", { exact: true }).waitFor();
  await deletion.getByText("第 6 小节 D.S. al Coda", { exact: true }).waitFor();
  await button("删除", deletion).click();
  await target(8, "Coda").waitFor({ state: "hidden" });
  await auditionFromHead(page);
  assert.deepEqual(await order(), ["1", "2", "3", "4", "5", "6"]);
  await button("播放").click();
  await cursor.and(score.locator('[data-paused="true"][data-playback-measure="m6"]')).waitFor();
  await button("返回编辑并定位", page.locator("[data-jump-playback-issue]")).click();
  await jumpForm("编辑记号").waitFor();
  await select("跳到 Coda", "第 7 小节 Coda");
  await button("应用", inspector).click();
  await jumpForm("编辑记号").waitFor({ state: "hidden" });
  await auditionFromHead(page);
  assert.deepEqual(await order(), ["1", "2", "3", "4", "5", "6", "2", "3", "4", "7", "8"]);
  assert.deepEqual(errors, []);

  const reopened = await browser.newPage({ viewport });
  await reopened.addInitScript(() => { window.print = () => { window.dispatchEvent(new Event("afterprint")); }; });
  await importScore(reopened, saved, download.suggestedFilename());
  await reopened.locator(`[data-jump-mark-target="${marks[7].id}"]`).waitFor();
  for (const item of ["图片(.png)", "打印"]) {
    await reopened.getByRole("button", { name: "导出", exact: true }).click();
    await reopened.getByRole("menuitem", { name: item, exact: true }).click();
    const preview = reopened.getByRole("dialog");
    const pagePreview = preview.getByRole("main", { name: "A4 成品页预览" });
    await pagePreview.locator(`[data-jump-mark="${marks[1].id}"]`).first().waitFor();
    await pagePreview.locator(`[data-jump-mark="${marks[5].id}"]`).getByText("D.S. al Coda", { exact: true }).waitFor();
    if (item === "图片(.png)") {
      await button("仅生成当前页", preview).click();
      const [png] = await Promise.all([
        reopened.waitForEvent("download"), preview.getByRole("link", { name: "下载图片", exact: true }).click(),
      ]);
      assert.equal((await readFile(await png.path())).toString("ascii", 1, 4), "PNG");
    } else {
      await button("打开打印窗口", preview).click();
      await reopened.emulateMedia({ media: "print" });
      assert.equal((await reopened.pdf({ preferCSSPageSize: true })).toString("ascii", 0, 5), "%PDF-");
      await reopened.emulateMedia({ media: "screen" });
    }
    await button("关闭预览", preview).click();
  }
  console.log("REQ-105 passed: context and keyboard entry, move and undo, .lxm round trip, audio and cursor, repair, PNG and print scenes");
  const endings = await browser.newPage({ viewport });
  await checkRepeatEndings(endings);
  console.log("BUG-086/087 passed: both 6×2 grids, group tooltips and form, whole-group undo, and runtime repair");
} finally {
  await browser.close();
}
