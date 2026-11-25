import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const runtime = process.env.LXM_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(runtime.startsWith('/') ? pathToFileURL(runtime).href : runtime);
const browser = await chromium.launch({ executablePath: process.env.LXM_BROWSER_EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.addInitScript(() => {
    window.demoTones = [];
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.demoTones.push(this.frequency.value);
      return start.apply(this, args);
    };
  });
  await page.goto(new URL('./index.html', import.meta.url).href);
  const bar = (index) => page.locator(`[data-measure="${index - 1}"]`);
  const button = (name) => page.getByRole('button', { name, exact: true });
  const add = () => button('添加单小节重复').click();
  const expand = () => button('展开为普通小节').click();
  const scenario = (name) => page.locator('#scenario').selectOption(name);
  const fileAction = async (name) => {
    await page.locator('summary').filter({ hasText: /^文件$/ }).click();
    await button(name).click();
  };
  const changeFret = async (value) => {
    await page.locator('#fret').fill(String(value));
    await button('应用品位').click();
  };
  const firstFret = (index) => bar(index).locator('[data-beat="0"]').textContent();
  const selectBar = (index) => page.locator(`#bar-${index - 1}`).click();
  const enterFromTop = async () => {
    await button('试听').click();
    await page.locator('#start').selectOption('0');
  };
  const fingerings = (index) => bar(index).locator('.beat').allTextContents();
  const assertPlaybackBeat = async (position) => {
    const measure = Math.floor(position / 4) + 1;
    const beat = position % 4 + 1;
    assert(await bar(measure).locator('.cursor').isVisible(), `游标应在第 ${measure} 小节第 ${beat} 拍`);
    assert.match(await page.locator('.timeline [aria-current="step"]').textContent(), new RegExp(`第 ${measure} 小节.*第 ${beat} 拍`));
  };
  const setAuditionVisibility = (hidden) => page.evaluate((value) => {
    // Headless Chrome 切换标签未必发出 visibilitychange。显式控制该输入以验证后台暂停。
    if (value === null) {
      delete document.hidden;
      delete document.visibilityState;
      return;
    }
    Object.defineProperties(document, {
      hidden: { configurable: true, value },
      visibilityState: { configurable: true, value: value ? 'hidden' : 'visible' },
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

  assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  assert(await page.locator('.brand img').evaluate((image) => image.complete && image.naturalWidth > 0));
  await bar(2).click({ button: 'right' });
  await button('小节工具　›　反复与跳转').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'repeat-heading');
  await add();
  assert.equal(await bar(2).locator('.repeat-hit').count(), 1);
  assert.equal(await bar(2).locator('.beat').count(), 0);
  assert.equal(await bar(2).locator('.staff i').count(), 6);
  const staffBox = await bar(2).locator('.staff').boundingBox();
  const signBox = await bar(2).locator('.repeat-hit svg').boundingBox();
  assert(Math.abs((staffBox.x + staffBox.width / 2) - (signBox.x + signBox.width / 2)) < 1);
  assert(Math.abs((staffBox.y + staffBox.height / 2) - (signBox.y + signBox.height / 2)) < 1);

  await fileAction('保存模拟');
  await expand();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'fret');
  await changeFret(7);
  assert.equal(await firstFret(2), '7');
  await fileAction('重开模拟');
  await button('取消').click();
  assert.equal(await firstFret(2), '7');
  await fileAction('重开模拟');
  await button('丢弃并重开').click();
  await bar(2).locator('.repeat-hit').waitFor();
  assert.match(await page.locator('#file-state').textContent(), /已保存/);
  await page.reload();
  await fileAction('重开模拟');
  await button('丢弃并重开').click();
  await bar(2).locator('.repeat-hit').waitFor();

  await enterFromTop();
  assert(await page.locator('#sidebar').isHidden());
  for (let position = 0; position < 12; position++) {
    await button('下一拍').click();
    await assertPlaybackBeat(position);
  }
  const tones = await page.evaluate(() => window.demoTones);
  assert.equal(tones.length, 12);
  assert.deepEqual(tones.slice(0, 4), tones.slice(4, 8));
  assert.notDeepEqual(tones.slice(4, 8), tones.slice(8, 12));
  await button('停止').click();

  // 同时控制 setTimeout 与 performance.now()，每次推进都经过真实的自动播放回调。
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(60_000);
  const playStatus = page.locator('#play-status');
  const beatMs = Math.ceil(60_000 / 90);
  await setAuditionVisibility(false);
  try {
    // 按键直接触发已聚焦按钮，在时钟暂停期间无需等待鼠标动效的帧。
    await button('播放').press('Enter');
    await assertPlaybackBeat(0);
    await page.clock.runFor(250);
    await button('暂停').press('Enter');
    await page.clock.runFor(beatMs * 2);
    assert.equal(await playStatus.textContent(), '已暂停，第 1 小节');
    await assertPlaybackBeat(0);
    await button('继续').press('Enter');
    await page.clock.runFor(400);
    await assertPlaybackBeat(0);
    await page.clock.runFor(30);
    await assertPlaybackBeat(1);

    for (let position = 2; position <= 8; position++) {
      await page.clock.runFor(beatMs);
      await assertPlaybackBeat(position);
    }

    // 复现原超时现场，在第 3 小节切后台，时间继续推进时游标仍停在当前拍。
    await setAuditionVisibility(true);
    await page.clock.runFor(beatMs * 5);
    assert.equal(await playStatus.textContent(), '页面已切至后台，试听已暂停，第 3 小节');
    await assertPlaybackBeat(8);
    await setAuditionVisibility(false);
    await page.clock.runFor(beatMs);
    assert(await button('继续').isVisible(), '回到前台后应等待用户继续');
    await assertPlaybackBeat(8);
    await button('继续').press('Enter');

    for (let position = 9; position < 12; position++) {
      await page.clock.runFor(beatMs);
      await assertPlaybackBeat(position);
    }
    assert.equal(await playStatus.textContent(), '第 3 小节');
    await page.clock.runFor(beatMs);
    assert.equal(await playStatus.textContent(), '试听结束');
    assert.deepEqual(await page.evaluate(() => window.demoTones.slice(12)), tones);
  } finally {
    await setAuditionVisibility(null);
    await page.clock.resume();
  }
  await button('退出试听').click();
  assert(await page.locator('#sidebar').isVisible());
  assert.equal(await page.locator('#bar-1').getAttribute('aria-pressed'), 'true');

  await button('编辑前一小节').click();
  await changeFret(6);
  assert.equal(await firstFret(1), '6');
  assert.equal(await firstFret(2), '3');
  assert.match(await page.locator('#message').textContent(), /已展开.*保留/);
  await page.locator('#message-undo').click();
  assert.equal(await firstFret(1), '3');
  assert.equal(await bar(2).locator('.repeat-hit').count(), 1);
  await page.locator('#mode').selectOption('sync');
  await changeFret(6);
  assert.equal(await bar(2).locator('.repeat-hit').count(), 1);
  assert.match(await page.locator('#message').textContent(), /已同步更新/);
  await selectBar(2);
  await expand();
  assert.equal(await firstFret(2), '6');
  await changeFret(8);
  assert.equal(await firstFret(2), '8');
  assert.equal(await firstFret(1), '6');

  await scenario('filled');
  const original = await fingerings(2);
  await add();
  assert.match(await page.locator('#confirm-preview').textContent(), /5 \/ 3 \/ 2 \/ 0/);
  await button('取消').click();
  assert.deepEqual(await fingerings(2), original);
  await add();
  await button('替换并添加记号').click();
  await bar(2).locator('.repeat-hit').waitFor();
  await page.locator('#message-undo').click();
  assert.deepEqual(await fingerings(2), original);
  await page.locator('#redo').click();
  assert.equal(await bar(2).locator('.repeat-hit').count(), 1);

  await scenario('first');
  assert(await button('添加单小节重复').isDisabled());
  await button('去第 2 小节').click();
  assert(await button('添加单小节重复').isEnabled());
  await scenario('meter');
  assert(await button('添加单小节重复').isDisabled());
  assert.match(await page.locator('#repeat-reason').textContent(), /4\/4.*3\/4/);
  await selectBar(3);
  assert.match(await page.locator('#repeat-reason').textContent(), /影响现有音符/);
  await button('查看此小节内容').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'note-heading');
  await selectBar(2);
  await button('将此小节改为 4/4').click();
  await add();
  assert.equal(await bar(2).locator('.repeat-hit').count(), 1);

  for (const [name, lyricBar] of [['source-lyric', 1], ['target-lyric', 2]]) {
    await scenario(name);
    assert(await button('添加单小节重复').isDisabled());
    await button(`查看第 ${lyricBar} 小节的歌词`).click();
    await button('清除此小节歌词…').click();
    await button('取消').click();
    assert((await bar(lyricBar).locator('.lyric').textContent()).trim());
    await button('清除此小节歌词…').click();
    await button('清除歌词').click();
    await page.locator('#lyric-in-sidebar').waitFor({ state: 'detached' });
    await selectBar(2);
    assert(await button('添加单小节重复').isEnabled());
  }
  await scenario('chain');
  assert(await button('添加单小节重复').isDisabled());
  await button('查看前一小节').click();
  await expand();
  await selectBar(3);
  assert(await button('添加单小节重复').isEnabled());
  assert.deepEqual(errors, []);
  console.log('REQ-108 通过：离线 1440px、共用入口、记号居中、逐拍与自动试听、后台暂停与继续、方案 A/B、确认与撤销、保存重开、边界反馈。');
} finally {
  await browser.close();
}
