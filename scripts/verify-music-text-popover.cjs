// Run with Playwright available in NODE_PATH and the website running on BASE_URL.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const out = path.resolve("artifacts/mvp-v8-popover");
  await fs.mkdir(out, { recursive: true });
  const results = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const check = async (name, action) => {
    try {
      await action();
      results.push({ name, passed: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
      throw error;
    }
  };
  const reset = async () => {
    await page.goto(process.env.BASE_URL || "http://localhost:3100");
    await page.getByRole("application", { name: "六线谱编辑器" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const surface = page.locator("#music-text-sidebar");
  const lyric = page.locator("#lyric-body");
  const firstLyric = () => page.locator('[role="application"] text[font-size="13"]').first();
  try {
    await reset();
    await check("歌词气泡锚定且无遮罩", async () => {
      await firstLyric().click();
      await lyric.waitFor();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.dataset.popoverPlacement);
      assert.equal(await surface.getAttribute("data-text-surface"), "popover");
      const box = await surface.boundingBox();
      const note = await firstLyric().boundingBox();
      assert(box && box.width <= 360 && box.height < 240);
      assert(box.y >= note.y + note.height || box.y + box.height <= note.y || box.x + box.width <= note.x || box.x >= note.x + note.width);
      assert.equal(await page.locator('.ant-modal-mask:visible').count(), 0);
      await page.screenshot({ path: path.join(out, "lyric-popover.png") });
    });
    await check("歌词草稿、DOM 与选区往返保留", async () => {
      await lyric.fill("测试歌词");
      await lyric.evaluate((el) => {
        window.__popoverInput = el;
        el.setSelectionRange(1, 3);
      });
      await page.getByRole("button", { name: "更多编辑", exact: true }).click();
      assert.equal(await surface.getAttribute("data-text-surface"), "sidebar");
      assert.equal(await lyric.evaluate((el) => window.__popoverInput === el), true);
      await page.getByRole("button", { name: "回到气泡", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
      assert.equal(await lyric.inputValue(), "测试歌词");
      assert.deepEqual(await lyric.evaluate((el) => [window.__popoverInput === el, el.selectionStart, el.selectionEnd]), [true, 1, 3]);
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
    });
    await check("组合输入禁止切表面和选词提交", async () => {
      await lyric.dispatchEvent("compositionstart");
      await page.getByRole("button", { name: "更多编辑", exact: true }).evaluate((el) => el.click());
      assert.equal(await surface.getAttribute("data-text-surface"), "popover");
      await lyric.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true, bubbles: true });
      assert.equal(await lyric.inputValue(), "测试歌词");
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
      await lyric.dispatchEvent("compositionend");
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(el => el.textContent === '更多编辑')?.disabled);
    });
    await check("脏气泡点击谱面空白不丢输入", async () => {
      await page.locator('[role="application"]').click({ position: { x: 10, y: 10 } });
      assert.equal(await lyric.inputValue(), "测试歌词");
      assert.equal(await surface.getAttribute("aria-hidden"), null);
    });
    await reset();
    await check("歌词无修改下一处不产生撤销", async () => {
      await firstLyric().click();
      await page.getByRole("button", { name: "下一处", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
      assert.match(await surface.innerText(), /第2拍|位置 2/);
    });
    await check("干净气泡空白收起且重复点选恢复", async () => {
      await page.locator('[role="application"]').click({ position: { x: 10, y: 10 } });
      assert.equal(await surface.getAttribute("aria-hidden"), "true");
      await firstLyric().click();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
      assert.equal(await surface.getAttribute("aria-hidden"), null);
    });
    await check("组合输入期间离屏保持，结束后隐藏并保留草稿", async () => {
      await page.setViewportSize({ width: 1440, height: 720 });
      await lyric.fill("离屏草稿");
      await lyric.dispatchEvent("compositionstart");
      await page.getByRole("main", { name: "A4 乐谱页面" }).evaluate(el => { el.parentElement.scrollTop = el.parentElement.scrollHeight; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const offscreen = await firstLyric().boundingBox();
      const viewport = await page.getByRole("main", { name: "A4 乐谱页面" }).evaluate(el => ({ y: el.parentElement.getBoundingClientRect().y }));
      assert(offscreen.y + offscreen.height < viewport.y, "test target must actually be offscreen");
      assert.equal(await surface.getAttribute("aria-hidden"), null);
      await lyric.dispatchEvent("compositionend");
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.getAttribute('aria-hidden') === 'true');
      assert.equal(await lyric.inputValue(), "离屏草稿");
      await page.setViewportSize({ width: 1300, height: 720 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await surface.getAttribute("aria-hidden"), "true");
      await page.setViewportSize({ width: 1440, height: 720 });
      await page.getByRole("main", { name: "A4 乐谱页面" }).evaluate(el => { el.parentElement.scrollTop = 0; });
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
      assert.equal(await lyric.evaluate(el => document.activeElement === el), false);
      assert.equal(await lyric.inputValue(), "离屏草稿");
    });
    await check("空间不足在侧栏继续且扩大后不抢回", async () => {
      await lyric.evaluate(el => { window.__popoverInput = el; });
      await page.setViewportSize({ width: 700, height: 280 });
      await firstLyric().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.dataset.textSurface === 'sidebar');
      assert.equal(await lyric.inputValue(), "离屏草稿");
      assert.equal(await lyric.evaluate(el => window.__popoverInput === el), true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(await surface.getAttribute("data-text-surface"), "sidebar");
      await page.getByRole("button", { name: "回到气泡", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
    });
    await check("关闭脏草稿需要确认，取消确认零写入", async () => {
      await page.setViewportSize({ width: 1440, height: 720 });
      await page.getByRole("button", { name: "结束文字编辑", exact: true }).click();
      await page.getByRole("alertdialog").waitFor();
      const confirmation = await page.getByRole("alertdialog").boundingBox();
      assert(confirmation.x >= 0 && confirmation.y >= 0 &&
        confirmation.x + confirmation.width <= 1440 &&
        confirmation.y + confirmation.height <= 720);
      await page.getByRole("button", { name: "继续编辑", exact: true }).click();
      assert.equal(await lyric.inputValue(), "离屏草稿");
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await reset();
    await check("空白时间窗首次填词后保持真实目标和编辑会话", async () => {
      const slot = await page.locator('[data-paragraph-cell^="numbered/"]').first().boundingBox();
      // 占位框是 pointer-events:none 装饰，真实交互由 SVG 坐标命中。
      await page.mouse.click(slot.x + slot.width / 2, slot.y + slot.height / 2);
      await page.getByRole("button", { name: "更多编辑", exact: true }).click();
      await page.getByRole("button", { name: "添加歌词行", exact: true }).click();
      await lyric.fill("空位");
      await lyric.press("Shift+Enter");
      await page.locator('[role="application"] text').filter({ hasText: /^空位$/ }).waitFor();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
      assert.equal(await lyric.inputValue(), "空位");
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isEnabled(), true);
      await page.getByRole("button", { name: "更多编辑", exact: true }).click();
      await page.getByRole("button", { name: "回到气泡", exact: true }).click();
      await lyric.waitFor();
      assert.equal(await lyric.inputValue(), "空位");
    });
    await reset();
    await check("简谱紧凑视图及侧栏往返保留正文节点", async () => {
      await page.locator('[role="application"] text[font-size="14"]').first().click();
      const input = surface.locator("textarea");
      await input.waitFor();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
      assert.equal(await page.getByRole("group", { name: "常用时值" }).isVisible(), true);
      const box = await surface.boundingBox();
      assert(box.width <= 400 && box.height < 260);
      assert.equal(await page.getByLabel("简谱节奏模板").isVisible(), false);
      await input.fill("6");
      await input.evaluate(el => { window.__numberedInput = el; el.setSelectionRange(0, 1); });
      await page.getByRole("button", { name: "更多编辑", exact: true }).click();
      assert.equal(await input.evaluate(el => window.__numberedInput === el), true);
      await page.getByRole("button", { name: "回到气泡", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
      assert.equal(await input.inputValue(), "6");
      assert.deepEqual(await input.evaluate(el => [window.__numberedInput === el, el.selectionStart, el.selectionEnd]), [true, 0, 1]);
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
      await page.screenshot({ path: path.join(out, "numbered-popover.png") });
    });
    await reset();
    await check("已有简谱时值独立应用，正文不被提交", async () => {
      const firstNote = page.locator('[role="application"] text[font-size="14"]').first();
      await firstNote.click();
      const toolbar = page.getByRole("group", { name: "常用时值" });
      await toolbar.getByRole("button", { name: "八分音符", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "应用", exact: true }).isDisabled(), true);
      assert.equal(await firstNote.textContent(), "1");
      await page.getByRole("button", { name: "应用时值", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isEnabled(), true);
      assert.equal(await firstNote.textContent(), "1");
      await surface.locator("textarea").fill("6");
      await page.getByRole("button", { name: "应用", exact: true }).click();
      assert.equal(await firstNote.textContent(), "6");
      await page.getByRole("button", { name: "结束文字编辑", exact: true }).click();
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      assert.equal(await firstNote.textContent(), "1");
    });
    const firstNumber = () => page.locator('[role="application"] text[font-size="14"]').first();
    const numberedInput = surface.locator('[data-presentation] textarea');
    await reset();
    await check("正文与时值依赖冲突提前禁用", async () => {
      await firstNumber().click();
      await page.getByRole("group", { name: "常用时值" }).getByRole("button", { name: "八分音符", exact: true }).click();
      await numberedInput.fill("6");
      assert.equal(await surface.getByRole("button", { name: "应用", exact: true }).isDisabled(), true);
      assert.match(await page.getByLabel("简谱紧凑摘要").innerText(), /先应用或恢复事件时值组/);
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
    });
    await check("干净气泡收起及离屏后释放谱面键盘", async () => {
      for (const offscreen of [false, true]) {
        await reset();
        await page.setViewportSize({ width: 1440, height: 720 });
        await firstLyric().click();
        await lyric.waitFor();
        await lyric.focus();
        if (offscreen) {
          await page.getByRole("main", { name: "A4 乐谱页面" }).evaluate(el => {
            el.parentElement.scrollTop = el.parentElement.scrollHeight;
          });
        } else {
          await page.locator('[role="application"]').click({ position: { x: 10, y: 10 } });
        }
        await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.getAttribute('aria-hidden') === 'true');
        await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'application');
        await page.keyboard.press("9");
        await page.getByText("请先选择谱面中的 TAB 单元格，再输入品位。", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await reset();
    await check("保留音高草稿返回气泡后可继续正文编辑", async () => {
      await firstNumber().click();
      await page.getByRole("button", { name: "更多编辑", exact: true }).click();
      await surface.locator("summary").filter({ hasText: "高级工具" }).click();
      const pitch = page.locator('[aria-label="简谱单音符音高"]');
      await pitch.fill("7");
      await page.getByRole("button", { name: "回到气泡", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
      await numberedInput.fill("6");
      assert.equal(await surface.getAttribute("data-text-surface"), "popover");
      assert.match(await page.getByLabel("简谱紧凑摘要").innerText(), /另有音高修改/);
      assert.equal(await pitch.inputValue(), "7");
      assert.equal(await firstNumber().textContent(), "1");
      assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "更多编辑", exact: true }).click();
      assert.equal(await pitch.inputValue(), "7");
      assert.equal(await numberedInput.inputValue(), "6");
    });
    await reset();
    await check("组合输入及结束保护期间历史操作零写入", async () => {
      await firstNumber().click();
      await numberedInput.fill("6");
      await page.getByRole("button", { name: "应用", exact: true }).click();
      await numberedInput.fill("7");
      await numberedInput.dispatchEvent("compositionstart");
      await page.getByRole("button", { name: "撤销", exact: true }).evaluate(el => {
        window.__popoverUndo = el;
        el.click();
      });
      assert.equal(await firstNumber().textContent(), "6");
      assert.equal(await numberedInput.inputValue(), "7");
      await numberedInput.evaluate(el => {
        el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        window.__popoverUndo.click();
        const score = document.querySelector('[role="application"]');
        score.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true }));
      });
      assert.equal(await firstNumber().textContent(), "6");
      assert.equal(await numberedInput.inputValue(), "7");
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(el => el.textContent === '更多编辑')?.disabled);
    });
    await reset();
    await check("已有锚点暂失后释放输入且恢复时不抢焦点", async () => {
      await firstLyric().click();
      await lyric.waitFor();
      await lyric.focus();
      await page.evaluate(() => {
        const svg = document.querySelector('[role="application"]');
        window.__popoverCTM = svg.getScreenCTM;
        svg.getScreenCTM = () => null;
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.getAttribute('aria-hidden') === 'true');
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'application');
      await page.keyboard.press("9");
      await page.getByText("请先选择谱面中的 TAB 单元格，再输入品位。", { exact: true }).waitFor();
      await page.evaluate(() => {
        document.querySelector('[role="application"]').getScreenCTM = window.__popoverCTM;
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForFunction(() => document.querySelector('#music-text-sidebar')?.style.visibility === 'visible');
      assert.equal(await lyric.evaluate(el => document.activeElement === el), false);
      assert.equal(await lyric.inputValue(), "轻");
    });
    assert.deepEqual(errors, []);
  } finally {
    if (!results.length || results.some(result => !result.passed)) {
      await page.screenshot({ path: path.join(out, "last-state.png") });
      await fs.writeFile(path.join(out, "last-state.txt"), await page.locator("body").innerText());
    }
    await fs.writeFile(path.join(out, "browser-results.json"), JSON.stringify({ results, errors }, null, 2));
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
