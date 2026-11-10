/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node browser runner. */
/* global require, __dirname, process, window, console */
/* Real React component + native browser keyboard. Synthetic composition events
 * check guards only; they do not certify a real OS input method.
 * PLAYWRIGHT_MODULE=/path/to/playwright node apps/website/tests/chord-diagram-editor.browser.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '../../..');
const vitestRequire = createRequire(require.resolve('vitest/package.json', { paths: [repo] }));
const viteRequire = createRequire(vitestRequire.resolve('vite'));
const { build } = viteRequire('esbuild');
const websiteRequire = createRequire(path.join(repo, 'apps/website/package.json'));
const sass = websiteRequire('sass');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/nice02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const css = sass.compile(path.join(repo, 'apps/website/components/EditorShell/ChordDiagramEditorModal.module.scss')).css;
  const result = await build({ entryPoints: [path.join(__dirname, 'chord-diagram-editor.browser.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.scss': 'empty' }, define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'actual-editor-styles', setup(build) { build.onLoad({ filter: /ChordDiagramEditorModal\.module\.scss$/ }, () => { const names = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))]; return { loader: 'js', contents: `const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(css)};document.head.append(sheet);export default ${JSON.stringify(Object.fromEntries(names.map((name) => [name, name])))};` }; }); } }] });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = () => page.evaluate(() => window.chordDiagramTest);
  const label = (name) => page.getByLabel(name, { exact: true });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const cell = (name) => page.getByRole('gridcell', { name, exact: true });
  const reset = () => button('重置测试').click();
  try {
    // Actual component and compiled Sass, with identity CSS-module class names.
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await label('自定义和弦名称').waitFor();
    assert.equal(await page.getByRole('gridcell').count(), 42);
    assert.equal(await page.locator('[role=gridcell][tabindex="0"]').count(), 1);
    assert.ok((await cell('第 6 弦 1 品').boundingBox()).height >= 32);
    assert.ok((await cell('第 6 弦 1 品').boundingBox()).width >= 32);
    assert.ok((await button('完成编辑').boundingBox()).y < 650);
    await cell('第 6 弦 空弦').focus();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await label('6弦品位').inputValue(), '1');
    await button('横按').click();
    await cell('第 6 弦 1 品').click();
    assert.equal(await label('1弦品位').inputValue(), '0');
    assert.equal(await button('完成编辑').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal((await state()).cancelled, 0);
    await cell('第 6 弦 1 品').click(); await cell('第 1 弦 1 品').click();
    assert.equal(await label('1弦品位').inputValue(), '1'); assert.equal(await label('1弦手指').inputValue(), '1');
    await button('撤销').click(); assert.equal(await label('1弦品位').inputValue(), '0');
    await button('重做').click(); assert.equal(await label('1弦品位').inputValue(), '1');
    await button('删除横按 1').click(); assert.equal(await label('1弦品位').inputValue(), '1'); assert.equal(await label('1弦手指').inputValue(), '');
    await button('撤销').click(); assert.equal(await label('1弦手指').inputValue(), '1');
    await button('编辑横按 1').click(); await label('横按起弦').fill('2'); await label('横按止弦').fill('4'); await button('应用横按').click();
    assert.equal(await label('1弦手指').inputValue(), ''); assert.equal(await label('3弦手指').inputValue(), '1');
    await button('撤销').click(); assert.equal(await label('1弦手指').inputValue(), '1');
    await label('6弦品位').fill('');
    assert.equal(await button('完成编辑').isDisabled(), true);
    assert.equal(await page.getByRole('img', { name: '指法图预览' }).count(), 1);
    assert.equal(await page.getByText('显示上次有效指法；当前修改尚未通过校验', { exact: true }).count(), 1);
    await label('自定义和弦名称').press('Enter'); assert.equal((await state()).completed.length, 0);
    await label('6弦品位').fill('1'); await label('自定义和弦名称').fill('Cm');
    await label('自定义和弦名称').press('Enter');
    const complete = (await state()).completed[0]; assert.equal(complete.display, 'name'); assert.equal(complete.chord.name, 'Cm'); assert.equal(complete.chord.diagram.strings[0].fret, 1);
    await reset();
    const input = label('自定义和弦名称');
    await input.focus(); await input.press('End'); await input.pressSequentially('maj7');
    await input.press('Meta+z'); assert.equal(await input.inputValue(), 'C');
    await input.fill('局部名称'); await page.getByRole('grid').focus();
    await cell('第 6 弦 空弦').focus(); await page.keyboard.press('Meta+z'); assert.notEqual(await input.inputValue(), '局部名称');
    await reset();
    await label('自定义和弦名称').dispatchEvent('compositionstart');
    await label('自定义和弦名称').press('Enter'); await label('自定义和弦名称').press('Escape');
    assert.equal((await state()).completed.length, 0); assert.equal((await state()).cancelled, 0);
    await label('自定义和弦名称').dispatchEvent('compositionend');
    await label('自定义和弦名称').press('Enter'); assert.equal((await state()).completed.length, 0);
    await page.waitForTimeout(65); await label('自定义和弦名称').press('Enter'); assert.equal((await state()).completed.length, 1);
    await reset();
    await label('自定义和弦名称').dispatchEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true });
    assert.equal((await state()).completed.length, 0); await page.waitForTimeout(65);
    await label('自定义和弦名称').dispatchEvent('keydown', { key: 'Enter', repeat: true, bubbles: true });
    assert.equal((await state()).completed.length, 0);
    await button('存入我的指法').click(); assert.equal((await state()).saved.length, 1); assert.equal((await state()).completed.length, 0);
    await button('取消').click(); assert.equal((await state()).cancelled, 1); assert.equal((await state()).saved.length, 1);
    await page.evaluate(() => { window.chordDiagramTest.saveOk = false; }); await button('存入我的指法').click();
    assert.equal(await page.getByText('存储失败', { exact: true }).count(), 1);
    assert.equal((await state()).backgroundKeys, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: actual component grid sizing, low height footer, roving keyboard, atomic barres, invalid preview, local/native undo, IME/cooling/229/repeat, independent save/cancel, display preservation. OS IME remains manual.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
