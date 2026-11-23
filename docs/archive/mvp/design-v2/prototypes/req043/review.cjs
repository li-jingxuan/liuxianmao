// Reviews the independent v2.1 design prototype. Never opens the product editor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.LXM_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.PROTOTYPE_URL || 'http://127.0.0.1:4191/docs/archive/mvp/design-v2/prototypes/req043/';
const output = path.join(__dirname, 'screenshots/v2.1');
const checks = [];
const errors = [];

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    const snapshot = () => page.evaluate(() => window.__req043);
    const open = async () => { if (!(await snapshot()).open) await page.click('#rhythm-trigger'); };
    const choose = id => page.click(`#template-${id}`);
    const shot = name => page.screenshot({ path: path.join(output, name), fullPage: page.viewportSize().width > 780, animations: 'disabled' });
    const scene = async (scenario = 'single', meter = '4/4', range = 'beat', layer = 'jian') => {
      await page.selectOption('#review-scenario', scenario);
      await page.selectOption('#review-meter', meter);
      await page.selectOption('#review-range', { beat: 'single', incomplete: 'short' }[range] || range);
      await page.selectOption('#review-layer', layer);
      await page.click('#review-reset');
      await open();
    };
    const apply = async () => {
      await page.click('#apply-rhythm');
      await page.waitForFunction(() => !window.__req043.busy);
    };
    const firstBeat = (state, layer = 'jian') => state.score[layer].filter(event => event.start < state.unit);
    const content = event => event.kind === 'rest' ? 'rest' : event.kind === 'gap' ? 'gap' : event.pitches?.[0] ?? event.positions?.[0]?.fret;

    await scene();
    assert.equal(await page.locator('[data-target], [data-scope], #template-search').count(), 0);
    assert.equal(await page.locator('#rhythm-trigger').count(), 1);
    assert.equal(await page.locator('#template-grid [data-template]').count(), 12);
    assert.doesNotMatch(await page.locator('#rhythm-dialog').innerText(), /双谱|仅简谱|仅六线谱/);
    let before = await snapshot();
    await choose('sixteenths');
    assert.deepEqual((await snapshot()).score, before.score);
    await page.keyboard.press('Escape');
    assert.equal((await snapshot()).open, false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'rhythm-trigger');
    assert.deepEqual((await snapshot()).score, before.score);
    checks.push('v2 has one replacement entry and no target, dual-layer, scope or search controls; choosing and cancelling only change the preview.');

    await open();
    await choose('eight-sixteen');
    await shot('01-single-note.png');
    await apply();
    let after = await snapshot();
    assert.deepEqual(firstBeat(after).map(content), [1, 'gap', 'gap']);
    assert.deepEqual(firstBeat(after).map(x => x.duration), [2, 1, 1]);
    assert.equal(after.score.layer, 'jian');
    assert.deepEqual(Object.keys(after.proposed), ['jian']);
    assert.deepEqual(after.score.events.filter(x => x.start >= after.unit), before.score.events.filter(x => x.start >= before.unit));
    assert.equal(after.open, false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'rhythm-trigger');
    const appliedVersion = after.version;
    await open();
    await choose('eight-sixteen');
    await apply();
    assert.equal((await snapshot()).version, appliedVersion);
    await page.click('#undo-button');
    assert.deepEqual((await snapshot()).score, before.score);
    checks.push('One quarter note becomes one eighth note plus two empty sixteenths; this prototype returns only the active layer, leaves later beats intact, and supports no-op and undo.');

    await scene('two');
    await choose('eight-sixteen');
    await shot('02-two-notes.png');
    await apply();
    assert.deepEqual(firstBeat(await snapshot()).map(content), [1, 3, 'gap']);
    assert.deepEqual(firstBeat(await snapshot()).map(x => x.duration), [2, 1, 1]);
    checks.push('Two eighth notes are retained in order and followed by one empty sixteenth.');

    await scene('mixed');
    await choose('eight-sixteen');
    const originalMixed = firstBeat(await snapshot()).filter(x => x.kind === 'note').map(content);
    await apply();
    assert.deepEqual(firstBeat(await snapshot()).map(content), [...originalMixed, 'gap']);
    await scene('blank');
    await choose('eight-sixteen');
    await apply();
    assert.deepEqual(firstBeat(await snapshot()).map(content), ['gap', 'gap', 'gap']);
    assert.ok(firstBeat(await snapshot()).every(x => !('pitches' in x) && !('positions' in x) && x.kind === 'gap'));
    await scene('rest');
    await choose('eight-sixteen');
    await shot('03-rest-and-empty.png');
    await apply();
    assert.deepEqual(firstBeat(await snapshot()).map(content), ['rest', 'gap', 'gap']);
    await scene('mixed-rest');
    await choose('eight-sixteen');
    await apply();
    assert.deepEqual(firstBeat(await snapshot()).map(content), [1, 'rest', 'gap']);
    checks.push('Blank and mixed empty ranges generate fillable gaps without invented rests; existing rests keep their type and order.');

    for (const layer of ['jian', 'tab']) {
      await scene('polyphonic', '4/4', 'beat', layer);
      before = await snapshot();
      await choose('eight-sixteen');
      await apply();
      after = await snapshot();
      const source = firstBeat(before, layer)[0];
      const result = firstBeat(after, layer);
      assert.equal(result.length, 3);
      assert.equal(result[0].id, source.id);
      assert.deepEqual(layer === 'jian' ? result[0].pitches : result[0].positions, layer === 'jian' ? source.pitches : source.positions);
      assert.ok(result.slice(1).every(x => x.kind === 'gap'));
    }
    await scene('content');
    before = await snapshot();
    await choose('eight-sixteen');
    await shot('12-content-preserved.png');
    await apply();
    after = await snapshot();
    const lyrics = state => state.score.events.filter(x => x.lyric).map(x => [x.id, x.lyric]);
    assert.deepEqual(lyrics(after), lyrics(before));
    assert.deepEqual(after.score.chords, before.score.chords);
    assert.equal(firstBeat(after)[1].lyric, '来');
    checks.push('A polyphonic numbered event or simultaneous TAB strings count as one position; the limited lyric/chord seed preserves its content and IDs, without claiming production-anchor coverage.');

    await scene('single', '4/4', 'incomplete');
    assert.equal(await page.locator('#apply-rhythm').isEnabled(), true);
    assert.equal((await snapshot()).selection.length, 4);
    await scene('two', '4/4', 'bar');
    await choose('eight-sixteen');
    await shot('04-multiple-beats.png');
    await apply();
    after = await snapshot();
    assert.equal(after.score.jian.length, 12);
    for (let beat = 0; beat < 4; beat++) {
      assert.deepEqual(after.score.jian.filter(x => x.start >= beat * 4 && x.start < beat * 4 + 4).map(content), [1, 3, 'gap']);
    }
    await scene('uneven', '4/4', 'two');
    await choose('eight-sixteen');
    before = await snapshot();
    assert.equal(await page.locator('#apply-rhythm').isDisabled(), true);
    assert.match(await page.locator('#validation-message').innerText(), /第\s*1\s*拍/);
    assert.deepEqual((await snapshot()).score, before.score);
    checks.push('A short current-note target automatically resolves to one complete beat; multiple beats map separately, and a locally overfull beat blocks the whole operation.');

    for (const meter of ['4/4', '3/4', '6/8']) {
      await scene('blank', meter, 'bar');
      before = await snapshot();
      const expected = meter === '6/8' ? [[6], [2, 2, 2], [4, 2], [2, 4], [1, 1, 1, 1, 1, 1]] : [[4], [2, 2], [2, 1, 1], [1, 1, 2], [1, 1, 1, 1], [3, 1], [1, 2, 1], [1, 3], [3, .5, .5], [.5, .5, 3], [2, .5, .5, .5, .5], [.5, .5, .5, .5, 2]];
      assert.deepEqual(before.library.map(x => x.values), expected);
      assert.equal(parseInt(await page.locator('#template-count').innerText(), 10), expected.length);
      for (const item of before.library) {
        await choose(item.id);
        const state = await snapshot();
        const proposed = state.proposed.jian;
        const cycles = meter === '6/8' ? 2 : Number(meter[0]);
        assert.equal(proposed.length, item.values.length * cycles);
        assert.equal(proposed.reduce((sum, x) => sum + x.duration, 0), meter === '4/4' ? 16 : 12);
        assert.ok(proposed.every(x => x.gap && x.kind === 'gap' && !('pitches' in x) && !('positions' in x)));
        assert.deepEqual(state.score, before.score);
      }
    }
    await scene('single', '6/8', 'bar');
    await choose('three-eighths');
    await shot('05-6-8.png');
    await apply();
    after = await snapshot();
    assert.equal(after.score.jian.length, 6);
    assert.ok(after.score.jian.every(x => x.duration === 2));
    checks.push('All 17 unique templates retain exact durations, including 1/32 precision; whole bars repeat four, three or two cycles; 6/8 uses dotted-quarter beats and creates no triplet.');

    await scene('notes');
    await choose('small-syncopation');
    await shot('13-small-syncopation.png');
    await apply();
    assert.deepEqual(firstBeat(await snapshot()).map(x => x.duration), [1, 2, 1]);
    assert.deepEqual(firstBeat(await snapshot()).map(content), [1, 3, 5]);
    await scene('two', '3/4', 'bar');
    await choose('reverse-dotted');
    await shot('14-3-4-reverse-dotted.png');
    await apply();
    after = await snapshot();
    assert.deepEqual(after.score.events.map(x => x.duration), [1, 3, 1, 3, 1, 3]);
    for (const layer of ['jian', 'tab']) {
      await scene('two', '4/4', 'beat', layer);
      before = await snapshot();
      await choose('two-thirtyseconds-dotted');
      assert.match(await page.locator('.compare-row.after svg').getAttribute('aria-label'), /1\/32/);
      if (layer === 'tab') await shot('15-tab-thirtyseconds.png');
      await apply();
      assert.deepEqual(firstBeat(await snapshot(), layer).map(x => x.duration), [.5, .5, 3]);
      assert.equal(firstBeat(await snapshot(), layer)[2].kind, 'gap');
      await page.click('#undo-button');
      assert.deepEqual((await snapshot()).score, before.score);
    }
    checks.push('New syncopation and reverse-dotted templates preserve note order; 3/4 repeats three cycles; 1/32 notes remain exact in both notation models and undo restores the originals.');

    await scene('decorated');
    await choose('eight-sixteen');
    before = await snapshot();
    await apply();
    assert.equal(await page.locator('#confirm-change').isVisible(), true);
    assert.deepEqual((await snapshot()).score, before.score);
    await shot('06-remove-marks-confirm.png');
    await page.click('#back-preview');
    assert.deepEqual((await snapshot()).score, before.score);
    await apply();
    await page.click('#confirm-change');
    await page.waitForFunction(() => !window.__req043.busy);
    after = await snapshot();
    assert.equal(after.open, false);
    assert.deepEqual(firstBeat(after).map(content), [1, 3, 'gap']);
    assert.equal(after.score.marks.length, 1);
    assert.equal(after.score.marks[0].id, 'outside-1');
    await page.click('#undo-button');
    assert.deepEqual((await snapshot()).score, before.score);
    checks.push('Marked content first opens an inline confirmation; returning preserves the score, confirming clears marks while preserving notes, and undo restores marks and contents.');

    await scene('decorated');
    await apply();
    await choose('sixteenths');
    assert.equal(await page.locator('#confirm-change').isVisible(), false);
    assert.equal(await page.locator('#apply-rhythm').isVisible(), true);
    checks.push('Changing the template invalidates the prior mark-removal confirmation.');

    for (const scenario of ['overflow', 'crossing-note', 'none', 'crossbar']) {
      await scene(scenario);
      assert.equal(await page.locator('#apply-rhythm').isDisabled(), true, scenario);
    }
    await shot('07-blocked-boundary.png');
    await scene('stale');
    assert.equal(await page.locator('#apply-rhythm').isDisabled(), true);
    await page.click('#refresh-preview');
    assert.equal(await page.locator('#apply-rhythm').isEnabled(), true);
    await scene('failure');
    before = await snapshot();
    await apply();
    if (await page.locator('#confirm-change').isVisible()) {
      await page.click('#confirm-change');
      await page.waitForFunction(() => !window.__req043.busy);
    }
    assert.equal((await snapshot()).failed, true);
    assert.deepEqual((await snapshot()).score, before.score);
    if (await page.locator('#confirm-change').isVisible()) {
      await page.click('#confirm-change');
      await page.waitForFunction(() => !window.__req043.busy);
    } else await apply();
    assert.equal((await snapshot()).open, false);
    checks.push('Overfull, absent, cross-bar and crossing-content targets are blocked; stale previews need refresh; failed submission leaves the score intact and can be retried.');

    await scene('single', '4/4', 'beat', 'tab');
    before = await snapshot();
    await choose('eight-sixteen');
    await shot('08-tab.png');
    await apply();
    after = await snapshot();
    assert.equal(after.score.layer, 'tab');
    assert.deepEqual(Object.keys(after.proposed), ['tab']);
    assert.deepEqual(after.score.events.filter(x => x.start >= after.unit), before.score.events.filter(x => x.start >= before.unit));
    const tab = firstBeat(after, 'tab');
    assert.deepEqual(tab[0].positions, firstBeat(before, 'tab')[0].positions);
    assert.deepEqual(tab.slice(1).map(content), ['gap', 'gap']);
    checks.push('The TAB-only model retains the original string and fret, creates empty TAB positions, and leaves later beats intact; real two-layer document isolation requires future product validation.');

    await scene();
    await page.setViewportSize({ width: 1440, height: 900 });
    const layout = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, height: r.height }; };
      return { comparison: rect('#comparison'), current: rect('.compare-row'), after: rect('.compare-row.after'), dialog: rect('#rhythm-dialog') };
    });
    assert.ok(Math.abs(layout.current.top - layout.after.top) <= 1, 'desktop before/after previews sit side by side');
    assert.ok(layout.comparison.height <= 170, 'comparison remains compact');
    assert.equal(await page.locator('.template-group-title').count(), 2);
    checks.push('The desktop preview uses compact side-by-side cards within 170px; 12 templates are separated into eight common patterns and four 1/32 subdivisions.');
    await shot('09-desktop-900.png');
    await page.setViewportSize({ width: 720, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await shot('10-review-720.png');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await shot('11-review-390.png');
    checks.push('1440px desktop and 720px/390px review layouts render without horizontal document overflow.');
    assert.deepEqual(errors, []);
    checks.push('No browser runtime errors.');
    fs.writeFileSync(path.join(output, 'review-result.json'), JSON.stringify({ version: 'v2.1', scope: 'independent design prototype only', url, checks, errors, layout }, null, 2) + '\n');
    console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
