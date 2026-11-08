/* Real application forms + score clicks + native JSON import/export.
 * Synthetic composition events below are automation checks, not a real OS IME.
 * node scripts/input-enter-x.browser.cjs (uses the already-running :3000 server)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('/Users/nice02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve('artifacts/input-enter-x');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  page.setDefaultTimeout(12000);
  const results = [], errors = [];
  let status = 'running', failure = null;
  page.on('pageerror', (error) => errors.push(error.message));
  const screenshot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) });
  const exported = async (name) => {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出曲谱', exact: true }).click();
    const data = JSON.parse(await fs.readFile(await (await waiting).path(), 'utf8'));
    if (name) await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(data, null, 2));
    return data;
  };
  const imported = async (document, name) => {
    const filename = path.join(output, `${name}.json`);
    await fs.writeFile(filename, JSON.stringify(document, null, 2));
    await page.getByLabel('选择六线猫曲谱文件', { exact: true }).setInputFiles(filename);
    await page.getByRole('button', { name: '导入并替换', exact: true }).click();
    await page.getByRole('application', { name: '六线谱编辑器' }).waitFor();
    await svg.locator('text').getByText(document.score.title, { exact: true }).waitFor();
  };
  const svg = page.getByRole('application', { name: '六线谱编辑器' });
  const text = (value) => svg.locator('text').getByText(value, { exact: true }).first();
  const visibleInput = (label) => page.locator(`input[aria-label="${label}"]:visible,textarea[aria-label="${label}"]:visible`).first();
  const undo = () => page.getByRole('toolbar').getByRole('button', { name: '撤销', exact: true }).click();
  const pass = (name, details = {}) => { results.push({ name, ...details }); console.log(`PASS ${name}`); };
  try {
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:3000', { waitUntil: 'networkidle' });
    await svg.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const fixture = structuredClone(await exported());
    fixture.documentRevision = 1;
    fixture.score.title = 'Enter 与 x 实际输入回归';
    fixture.score.arranger = '';
    fixture.score.meta = { fixture: 'input-enter-x', purpose: 'native form and keyboard regression' };
    fixture.score.keySignature = 'C';
    fixture.score.tracks = [fixture.score.tracks[0]];
    const track = fixture.score.tracks[0];
    track.techniques = []; track.numberedMarks = [];
    track.measures = track.measures.slice(0, 2).map((source, m) => ({
      ...source, id: `enter-measure-${m + 1}`, timeSignature: { numerator: 4, denominator: 4 },
      barline: m === 1 ? 'final' : 'single', lyrics: [], chordSymbols: [], tuplets: [],
      numberedVoice: { events: [], tuplets: [] },
      beats: Array.from({ length: 4 }, (_, i) => ({ id: `enter-beat-${m + 1}-${i + 1}`, tick: i * 960,
        rhythm: { base: 'quarter', dots: 0 }, kind: 'notes',
        notes: [{ id: `enter-note-${m + 1}-${i + 1}`, string: 1, fret: i + 3 }] })),
    }));
    await imported(fixture, 'fixture');
    await screenshot('fixture');
    await text('3').click();
    await page.getByRole('tab', { name: '简谱与歌词', exact: true }).click();
    await page.getByRole('button', { name: '在当前位置录入简谱', exact: true }).click();
    pass('fixture imported through native file input');
    const baseline = await exported('before-enter');
    const continuous = page.locator('textarea[aria-label="音符内容"]:visible').first();
    await continuous.fill('1');
    await continuous.press('Shift+Enter');
    assert.ok((await continuous.inputValue()).includes('\n'));
    await continuous.fill('');
    assert.deepEqual(await exported(), baseline, 'Shift+Enter inserts a newline without changing the document');
    pass('numbered Shift+Enter inserts newline without a score command');

    await page.getByRole('group', { name: '常用时值', exact: true }).getByRole('button', { name: '八分音符', exact: true }).click();
    await continuous.fill('1 2');
    await continuous.dispatchEvent('compositionstart');
    await continuous.press('Enter');
    await continuous.evaluate(node => {
      node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '2' }));
      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
    });
    assert.equal(await svg.locator('[data-numbered-event]').count(), 0);
    await screenshot('numbered-composition-enter-blocked');
    await page.waitForTimeout(180);
    // Restore only the uncommitted text so native export remains available. No command is sent.
    await continuous.fill('');
    assert.deepEqual(await exported('after-composition-enter'), baseline);
    pass('synthetic composition Enter and immediate post-composition Enter leave exported document unchanged');
    await continuous.fill('1 2');
    await screenshot('numbered-continuous-before-enter');
    await continuous.press('Enter');
    await svg.locator('[data-numbered-event]').first().waitFor();
    const sequenceDocument = await exported('numbered-continuous-enter');
    assert.equal(sequenceDocument.documentRevision, baseline.documentRevision + 1);
    assert.deepEqual(sequenceDocument.score.tracks[0].measures[0].numberedVoice.events.map(e => e.items[0].token), ['1', '2']);
    assert.deepEqual(sequenceDocument.score.tracks[0].measures.map(m => m.beats), baseline.score.tracks[0].measures.map(m => m.beats));
    await screenshot('numbered-continuous-after-enter');
    await undo();
    assert.deepEqual((await exported()).score, baseline.score, 'one undo removes the complete sequence');
    await page.getByRole('toolbar').getByRole('button', { name: '重做', exact: true }).click();
    assert.deepEqual((await exported()).score, sequenceDocument.score);
    pass('continuous numbered Enter applies one command after composition cooldown; undo/redo restores full sequence');

    await svg.locator('[data-numbered-event]').first().click();
    await page.getByText('单音组编辑', { exact: true }).click();
    await visibleInput('单音组简谱').fill('5');
    await visibleInput('单音组简谱').press('Enter');
    const singleDocument = await exported('numbered-single-enter');
    assert.equal(singleDocument.documentRevision, sequenceDocument.documentRevision + 1);
    assert.equal(singleDocument.score.tracks[0].measures[0].numberedVoice.events[0].items[0].token, '5');
    await screenshot('numbered-single-after-enter');
    pass('single numbered Enter applies one command');
    await page.getByRole('button', { name: '结束文字编辑', exact: true }).click();
    await svg.locator('[data-numbered-event]').first().click();
    await page.getByText('歌词', { exact: true }).click();
    await page.getByRole('button', { name: '为当前简谱填写歌词', exact: true }).click();
    await page.getByText('连续填词', { exact: true }).first().click();
    await visibleInput('连续歌词').fill('春 风');
    await visibleInput('连续歌词').press('Enter');
    const lyricSequenceDocument = await exported('lyric-sequence-enter');
    assert.equal(lyricSequenceDocument.documentRevision, singleDocument.documentRevision + 1);
    assert.deepEqual(lyricSequenceDocument.score.tracks[0].measures[0].lyrics.map(l => l.text), ['春', '风']);
    await screenshot('lyric-sequence-after-enter');
    pass('continuous lyric Enter applies one command');
    await page.getByText('单个位置', { exact: true }).first().click();
    await visibleInput('歌词文本').fill('暖');
    await visibleInput('歌词文本').press('Enter');
    const lyricSingleDocument = await exported('lyric-single-enter');
    assert.equal(lyricSingleDocument.documentRevision, lyricSequenceDocument.documentRevision + 1);
    assert.deepEqual(lyricSingleDocument.score.tracks[0].measures[0].lyrics.map(l => l.text), ['暖', '风']);
    await screenshot('lyric-single-after-enter');
    pass('single-position lyric Enter applies one command');
    await text('3').click();
    await page.getByRole('toolbar').getByRole('button', { name: '添加和弦', exact: true }).click();
    await visibleInput('和弦名称').fill('Dm7');
    await visibleInput('和弦名称').press('Enter');
    const chordDocument = await exported('chord-name-enter');
    assert.equal(chordDocument.documentRevision, lyricSingleDocument.documentRevision + 1);
    assert.equal(chordDocument.score.tracks[0].measures[0].chordSymbols[0].chord.name, 'Dm7');
    await screenshot('chord-name-after-enter');
    pass('chord name Enter applies one command');
    await visibleInput('和弦名称').fill('Dm9');
    await visibleInput('和弦名称').press('Control+Enter');
    const chordControlDocument = await exported('chord-name-control-enter');
    assert.equal(chordControlDocument.documentRevision, chordDocument.documentRevision + 1);
    assert.equal(chordControlDocument.score.tracks[0].measures[0].chordSymbols[0].chord.name, 'Dm9');
    pass('existing Control+Enter chord submission remains available');

    await imported(fixture, 'x-fixture');
    await text('3').click();
    await page.keyboard.press('x');
    await page.waitForTimeout(250);
    const xDocument = await exported('x-keyboard');
    assert.equal(xDocument.score.tracks[0].measures[0].beats[0].notes[0].fret, 'x');
    assert.equal(xDocument.documentRevision, fixture.documentRevision + 1);
    await page.getByRole('toolbar').getByRole('button', { name: '击弦 H', exact: true }).click();
    const hammerDocument = await exported('x-hammer');
    assert.equal(hammerDocument.documentRevision, xDocument.documentRevision + 1);
    assert.deepEqual(hammerDocument.score.tracks[0].measures, xDocument.score.tracks[0].measures);
    assert.equal(hammerDocument.score.tracks[0].techniques.length, 1);
    const hammer = hammerDocument.score.tracks[0].techniques[0];
    assert.equal(hammer.type, 'hammerOn');
    assert.equal(hammer.fromNoteId, 'enter-note-1-1');
    assert.equal(hammer.toNoteId, 'enter-note-1-2');
    assert.ok(hammer.id);
    await screenshot('x-keyboard-and-hammer');
    await undo();
    assert.deepEqual((await exported('x-hammer-undone')).score, xDocument.score);
    await undo();
    assert.deepEqual((await exported('x-keyboard-undone')).score, fixture.score);
    await imported(hammerDocument, 'x-hammer-reimport');
    assert.deepEqual((await exported('x-hammer-roundtrip')).score, hammerDocument.score);
    await screenshot('x-hammer-reimported');
    pass('keyboard x accepts hammer-on to next note; export, two independent undos and native reimport preserve valid score');
    assert.deepEqual(errors, []);
    status = 'passed';
    await fs.rm(path.join(output, 'failure.png'), { force: true });
  } catch (error) {
    status = 'failed'; failure = error.stack || String(error);
    await screenshot('failure').catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ status, failure, url: process.env.EDITOR_URL || 'http://127.0.0.1:3000', results, errors,
      compositionScope: 'Synthetic browser composition/keyboard event automation only; no real OS IME used.' }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
