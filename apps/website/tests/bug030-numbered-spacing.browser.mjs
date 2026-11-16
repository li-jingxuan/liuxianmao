import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
// Normal runs validate against the preserved original baseline. Capture a new
// baseline only with an explicit BUG030_PHASE=before on unmodified core code.
const phase = process.env.BUG030_PHASE ?? "after";
assert.match(phase, /^(before|after)$/);
const output = path.resolve(website, `../../output/playwright/bug030/${phase}`);
const server = await createServer({
  root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, `node_modules/.vite/bug030-numbered-spacing-${phase}`),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "bug030-real-editor", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__bug030__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});

// Read the actual layout consumed by the live renderer. No synthetic layout or
// extra render is substituted for the EditorShell fixture.
async function measure(page, print = false) {
  return page.evaluate(({ print }) => {
    const svg = document.querySelector(print ? '[data-score-print-layer] svg' : 'svg[role="application"]');
    const editSvg = document.querySelector('svg[role="application"]');
    const fiberKey = Object.keys(editSvg).find(key => key.startsWith("__reactFiber$"));
    function findLayout(fiber) {
      if (!fiber) return null;
      if (fiber.memoizedProps?.layout?.systems) return fiber.memoizedProps.layout;
      return findLayout(fiber.child) ?? findLayout(fiber.sibling);
    }
    const layout = findLayout(editSvg[fiberKey]);
    const measureId = window.bug030.measureId;
    const m = layout.systems.flatMap(s => s.measures).find(m => m.id === measureId);
    const box = node => {
      const b = node.getBBox(); const r = node.getBoundingClientRect();
      return { svg: { x: b.x, y: b.y, width: b.width, height: b.height }, screen: { x: r.x, y: r.y, width: r.width, height: r.height } };
    };
    const labels = window.bug030.ids.map(id => {
      const node = svg.querySelector(`text[data-numbered-event="${id}"], [data-numbered-event="${id}"] text`);
      return { id, text: node.textContent, x: +node.getAttribute("x"), font: { family: node.getAttribute("font-family"), size: node.getAttribute("font-size"), weight: node.getAttribute("font-weight") }, ...box(node) };
    });
    const deltas = labels.slice(1).map((label, i) => label.x - labels[i].x);
    const glyphClearances = labels.slice(1).map((label, i) => label.svg.x - labels[i].svg.x - labels[i].svg.width);
    const timeAnchorAlignment = print ? [] : window.bug030.ids.map((id, i) => {
      const slot = m.numberedSlots.find(slot => slot.id === id);
      const anchor = m.timeAnchors.find(anchor => anchor.tick === slot.tick);
      const tab = m.beats.find(beat => beat.tick === slot.tick);
      return { id, tick: slot.tick, numberedX: labels[i].x, timeAnchorX: anchor.x, anchorDelta: labels[i].x - anchor.x, tabX: tab?.x ?? null, tabDelta: tab ? labels[i].x - tab.x : null };
    });
    // The real scene's TAB fret text at tick 1920 is "x". Read that SVG
    // glyph directly in both layers; presentation has a different layout.
    const firstLabel = labels[0];
    const tabCandidates = [...svg.querySelectorAll('text')].filter(node => node.textContent === 'x' && Math.abs(+node.getAttribute('x') - firstLabel.x) < 0.01 && +node.getAttribute('y') < +svg.querySelector(`text[data-numbered-event="${firstLabel.id}"], [data-numbered-event="${firstLabel.id}"] text`).getAttribute('y'));
    const tabGlyph = tabCandidates.sort((a, b) => +b.getAttribute('y') - +a.getAttribute('y'))[0];
    const tabAlignment = tabGlyph ? { tick: 1920, numberedX: firstLabel.x, tabX: +tabGlyph.getAttribute('x'), delta: firstLabel.x - +tabGlyph.getAttribute('x'), glyph: box(tabGlyph) } : null;
    const placeholders = [...svg.querySelectorAll('[data-paragraph-placeholder]')].filter(node => node.getAttribute('data-paragraph-cell')?.includes(`/${measureId}/`)).map(node => ({ cell: node.getAttribute('data-paragraph-cell'), kind: node.getAttribute('data-paragraph-placeholder'), ...box(node) }));
    const ctm = editSvg.getScreenCTM();
    const top = new DOMPoint(m.x, m.strings[0].y1 - 55).matrixTransform(ctm);
    const bottom = new DOMPoint(m.x + m.width, m.numberedNotation[0].labels[0].y + 45).matrixTransform(ctm);
    const crop = { x: Math.max(0, Math.floor(top.x - 12)), y: Math.max(0, Math.floor(top.y)), width: Math.ceil(bottom.x - top.x + 24), height: Math.ceil(bottom.y - top.y) };
    return { print, svgViewBox: svg.getAttribute('viewBox'), labels, deltas, span: labels[3].x - labels[0].x, glyphClearances, timeAnchorAlignment, tabAlignment, placeholders, editorMeasure: m, crop, scale: document.querySelector('[data-score-scale]').getAttribute('data-score-scale') };
  }, { print });
}

let browser;
let page;
const errors = [];
const results = [];
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}) });
  for (const width of [1400, 1600]) {
    page = await browser.newPage({ viewport: { width, height: 1100 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bug030__`);
    const score = page.getByRole("application", { name: "六线谱编辑器" });
    await score.waitFor({ timeout: 90000 });
    const fixture = await page.evaluate(() => {
      const original = structuredClone(window.coexistStore.getState().document);
      const document = structuredClone(original);
      const track = document.score.tracks[0];
      const measure = track.measures[5];
      const originalEvent = measure.numberedVoice.events.find(event => event.tick === 1920);
      if (!originalEvent) throw new Error('Default example missing measure 6 tick 1920');
      const ids = [0, 1, 2, 3].map(i => i ? `bug030-sixteenth-${i}` : originalEvent.id);
      const events = ["3", "3", "4", "5"].map((token, i) => ({ ...structuredClone(originalEvent), id: ids[i], tick: 1920 + i * 240, kind: "notes", rhythm: { base: "sixteenth", dots: 0 }, items: [{ id: i ? `bug030-item-${i}` : originalEvent.items[0].id, token }] }));
      measure.numberedVoice.events = measure.numberedVoice.events.filter(event => event.tick < 1920 || event.tick >= 2880).concat(events).sort((a, b) => a.tick - b.tick);
      const result = window.coexistStore.getState().replaceDocument(document);
      if (!result.ok) throw new Error(JSON.stringify(result));
      window.bug030 = { ids, measureId: measure.id };
      return { original, document, originalEvent, ids, measureId: measure.id };
    });
    assert.deepEqual(fixture.document.score.tracks[0].measures[5].beats, fixture.original.score.tracks[0].measures[5].beats);
    for (let i = 0; i < fixture.original.score.tracks[0].measures.length; i++) if (i !== 5) assert.deepEqual(fixture.document.score.tracks[0].measures[i], fixture.original.score.tracks[0].measures[i]);
    const digit = id => score.locator(`text[data-numbered-event="${id}"], [data-numbered-event="${id}"] text`).first();
    await digit(fixture.ids[0]).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-score-print-layer][data-print-ready="true"]').waitFor({ state: "attached" });
    await digit(fixture.ids[0]).scrollIntoViewIfNeeded();
    const snapshot = () => page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth }));
    const baseline = await snapshot();
    const edit = await measure(page);
    assert.ok(edit.glyphClearances.every(gap => gap >= 4), 'actual numbered glyphs need clear space');
    assert.ok(edit.timeAnchorAlignment.every(a => Math.abs(a.anchorDelta) < 0.01));
    assert.ok(edit.tabAlignment && Math.abs(edit.tabAlignment.delta) < 0.01, 'editing TAB/numbered tick 1920 alignment');
    await page.screenshot({ path: path.join(output, `${width}-editor.png`), animations: "disabled" });
    await page.screenshot({ path: path.join(output, `${width}-measure6-detail.png`), clip: edit.crop, animations: "disabled" });
    const selections = [];
    for (const [i, id] of fixture.ids.entries()) {
      await digit(id).click();
      await score.locator(`[data-numbered-event-focus="${id}"]`).waitFor();
      const selection = await page.evaluate(() => window.coexistStore.getState().numberedSelection);
      assert.equal(selection.eventId, id);
      const popover = page.locator('[data-text-surface="popover"]');
      assert.equal(await popover.getByRole('textbox', { name: '简谱内容', exact: true }).inputValue(), ["3", "3", "4", "5"][i]);
      assert.deepEqual(await snapshot(), baseline, "selection must preserve document, musical ticks/durations, and history");
      selections.push({ id, selection });
      await page.screenshot({ path: path.join(output, `${width}-selected-${i + 1}.png`), animations: "disabled" });
    }
    await page.keyboard.press("Escape");
    await page.emulateMedia({ media: "print" });
    const print = await measure(page, true);
    assert.ok(print.glyphClearances.every(gap => gap >= 4), 'actual printed glyphs need clear space');
    assert.ok(print.tabAlignment && Math.abs(print.tabAlignment.delta) < 0.01, 'presentation TAB/numbered tick 1920 alignment');
    let comparison;
    if (phase === 'after') {
      const before = JSON.parse(await readFile(path.resolve(output, '../before/result.json'), 'utf8')).results.find(result => result.width === width);
      comparison = {};
      for (const [name, current] of [['edit', edit], ['print', print]]) {
        const previous = before[name];
        assert.ok(current.deltas.every(delta => Math.abs(delta - 19.2) < 0.1), `${name}: each adjacent label must use the compact 19.2 target`);
        assert.ok(Math.abs(current.span - 57.6) < 0.1, `${name}: three intervals must total 57.6`);
        const ratio = current.span / previous.span;
        assert.ok(ratio <= (name === 'edit' ? 0.8 : 0.9), `${name}: spacing must measurably decrease from the saved real-font baseline`);
        for (const [i, label] of current.labels.entries()) {
          assert.deepEqual(label.font, previous.labels[i].font, `${name}: preserve font, weight and size`);
          assert.ok(Math.abs(label.svg.width - previous.labels[i].svg.width) < 0.05, `${name}: preserve real glyph width`);
          assert.ok(Math.abs(label.svg.height - previous.labels[i].svg.height) < 0.05, `${name}: preserve real glyph height`);
        }
        comparison[name] = { beforeDeltas: previous.deltas, afterDeltas: current.deltas, beforeSpan: previous.span, afterSpan: current.span, ratio, glyphDimensionsPreserved: true };
      }
    }
    await page.screenshot({ path: path.join(output, `${width}-print.png`), fullPage: true, animations: "disabled" });
    await page.pdf({ path: path.join(output, `${width}-print.pdf`), format: "A4", printBackground: true });
    await page.emulateMedia({ media: "screen" });
    // Generate and download the real product export, rather than a screenshot surrogate.
    await page.getByRole("button", { name: "导出 A4 图片", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('[data-image-export-status="ready"]').waitFor();
    await dialog.getByRole("button", { name: "仅生成当前页", exact: true }).click();
    await dialog.locator('[data-image-export-status="generated"]').waitFor({ timeout: 60000 });
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("link", { name: "下载图片", exact: true }).click()]);
    await download.saveAs(path.join(output, `${width}-export.png`));
    await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
    assert.deepEqual(await snapshot(), baseline);
    results.push({ width, fixture: { measureId: fixture.measureId, originalEvent: fixture.originalEvent, ids: fixture.ids }, edit, print, selections, comparison, preservedDocumentAndHistory: true });
    await writeFile(path.join(output, 'result.json'), JSON.stringify({ phase, results, errors }, null, 2));
    console.log(JSON.stringify({ width, phase, editDeltas: edit.deltas, editSpan: edit.span, printDeltas: print.deltas, printSpan: print.span }));
    await page.close();
  }
  assert.deepEqual(errors, []);
  if (phase === 'after') {
    const before = JSON.parse(await readFile(path.resolve(output, '../before/result.json'), 'utf8'));
    const summary = results.map(result => {
      const previous = before.results.find(entry => entry.width === result.width);
      const compact = layer => ({
        adjacentDistances: layer.deltas,
        threeIntervalSpan: layer.span,
        glyphClearances: layer.glyphClearances,
        labels: layer.labels.map(label => ({ text: label.text, x: label.x, font: label.font, glyph: label.svg })),
        tabAlignment: layer.tabAlignment ?? null,
        timeAnchorAlignment: layer.timeAnchorAlignment ?? [],
        numberedPlaceholders: layer.placeholders.filter(p => p.cell.startsWith('numbered/')),
      });
      return { width: result.width, before: { edit: compact(previous.edit), print: compact(previous.print) }, after: { edit: compact(result.edit), print: compact(result.print) }, comparison: result.comparison, preservedDocumentAndHistory: result.preservedDocumentAndHistory };
    });
    await writeFile(path.resolve(output, '../results.json'), JSON.stringify({ passed: true, units: 'SVG score units (screen geometry retained in phase results)', fixture: 'Default example, measure 6 tick1920 four sixteenths 3 3 4 5; original TAB and other measures retained', assertions: ['each adjacent label distance 19.2 ± 0.1', 'three intervals 57.6 ± 0.1', 'editing span ratio ≤ 0.8; presentation ≤ 0.9', 'font, size, weight and actual SVG glyph dimensions preserved', 'glyph clearance ≥ 4', 'numbered/time anchor alignment; same tick TAB alignment', 'four actual pointer clicks focus correct events and popover values', 'selection, print and real PNG export preserve document and history'], results: summary, errors }, null, 2));
  }
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" }).catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
