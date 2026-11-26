import assert from "node:assert/strict";

const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
const origin = (process.env.REQ_NEXT_ORIGIN ?? "http://127.0.0.1:3031").replace(/\/$/, "");
const production = process.env.REQ015_PRODUCTION_DEFAULT === "1";
const viewport = { width: 1440, height: 900 };
const github = "https://github.com/li-jingxuan/liuxianmao";
const deepLinks = [
  "/guitar-advanced",
  "/guitar-advanced/modules/rhythm-and-beat",
  "/guitar-advanced/theory/rhythm-eighth-sixteenth",
  "/guitar-advanced/practice/rhythm-identify-eighth-notes",
  "/guitar-advanced/progress",
  "/guitar-advanced/exam",
  "/guitar-advanced/exam/attempt/previous-attempt",
  "/guitar-advanced/exam/result/previous-attempt",
  "/technique-test",
];

async function checkDialog(page, trigger, name) {
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name });
  await dialog.waitFor();
  assert.equal(await dialog.locator(":focus").count(), 1);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((node) => document.activeElement === node), true);
}

async function imagesDecode(page) {
  assert.deepEqual(await page.locator("main img:visible").evaluateAll(async (images) => {
    const broken = [];
    for (const image of images) {
      image.loading = "eager";
      try { await image.decode(); } catch { broken.push(image.getAttribute("src")); }
    }
    return broken;
  }), []);
}

try {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  assert.equal((await page.goto(origin)).status(), 200);
  assert.equal(await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "产品首页" }).getAttribute("aria-current"), "page");
  assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "吉他谱，\n一弦一弦写");
  await imagesDecode(page);
  const home = await page.evaluate(() => {
    const hero = document.querySelector("[data-cue-active]");
    const window = hero.querySelector("figure");
    const footer = document.querySelector("footer");
    const source = document.querySelector('[aria-labelledby="source-heading"]');
    return [hero.parentElement.parentElement.scrollWidth, Math.round(window.getBoundingClientRect().width), footer.getBoundingClientRect().height, source.getBoundingClientRect().height];
  });
  assert.equal(home[0], 1440);
  assert.equal(home[2], 42);
  assert.equal(home[3], 42);
  // 对实际 CSS 入场时间轴取首尾样本，以免动画中途请求或解码速度使几何量测漂移。
  const entrance = await page.locator("[data-cue-active] figure").evaluate((element) => {
    const name = getComputedStyle(element).animationName;
    const cssDuration = getComputedStyle(element).animationDuration;
    const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
    const keyframes = rules.find((rule) => rule instanceof CSSKeyframesRule && rule.name === name);
    return { cssDuration, start: keyframes?.cssRules[0].style.transform, end: keyframes?.cssRules[1].style.transform };
  });
  assert.deepEqual(entrance, { cssDuration: "1.32s", start: "translateY(72px) rotate(-2deg)", end: "rotate(-2deg)" });
  const cue = page.locator("[data-example]");
  await page.waitForFunction(() => document.querySelector("[data-example]").getAnimations()[0]?.playState === "running");
  assert.deepEqual(await cue.evaluate((element) => [getComputedStyle(element).animationDuration, getComputedStyle(element).animationDelay]), ["4s", "1.04s"]);
  await page.getByRole("button", { name: "暂停选框" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-example]").getAnimations()[0]?.playState === "paused");
  const site = page.locator("main").locator("..");
  await site.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await site.evaluate((element) => { element.scrollTop = 0; });
  assert.equal(await cue.evaluate((element) => element.getAnimations()[0].playState), "paused");
  await page.getByRole("button", { name: "继续选框" }).click();
  await page.waitForFunction(() => document.querySelector("[data-example]").getAnimations()[0]?.playState === "running");
  await site.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => document.querySelector("[data-example]").getAnimations()[0]?.playState === "paused");
  await site.evaluate((element) => { element.scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector("[data-example]").getAnimations()[0]?.playState === "running");

  const homeGitHub = page.getByRole("link", { name: "查看 GitHub 源码" });
  assert.equal(await homeGitHub.getAttribute("href"), github);
  assert.equal(await homeGitHub.getAttribute("target"), "_blank");
  if (production) await checkDialog(page, page.getByRole("button", { name: "打开 Web 编辑器" }), "打开 Web 编辑器");
  else assert.equal(new URL(await page.getByRole("link", { name: "打开 Web 编辑器" }).getAttribute("href"), origin).href, `${origin}/editor`);

  await page.getByRole("link", { name: "下载桌面编辑器" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin}/download`);
  assert.equal(await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "编辑器下载" }).getAttribute("aria-current"), "page");
  assert.equal(await page.getByRole("link", { name: "查看源码" }).getAttribute("href"), github);
  await checkDialog(page, page.getByRole("button", { name: "下载 macOS 版" }), "macOS 安装包");
  await checkDialog(page, page.getByRole("button", { name: "下载 Windows 版" }), "Windows 安装包");
  if (production) await checkDialog(page, page.getByRole("button", { name: "在线体验" }), "打开 Web 编辑器");
  else assert.equal(new URL(await page.getByRole("link", { name: "在线体验" }).getAttribute("href"), origin).href, `${origin}/editor`);

  const gallery = page.getByRole("region", { name: "编辑器画面" });
  const current = gallery.getByLabel("当前画面");
  await current.waitFor();
  await page.clock.install();
  await page.mouse.move(20, 100);
  await page.reload();
  await current.waitFor();
  assert.equal(await current.innerText(), "1 / 3");
  await page.clock.fastForward(7100);
  await page.waitForFunction(() => document.querySelector('[aria-label="当前画面"]').textContent === "2 / 3");
  await gallery.hover();
  await page.clock.fastForward(7100);
  assert.equal(await current.innerText(), "2 / 3");
  await page.mouse.move(20, 100);
  const next = gallery.getByRole("button", { name: "下一张" });
  await next.focus();
  await page.clock.fastForward(7100);
  assert.equal(await current.innerText(), "2 / 3");
  await page.keyboard.press("Enter");
  assert.equal(await gallery.getByRole("status").textContent(), "第 3 张，共 3 张，A4 谱页导出");
  assert.equal(await gallery.locator("figure:visible img").evaluate((element) => getComputedStyle(element).animationDuration), "0.5s");
  await imagesDecode(page);
  await page.keyboard.press("Enter");
  assert.equal(await current.innerText(), "1 / 3");
  await gallery.getByRole("button", { name: "上一张" }).click();
  assert.equal(await current.innerText(), "3 / 3");
  await gallery.getByRole("button", { name: "暂停自动轮播" }).click();
  await page.mouse.move(20, 100);
  await page.getByRole("link", { name: "返回首页" }).focus();
  await page.clock.fastForward(7100);
  assert.equal(await current.innerText(), "3 / 3");
  await gallery.getByRole("button", { name: "继续自动轮播" }).click();
  await page.mouse.move(20, 100);
  await page.getByRole("link", { name: "返回首页" }).focus();
  await page.clock.fastForward(7100);
  await page.waitForFunction(() => document.querySelector('[aria-label="当前画面"]').textContent === "1 / 3");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.href.replace(/\/$/, "") === origin);
  assert.deepEqual(errors, []);

  const reduced = await browser.newPage({ viewport, reducedMotion: "reduce" });
  await reduced.goto(origin);
  assert.equal(await reduced.locator("[data-cue-active]").evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
  assert.equal(await reduced.getByRole("button", { name: "暂停选框" }).isVisible(), false);
  await reduced.getByRole("link", { name: "下载桌面编辑器" }).click();
  await reduced.clock.install();
  const reducedGallery = reduced.getByRole("region", { name: "编辑器画面" });
  await reducedGallery.getByRole("button", { name: "下一张" }).waitFor();
  await reduced.clock.fastForward(7100);
  assert.equal(await reducedGallery.getByLabel("当前画面").innerText(), "1 / 3");
  assert.equal(await reducedGallery.getByRole("button", { name: "暂停自动轮播" }).isVisible(), false);
  await reducedGallery.getByRole("button", { name: "下一张" }).click();
  assert.equal(await reducedGallery.getByLabel("当前画面").innerText(), "2 / 3");
  assert.equal(await reducedGallery.locator("figure:visible img").evaluate((element) => element.getAnimations().length), 0);
  await imagesDecode(reduced);

  const noScript = await browser.newPage({ viewport, javaScriptEnabled: false });
  await noScript.goto(origin);
  assert.equal(await noScript.locator("[data-example]").evaluate((element) => element.getAnimations().length), 0);
  await noScript.getByRole("link", { name: "下载桌面编辑器" }).click();
  await noScript.getByRole("heading", { name: "六线谱编辑", exact: true }).waitFor();
  assert.equal(await noScript.getByRole("button", { name: "下一张" }).count(), 0);
  await checkDialog(noScript, noScript.getByRole("button", { name: "下载 macOS 版" }), "macOS 安装包");
  await imagesDecode(noScript);

  // 新匿名上下文回访全部深链，并检查生产默认的同一发布边界覆盖编辑器与资源直达。
  for (const path of deepLinks) {
    assert.equal((await noScript.goto(`${origin}${path}`)).status(), 404, path);
    assert.equal((await noScript.reload()).status(), 404, `${path} 刷新`);
  }
  assert.equal((await noScript.goto(`${origin}/editor`)).status(), production ? 404 : 200);
  assert.equal((await noScript.request.get(`${origin}/previews/ideal/editor.png`)).status(), production ? 404 : 200);
  assert.equal((await noScript.request.get(`${origin}/assets/home/editor-preview.png`)).status(), 404);
  console.log(`REQ-015 ${production ? "production default" : "development preview"} passed · 1440×900 · gallery, motion and route boundaries`);
} finally {
  await browser.close();
}
