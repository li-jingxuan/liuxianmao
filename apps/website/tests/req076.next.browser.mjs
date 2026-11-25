import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(runtime.startsWith("/") ? pathToFileURL(runtime).href : runtime);
const browser = await chromium.launch({
  channel: process.env.LXM_BROWSER_CHANNEL,
  executablePath: process.env.LXM_BROWSER_EXECUTABLE,
});

const rhythm = { base: "quarter", dots: 0 };
const fixture = {
  schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
  score: {
    id: "req076-score", title: "试听回归", arranger: "", keySignature: "C", meta: {},
    tracks: [{
      id: "track", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
      tuning: { strings: ["E4", "B3", "G3", "D3", "A2", "E2"].map((pitch, index) => ({
        index: index + 1, pitch, midi: [64, 59, 55, 50, 45, 40][index],
      })) },
      techniques: [], numberedMarks: [],
      measures: Array.from({ length: 25 }, (_, index) => ({
        id: `m${index}`, timeSignature: { numerator: index === 3 ? 3 : 4, denominator: 4 }, barline: "single",
        tuplets: [], chordSymbols: [], numberedVoice: { events: [], tuplets: [] }, lyrics: [],
        beats: Array.from({ length: index === 3 ? 3 : 4 }, (_, beat) => ({
          id: `m${index}-b${beat}`, tick: beat * 960, kind: "notes", rhythm,
          notes: [{ id: `m${index}-n${beat}`, string: 1, fret: beat }],
        })),
      })),
    }],
  },
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 680 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  const flushSyncErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/flushSync was called from inside a lifecycle method/i.test(message.text())) {
      flushSyncErrors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    window.audioStarts = 0;
    window.audioStops = 0;
    window.audioCloses = 0;
    window.clickStarts = 0;
    for (const [owner, method, counter] of [
      [AudioBufferSourceNode, "start", "audioStarts"], [AudioBufferSourceNode, "stop", "audioStops"],
      [AudioContext, "close", "audioCloses"], [OscillatorNode, "start", "clickStarts"],
    ]) {
      const original = owner.prototype[method];
      owner.prototype[method] = function (...args) {
        const result = original.apply(this, args);
        window[counter]++;
        return result;
      };
    }
  });
  await page.goto(process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor", { waitUntil: "domcontentloaded", timeout: 30000 });
  const score = page.locator('svg[aria-label="六线谱编辑器"]');
  const viewport = page.locator("[data-score-viewport]");
  const cursor = score.locator("[data-playback-cursor]");
  const toggle = page.getByRole("button", { name: "木吉他试听", exact: true });
  const exitPlayback = page.getByRole("button", { name: "退出试听", exact: true });
  const sidebar = page.getByRole("button", { name: "编辑面板", exact: true });
  const history = page.getByRole("button", { name: "操作历史", exact: true });
  const workspace = page.locator('[data-sidebar-collapsed]');
  const transport = page.getByRole("group", { name: "木吉他试听工具" });
  const play = transport.getByRole("button", { name: "播放", exact: true });
  const pause = transport.getByRole("button", { name: "暂停", exact: true });
  const resume = transport.getByRole("button", { name: "继续", exact: true });
  const stop = transport.getByRole("button", { name: "停止", exact: true });
  const start = transport.getByRole("combobox", { name: "播放起点" });
  const startControl = transport.locator(".ant-select");
  const startHighlight = score.locator("[data-playback-start-measure]");
  const metronome = transport.getByRole("group", { name: "试听节拍器" });
  const clickToggle = metronome.getByRole("checkbox", { name: "启用节拍器" });
  const clickSettings = metronome.getByRole("button", { name: "节拍器设置" });
  const currentClick = metronome.locator('[data-metronome-beats] [data-current="true"]');
  const tempo = transport.getByRole("spinbutton", { name: "速度，每分钟四分音符数" });
  const slider = transport.getByRole("slider", { name: "临时调速" });
  const resetTempo = transport.getByRole("button", { name: "恢复曲谱速度" });
  const editorTools = page.getByRole("toolbar", { name: "节奏、小节与历史工具" });
  const playbackTools = page.getByRole("toolbar", { name: "木吉他试听", exact: true });
  const firstTabFret = score.locator('[data-layer="score-music"] [data-system-index="0"]')
    .getByText("2", { exact: true }).first();
  const appendMeasure = score.getByRole("button", { name: "在曲末新增小节", exact: true });
  const clickMeasure = async (id) => {
    const number = score.locator(`[data-measure-number="${id}"]`);
    await number.scrollIntoViewIfNeeded();
    // 小节编号在小节线末端，向左下方点击 TAB 内部，覆盖与音符无关的整小节命中。
    const point = await number.evaluate((node) => {
      const x = Number(node.getAttribute("x"));
      const y = Number(node.getAttribute("y"));
      const { x: clientX, y: clientY } = new DOMPoint(x - 18, y + 12).matrixTransform(node.getScreenCTM());
      return { x: clientX, y: clientY };
    });
    await page.mouse.click(point.x, point.y);
    await score.locator(`[data-playback-start-measure="${id}"]`).waitFor();
    assert.equal(await startHighlight.count(), 1);
  };
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    return svg && Object.keys(svg).some((key) => key.startsWith("__reactFiber$"));
  }, undefined, { timeout: 60000, polling: 250 });
  const runInSession = (action, data) => score.evaluate((svg, { action, data }) => {
    const key = Object.keys(svg).find((name) => name.startsWith("__reactFiber$"));
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const state = fiber.memoizedProps?.session?.getState();
      if (!state?.document) continue;
      if (action === "load") return state.replaceDocument(JSON.stringify(data), "file");
      if (action === "select") {
        const target = data && { trackId: "track", measureId: data, beatId: `${data}-b0`, string: 1 };
        state.setSelection(target ? { anchor: target, focus: target } : null);
      }
      if (action === "rename") return state.execute({ type: "score.setInfo", title: "新的标题", arranger: "", keySignature: "C" });
      if (action === "editFret") return state.execute({
        type: "note.set", trackId: "track", measureId: data.measureId,
        beatId: `${data.measureId}-b0`, string: 1, fret: data.fret,
      });
      if (action === "snapshot") return { selection: state.selection, past: state.pastEntries.length, document: state.document, baseline: state.fileBaseline };
      return null;
    }
    throw new Error("Editor session unavailable");
  }, { action, data });
  assert.equal((await runInSession("load", fixture)).ok, true);
  await score.locator('[data-measure-number="m24"]').waitFor({ state: "attached" });

  const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
  const expectReadOnlyScore = async (phase, phaseButton, expected, locked = false) => {
    const oldStart = await startHighlight.getAttribute("data-playback-start-measure");
    await firstTabFret.click();
    assert.deepEqual(await runInSession("snapshot"), expected, `Score click during ${phase}`);
    if (locked) {
      assert.ok(await start.isDisabled());
      assert.equal(await startHighlight.getAttribute("data-playback-start-measure"), oldStart);
    } else {
      await startControl.getByText("从第 1 小节开始", { exact: true }).waitFor();
      await clickMeasure(oldStart);
    }
    await score.focus();
    assert.ok(await score.evaluate((svg) => document.activeElement === svg), `Score focus during ${phase}`);
    for (const key of ["ArrowRight", "8", "Delete", undoShortcut]) {
      await score.press(key);
      assert.deepEqual(await runInSession("snapshot"), expected, `${key} during ${phase}`);
    }
    await phaseButton.waitFor();
  };

  for (const width of [1440, 1600]) {
    await page.setViewportSize({ width, height: 680 });
    const editBounds = await editorTools.boundingBox();
    assert.ok((await toggle.boundingBox()).x < (await sidebar.boundingBox()).x);
    await toggle.click();
    await play.and(page.locator(":focus")).waitFor();
    assert.equal(await editorTools.count(), 0);
    assert.equal(await playbackTools.getByRole("group", { name: "木吉他试听工具" }).count(), 1);
    assert.equal(await transport.getByRole("button", { name: "跟随谱面", exact: true }).count(), 0);
    assert.ok(await clickToggle.isChecked());
    assert.equal(await page.getByRole("dialog", { name: "试听速度" }).count(), 0);
    assert.equal(await workspace.getAttribute("data-sidebar-collapsed"), "true");
    assert.ok(await history.isDisabled());
    assert.equal(await sidebar.count(), 0);
    assert.equal((await playbackTools.boundingBox()).height, editBounds.height, `Keeps a single toolbar row at ${width}px`);
    await play.press("Escape");
    await toggle.and(page.locator(":focus")).waitFor();
    await editorTools.waitFor();
    assert.ok(await history.isEnabled());
  }
  assert.deepEqual(flushSyncErrors, [], "Switching and focusing the toolbar logged a React flushSync lifecycle error");
  await page.setViewportSize({ width: 1440, height: 680 });
  if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
  await history.click();
  assert.equal(await workspace.getAttribute("data-history-open"), "true");
  await toggle.click();
  await play.and(page.locator(":focus")).waitFor();
  assert.equal(await workspace.getAttribute("data-history-open"), "false");
  await exitPlayback.click();
  await toggle.and(page.locator(":focus")).waitFor();
  assert.equal(await sidebar.getAttribute("aria-expanded"), "false", "Exit preserves a collapsed sidebar");
  assert.equal(await workspace.getAttribute("data-history-open"), "true");
  await history.click();
  const song = page.getByRole("tab", { name: "歌曲", exact: true });
  if (await sidebar.getAttribute("aria-expanded") === "false") await sidebar.click();
  await song.click();
  const title = page.getByRole("textbox", { name: "歌曲名称", exact: true });
  await title.fill("未应用的标题");
  await toggle.click();
  await play.and(page.locator(":focus")).waitFor();
  await title.waitFor({ state: "hidden" });
  assert.equal((await runInSession("snapshot")).document.score.title, "试听回归");
  await play.press("Escape");
  await title.waitFor();
  assert.equal(await title.inputValue(), "未应用的标题");
  await title.fill("试听回归");

  assert.equal((await runInSession("editFret", { measureId: "m24", fret: 4 })).ok, true);
  await runInSession("select", "m1");
  await toggle.click();
  await startControl.getByText("从头开始", { exact: true }).waitFor();
  assert.equal(await startHighlight.count(), 0);
  await clickMeasure("m3");
  await startControl.getByText("从第 4 小节开始", { exact: true }).waitFor();
  assert.equal(await metronome.locator("[data-metronome-beats] [data-current]").count(), 3, "拍号随选择的起点更新");
  await start.click();
  await page.locator(".ant-select-item-option-content").getByText("从头开始", { exact: true }).click();
  await startControl.getByText("从头开始", { exact: true }).waitFor();
  assert.equal(await startHighlight.count(), 0);
  await start.click();
  await page.locator(".ant-select-item-option-content").getByText("从第 2 小节开始", { exact: true }).click();
  await startHighlight.and(score.locator('[data-playback-start-measure="m1"]')).waitFor();
  await clickMeasure("m3");
  for (const copy of ["临时调速仅影响本次试听", "从当前小节开始", "未启用"])
    assert.equal(await transport.getByText(copy, { exact: true }).count(), 0);
  await slider.press("ArrowRight");
  assert.equal(await tempo.inputValue(), "91");
  await resetTempo.click();
  assert.equal(await tempo.inputValue(), "90");
  await tempo.fill("240");
  await tempo.press("Tab");
  const initial = await runInSession("snapshot");
  assert.ok(initial.past > 0, "The score has an edit available to undo");
  assert.equal(initial.selection?.focus.measureId, "m1");
  assert.equal(await appendMeasure.count(), 0, "The score append button is unavailable in playback mode");
  await expectReadOnlyScore("idle", play, initial);
  await startControl.getByText("从第 4 小节开始", { exact: true }).waitFor();

  const audioUrl = "**/assets/audio/meta-steel-guitar-v1/**";
  let release;
  const blockedRequest = new Promise((resolve) => { release = resolve; });
  const delayedAudio = async (route) => {
    await blockedRequest;
    await route.abort().catch(() => {});
  };
  await page.route(audioUrl, delayedAudio);
  const requestStarted = page.waitForRequest(audioUrl);
  await play.click();
  const loading = transport.getByRole("button", { name: "加载中…" });
  await loading.waitFor();
  await requestStarted;
  await expectReadOnlyScore("loading", loading, initial, true);
  await stop.click();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await play.waitFor();
  assert.equal(await cursor.count(), 0);
  assert.equal(await page.evaluate(() => window.audioStarts), 0);
  assert.equal(await page.evaluate(() => window.clickStarts), 0);
  await expectReadOnlyScore("stopped", play, initial);

  await page.route(audioUrl, (route) => route.fulfill({ status: 503 }));
  await play.click();
  const retry = transport.getByRole("button", { name: "重试", exact: true });
  await retry.waitFor();
  await page.getByRole("status").filter({ hasText: "试听失败" }).first().waitFor();
  await expectReadOnlyScore("error", retry, initial);
  await page.unrouteAll({ behavior: "wait" });
  await retry.click();
  await cursor.and(score.locator('[data-playback-measure="m3"]')).waitFor();
  await page.waitForFunction(() => window.audioStarts > 0 && window.clickStarts > 0);
  await currentClick.waitFor();
  await clickToggle.uncheck();
  assert.equal(await metronome.getAttribute("data-click-disabled"), "true");
  assert.equal(await metronome.evaluate((node) => getComputedStyle(node).filter), "grayscale(1)");
  assert.ok(await clickSettings.isDisabled());
  assert.ok(await clickToggle.isEnabled());
  assert.equal(await currentClick.count(), 0);
  assert.equal(await metronome.getByText("未启用", { exact: true }).count(), 0);
  const silenceStart = await page.evaluate(() => ({ guitar: window.audioStarts, click: window.clickStarts }));
  await page.waitForFunction((guitar) => window.audioStarts >= guitar + 2, silenceStart.guitar);
  assert.equal(await page.evaluate(() => window.clickStarts), silenceStart.click);
  assert.ok(await pause.isVisible(), "关闭节拍器后谱面仍在播放");
  await clickToggle.check();
  assert.equal(await metronome.getAttribute("data-click-disabled"), null);
  assert.ok(await clickSettings.isEnabled());
  await page.waitForFunction((click) => window.clickStarts > click, silenceStart.click);
  await currentClick.waitFor();
  await expectReadOnlyScore("playing", pause, initial, true);
  await pause.click();
  await cursor.and(score.locator("[data-paused]")).waitFor();
  const pausedBeat = await cursor.getAttribute("data-playback-beat");
  await expectReadOnlyScore("paused", resume, initial, true);
  const zoom = page.getByRole("button", { name: "放大谱面", exact: true });
  const priorWidth = (await cursor.locator("rect").boundingBox()).width;
  await zoom.click();
  assert.ok((await cursor.locator("rect").boundingBox()).width > priorWidth);
  assert.equal(await cursor.getAttribute("data-playback-beat"), pausedBeat);
  assert.deepEqual(await runInSession("snapshot"), initial);

  await resume.click();
  await pause.waitFor();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await resume.waitFor();
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await cursor.and(score.locator("[data-paused]")).waitFor();
  assert.ok(await page.evaluate(() => window.audioStops > 0));
  await resume.click();
  await pause.waitFor();
  assert.equal((await runInSession("rename")).ok, true);
  await cursor.waitFor();
  assert.ok(await pause.isVisible(), "An external title change keeps playback running");
  assert.equal((await runInSession("editFret", { measureId: "m3", fret: 8 })).ok, true);
  await play.waitFor();
  await cursor.waitFor({ state: "detached" });
  await page.getByRole("status").filter({ hasText: "谱面已更新" }).first().waitFor();

  const boundary = await page.locator("[data-measure-number]").evaluateAll((numbers) => {
    const previous = numbers.findLast((number, index) => index < numbers.length - 1 &&
      number.getAttribute("y") !== numbers[index + 1].getAttribute("y"));
    if (!previous) throw new Error("The playback fixture must span several systems");
    const index = numbers.indexOf(previous);
    return { before: previous.dataset.measureNumber, after: numbers[index + 1].dataset.measureNumber };
  });
  await clickMeasure(boundary.before);
  await play.click();
  await cursor.and(score.locator(`[data-playback-measure="${boundary.before}"]`)).waitFor();
  const previousSystem = await cursor.getAttribute("data-playback-system");
  const previousScroll = await viewport.evaluate((node) => {
    const marker = node.querySelector("[data-playback-cursor] rect").getBoundingClientRect();
    const view = node.getBoundingClientRect();
    node.scrollTop += marker.bottom - view.bottom + 10;
    return node.scrollTop;
  });
  await cursor.and(score.locator(`[data-playback-measure="${boundary.after}"]`)).waitFor();
  assert.notEqual(await cursor.getAttribute("data-playback-system"), previousSystem);
  await page.waitForFunction((previous) => document.querySelector("[data-score-viewport]").scrollTop > previous, previousScroll);
  await stop.click();

  await clickMeasure(boundary.before);
  await viewport.evaluate((element) => { element.scrollTop = 0; });
  await play.click();
  await cursor.and(score.locator(`[data-playback-measure="${boundary.before}"]`)).waitFor();
  await page.waitForFunction(() => document.querySelector("[data-score-viewport]").scrollTop > 100);
  await viewport.hover();
  await page.mouse.wheel(0, -10000);
  await page.waitForFunction(() => document.querySelector("[data-score-viewport]").scrollTop === 0);
  await cursor.and(score.locator(`[data-playback-measure="${boundary.after}"]`)).waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await viewport.evaluate((node) => node.scrollTop), 0, "手动滚动后跨谱行保留视口");
  await stop.click();
  await cursor.waitFor({ state: "detached" });
  await play.click();
  await pause.waitFor();
  await page.waitForFunction(() => document.querySelector("[data-score-viewport]").scrollTop > 100);
  const beforeExit = await runInSession("snapshot");
  await pause.press("Escape");
  await toggle.and(page.locator(":focus")).waitFor();
  await cursor.waitFor({ state: "detached" });
  assert.deepEqual(await runInSession("snapshot"), beforeExit, "Exiting playback preserves the editing selection");
  await toggle.click();
  assert.equal(await tempo.inputValue(), "90", "Exiting playback resets temporary tempo");
  await startControl.getByText("从头开始", { exact: true }).waitFor();
  assert.ok(await clickToggle.isChecked());
  await exitPlayback.click();
  await appendMeasure.waitFor({ state: "attached" });
  await firstTabFret.click();
  const afterClick = await runInSession("snapshot");
  assert.equal(afterClick.selection?.focus.beatId, "m0-b2", "Score clicks select notes after exit");
  await score.press("7");
  const afterEdit = await runInSession("snapshot");
  assert.equal(afterEdit.document.score.tracks[0].measures[0].beats[2].notes[0].fret, 7);
  assert.equal(afterEdit.past, afterClick.past + 1, "Keyboard editing records history after exit");

  await toggle.click();
  await play.click();
  await pause.waitFor();
  await cursor.and(score.locator('[data-playback-measure="m0"]')).waitFor();
  await clickToggle.uncheck();
  assert.equal((await runInSession("load", fixture)).ok, true);
  await editorTools.waitFor();
  await cursor.waitFor({ state: "detached" });
  await page.waitForFunction(() => window.audioCloses > 0);
  await toggle.click();
  assert.equal(await tempo.inputValue(), "90");
  await startControl.getByText("从头开始", { exact: true }).waitFor();
  assert.ok(await clickToggle.isChecked());
  await exitPlayback.click();
  const practice = page.getByRole("button", { name: "节拍器", exact: true });
  await practice.click();
  const practicePanel = page.getByRole("dialog", { name: "节拍器", exact: true });
  assert.equal(await practicePanel.getByRole("spinbutton", { name: "节拍器练习速度（BPM）" }).inputValue(), "90");
  assert.ok(!(await practicePanel.getByRole("checkbox", { name: "静音节拍器" }).isChecked()));
  const pastClicks = await page.evaluate(() => window.clickStarts);
  await practicePanel.getByRole("button", { name: "开始节拍器" }).click();
  await page.waitForFunction((previous) => window.clickStarts > previous, pastClicks);
  await practicePanel.getByRole("button", { name: "停止节拍器" }).click();
  assert.equal(await transport.count(), 0);
  assert.deepEqual(flushSyncErrors, []);
  assert.deepEqual(errors, []);
  console.log("REQ-076 / BUG-060 / BUG-074 / BUG-075 browser passed: toolbar focus, Ant Design start selector, single score selection, read-only score in every phase, default click audio and re-enable, automatic and manual scroll, drafts, editing after exit, external invalidation, background and document replacement.");
} finally {
  await browser.close();
}
