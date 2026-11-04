// LXM_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node <this file>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: website, configFile: false, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(website, "../..")] } }, plugins: [{ name: "settings-fixture", configureServer(dev) { dev.middlewares.use((request, response, next) => { if (!request.url?.startsWith("/__settings-test__")) return next(); response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><div id="root"></div><script type="module" src="/tests/score-settings-portals.browser.tsx"></script>'); }); } }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async () => { await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__settings-test__`); await page.locator("#settings-title").waitFor(); await page.waitForFunction(() => !!window.settingsTest); };
  const status = () => page.evaluate(() => window.settingsTest.status());
  await open();
  assert.equal(await page.locator("#settings-label").count(), 1);
  assert.equal(await page.locator('[data-settings-surface="song"] #settings-label').count(), 0);
  await page.locator("#settings-title").fill("未应用名称");
  await page.evaluate(() => window.settingsTest.externalCapo(5));
  assert.equal(await page.locator("#settings-title").inputValue(), "未应用名称");
  assert.equal(await page.locator("#settings-capo").inputValue(), "5");
  assert.equal((await status()).groups.info.canApply, true);
  await page.evaluate(() => window.settingsTest.external("外部名称"));
  assert.equal(await page.locator("#settings-title").inputValue(), "未应用名称");
  assert.equal((await status()).groups.info.canApply, false);
  assert.equal(await page.evaluate(() => window.settingsTest.apply("info")), false);
  await page.locator("#settings-title").fill("核对后的名称");
  assert.equal((await status()).groups.info.canApply, true);
  assert.equal(await page.evaluate(() => window.settingsTest.apply("info")), true);
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.title), "核对后的名称");

  await page.evaluate(() => window.settingsTest.focus("label"));
  await page.waitForFunction(() => document.activeElement?.id === "settings-label");
  await page.locator("#settings-label").fill("原小节标记");
  const bound = (await status()).measureId;
  await page.evaluate(() => window.settingsTest.measure(1));
  assert.equal((await status()).measureId, bound);
  assert.equal(await page.evaluate(() => window.settingsTest.apply("label")), true);
  assert.equal(await page.evaluate((id) => window.settingsTest.document().score.tracks[0].measures.find((measure) => measure.id === id).sectionLabel, bound), "原小节标记");
  await page.evaluate(() => window.settingsTest.focus("info"));
  await page.locator("#settings-title").fill("另一个未应用名称");
  await page.evaluate(() => window.settingsTest.focus("label"));
  await page.locator("#settings-label").fill("待处理标记");
  assert.deepEqual((await page.evaluate(() => window.settingsTest.pending())).filter((entry) => entry.dirty).map((entry) => entry.label).sort(), ["歌曲信息", "段落标记"].sort());
  assert.equal(await page.evaluate(() => window.settingsTest.restore("label")), true);
  assert.equal((await status()).groups.info.dirty, true);
  assert.equal((await status()).groups.label.dirty, false);

  // 两个 Portal 的原生 composition 都必须经过同一个同步闸门。
  for (const [group, field] of [["info", "settings-title"], ["label", "settings-label"]]) {
    await page.evaluate((group) => window.settingsTest.focus(group), group);
    await page.locator(`#${field}`).dispatchEvent("compositionstart");
    assert.equal((await status()).composing, true);
    assert.equal(await page.evaluate((group) => window.settingsTest.apply(group), group), false);
    assert.equal(await page.evaluate((group) => window.settingsTest.restore(group), group), false);
    assert.equal(await page.evaluate(() => window.settingsTest.discard()), false);
    await page.locator(`#${field}`).dispatchEvent("compositionend");
    assert.equal((await status()).composing, true);
    await page.waitForFunction(() => !window.settingsTest.status().composing);
  }
  await page.evaluate(() => window.settingsTest.discard());
  // 收起仅隐藏 Portal，重新打开不重读或丢弃输入。
  await page.evaluate(() => window.settingsTest.focus("info"));
  await page.locator("#settings-title").fill("收起后保留");
  await page.evaluate(() => window.settingsTest.surface(null));
  assert.equal(await page.getByRole("button", { name: "应用歌曲信息", exact: true }).count(), 0);
  await page.evaluate(() => window.settingsTest.focus("info"));
  assert.equal(await page.locator("#settings-title").inputValue(), "收起后保留");
  await page.evaluate(() => window.settingsTest.focus("copy"));
  await page.waitForFunction(() => document.activeElement?.id === "settings-copy-start");
  assert.equal(await page.getByRole("button", { name: "复制小节范围", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.settingsTest.discard());
  const commandsBeforeCopy = await page.evaluate(() => window.settingsTest.commands().length);
  const historyBeforeCopy = await page.evaluate(() => window.settingsTest.history());
  await page.getByRole("button", { name: "复制小节范围", exact: true }).click();
  assert.equal((await status()).busy, true);
  assert.equal(await page.getByRole("button", { name: /复制小节范围/ }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.settingsTest.focus("label")), false);
  assert.equal(await page.evaluate(() => window.settingsTest.commands().length), commandsBeforeCopy + 1);
  await page.evaluate(() => window.settingsTest.finishCopy());
  await page.waitForFunction(() => !window.settingsTest.status().busy);
  assert.equal(await page.evaluate(() => window.settingsTest.history()), historyBeforeCopy);
  await page.evaluate(() => window.settingsTest.focus("label"));
  await page.locator("#settings-label").fill("失效原文");
  await page.evaluate(() => window.settingsTest.remove());
  assert.equal(await page.locator("#settings-label").inputValue(), "失效原文");
  assert.equal((await status()).groups.label.canApply, false);
  assert.equal(await page.locator('[data-settings-host="measure"]').count(), 1);
  assert.equal(await page.evaluate(() => window.settingsTest.apply("label")), false);
  assert.deepEqual(errors, []);
  console.log("score-settings portals: rebasing, conflicts, group records, pinned/invalid target, focus and IME passed");
} finally { await browser?.close(); await server.close(); }
