/** 静态交互稿检查及评审截图；不启动、不测试产品代码。需本机已有 Playwright。 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const url = process.env.PROTOTYPE_URL || 'http://127.0.0.1:4178/' +
  'docs/design-v2/prototypes/toolbar-history/index.html';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const results = [];
  const dir = path.join(__dirname, '评审截图');
  await fs.mkdir(dir, { recursive: true });
  try {
    for (const [width, height] of [[1920,1080],[1440,900],[1280,900],[1024,768],[768,1024],[375,812],[1440,650]]) {
      await page.setViewportSize({ width, height });
      await page.goto(url);
      await page.locator('#score path').first().waitFor({ state: 'attached' });
      const bounds = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        rest: document.getElementById('rest').getBoundingClientRect().right,
        more: document.getElementById('more-menu').getBoundingClientRect().right,
      }));
      assert(bounds.document <= width, `页面横向溢出 ${width}: ${JSON.stringify(bounds)}`);
      assert(bounds.rest <= width && bounds.more <= width, `工具入口超出视口 ${width}`);
      const panelToggle = page.getByRole('button', { name: '编辑面板', exact: true });
      const panel = page.locator('#inspector');
      assert.equal((await panelToggle.textContent()).trim(), '', '面板入口仅显示图标');
      assert.equal(await panel.locator('.panel-head').count(), 0, '侧栏直接从页签开始');
      const panelBounds = await panelToggle.boundingBox();
      assert(panelBounds && panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= width, `面板开关超出视口 ${width}`);
      const initiallyOpen = await panelToggle.getAttribute('aria-expanded') === 'true';
      if (initiallyOpen) await panelToggle.click();
      await panelToggle.focus();
      await panelToggle.press('Enter');
      assert.equal(await panel.isVisible(), true);
      assert.equal(await panelToggle.getAttribute('aria-expanded'), 'true');
      await page.locator('[data-tab="song"]').click();
      await page.locator('#mock-content').fill('保留当前输入');
      if ([1440,375].includes(width) && height !== 650) {
        await page.screenshot({ path: path.join(dir, `面板纯图标-${width}.png`) });
      }
      await panelToggle.click();
      assert.equal(await panel.isVisible(), false);
      assert.equal(await panelToggle.evaluate(element => element === document.activeElement), true);
      await panelToggle.click();
      assert.equal(await page.locator('#mock-content').inputValue(), '保留当前输入');
      assert.equal(await page.locator('[data-tab="song"]').getAttribute('aria-current'), 'page');
      if (width < 1200) {
        await page.keyboard.press('Escape');
        assert.equal(await panel.isVisible(), false);
        await panelToggle.click();
        await page.locator('#scrim').click({ position: { x: 1, y: 1 } });
        assert.equal(await panel.isVisible(), false);
        await panelToggle.click();
      }
      await page.locator('[data-tab="selection"]').click();
      if (!initiallyOpen) await panelToggle.click();
      for (const selector of ['[data-tech="击弦 H"]','[data-tech="勾弦 P"]',
        '[data-tech="滑音"]','[data-stroke="down"]','[data-stroke="up"]']) {
        assert.equal(await page.locator(selector).isVisible(), true, `快捷入口被隐藏 ${width}: ${selector}`);
      }
      if ([1440,375].includes(width) && height !== 650) {
        await page.screenshot({ path: path.join(dir, `默认态-${width}.png`) });
      }
      if (width === 1440 && height === 900) {
        assert.equal(await page.locator('#rest').textContent(), '');
        assert(!/[\u4e00-\u9fff]/.test(await page.locator('.shortcuts').textContent()),
          '符号快捷区不应出现常驻中文标签');
        for (const selector of ['#rest','[data-tech="击弦 H"]','[data-tech="勾弦 P"]',
          '[data-tech="滑音"]','[data-stroke="down"]','[data-stroke="up"]','[data-tech="琶音"]','#tech-menu']) {
          await page.locator(selector).hover();
          assert.equal(await page.locator('#tool-tooltip').isVisible(), true);
          assert(await page.locator(selector).getAttribute('aria-label'));
        }
        await page.locator('[data-tech="琶音"]').hover();
        assert.equal(await page.locator('#tool-tooltip').textContent(), '琶音');
        await page.screenshot({ path: path.join(dir, '符号悬停-1440.png') });
        await page.mouse.move(0, 0);
        await page.locator('#rest').focus();
        assert.equal(await page.locator('#tool-tooltip').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#tool-tooltip').isVisible(), false);
        await page.locator('#rest').blur();
      }
      await page.locator('#history-toggle').click();
      assert.equal(await page.locator('#history').isVisible(), true);
      await page.locator('#history-list summary').first().click();
      if ([1920,1440,375].includes(width) && height !== 650) {
        await page.screenshot({ path: path.join(dir, `历史展开-${width}.png`) });
      }
      await page.locator('#history-close').click();
      await page.locator('[data-stroke="down"]').click();
      assert.equal(await page.locator('#popover').isVisible(), false);
      assert.equal(await page.locator('#score [data-score-stroke="down"]').count(), 1);
      assert.equal(await page.locator('#score [data-score-stroke="down"]').evaluate(
        path => path.getPointAtLength(10).y < path.getPointAtLength(0).y), true,
        '下扫须从低音弦侧指向高音弦侧，与产品谱面保持一致');
      assert.equal(await page.locator('#i-strum path').evaluate(
        path => path.getPointAtLength(8).y < path.getPointAtLength(0).y), true);
      await page.locator('[data-stroke="up"]').click();
      assert.equal(await page.locator('#popover').isVisible(), false);
      assert.equal(await page.locator('[data-stroke="up"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-stroke="down"]').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#score [data-score-stroke="up"]').count(), 1);
      assert.equal(await page.locator('#score [data-score-stroke="up"]').evaluate(
        path => path.getPointAtLength(10).y > path.getPointAtLength(0).y), true,
        '上扫须从高音弦侧指向低音弦侧，与产品谱面保持一致');
      assert.equal(await page.locator('#i-strum-up path').evaluate(
        path => path.getPointAtLength(8).y > path.getPointAtLength(0).y), true);
      const count = await page.locator('.history-item').count();
      await page.locator('[data-stroke="up"]').click();
      assert.equal(await page.locator('.history-item').count(), count);
      if (width === 1440 && height === 900) {
        await page.screenshot({ path: path.join(dir, '上扫快捷-1440.png') });
      }
      await page.locator('#undo').click();
      assert.equal(await page.locator('#score [data-score-stroke="down"]').count(), 1);
      await page.locator('#undo').click();
      assert.equal(await page.locator('#score use[href="#i-rest"]').count(), 1);
      // 更多技巧原有扫弦窗口继续保留方向选择和手动应用。
      await page.locator('#tech-menu').click();
      await page.locator('[data-picker-tech="扫弦"]').click();
      assert.equal(await page.locator('#apply-tech').isDisabled(), true);
      assert.deepEqual(await page.locator('#direction option').allTextContents(), ['请选择方向','下扫','上扫']);
      await page.locator('.pop-close').click();
      await page.locator('[data-tech="琶音"]').click();
      assert.equal(await page.locator('#apply-tech').isDisabled(), true);
      await page.selectOption('#direction', { label: '上行（低音 → 高音）' });
      assert.equal(await page.locator('#apply-tech').isDisabled(), false);
      if (width === 1440 && height === 900) {
        await page.screenshot({ path: path.join(dir, '琶音参数-1440.png') });
      }
      await page.locator('#apply-tech').click();
      assert.equal(await page.locator('#score use[href="#i-rest"]').count(), 0);
      await page.locator('#undo').click();
      assert.equal(await page.locator('#score use[href="#i-rest"]').count(), 1);
      await page.locator('#redo').click();
      assert.equal(await page.locator('#score use[href="#i-rest"]').count(), 0);
      await page.locator('#undo').click();
      await page.locator('#rest').click();
      assert.equal(await page.locator('#redo').isDisabled(), true);
      results.push({ width, height, overflow: false, history: true, parameters: true, undoRedo: true, branch: true,
        shortcutsVisible: true, directStrumDirections: true, strumScoreDirectionMapping: true,
        strumNoOp: true, fullMenuUnchanged: true, iconOnlyPanelToggle: true,
        panelWithoutTitleRow: true, panelInputAndTabPreserved: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    await page.locator('[data-tab="numbered"]').click();
    assert.equal(await page.locator('#rest').isDisabled(), true);
    assert.equal(await page.locator('[data-tech="琶音"]').isDisabled(), true);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    // 字体放大单列验证；不冒充浏览器原生 200% 缩放。
    await page.locator('#rest').boundingBox();
    const scaled = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      rest: document.getElementById('rest').getBoundingClientRect().right,
      more: document.getElementById('more-menu').getBoundingClientRect().right,
    }));
    assert(scaled.document <= 1440 && scaled.rest <= 1440 && scaled.more <= 1440,
      `200%字体导致关键入口裁切: ${JSON.stringify(scaled)}`);
    await page.screenshot({ path: path.join(dir, '字体200%-1440.png') });
    assert.equal(errors.length, 0, errors.join('\n'));
    const report = { scope: '静态交互稿，非产品运行时验收', results, numberedFocusGuard: true,
      iconOnlyToolbar: true, tooltipHoverFocusEscape: true,
      textScale200: '已截图；不等价于原生浏览器缩放', consoleErrors: errors,
      limitations: ['真实产品尚未实施', '未运行浏览器原生200%缩放、系统IME或多浏览器矩阵',
        '谱面和历史为演示数据，H/P完整音高校验、所有低频菜单、焦点圈定及导入导出不在原型中实现'] };
    await fs.writeFile(path.join(__dirname, 'prototype-validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
