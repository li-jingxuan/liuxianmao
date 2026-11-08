/* 只生成复现谱和证据，不修改产品代码。仓库根目录执行。
 * 可选浏览器截图：PLAYWRIGHT_MODULE=/absolute/path/to/playwright node <this file>
 * EDITOR_URL 默认 http://127.0.0.1:3000；不提供 Playwright 时仅跑领域复现。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../../../..");
const output = path.join(root, "artifacts/rhythm-sync-20261109");
fs.mkdirSync(output, { recursive: true });
require.extensions[".ts"] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename,
);
const core = require(path.join(root, "packages/lxm-editor/src"));
const fixtures = [];
const reports = [];
const create = (index) => {
  const document = structuredClone(core.EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0];
  track.measures = [track.measures[index]];
  track.techniques = [];
  track.numberedMarks = [];
  return document;
};
const apply = (document, command) => {
  const track = document.score.tracks[0], measure = track.measures[0];
  const result = core.applyScoreCommand(document, { trackId: track.id, measureId: measure.id, ...command });
  assert.equal(result.ok, true, result.message);
  assert.equal(core.loadDocument(JSON.stringify(result.document)).ok, true);
  return result.document;
};
const rhythm = (base) => ({ base, dots: 0 });
const items = (tokens) => tokens.map((token) => ({ kind: "set", tokens: [token] }));
const save = (name, document) => {
  const fixture = structuredClone(document);
  fixture.score.title = name;
  fs.writeFileSync(path.join(output, `${name}.lxm`), JSON.stringify(fixture, null, 2) + "\n");
  fixtures.push({ name, document: fixture });
  const measure = fixture.score.tracks[0].measures[0];
  const layout = core.buildLayout(fixture, { purpose: "editing" });
  const system = layout.systems[0], m = system.measures[0];
  const summaries = {};
  for (const purpose of ["editing", "presentation"]) {
    const rendered = core.buildLayout(fixture, { purpose }).systems[0].measures[0];
    summaries[purpose] = rendered.numberedNotation.map((n) => ({
      eventId: n.eventId, token: n.labels.map((g) => g.text).join(""),
      x: n.labels[0].x, lines: n.lines,
    }));
  }
  const row = system.numberedRow;
  const hitAt = (tick) => {
    const anchor = m.timeAnchors.find((a) => a.tick === tick);
    if (!anchor || !row) return null;
    return core.hitTestMusicText(layout, { x: anchor.x, y: row.y + row.height / 2 });
  };
  reports.push({ name,
    tab: measure.beats.map((b) => ({ id: b.id, tick: b.tick, base: b.rhythm.base, kind: b.kind })),
    numbered: measure.numberedVoice.events.map((e) => ({ id: e.id, tick: e.tick, base: e.rhythm.base, kind: e.kind })),
    inputSlots: (m.numberedInputSlots ?? []).map((s) => ({ tick: s.startTick, endTick: s.endTick, x: s.anchorX })),
    lyricPositions: core.planLyricPositions(measure),
    hit240: hitAt(240), hit480: hitAt(480), notation: summaries,
  });
};

let a = create(0);
save("A-before-quarter", a);
for (const id of a.score.tracks[0].measures[0].beats.slice(0, 2).map((b) => b.id))
  a = apply(a, { type: core.LXMScoreCommandEnum.SetBeatRhythm, beatId: id, rhythm: rhythm("eighth") });
save("A-after-eighths", a);
assert.deepEqual(a.score.tracks[0].measures[0].numberedVoice, fixtures[0].document.score.tracks[0].measures[0].numberedVoice);
assert.equal(reports.at(-1).inputSlots.length, 0);
assert.equal(reports.at(-1).hit480, null);

let b = create(6);
b = apply(b, { type: "numbered.sequence.insert", startTick: 0, endTick: 960,
  items: items(["1", "2"]), rhythms: [rhythm("eighth"), rhythm("eighth")] });
save("B-before-two-eighths", b);
for (const id of b.score.tracks[0].measures[0].beats.slice(0, 2).map((beat) => beat.id))
  b = apply(b, { type: core.LXMScoreCommandEnum.SetBeatRhythm, beatId: id, rhythm: rhythm("sixteenth") });
save("B-after-tab-sixteenth-sixteenth-eighth", b);
assert.deepEqual(reports.at(-1).tab.slice(0, 3).map((beat) => beat.tick), [0, 240, 480]);
assert.deepEqual(reports.at(-1).numbered.map((e) => [e.tick, e.base]), [[0, "eighth"], [480, "eighth"]]);
assert.equal(reports.at(-1).hit240, null);
assert.equal(reports.at(-1).inputSlots.some((s) => s.tick === 240), false);

const correct = apply(b, { type: "numbered.range.replace", startTick: 0, endTick: 960,
  items: items(["1", "2", "2"]), rhythms: [rhythm("sixteenth"), rhythm("sixteenth"), rhythm("eighth")], allowOverwrite: true });
save("B-control-explicit-mixed-rhythm", correct);
for (const purpose of ["editing", "presentation"]) {
  const frames = reports.at(-1).notation[purpose];
  const lines = frames.flatMap((frame) => frame.lines);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.shared));
  const [upper, lower] = [...lines].sort((x, y) => x.y - y.y);
  assert.ok(upper.x2 > frames[2].x);
  assert.ok(lower.x2 < frames[2].x, "八分音符不应被第二层减时线覆盖");
}

// 对照录入路径：统一十六分模板会真实保存五个十六分，不能靠改线条改成混合节奏。
let uniform = structuredClone(b);
uniform.score.tracks[0].measures[0].numberedVoice = { events: [], tuplets: [] };
uniform.score.tracks[0].measures[0].lyrics = [];
uniform = apply(uniform, { type: "numbered.sequence.insert", startTick: 0, endTick: 3840,
  items: items(["1", "2", "2", "2", "2"]), rhythms: Array.from({ length: 5 }, () => rhythm("sixteenth")) });
save("B-control-uniform-five-sixteenths", uniform);
assert.deepEqual(reports.at(-1).numbered.map((e) => e.tick), [0, 240, 480, 720, 960]);
const report = { scope: "当前实现的领域命令复现与布局对照，不表示已修复；截图操作由 Playwright 可选执行", reports };
fs.writeFileSync(path.join(__dirname, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log("PASS 6 个复现/对照谱、时间轴、占位命中、混合减时线和 loader 往返");

async function screenshots() {
  if (!process.env.PLAYWRIGHT_MODULE) return;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3000", { waitUntil: "networkidle" });
    for (const { name } of fixtures) {
      await page.locator('input[type="file"]').setInputFiles(path.join(output, `${name}.lxm`));
      await page.getByRole("button", { name: "导入并替换", exact: true }).click();
      await page.getByRole("application", { name: "六线谱编辑器" }).getByText(name, { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const toggle = page.getByRole("button", { name: "编辑面板", exact: true });
      if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
      const svg = page.getByRole("application", { name: "六线谱编辑器" });
      await svg.screenshot({ path: path.join(output, `${name}.png`) });
      console.log(`CAPTURE ${name}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
screenshots().catch((error) => { console.error(error); process.exitCode = 1; });
