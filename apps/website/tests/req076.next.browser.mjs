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
        id: `m${index}`, timeSignature: { numerator: 4, denominator: 4 }, barline: "single",
        tuplets: [], chordSymbols: [], numberedVoice: { events: [], tuplets: [] }, lyrics: [],
        beats: Array.from({ length: 4 }, (_, beat) => ({
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
    for (const [owner, method, counter] of [
      [AudioBufferSourceNode, "start", "audioStarts"], [AudioBufferSourceNode, "stop", "audioStops"],
      [AudioContext, "close", "audioCloses"],
    ]) {
      const original = owner.prototype[method];
      owner.prototype[method] = function (...args) {
        const result = original.apply(this, args);
        window[counter]++;
        return result;
      };
    }
  });
  await page.goto(process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor");
  const score = page.locator('svg[aria-label="六线谱编辑器"]');
  const viewport = page.locator("[data-score-viewport]");
  const cursor = score.locator("[data-playback-cursor]");
  const toggle = page.getByRole("button", { name: "木吉他试听", exact: true });
  const sidebar = page.getByRole("button", { name: "编辑面板", exact: true });
  const transport = page.getByRole("group", { name: "木吉他试听工具" });
  const play = transport.getByRole("button", { name: "播放", exact: true });
  const pause = transport.getByRole("button", { name: "暂停", exact: true });
  const resume = transport.getByRole("button", { name: "继续", exact: true });
  const stop = transport.getByRole("button", { name: "停止", exact: true });
  const follow = transport.getByRole("button", { name: "跟随谱面", exact: true });
  const start = transport.getByRole("combobox", { name: "播放起点" });
  const tempo = transport.getByRole("spinbutton", { name: "速度，每分钟四分音符数" });
  const editorTools = page.getByRole("toolbar", { name: "节奏、小节与历史工具" });
  const playbackTools = page.getByRole("toolbar", { name: "木吉他试听", exact: true });
  const firstTabFret = score.locator('[data-layer="score-music"] [data-system-index="0"]')
    .getByText("2", { exact: true }).first();
  const appendMeasure = score.getByRole("button", { name: "在曲末新增小节", exact: true });
  const waitForAttribute = async (selector, attribute, value) => {
    await page.waitForFunction(({ selector, attribute, value }) => document.querySelector(selector)?.getAttribute(attribute) === value,
      { selector, attribute, value });
  };
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    return svg && Object.keys(svg).some((key) => key.startsWith("__reactFiber$"));
  });
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
  const expectReadOnlyScore = async (phase, phaseButton, expected) => {
    await firstTabFret.click();
    assert.deepEqual(await runInSession("snapshot"), expected, `Score click during ${phase}`);
    await score.focus();
    assert.ok(await score.evaluate((svg) => document.activeElement === svg), `Score focus during ${phase}`);
    for (const key of ["ArrowRight", "8", "Delete", undoShortcut]) {
      await score.press(key);
      assert.deepEqual(await runInSession("snapshot"), expected, `${key} during ${phase}`);
    }
    await phaseButton.waitFor();
  };

  const wrapper = page.locator('[class*="editorContentWrapper"]');
  for (const width of [1440, 960, 959, 375]) {
    // Exercise the toolbar container query independently of the page's 1400px desktop canvas.
    await wrapper.evaluate((node) => { node.style.minWidth = "0"; });
    await page.setViewportSize({ width, height: 680 });
    const editBounds = await editorTools.boundingBox();
    assert.equal(editBounds.height, width < 960 ? 89 : 45, `Editing toolbar height at ${width}px`);
    assert.ok((await toggle.boundingBox()).x < (await sidebar.boundingBox()).x);
    await toggle.click();
    await play.and(page.locator(":focus")).waitFor();
    assert.equal(await editorTools.count(), 0);
    assert.equal((await playbackTools.boundingBox()).height, editBounds.height, `Toolbar height at ${width}px`);
    await play.press("Escape");
    await toggle.and(page.locator(":focus")).waitFor();
    await editorTools.waitFor();
  }
  assert.deepEqual(flushSyncErrors, [], "Switching and focusing the toolbar logged a React flushSync lifecycle error");
  await page.setViewportSize({ width: 1440, height: 680 });
  await wrapper.evaluate((node) => { node.style.removeProperty("min-width"); });
  const song = page.getByRole("tab", { name: "歌曲", exact: true });
  if (await sidebar.getAttribute("aria-expanded") === "false") await sidebar.click();
  await song.click();
  const title = page.getByRole("textbox", { name: "歌曲名称", exact: true });
  await title.fill("未应用的标题");
  await toggle.click();
  await play.and(page.locator(":focus")).waitFor();
  assert.equal(await title.inputValue(), "未应用的标题");
  assert.equal((await runInSession("snapshot")).document.score.title, "试听回归");
  await play.press("Escape");
  await title.fill("试听回归");

  await runInSession("select", null);
  await toggle.click();
  assert.ok(await start.locator('option[value="current"]').isDisabled());
  await play.press("Escape");
  await editorTools.waitFor();
  assert.equal((await runInSession("editFret", { measureId: "m24", fret: 4 })).ok, true);
  await runInSession("select", "m3");
  await toggle.click();
  await start.selectOption("current");
  await tempo.fill("240");
  await tempo.press("Tab");
  const initial = await runInSession("snapshot");
  assert.ok(initial.past > 0, "The score has an edit available to undo");
  assert.equal(initial.selection?.focus.measureId, "m3");
  assert.equal(await appendMeasure.count(), 0, "The score append button is unavailable in playback mode");
  await expectReadOnlyScore("idle", play, initial);
  assert.equal(await start.inputValue(), "current");

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
  await expectReadOnlyScore("loading", loading, initial);
  await stop.click();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await play.waitFor();
  assert.equal(await cursor.count(), 0);
  assert.equal(await page.evaluate(() => window.audioStarts), 0);
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
  await page.waitForFunction(() => window.audioStarts > 0);
  await expectReadOnlyScore("playing", pause, initial);
  await pause.click();
  await cursor.and(score.locator("[data-paused]")).waitFor();
  const pausedBeat = await cursor.getAttribute("data-playback-beat");
  await expectReadOnlyScore("paused", resume, initial);
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
  await runInSession("select", boundary.before);
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
  assert.equal(await follow.getAttribute("aria-pressed"), "true");
  await stop.click();

  await runInSession("select", "m18");
  await viewport.evaluate((element) => { element.scrollTop = 0; });
  await play.click();
  await cursor.and(score.locator('[data-playback-measure="m18"]')).waitFor();
  await page.waitForFunction(() => document.querySelector("[data-score-viewport]").scrollTop > 100);
  assert.equal(await follow.getAttribute("aria-pressed"), "true");
  await viewport.hover();
  await page.mouse.wheel(0, -130);
  await waitForAttribute('#editor-playback-controls [aria-pressed]', "aria-pressed", "false");
  await stop.click();
  await cursor.waitFor({ state: "detached" });
  await waitForAttribute('#editor-playback-controls [aria-pressed]', "aria-pressed", "true");
  await play.click();
  await pause.waitFor();
  const beforeExit = await runInSession("snapshot");
  await pause.press("Escape");
  await toggle.and(page.locator(":focus")).waitFor();
  await cursor.waitFor({ state: "detached" });
  assert.deepEqual(await runInSession("snapshot"), beforeExit, "Exiting playback preserves the editing selection");
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
  assert.equal((await runInSession("load", fixture)).ok, true);
  await editorTools.waitFor();
  await cursor.waitFor({ state: "detached" });
  await page.waitForFunction(() => window.audioCloses > 0);
  await toggle.click();
  assert.equal(await tempo.inputValue(), "90");
  assert.equal(await start.inputValue(), "beginning");
  assert.deepEqual(flushSyncErrors, []);
  assert.deepEqual(errors, []);
  console.log("REQ-076 / BUG-060 browser passed: toolbar focus, read-only score in every playback phase, editing after exit, external invalidation, drafts, audio, cursor, scroll, background and document replacement.");
} finally {
  await browser.close();
}
