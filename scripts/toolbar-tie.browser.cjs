/* 真实页面回归；先启动网站。
 * PLAYWRIGHT_MODULE=/path/to/playwright EDITOR_URL=http://127.0.0.1:3000 node scripts/toolbar-tie.browser.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

require.extensions[".ts"] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { EXAMPLE_MVP_7_2_DOCUMENT } = require("../packages/lxm-editor/src");
const fixture = (samePitch) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  document.score.title = samePitch ? "延音线快捷回归" : "不同品位禁止延音线";
  const track = document.score.tracks[0];
  track.measures = [track.measures[0]];
  track.techniques = [];
  track.numberedMarks = [];
  for (const [index, fret] of [3, samePitch ? 3 : 5].entries()) {
    track.measures[0].beats[index].notes = [{ id: `toolbar-tie-note-${index}`, string: 1, fret }];
  }
  return document;
};

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const svg = page.getByRole("application", { name: "六线谱编辑器" });
    const toolbar = page.getByRole("toolbar");
    const tie = toolbar.getByRole("button", { name: "延音线", exact: true });
    const importDocument = async (document) => {
      await page.locator('input[type="file"]').setInputFiles({ name: "tie.lxm", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
      await page.getByRole("button", { name: "导入并替换", exact: true }).click();
      await svg.getByText(document.score.title, { exact: true }).waitFor();
    };
    const exported = async () => {
      const waiting = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
      const download = await waiting;
      return JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    };
    const selectStart = async () => {
      const point = await svg.evaluate((element) => {
        const group = element.querySelector('[data-system-index="0"]');
        const staffs = new Map();
        for (const line of group.querySelectorAll("line")) {
          if (line.getAttribute("y1") !== line.getAttribute("y2") || Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) <= 50) continue;
          const key = `${line.getAttribute("x1")}/${line.getAttribute("x2")}`;
          if (!staffs.has(key)) staffs.set(key, []);
          staffs.get(key).push(Number(line.getAttribute("y1")));
        }
        const ys = [...staffs.values()].find((values) => values.length === 6).sort((a, b) => a - b);
        const label = [...group.querySelectorAll("text")].find((text) => text.textContent === "3" && Math.abs(Number(text.getAttribute("y")) - ys[0]) < 5);
        const screen = new DOMPoint(Number(label.getAttribute("x")), ys[0]).matrixTransform(element.getScreenCTM());
        return { x: screen.x, y: screen.y };
      });
      await page.mouse.click(point.x, point.y);
    };
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3000", { waitUntil: "networkidle" });
    await importDocument(fixture(false));
    await selectStart();
    assert.equal(await tie.isDisabled(), true);
    await tie.locator("..").hover();
    await page.getByRole("tooltip").filter({ hasText: "延音线两端必须是同弦同品位" }).waitFor();
    await importDocument(fixture(true));
    await selectStart();
    assert.equal(await tie.isEnabled(), true);
    assert.equal(await tie.locator("svg path").count(), 1);
    const before = await exported();
    const pathCount = await svg.locator('[data-layer="score-music"] path').count();
    await tie.click();
    const after = await exported();
    assert.equal(after.documentRevision, before.documentRevision + 1);
    assert.deepEqual(after.score.tracks[0].techniques.map(({ type, fromNoteId, toNoteId }) => ({ type, fromNoteId, toNoteId })), [
      { type: "tie", fromNoteId: "toolbar-tie-note-0", toNoteId: "toolbar-tie-note-1" },
    ]);
    assert.equal(await tie.getAttribute("aria-pressed"), "true");
    assert.ok(await svg.locator('[data-layer="score-music"] path').count() > pathCount);
    await tie.click();
    assert.deepEqual(await exported(), after);
    await toolbar.getByRole("button", { name: "撤销", exact: true }).click();
    assert.deepEqual((await exported()).score.tracks[0].techniques, []);
    await toolbar.getByRole("button", { name: "重做", exact: true }).click();
    assert.deepEqual((await exported()).score.tracks[0].techniques, after.score.tracks[0].techniques);
    await importDocument(after);
    assert.deepEqual((await exported()).score, after.score);
    const output = path.resolve("artifacts/toolbar-tie");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await tie.scrollIntoViewIfNeeded();
    const box = await tie.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 375);
    await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS 延音线快捷：无效品位禁用及提示、单选下一音、弧线与高亮、重复零写入、撤销重做、保存重开、375px可达、零脚本错误");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
