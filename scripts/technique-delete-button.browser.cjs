/* Real browser investigation of the existing technique-panel Delete button. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/nice02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const output = path.resolve(process.env.EDITOR_ARTIFACTS || 'artifacts/technique-delete-button');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const scenario of ['label', 'dash-start', 'dash-end', 'previous-arpeggio', 'previous-strum', 'previous-arpeggio-open', 'previous-strum-open']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const dir = path.join(output, scenario);
      await fs.mkdir(dir, { recursive: true });
      try {
        await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:3000', { waitUntil: 'domcontentloaded' });
        const svg = page.getByRole('application', { name: '六线谱编辑器' });
        await svg.waitFor();
        await page.evaluate(() => document.fonts.ready);
        const label = svg.locator('text').filter({ hasText: /^let ring$/ });
        await label.waitFor();
        const toolbar = page.getByRole('toolbar');
        const panel = page.locator('[data-tool-panel="technique"]');
        const open = async () => {
          if (!(await panel.isVisible())) await toolbar.getByRole('button', { name: '技巧工具', exact: true }).click();
          await panel.waitFor({ state: 'visible' });
        };
        const exported = async name => {
          const waiting = page.waitForEvent('download');
          await page.getByRole('button', { name: '导出曲谱', exact: true }).click();
          const download = await waiting;
          await download.saveAs(path.join(dir, `${name}.lxm`));
          return JSON.parse(await fs.readFile(await download.path(), 'utf8'));
        };
        const capture = async name => {
          const shapes = await svg.evaluate(element => {
            const attrs = item => Object.fromEntries([...item.attributes].map(a => [a.name, a.value]));
            return [...element.querySelectorAll('[data-system-index]')].map(group => ({
              system: group.getAttribute('data-system-index'),
              shapes: [...group.querySelectorAll('path,polygon,text')].map(item => { const b = item.getBBox(); const s = getComputedStyle(item); const screen = item.getBoundingClientRect(); return { tag: item.tagName, text: item.textContent, attrs: attrs(item), box: { x: b.x, y: b.y, width: b.width, height: b.height }, rendered: { display: s.display, visibility: s.visibility, opacity: s.opacity, stroke: s.stroke, screen: { x: screen.x, y: screen.y, width: screen.width, height: screen.height } } }; }),
            }));
          });
          await fs.writeFile(path.join(dir, `${name}.svg`), await svg.evaluate(element => element.outerHTML));
          await fs.writeFile(path.join(dir, `${name}-shapes.json`), JSON.stringify(shapes, null, 2));
          await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
          return shapes;
        };
        const clickSvg = async point => {
          const screen = await svg.evaluate((element, p) => {
            const result = new DOMPoint(p.x, p.y).matrixTransform(element.getScreenCTM());
            return { x: result.x, y: result.y };
          }, point);
          await page.mouse.click(screen.x, screen.y);
        };
        const before = await exported('before');
        await label.scrollIntoViewIfNeeded();
        const geometry = await label.evaluate(element => {
          const group = element.parentNode;
          const dashed = [...group.querySelectorAll('path[stroke-dasharray]')].at(-1);
          const numbers = dashed.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
          const waves = [...group.querySelectorAll('path')].filter(item => / Q /.test(item.getAttribute('d')));
          const straight = [...group.querySelectorAll('path')].filter(item => /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/.test(item.getAttribute('d')) && item.getAttribute('stroke-width') === '1.2');
          const midpoint = item => { const box = item.getBBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
          return { dash: dashed.getAttribute('d'), start: { x: numbers[0], y: numbers[1] }, end: { x: numbers[2], y: numbers[3] }, arpeggio: waves.map(midpoint), strum: straight.map(midpoint) };
        });
        const shapesBefore = await capture('before');
        let previousPanel = null;
        if (scenario.startsWith('previous-')) {
          const point = scenario.startsWith('previous-arpeggio') ? geometry.arpeggio[0] : geometry.strum[0];
          assert(point, 'previous technique glyph located');
          await clickSvg(point);
          await open();
          previousPanel = await panel.innerText();
          if (!scenario.endsWith('-open')) {
            await page.keyboard.press('Escape');
            await panel.waitFor({ state: 'hidden' });
          }
        }
        if (scenario === 'dash-start') await clickSvg({ x: geometry.start.x + 1, y: geometry.start.y });
        else if (scenario === 'dash-end') await clickSvg({ x: geometry.end.x - 1, y: geometry.end.y });
        else await label.click();
        // Let click-away close the previously open popover before reopening it.
        await page.waitForTimeout(250);
        await open();
        const panelText = await panel.innerText();
        const selectedShapes = await capture('selected');
        assert.match(panelText, /已选：Let Ring/, 'panel must actually load let ring before deletion');
        await panel.getByRole('button', { name: '删除技巧', exact: true }).click();
        await panel.waitFor({ state: 'hidden' });
        const shapesAfter = await capture('after');
        const after = await exported('after');
        const expected = structuredClone(before);
        expected.documentRevision = after.documentRevision;
        const removed = expected.score.tracks.flatMap(track => track.techniques.filter(t => t.type === 'letRing'));
        for (const track of expected.score.tracks) track.techniques = track.techniques.filter(t => t.type !== 'letRing');
        assert.equal(removed.length, 1);
        assert.deepEqual(after, expected, 'export changes only by removing selected letRing');
        const systemBefore = shapesBefore.find(s => s.shapes.some(t => t.text === 'let ring'));
        const systemAfter = shapesAfter.find(s => s.system === systemBefore.system);
        const techniqueShapes = system => system.shapes.filter(s => (s.tag === 'path' || s.tag === 'polygon') && (s.attrs['stroke-width'] === '1.2' || s.tag === 'polygon'));
        const actualBefore = techniqueShapes(systemBefore), actualAfter = techniqueShapes(systemAfter);
        const traversalGlyphs = systems => systems.flatMap(system => system.shapes
          .filter(s => s.tag === 'path' && s.attrs['stroke-width'] === '1.2' && s.box.height > 20 && s.box.width < 3)
          .map(s => ({ system: system.system, type: s.box.width > 0 ? 'arpeggio' : 'strum', d: s.attrs.d, box: s.box, rendered: s.rendered })));
        const glyphsBefore = traversalGlyphs(shapesBefore), glyphsAfter = traversalGlyphs(shapesAfter);
        assert.deepEqual(glyphsBefore.map(g => g.type).sort(), ['arpeggio', 'strum']);
        assert.deepEqual(glyphsAfter.map(g => g.type).sort(), ['arpeggio', 'strum'], 'both visible SVG traversal glyphs survive deletion across all systems');
        assert(glyphsAfter.every(g => g.rendered.display !== 'none' && g.rendered.visibility === 'visible' && Number(g.rendered.opacity) > 0 && g.rendered.stroke !== 'none' && g.rendered.screen.height > 0));
        assert.equal(shapesAfter.flatMap(s => s.shapes).filter(s => s.text === 'let ring').length, 0);
        assert.deepEqual(errors, []);
        const blue = selectedShapes.flatMap(s => s.shapes).filter(s => s.attrs.fill === '#2864e3' || s.attrs.stroke === '#2864e3');
        const result = { scenario, geometry, previousPanel, panelText, removed, beforeTechniques: before.score.tracks.flatMap(t => t.techniques), afterTechniques: after.score.tracks.flatMap(t => t.techniques), actualBefore, actualAfter, glyphsBefore, glyphsAfter, blue, errors, onlyLetRingRemoved: true };
        await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
        await fs.rm(path.join(dir, 'failure.txt'), { force: true });
        await fs.rm(path.join(dir, 'failure.png'), { force: true });
        results.push(result);
        console.log(`PASS ${scenario}: selected Let Ring; only letRing removed; arpeggio/strum SVG system ${glyphsBefore[0].system}→${glyphsAfter[0].system}`);
      } catch (error) {
        await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true });
        await fs.writeFile(path.join(dir, 'failure.txt'), String(error.stack) + '\n' + await page.locator('body').innerText());
        throw error;
      } finally { await context.close(); }
    }
    await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ browser: await browser.version(), url: process.env.EDITOR_URL || 'http://127.0.0.1:3000', results }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
