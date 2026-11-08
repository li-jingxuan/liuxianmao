/* Real application regression for associated text surfaces and Modal Select portals.
 * Uses isolated browser pages; does not inject store state or commit score changes.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const output = path.resolve(process.env.EDITOR_ARTIFACTS || 'artifacts/toolbar-associated-overlays');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [], errors = [];
  const url = process.env.EDITOR_URL || 'http://127.0.0.1:3012';
  const sidebar = p => p.locator('#music-text-sidebar');
  const floating = p => p.locator('#chord-edit-popover');
  const input = p => floating(p).locator('#chord-popover-name');
  const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const focusState = p => p.evaluate(() => ({
    tag: document.activeElement?.tagName,
    id: document.activeElement?.id,
    label: document.activeElement?.getAttribute('aria-label'),
    associated: document.activeElement?.closest('[data-editor-associated-panel]')?.getAttribute('data-editor-associated-panel'),
  }));
  const run = async (name, width, task) => {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    p.setDefaultTimeout(10000);
    p.on('pageerror', error => errors.push({ name, width, message: error.message }));
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded' });
      await p.getByRole('application', { name: '六线谱编辑器' }).waitFor();
      if (width < 1200) await p.locator('[data-sidebar-collapsed="true"]').waitFor();
      const detail = await task(p);
      results.push({ name, width, status: 'pass', ...detail });
      console.log('PASS', name, width);
    } catch (error) {
      results.push({ name, width, status: 'fail', error: error.message, focus: await focusState(p) });
      console.error('FAIL', name, width, error.message);
      await p.screenshot({ path: path.join(output, `${name}-${width}-failure.png`), fullPage: true });
    } finally {
      await p.close();
    }
  };
  const openAssociated = async p => {
    await p.locator('svg[role="application"] text').filter({ hasText: /^C$/ }).first().click();
    await floating(p).waitFor({ state: 'visible' });
    await p.getByRole('button', { name: '编辑面板', exact: true }).click();
    await sidebar(p).waitFor({ state: 'visible' });
    await settle(p);
    await input(p).focus();
    assert.equal(await input(p).evaluate(el => el === document.activeElement), true,
      'associated chord input retains focus while the property drawer is open');
    assert.equal(await floating(p).evaluate(el => !!el.closest('[inert]')), false);
  };
  const boundaryCycle = p => p.evaluate(() => {
    const roots = [document.querySelector('#music-text-sidebar'), ...document.querySelectorAll('[data-editor-associated-panel="music-text-sidebar"]')]
      .filter(el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[aria-hidden=true]'));
    const controls = roots.flatMap(root => [...root.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')])
      .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[hidden],[inert],[aria-hidden=true]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const identity = el => el && ({ tag: el.tagName, id: el.id, label: el.getAttribute('aria-label') });
    return { first: identity(controls[0]), last: identity(controls.at(-1)), count: controls.length };
  });
  const focusBoundary = (p, last) => p.evaluate(last => {
    const roots = [document.querySelector('#music-text-sidebar'), ...document.querySelectorAll('[data-editor-associated-panel="music-text-sidebar"]')]
      .filter(el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[aria-hidden=true]'));
    const controls = roots.flatMap(root => [...root.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')])
      .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[hidden],[inert],[aria-hidden=true]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    (last ? controls.at(-1) : controls[0]).focus();
  }, last);
  try {
    for (const width of [1440, 768, 375]) {
      await run('image-range-pointer-selection', width, async p => {
        await p.getByRole('button', { name: '导出 A4 图片', exact: true }).click();
        await p.waitForFunction(() => document.querySelector('[data-image-export-status]')?.getAttribute('data-image-export-status') === 'ready');
        // Let the Modal entrance animation finish before measuring popup hit targets.
        await p.waitForFunction(() => !document.querySelector('.ant-modal.ant-zoom-appear'));
        const combo = p.getByRole('combobox', { name: '输出范围', exact: true });
        await combo.click();
        const option = p.getByRole('option', { name: '当前第 1 页', exact: true });
        await option.waitFor();
        await p.waitForFunction(() => !document.querySelector('.ant-select-dropdown.ant-slide-up-appear'));
        const popup = await option.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return {
            inert: !!el.closest('[inert]'),
            pointerEvents: getComputedStyle(el).pointerEvents,
            insideModal: !!el.closest('[role="dialog"]'),
            hitWithinOption: !!hit && el.contains(hit),
            hit: hit?.outerHTML.slice(0, 200),
          };
        });
        assert.equal(popup.inert, false, 'Modal owns an interactive Select popup');
        assert.equal(popup.insideModal, true, 'popup is within the top Modal domain');
        assert.notEqual(popup.pointerEvents, 'none', `popup must accept pointer events: ${JSON.stringify(popup)}`);
        assert.equal(popup.hitWithinOption, true, `option must be the actual pointer hit target: ${JSON.stringify(popup)}`);
        await option.click();
        await p.locator('[data-image-export-range="page"]').waitFor();
        assert.equal(await p.getByRole('button', { name: '关闭预览', exact: true }).isVisible(), true);
        await p.getByRole('button', { name: '关闭预览', exact: true }).click();
        return { popup, selectedRange: 'page' };
      });
    }
    // A 360px chord popup intentionally falls back to the property editor at 375px.
    // Exercise the visible associated surface where the existing geometry can place it.
    for (const width of [1024, 768]) {
      await run('associated-input-tab-escape', width, async p => {
        await openAssociated(p);
        const cycle = await boundaryCycle(p);
        assert.ok(cycle.count > 1, 'combined drawer and associated surface has controls');
        await focusBoundary(p, true);
        await p.keyboard.press('Tab');
        assert.deepEqual(await p.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id, label: document.activeElement.getAttribute('aria-label') })), cycle.first, 'Tab wraps from associated surface to drawer');
        await focusBoundary(p, false);
        await p.keyboard.press('Shift+Tab');
        assert.deepEqual(await p.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id, label: document.activeElement.getAttribute('aria-label') })), cycle.last, 'Shift+Tab wraps from drawer to associated surface');
        await input(p).fill('Cmaj7');
        assert.equal(await input(p).inputValue(), 'Cmaj7');
        assert.equal(await input(p).evaluate(el => el === document.activeElement), true, 'typing keeps focus in associated input');
        await p.keyboard.press('Escape');
        await floating(p).waitFor({ state: 'hidden' });
        assert.equal(await sidebar(p).isVisible(), true, 'first Escape belongs to text owner, preserving the drawer');
        return { controlCount: cycle.count, firstEscapePreservesDrawer: true };
      });
      await run('associated-focus-restored-after-modal', width, async p => {
        await openAssociated(p);
        // The toolbar is intentionally inert beneath the drawer. Exercise its UI handler
        // directly to verify an independent top Modal over an associated text surface.
        await p.getByRole('button', { name: '导出 A4 图片', exact: true }).dispatchEvent('click');
        const close = p.getByRole('button', { name: '关闭预览', exact: true });
        await close.waitFor();
        await p.waitForFunction(() => !!document.querySelector('#chord-edit-popover')?.closest('[inert]'));
        assert.equal(await sidebar(p).evaluate(el => !!el.closest('[inert]')), true);
        await close.click();
        await close.waitFor({ state: 'hidden' });
        await p.waitForFunction(() => document.activeElement?.id === 'chord-popover-name');
        assert.equal(await sidebar(p).isVisible(), true);
        assert.equal(await floating(p).evaluate(el => !!el.closest('[inert]')), false);
        return { restoredFocus: await focusState(p), opening: 'dispatchEvent(click) on inert toolbar UI handler' };
      });
      await run('history-inerts-associated-surface', width, async p => {
        await openAssociated(p);
        await p.getByRole('button', { name: '编辑面板', exact: true }).click();
        await sidebar(p).waitFor({ state: 'hidden' });
        await p.getByRole('button', { name: '操作历史', exact: true }).click();
        await p.locator('#editor-history-panel').waitFor({ state: 'visible' });
        await p.waitForFunction(() => !!document.querySelector('#chord-edit-popover')?.closest('[inert]'));
        assert.equal(await floating(p).isVisible(), true, 'layout preserves the text owner surface');
        assert.equal(await p.locator('#editor-history-panel').evaluate(el => el.contains(document.activeElement)), true,
          'history owns focus while the unrelated text surface is inert');
        await p.keyboard.press('Escape');
        await p.locator('#editor-history-panel').waitFor({ state: 'hidden' });
        return { associatedSurfaceInertUnderHistory: true };
      });
    }
    await run('narrow-chord-sidebar-fallback', 375, async p => {
      await p.locator('svg[role="application"] text').filter({ hasText: /^C$/ }).first().click();
      await sidebar(p).waitFor({ state: 'visible' });
      const field = sidebar(p).getByRole('textbox', { name: '和弦名称', exact: true });
      await field.waitFor();
      await p.waitForFunction(() => document.activeElement?.closest('#music-text-sidebar') &&
        document.activeElement?.tagName === 'INPUT');
      assert.equal(await floating(p).isVisible(), false, 'oversized chord surface yields to the property editor');
      assert.equal(await floating(p).evaluate(el => !!el.closest('[inert]')), true, 'hidden floating input is inert');
      assert.equal(await field.inputValue(), 'C');
      await field.fill('Cmaj7');
      assert.equal(await field.inputValue(), 'Cmaj7');
      assert.equal(await field.evaluate(el => el === document.activeElement), true, 'fallback input remains editable');
      assert.equal(await p.locator('#editor-history-panel').isVisible(), false);
      return { fallback: 'property editor', focus: await focusState(p), documentCommitted: false };
    });
  } finally {
    await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ browser: await browser.version(), url, results, errors }, null, 2));
    await browser.close();
    console.log('Report:', path.join(output, 'validation.json'));
  }
  if (results.some(result => result.status === 'fail') || errors.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
