import assert from "node:assert/strict";

const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
// 可连接以 macOS「始终」或「滚动时」偏好启动的真实浏览器。先实测未定制的占槽尺寸，防止误测模式。
const browser = process.env.LXM_CHROME_CDP
  ? await chromium.connectOverCDP(process.env.LXM_CHROME_CDP)
  : await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
const origin = (process.env.REQ_NEXT_ORIGIN ?? "http://127.0.0.1:3031").replace(/\/$/, "");
const desktop = { width: 1440, height: 390 };

try {
  const page = await browser.newPage({ viewport: desktop, reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.guitarStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const result = start.apply(this, args);
      window.guitarStarts++;
      return result;
    };
  });
  await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
  const importButton = page.getByRole("button", { name: "文件", exact: true });
  const importElement = await importButton.elementHandle();
  await page.waitForFunction((node) => Object.keys(node).some((key) => key.startsWith("__reactProps$")), importElement);
  await importElement.dispose();
  await page.locator('[data-score-viewport] [data-measure-number]').nth(41).waitFor({ state: "attached" });

  const nativeSlot = await page.evaluate(() => {
    const sample = document.createElement("div");
    sample.style.cssText = "position:absolute;visibility:hidden;width:100px;height:100px;overflow:scroll";
    document.body.append(sample);
    const width = sample.offsetWidth - sample.clientWidth;
    sample.remove();
    return width;
  });
  if (process.env.LXM_NATIVE_SCROLL_MODE) assert.equal(nativeSlot > 0 ? "classic" : "overlay", process.env.LXM_NATIVE_SCROLL_MODE);

  const view = (selector) => page.locator(selector);
  const score = view("[data-score-viewport]");
  const property = view("[data-music-text-fields]");
  const order = view("[data-playback-order]");
  const bar = (viewport, axis = "vertical") => viewport.locator(`xpath=following-sibling::*[1]`).locator(`[data-scroll-axis=${axis}]`);
  const menu = page.getByRole("tab", { name: "歌曲", exact: true });
  const heading = page.getByRole("heading", { name: "小节播放顺序", exact: true });
  const y = (viewport) => viewport.evaluate((node) => node.scrollTop);
  const home = (viewport) => viewport.evaluate((node) => node.scrollTo(0, 0));
  const visible = (track, expected) => track.evaluate((node, visible) => {
    if (Number(getComputedStyle(node).opacity) !== Number(visible)) throw new Error(`滚动条可见状态与预期不符 ${visible}`);
  }, expected);
  async function drag(viewport, other, axis = "vertical") {
    const track = bar(viewport, axis);
    await viewport.hover();
    await track.locator("..").and(page.locator(`[data-overflow-${axis}]`)).waitFor();
    await visible(track, true);
    const thumb = await track.locator("span").boundingBox();
    assert.equal(axis === "vertical" ? thumb.width : thumb.height, 4);
    const before = await y(other);
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    // 拖出视口边界仍应保持捕获，松手后对应视口已达到末端。
    await page.mouse.move(axis === "vertical" ? thumb.x - 35 : desktop.width - 2, axis === "vertical" ? desktop.height - 2 : thumb.y - 30, { steps: 5 });
    await page.mouse.up();
    const { scroll, end } = await viewport.evaluate((node, axis) => axis === "vertical"
      ? { scroll: node.scrollTop, end: node.scrollHeight - node.clientHeight }
      : { scroll: node.scrollLeft, end: node.scrollWidth - node.clientWidth }, axis);
    assert.ok(scroll > 0 && Math.abs(scroll - end) <= 1);
    assert.equal(await y(other), before);
  }

  await menu.click();
  const menuPosition = await menu.boundingBox();
  await drag(score, property);
  await drag(property, score);
  assert.deepEqual(await menu.boundingBox(), menuPosition);
  await page.mouse.move(650, 16);
  await page.waitForFunction(() => !document.querySelector("[data-recent-scroll]"));
  await visible(bar(property), false);
  await home(property);
  await property.focus();
  await property.press("PageDown");
  await page.waitForFunction(() => document.querySelector("[data-music-text-fields]").scrollTop > 0);
  await visible(bar(property), true);
  const zoomIn = page.getByRole("button", { name: "放大谱面", exact: true });
  while (await zoomIn.isEnabled()) await zoomIn.click();
  await drag(score, property, "horizontal");

  await page.getByRole("button", { name: "木吉他试听", exact: true }).click();
  const position = await heading.boundingBox();
  const overflowingWidth = await order.evaluate((node) => node.clientWidth);
  await drag(order, score);
  await drag(score, order);
  assert.deepEqual(await heading.boundingBox(), position);
  await home(order);
  const scoreBeforeWheel = await y(score);
  await order.hover();
  await page.mouse.wheel(0, 65);
  await page.waitForFunction(() => document.querySelector("[data-playback-order]").scrollTop > 0);
  await page.mouse.move(650, 16);
  await visible(bar(order), true);
  assert.equal(await y(score), scoreBeforeWheel);
  await page.waitForFunction(() => !document.querySelector("[data-playback-order] + [data-recent-scroll]"));
  await visible(bar(order), false);
  await home(order);
  await order.focus();
  await order.press("End");
  await page.waitForFunction(() => document.querySelector("[data-playback-order]").scrollTop > 0);
  await page.emulateMedia({ contrast: "more" });
  assert.equal(await bar(order).locator("span").evaluate((node) => node.getBoundingClientRect().width), 4);
  await page.emulateMedia({ forcedColors: "active" });
  assert.equal(await bar(order).isVisible(), false);
  assert.equal(await bar(score).isVisible(), false);
  assert.equal(await order.evaluate((node) => getComputedStyle(node).scrollbarWidth), "auto");
  await order.press("Home");
  await page.waitForFunction(() => document.querySelector("[data-playback-order]").scrollTop === 0);
  await page.emulateMedia({ forcedColors: "none", contrast: "no-preference" });
  await page.setViewportSize({ width: desktop.width, height: 1250 });
  await page.waitForFunction(() => !document.querySelector("[data-playback-order] + [data-overflow-vertical]"));
  await order.hover();
  await visible(bar(order), false);
  assert.equal(await order.evaluate((node) => node.clientWidth), overflowingWidth);
  // 应用内《理想》确实有两次进入第 17 小节，分别用鼠标与键盘点听并检查真实音频源及游标身份。
  const visits = order.locator("[data-jump-visit]").filter({ has: page.locator("[data-visit-measure]").filter({ hasText: /^17$/ }) });
  assert.equal(await visits.count(), 2);
  for (const [index, visit] of (await visits.all()).entries()) {
    const id = await visit.getAttribute("data-jump-visit");
    const before = await page.evaluate(() => window.guitarStarts);
    if (index === 0) await visit.click();
    else { await visit.focus(); await visit.press("Enter"); }
    await score.locator(`[data-playback-visit="${id}"][data-playback-measure-end="true"]`).waitFor();
    assert.equal(await order.locator('[aria-current="step"]').getAttribute("data-jump-visit"), id);
    assert.ok(await page.evaluate((count) => window.guitarStarts > count, before));
  }
  console.log(`BUG-085 browser passed (${nativeSlot ? `classic ${nativeSlot}px` : "overlay"})`);
} finally {
  await browser.close();
}
