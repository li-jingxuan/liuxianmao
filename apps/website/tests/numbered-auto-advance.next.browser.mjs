// Run against a running Next app with LXM_PLAYWRIGHT_MODULE set if needed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const origin = process.env.LXM_NEXT_ORIGIN ?? "http://localhost:3031";
const document = JSON.parse(await readFile(new URL("../../../packages/lxm-editor/example/ideal-score.lxm.json", import.meta.url), "utf8"));
const track = document.score.tracks[0];
const note = (id, tick, base, dots = 0) => ({
  id, tick, kind: "notes", rhythm: { base, dots }, items: [{ id: `${id}-item`, token: "1'" }],
});
const measure = (id, beats, events) => ({
  id, timeSignature: { numerator: 4, denominator: 4 }, barline: "single",
  chordSymbols: [], lyrics: [], tuplets: [], numberedVoice: { events, tuplets: [] },
  beats: beats.map(([tick, base]) => ({ id: `${id}-${tick}`, tick, kind: "rest", rhythm: { base, dots: 0 }, notes: [] })),
});
const screenshotMeasure = track.measures[28];
const revisedMeasure = structuredClone(screenshotMeasure);
revisedMeasure.id = "m29-revised";
for (const event of revisedMeasure.numberedVoice.events) {
  event.id = `revised-${event.id}`;
  for (const item of event.items) item.id = `revised-${item.id}`;
  if (event.tick === 2640) event.rhythm.dots = 0;
  if (event.tick === 3000) event.tick = 2880;
}
revisedMeasure.beats = revisedMeasure.beats.map((beat) => ({ ...beat, id: `revised-${beat.id}`, notes: [] }));
revisedMeasure.chordSymbols = [];
revisedMeasure.lyrics = [];
track.techniques = [];
track.numberedMarks = [];
delete track.playbackReplay;
track.measures = [
  measure("advance", [[0, "eighth"], [480, "eighth"], [960, "quarter"], [1920, "quarter"], [2880, "quarter"]], [note("previous", 0, "eighth")]),
  measure("exact-fit", [[0, "quarter"], [960, "quarter"], [1920, "quarter"], [2880, "eighth"], [3360, "sixteenth"], [3600, "sixteenth"]], [note("exact-first", 2880, "sixteenth"), note("exact-second", 3120, "eighth")]),
  screenshotMeasure,
  revisedMeasure,
  measure("inherited-batch", [[0, "quarter"], [960, "quarter"], [1920, "eighth"], [2400, "sixteenth"], [2640, "sixteenth"], [2880, "quarter"]], [
    note("batch-dotted", 1440, "eighth", 1), note("batch-short", 2160, "sixteenth"), note("batch-after", 3000, "eighth"),
  ]),
];

const browser = await chromium.launch({ executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "导入曲谱", exact: true }).click();
  const importer = page.getByRole("dialog", { name: "导入曲谱" });
  await importer.locator('input[type="file"]').setInputFiles({
    name: "numbered-auto-advance.lxm", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
  });
  await importer.getByRole("button", { name: "打开曲谱", exact: true }).click();
  await page.waitForURL("**/editor");
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const popover = page.locator("[id$=music-text-edit-popover]");
  const input = popover.getByRole("textbox", { name: "简谱内容", exact: true });
  const advance = popover.getByRole("checkbox", { name: "应用后跳转到下一处" });
  const apply = popover.getByRole("button", { name: "应用简谱内容", exact: true });
  const rhythm = (name) => popover.getByRole("group", { name: "常用时值" }).getByRole("button", { name, exact: true });
  const toolbarRhythm = (name) => page.getByRole("group", { name: "基础时值" }).getByRole("button", { name: `设置为${name}`, exact: true });
  const select = async (id) => {
    await score.locator(`text[data-numbered-event="${id}"]`).first().click({ force: true });
    await input.waitFor();
  };
  const savedMeasure = (measureId) => score.evaluate((svg, id) => {
    const key = Object.keys(svg).find((name) => name.startsWith("__reactFiber$"));
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const state = fiber.memoizedProps?.session?.getState();
      if (state?.document) return state.document.score.tracks[0].measures.find((m) => m.id === id);
    }
    throw new Error("Missing score session");
  }, measureId);
  const events = async (measureId) => (await savedMeasure(measureId)).numberedVoice.events;
  const scorePoint = (target) => score.evaluate((svg, position) => {
    const key = Object.keys(svg).find((name) => name.startsWith("__reactFiber$"));
    let root = svg[key];
    while (root.return) root = root.return;
    const findLayout = (fiber) => fiber && (fiber.memoizedProps?.layout?.systems ? fiber.memoizedProps.layout :
      findLayout(fiber.child) ?? findLayout(fiber.sibling));
    const measure = findLayout(root.stateNode.current).systems.flatMap((system) => system.measures)
      .find(({ id }) => id === position.measureId);
    const beat = measure.beats.find(({ id }) => id === position.beatId);
    const point = new DOMPoint(beat.x, measure.strings[0].y1).matrixTransform(svg.getScreenCTM());
    return { x: point.x, y: point.y };
  }, target);
  const selectPosition = async (target) => {
    if (target.tick !== undefined) {
      const placeholder = score.locator(`[data-paragraph-cell^="numbered/${target.measureId}/${target.tick}/"]`);
      await placeholder.waitFor({ state: "attached", timeout: 5000 });
      await placeholder.scrollIntoViewIfNeeded();
      const point = await placeholder.evaluate((node) => {
        const box = node.getBBox();
        const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(node.getScreenCTM());
        return { x: point.x, y: point.y };
      });
      await page.mouse.click(point.x, point.y);
      return;
    }
    const point = await scorePoint(target);
    await page.mouse.click(point.x, point.y);
  };

  // 先在既有小节首音录入十六分音符，随后跳入同小节 480 tick 的八分时间窗。
  await select("previous");
  await advance.check();
  await input.fill("2");
  await rhythm("十六分音符").click();
  // 先跨过缩短原音后生成的十六分 gap，确认旧偏好确实已生效。
  await input.press("Enter");
  await rhythm("十六分音符").and(popover.locator('[aria-pressed="true"]')).waitFor();
  assert.equal(await input.inputValue(), "");
  await input.fill("3");
  await input.press("Enter");
  await popover.getByText(/第1拍 \+ 1\/2/).waitFor();
  const destinationEighth = await rhythm("八分音符").getAttribute("aria-pressed");
  const toolbarEighth = await toolbarRhythm("八分音符").getAttribute("aria-pressed");
  const sidebarEighth = page.locator('[data-presentation="sidebar"]').getByRole("button", { name: "八分音符", exact: true });
  assert.equal(await sidebarEighth.getAttribute("aria-pressed"), "true");
  await input.fill("4 5");
  await input.press("Enter");
  const entered = (await events("advance")).filter((event) => event.tick >= 480);
  console.log("BUG-069 next slot", JSON.stringify(entered.map((event) => [event.tick, event.rhythm])));

  // 到达下一格后可重新显式选择上一格用过的十六分时值。
  await input.fill("6");
  await rhythm("十六分音符").click();
  await input.press("Enter");
  const explicit = (await events("advance")).find((event) => event.items[0]?.token === "6");
  assert.deepEqual(explicit?.rhythm, { base: "sixteenth", dots: 0 });

  // 顶部工具栏以刚到达的虚拟格为基础计算附点，同时更新气泡显示和实际提交的时值。
  const topDot = page.getByRole("group", { name: "附点与休止" }).getByRole("button", { name: "单附点", exact: true });
  await topDot.and(page.locator('[aria-pressed="true"]')).waitFor();
  await topDot.click();
  await rhythm("单附点").and(popover.locator('[aria-pressed="false"]')).waitFor();
  await input.fill("7");
  await input.press("Enter");
  const undotted = (await events("advance")).find((event) => event.items[0]?.token === "7");
  assert.deepEqual(undotted?.rhythm, { base: "eighth", dots: 0 });

  // BUG-070 的真实余量：3120 + 720 恰好到 4/4 小节尾，允许附点并保留前面的十六分音符。
  await select("exact-second");
  await advance.uncheck();
  await input.fill("5");
  await rhythm("单附点").click();
  assert.equal(await apply.isEnabled(), true);
  await input.press("Enter");
  assert.deepEqual((await events("exact-fit")).map(({ tick, rhythm, items }) => [tick, rhythm.base, rhythm.dots, items[0].token]), [
    [2880, "sixteenth", 0, "1'"], [3120, "eighth", 1, "5"],
  ]);

  // 截图音符实际落在 3240 tick，只够 600 tick。必须继续阻止跨小节且不改动前音。
  await select("numbered-event-592-1");
  const before = await events(screenshotMeasure.id);
  assert.equal(await input.inputValue(), "1'");
  await rhythm("单附点").click();
  const overflow = popover.getByRole("status").filter({ hasText: "已超出本小节末尾" });
  await overflow.waitFor({ timeout: 5000 });
  assert.equal(await apply.isDisabled(), true);
  await input.press("Enter");
  assert.deepEqual(await events(screenshotMeasure.id), before);
  console.log("BUG-070 exact fit accepted, screenshot overflow rejected", await overflow.textContent());

  // 新截图中手动点中的是 3120–3240 的虚拟空位。先加点吃进空格，再取消附点释放空格。
  await select("revised-numbered-event-592-1");
  await rhythm("八分音符").click();
  const revisedBefore = await events(revisedMeasure.id);
  await select("revised-numbered-event-590-2");
  await rhythm("单附点").click();
  const withDot = await events(revisedMeasure.id);
  assert.equal(withDot.find(({ tick }) => tick === 2880)?.rhythm.dots, 1);
  assert.deepEqual(withDot.filter(({ tick }) => tick !== 2880), revisedBefore.filter(({ tick }) => tick !== 2880));
  await rhythm("单附点").click();
  assert.deepEqual(await events(revisedMeasure.id), revisedBefore);

  // 在后一音重新选择八分，复现上次偏好跨进后音。新格默认三十二分，可直接应用。
  await select("revised-numbered-event-592-1");
  await rhythm("八分音符").click();
  await selectPosition({ measureId: revisedMeasure.id, tick: 3120 });
  assert.equal(await rhythm("三十二分音符").getAttribute("aria-pressed"), "true");
  assert.equal(await toolbarRhythm("三十二分音符").getAttribute("aria-pressed"), "true");
  await input.fill("1");
  assert.equal(await apply.isEnabled(), true);
  await input.press("Enter");
  const filled = await events(revisedMeasure.id);
  assert.deepEqual(filled.find(({ tick }) => tick === 3120)?.rhythm, { base: "thirtySecond", dots: 0 });
  assert.deepEqual(filled.filter(({ tick }) => tick !== 3120), revisedBefore);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.deepEqual(await events(revisedMeasure.id), revisedBefore);
  await select("revised-numbered-event-592-1");
  await selectPosition({ measureId: revisedMeasure.id, tick: 3120 });
  // 先用顶部工具栏手选八分，再输入；本格的主动选择必须报错，不能当作旧偏好静默回退。
  await toolbarRhythm("八分音符").click();
  await rhythm("八分音符").and(popover.locator('[aria-pressed="true"]')).waitFor();
  await input.fill("1");
  const issue = popover.getByRole("status").filter({ hasText: "所选时值会占用后面的简谱音符。请缩短时值或取消附点。" });
  await issue.waitFor();
  assert.equal(await apply.isDisabled(), true);
  assert.deepEqual(await events(revisedMeasure.id), revisedBefore);
  // 同一份草稿可以选短时值修正。在这个空位上，三十二分的附点也会碰到后音。
  await rhythm("三十二分音符").click();
  assert.equal(await apply.isEnabled(), true);
  await rhythm("单附点").click();
  await issue.waitFor();
  assert.equal(await apply.isDisabled(), true);
  await rhythm("单附点").click();
  assert.equal(await apply.isEnabled(), true);
  await input.press("Enter");
  assert.deepEqual((await events(revisedMeasure.id)).find(({ tick }) => tick === 3120)?.rhythm, { base: "thirtySecond", dots: 0 });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.deepEqual(await events(revisedMeasure.id), revisedBefore);
  console.log("BUG-070 revised gap: toggle round-trip, guarded explicit overlap, 3120–3240 saved without neighbor changes");

  // 上一格选的八分能放入第一个连续空窗，但第二项只能用后音前的三十二分余量。
  await input.press("Escape");
  await select("batch-after");
  await rhythm("八分音符").click();
  const batchBefore = await events("inherited-batch");
  await selectPosition({ measureId: "inherited-batch", tick: 2400 });
  assert.equal(await rhythm("八分音符").getAttribute("aria-pressed"), "true");
  await input.fill("2 3");
  assert.equal(await apply.isEnabled(), true, await popover.innerText());
  await input.press("Enter");
  const batch = await events("inherited-batch");
  assert.deepEqual(batch.filter(({ tick }) => tick === 2400 || tick === 2880).map(({ tick, rhythm, items }) => [tick, rhythm, items[0].token]), [
    [2400, { base: "eighth", dots: 0 }, "2"], [2880, { base: "thirtySecond", dots: 0 }, "3"],
  ]);
  assert.deepEqual(batch.filter(({ tick }) => tick !== 2400 && tick !== 2880), batchBefore);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.deepEqual(await events("inherited-batch"), batchBefore);
  console.log("BUG-070 inherited batch saved as eighth + thirty-second and undone");
  await input.press("Escape");
  await selectPosition({ measureId: "inherited-batch", tick: 2400 });
  await input.fill("2 3");
  await rhythm("八分音符").click();
  await issue.waitFor();
  assert.equal(await apply.isDisabled(), true);
  assert.deepEqual(await events("inherited-batch"), batchBefore);

  // 再切到实际 TAB 空拍，顶部工具栏应读写 TAB，自身的四分时值不继承简谱录入偏好。
  await input.press("Escape");
  await selectPosition({ measureId: "advance", beatId: "advance-2880" });
  assert.equal(await toolbarRhythm("四分音符").getAttribute("aria-pressed"), "true");
  await toolbarRhythm("八分音符").click();
  assert.deepEqual((await savedMeasure("advance")).beats.find(({ id }) => id === "advance-2880").rhythm, { base: "eighth", dots: 0 });

  // 手选四分从 2880 延伸到小节末时，会完整盖住后音，应用前必须确认影响。
  await selectPosition({ measureId: "inherited-batch", tick: 2880 });
  await input.fill("4");
  await rhythm("四分音符").click();
  await input.press("Enter");
  const impact = page.getByRole("dialog", { name: "确认简谱修改影响" });
  await impact.waitFor();
  assert.deepEqual(await events("inherited-batch"), batchBefore);
  await impact.getByRole("button", { name: /取.*消/ }).click();
  assert.deepEqual(await events("inherited-batch"), batchBefore);

  assert.equal(destinationEighth, "true");
  assert.equal(toolbarEighth, "true");
  assert.deepEqual(entered.map(({ tick, rhythm, items }) => [tick, rhythm.base, rhythm.dots, items[0].token]), [
    [480, "eighth", 0, "4"], [960, "quarter", 0, "5"],
  ]);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
