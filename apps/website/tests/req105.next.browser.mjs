import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { downloadScoreJson } from "./score-file-actions.browser.cjs";

const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
const origin = (process.env.REQ_NEXT_ORIGIN ?? "http://127.0.0.1:3031").replace(/\/$/, "");
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
  const score = page.locator('svg[aria-label="六线谱编辑器"]');
  const inspector = page.locator("[data-jump-mark-inspector]");
  const button = (name, root = page) => root.getByRole("button", {
    name: /^\p{Script=Han}{2}$/u.test(name) ? new RegExp(`^${name[0]}\\s*${name[1]}$`) : name, exact: true,
  });
  const select = async (label, value) => {
    await inspector.getByRole("combobox", { name: label, exact: true }).click();
    await page.locator(".ant-select-item-option-content").getByText(value, { exact: true }).click();
  };
  const pointIn = async (number) => {
    const label = score.locator(`[data-measure-number="m${number}"]`);
    await label.scrollIntoViewIfNeeded();
    return label.evaluate((element) => {
      const x = Number(element.getAttribute("x"));
      const y = Number(element.getAttribute("y"));
      const point = new DOMPoint(x - 22, y + 16).matrixTransform(element.getScreenCTM());
      return { x: point.x, y: point.y };
    });
  };
  const openMeasureTools = async (number, entry = "context") => {
    const point = await pointIn(number);
    await page.mouse.click(point.x, point.y, { button: entry === "context" ? "right" : "left" });
    if (entry === "toolbar") {
      await button("小节工具", page.getByRole("toolbar", { name: "节奏、小节与历史工具" })).click();
    } else {
      if (entry === "keyboard") await page.keyboard.press("Shift+F10");
      await page.getByRole("menuitem", { name: /反复与跳转/ }).click();
    }
    return page.getByRole("dialog", { name: "小节工具参数", exact: true });
  };
  const symbolRow = (tools) => tools.getByRole("region", { name: "反复与跳转", exact: true });
  const openMark = async (number, kind, entry, mode = "插入记号") => {
    const tools = await openMeasureTools(number, entry);
    await button(kind, symbolRow(tools)).click();
    await inspector.waitFor();
    const form = inspector.getByRole("form", { name: mode, exact: true });
    await form.getByText(kind, { exact: true }).waitFor();
    await tools.waitFor({ state: "hidden" });
  };
  const target = (number, label) => score.getByRole("button", { name: `编辑第 ${number} 小节的 ${label} 记号`, exact: true });
  const add = async (number, kind, entry) => {
    await openMark(number, kind, entry);
    await button("应用", inspector).click();
    await target(number, kind).waitFor();
  };

  const tools = await openMeasureTools(1, "toolbar");
  const symbols = symbolRow(tools);
  assert.deepEqual(await symbols.getByRole("button").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))), [
    "反复房子", "Segno", "D.S.", "D.S. al Coda", "To Coda", "Coda", "D.C.", "Fine",
    "D.C. al Fine", "D.S. al Fine", "D.C. al Coda", "单小节重复",
  ]);
  const symbolBounds = await symbols.getByRole("button").evaluateAll((items) => items.map((item) => {
    const { top, left, right } = item.getBoundingClientRect();
    return { top, left, right };
  }));
  assert.ok(symbolBounds.every(({ top, left, right }) => Math.abs(top - symbolBounds[0].top) < 1 && left >= 0 && right <= viewport.width));
  assert.equal(await symbols.evaluate((node) => getComputedStyle(node).borderTopWidth), "1px");
  const repeat = button("单小节重复", symbols);
  assert.equal(await repeat.getAttribute("aria-disabled"), "true");
  await repeat.focus();
  await page.getByRole("tooltip", { name: /^单小节重复.*第 1 小节没有前一小节/ }).waitFor();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("[data-measure-repeat-inspector]").count(), 0);
  await button("Fine", symbols).hover();
  await page.getByRole("tooltip", { name: /^Fine.*首遍顺行/ }).waitFor();
  await button("Fine", symbols).focus();
  await page.keyboard.press("Escape");
  assert.equal(await tools.isVisible(), true);
  await page.keyboard.press("Escape");
  await tools.waitFor({ state: "hidden" });

  // 两端新增区同样进入真实属性，而键盘选区在小节间移动时没有隐藏的 TAB 拍位。
  await button("反复房子", symbolRow(await openMeasureTools(2))).click();
  const room = page.locator("[data-repeat-ending-inspector]").getByRole("form", { name: "插入反复房子" });
  await room.waitFor();
  await button("取消", room).click();
  await button("单小节重复", symbolRow(await openMeasureTools(2, "toolbar"))).click();
  await page.locator("[data-measure-repeat-inspector]").getByRole("button", { name: "添加单小节重复" }).waitFor();
  await score.locator('[data-whole-measure-selection="m2"]').waitFor();
  await button("选记号…").click();
  await button("D.C.", symbolRow(tools)).click();
  const dcForm = inspector.getByRole("form", { name: "插入记号" });
  await dcForm.getByText("D.C.", { exact: true }).waitFor();
  await button("取消", dcForm).click();
  await score.focus();
  await page.keyboard.press("ArrowRight");
  await score.locator('[data-whole-measure-selection="m3"]').waitFor();
  await page.keyboard.press("ArrowLeft");
  await score.locator('[data-whole-measure-selection="m2"]').waitFor();

  await add(2, "Segno", "keyboard");
  await add(8, "Coda", "toolbar");
  await add(4, "To Coda");
  await add(1, "Segno");
  await openMark(6, "D.S. al Coda");
  await inspector.getByText(/有 2 个 Segno/).waitFor();
  await select("回到 Segno", "第 2 小节 Segno");
  await button("应用", inspector).click();
  await target(6, "D.S. al Coda").waitFor();
  await openMark(2, "Segno", "toolbar", "编辑记号");
  await select("位置小节", "第 3 小节");
  await score.locator('[data-jump-mark-draft="m3"]').waitFor();
  await page.keyboard.press("Escape");
  await score.locator("[data-jump-mark-draft]").waitFor({ state: "hidden" });
  await target(2, "Segno").click();
  await select("位置小节", "第 3 小节");
  await button("应用", inspector).click();
  await target(3, "Segno").waitFor();
  await score.locator("[data-jump-mark-draft]").waitFor({ state: "hidden" });
  await score.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await target(2, "Segno").waitFor();

  const download = await downloadScoreJson(page);
  const saved = await readFile(await download.path());
  const marks = JSON.parse(saved).score.tracks[0].measures.map((measure) => measure.jumpMarks?.[0]);
  assert.equal(marks[5].segnoId, marks[1].id);
  assert.equal(marks[5].toCodaId, marks[3].id);
  assert.equal(marks[3].codaId, marks[7].id);

  const audition = page.locator("[data-jump-audition]");
  const order = () => audition.locator("[data-jump-visit]").allTextContents();
  const fromHead = async () => {
    await button("木吉他试听").click();
    await page.getByRole("combobox", { name: "播放起点", exact: true }).click();
    await page.locator(".ant-select-item-option-content").getByText("从头开始", { exact: true }).click();
  };
  const cursor = score.locator("[data-playback-cursor]");
  await fromHead();
  assert.deepEqual(await order(), ["1", "2", "3", "4", "5", "6", "2", "3", "4", "8"]);
  await button("D.S. al Coda · 6 → 2", audition).click();
  await cursor.and(score.locator('[data-playback-visit="6"][data-playback-measure="m2"]')).waitFor();
  assert.ok(await page.evaluate(() => window.audioStarts >= 2));
  await button("To Coda · 4 → 8", audition).click();
  await cursor.and(score.locator('[data-playback-visit="9"][data-playback-measure="m8"]')).waitFor();
  await button("退出试听").click();

  await add(7, "Coda");
  await target(8, "Coda").click();
  await button("删除", inspector).click();
  const deletion = page.getByRole("dialog", { name: /删除第 8 小节 Coda/ });
  await deletion.getByText("第 4 小节 To Coda", { exact: true }).waitFor();
  await deletion.getByText("第 6 小节 D.S. al Coda", { exact: true }).waitFor();
  await button("删除", deletion).click();
  await target(8, "Coda").waitFor({ state: "hidden" });
  await fromHead();
  assert.deepEqual(await order(), ["1", "2", "3", "4", "5", "6"]);
  await button("播放").click();
  await cursor.and(score.locator('[data-paused="true"][data-playback-measure="m6"]')).waitFor();
  await button("返回编辑并定位", audition).click();
  await inspector.getByRole("form", { name: "编辑记号" }).waitFor();
  await select("跳到 Coda", "第 7 小节 Coda");
  await button("应用", inspector).click();
  await inspector.getByRole("form", { name: "编辑记号" }).waitFor({ state: "hidden" });
  await fromHead();
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
} finally {
  await browser.close();
}
