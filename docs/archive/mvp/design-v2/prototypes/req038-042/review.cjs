const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.LXM_PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.PROTOTYPE_URL || 'http://localhost:4191/docs/archive/mvp/design-v2/prototypes/req038-042/';
const artifacts = path.join(__dirname, 'screenshots');
const checks = [];
const errors = [];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    const shot = name => page.screenshot({ path: path.join(artifacts, name), fullPage: true, animations: 'disabled' });
    const sample = async name => {
      await page.getByRole('radio', { name, exact: true }).locator('..').click();
      await page.waitForFunction(() => !document.querySelector('.ant-segmented-thumb'));
    };
    const nav = name => page.getByRole('button', { name, exact: true }).click();
    const info = page.getByTestId('apply-info');
    const capo = page.getByTestId('apply-capo');
    const score = page.getByTestId('score-preview');
    await page.goto(url);
    assert.equal(await info.isDisabled(), true);
    assert.equal(await capo.isDisabled(), true);
    assert.equal(await page.locator('.project-frame input:not([readonly])').count(), 2);
    assert.equal(await page.locator('.project-frame .ant-select').count(), 1);
    assert.equal(await page.locator('.project-frame .ant-segmented').count(), 0);
    assert.equal(await page.locator('.key-readonly > div').count(), 4);
    assert.equal(await page.getByRole('radio', { name: 'C大调', exact: true }).evaluate(el => !!el.closest('.project-frame')), false);
    checks.push('调性四项为紧凑只读文本，产品内仅名称、作者及变调夹可编辑；展示样例位于产品框外');
    await shot('01-song.png');

    await page.getByLabel('歌曲名称', { exact: true }).fill('山谷回声');
    await page.getByLabel('编谱作者', { exact: true }).fill('原型作者');
    assert.equal(await score.locator('h1').innerText(), '风吹过山谷');
    await page.getByLabel('变调夹', { exact: true }).click();
    await page.getByText('第 2 品', { exact: true }).click();
    await info.click();
    assert.equal(await score.locator('h1').innerText(), '山谷回声');
    assert.equal(await score.locator('.credit').innerText(), '编谱：原型作者');
    assert.equal(await score.locator('.capo-preview').innerText(), '变调夹：不使用');
    assert.equal(await capo.isEnabled(), true);
    await page.getByLabel('歌曲名称', { exact: true }).fill('未应用名称');
    await capo.click();
    assert.equal(await score.locator('h1').innerText(), '山谷回声');
    assert.equal(await score.locator('.capo-preview').innerText(), '变调夹：第 2 品');
    assert.equal(await info.isEnabled(), true);
    checks.push('名称和作者应用更新头部，变调夹独立应用；双方均不提交另一类草稿');

    await sample('A小调记6');
    assert.equal(await page.getByLabel('歌曲名称', { exact: true }).inputValue(), '未应用名称');
    assert.equal(await score.locator('h1').innerText(), '山谷回声');
    assert.equal(await score.locator('.score-meta').innerText(), '1=C · 4/4\nA小调');
    assert.match(await page.locator('.key-readonly').innerText(), /主音记 6/);
    await info.click();
    assert.equal(await info.isDisabled(), true);
    await sample('旧曲谱示例');
    assert.equal(await info.isDisabled(), true);
    assert.equal(await score.locator('.score-meta').innerText(), '1=C · 4/4\n调性未确认');
    assert.deepEqual(await page.locator('.key-readonly dd').allTextContents(), ['C', '未确认', '—', '—']);
    checks.push('样例切换不改变名称作者草稿或应用状态；旧曲谱缺失mode显示调性未确认，不猜调');
    await page.reload();
    await sample('旧曲谱示例');
    await shot('09-legacy.png');
    await sample('A小调记6');
    await shot('02-minor.png');
    await nav('和弦推荐');
    assert.equal(await page.getByRole('heading', { name: 'A小调·和弦推荐', exact: true }).count(), 1);
    await shot('03-recommend.png');
    await nav('歌曲设置');
    await sample('旧曲谱示例');
    await nav('和弦推荐');
    assert.equal(await page.getByRole('heading', { name: '常用和弦推荐', exact: true }).count(), 1);
    await nav('歌曲设置');
    await sample('C大调');
    await nav('和弦推荐');
    assert.equal(await page.getByRole('heading', { name: 'C大调·和弦推荐', exact: true }).count(), 1);
    await shot('06-recommend-C.png');
    await page.getByLabel('搜索推荐和弦', { exact: true }).fill('F#m7');
    assert.equal(await page.getByRole('heading', { name: '搜索结果', exact: true }).count(), 1);
    checks.push('推荐标题跟随只读展示调性，未确认时用常用和弦标题，搜索时用搜索结果');

    await nav('和弦库回退');
    assert.deepEqual(await page.locator('.group-heading h3').allTextContents(), ['当前调性 · 自然三和弦', '七和弦', '小调和声补充', '其他和弦']);
    assert.deepEqual(await page.locator('.group-heading > span').allTextContents(), ['7 项', '7 项', '4 项', '174 项']);
    const chords = await page.locator('.library-grid button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    assert.equal(chords.length, 192);
    assert.equal(new Set(chords).size, 192);
    await shot('04-library.png');
    await page.getByTestId('library-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await shot('07-library-other.png');
    await sample('C大调');
    assert.deepEqual(await page.locator('.group-heading > span').allTextContents(), ['7 项', '7 项', '178 项']);
    await page.getByLabel('搜索库和弦', { exact: true }).fill('F#m7');
    assert.deepEqual(await page.locator('.group-heading h3').allTextContents(), ['搜索结果']);
    checks.push('REQ038恢复旧分组：A小调7/7/4/174项，C大调7/7/178项；192项无重复遗漏，搜索平铺');

    await nav('歌曲设置');
    await page.getByRole('switch', { name: '错误提示示例' }).click();
    assert.equal(await page.getByRole('alert').innerText(), '曲谱信息应用失败，请重试。');
    await shot('08-error.png');
    await page.getByRole('switch', { name: '错误提示示例' }).click();
    for (const width of [720, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scene of ['歌曲设置', '和弦推荐', '和弦库回退']) {
        await nav(scene);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px ${scene}溢出`);
      }
    }
    await nav('歌曲设置');
    await shot('05-narrow.png');
    assert.equal(await page.getByText(/待确认/).count(), 0);
    checks.push('720px与390px三页无横向溢出；紧凑错误样例可用，无待确认标记');
    assert.deepEqual(errors, []);
    console.log(`浏览器复核通过：${checks.length} 组检查，9 张截图已刷新。`);
  } catch (error) {
    errors.push(error.stack);
    process.exitCode = 1;
    console.error(error);
  } finally {
    fs.writeFileSync(path.join(artifacts, 'review-result.json'), JSON.stringify({ checks, errors }, null, 2) + '\n');
    await browser.close();
  }
})();
