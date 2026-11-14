// 与现有浏览器回归共用 Vite / Playwright，聚焦点击即应用与异步结果。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: website, configFile: false, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(website, "../..")] } }, plugins: [{ name: "tuplet-fixture", configureServer(dev) { dev.middlewares.use((request, response, next) => { if (!request.url?.startsWith("/__tuplet-test__")) return next(); response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><div id="root"></div><script type="module" src="/tests/tuplet-details.browser.tsx"></script>'); }); } }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__tuplet-test__`);
  await page.waitForFunction(() => !!window.tupletTest);
  const group = page.getByRole("group", { name: "连音类型", exact: true });
  const type = (name) => group.getByRole("button", { name, exact: true });
  const snapshot = () => page.evaluate(() => ({ document: window.tupletTest.document(), history: window.tupletTest.history() }));
  const waitIdle = () => page.waitForFunction(() => !document.querySelector('button[aria-label="5:4连音"]')?.disabled);
  assert.equal(await group.getByRole("button").count(), 6);
  assert.deepEqual(await group.getByRole("button").allTextContents(), ["二连音", "三连音", "四连音", "5:4连音", "5:3连音", "六连音"]);
  assert.equal(await type("5:4连音").getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("status").count(), 0);
  assert.equal(await page.getByRole("button", { name: /应用/ }).count(), 0);
  // 可用与禁用类型都没有悬停/聚焦提示，也不增加可聚焦包装。
  assert.equal(await group.locator('[tabindex="0"], [title], [aria-describedby]').count(), 0);
  await type("5:3连音").hover();
  await type("5:3连音").focus();
  assert.equal(await page.getByRole("tooltip").count(), 0);
  await type("三连音").hover();
  assert.equal(await type("三连音").getAttribute("aria-description"), "需要 3 个连续拍点，当前选中 5 个");
  assert.equal(await page.getByRole("tooltip").count(), 0);
  // 同值仍提交适配器，核心返回 noop，文档与历史不变。
  const initial = await snapshot();
  await type("5:4连音").click();
  await waitIdle();
  assert.equal(await page.evaluate(() => window.tupletTest.commands().length), 1);
  assert.deepEqual(await snapshot(), initial);
  assert.equal(await page.evaluate(() => window.tupletTest.history().past), 0);
  // 失败和取消继续显示真实当前组；再次点选直接重试。
  for (const mode of ["blocked", "cancelled"]) {
    await page.evaluate((mode) => window.tupletTest.mode(mode), mode);
    await type("5:3连音").click();
    await page.getByRole("alert").waitFor();
    await waitIdle();
    assert.equal(await type("5:4连音").getAttribute("aria-pressed"), "true");
    assert.equal(await type("5:3连音").getAttribute("aria-pressed"), "false");
    assert.deepEqual(await snapshot(), initial);
  }
  await page.evaluate(() => window.tupletTest.mode("normal"));
  await type("5:3连音").click();
  await waitIdle();
  assert.equal(await page.evaluate(() => window.tupletTest.history().past), 1);
  assert.equal(await type("5:3连音").getAttribute("aria-pressed"), "true");
  await page.evaluate(() => window.tupletTest.undo());
  await page.waitForFunction(() => document.querySelector('button[aria-label="5:4连音"]')?.getAttribute("aria-pressed") === "true");
  // 提交中禁用所有操作，同一事件批次也只能提交一次；切换选区后仍写入原目标。
  await page.evaluate(() => window.tupletTest.mode("deferred"));
  const commandCount = await page.evaluate(() => window.tupletTest.commands().length);
  const originalMeasureId = initial.document.score.tracks[0].measures[3].id;
  await type("5:3连音").evaluate((button) => { button.click(); button.click(); });
  assert.equal(await page.evaluate(() => window.tupletTest.commands().length), commandCount + 1);
  assert.equal(await group.locator("button:disabled").count(), 6);
  assert.equal(await page.getByRole("button", { name: /删除当前连音组/ }).isDisabled(), true);
  assert.equal(await type("5:4连音").getAttribute("aria-pressed"), "true");
  await page.evaluate(() => window.tupletTest.select(4));
  assert.equal(await page.evaluate(() => window.tupletTest.commands().at(-1).measureId), originalMeasureId);
  assert.equal(await type("5:3连音").getAttribute("aria-pressed"), "true");
  const newTargetBefore = await page.evaluate(() => window.tupletTest.document().score.tracks[0].measures[4]);
  await page.evaluate(() => window.tupletTest.finish());
  await waitIdle();
  assert.deepEqual(await page.evaluate(() => window.tupletTest.document().score.tracks[0].measures[4]), newTargetBefore);
  assert.equal(await type("5:3连音").getAttribute("aria-pressed"), "true");
  assert.equal(await page.evaluate(() => window.tupletTest.history().past), 1);
  await page.evaluate(() => window.tupletTest.select(3));
  assert.equal(await type("5:3连音").getAttribute("aria-pressed"), "true");
  await page.evaluate(() => window.tupletTest.undo());
  await page.waitForFunction(() => document.querySelector('button[aria-label="5:4连音"]')?.getAttribute("aria-pressed") === "true");
  // 删除成功只产生一条历史；撤销恢复真实组和高亮。
  await page.evaluate(() => window.tupletTest.mode("normal"));
  await page.getByRole("button", { name: /删除当前连音组/ }).click();
  await waitIdle();
  assert.equal(await group.locator('button[aria-pressed="true"]').count(), 0);
  assert.equal(await page.evaluate(() => window.tupletTest.history().past), 1);
  await page.evaluate(() => window.tupletTest.undo());
  await page.waitForFunction(() => document.querySelector('button[aria-label="5:4连音"]')?.getAttribute("aria-pressed") === "true");
  // 扩张比例的容量失败同样由核心裁定，保留文档当前比例和历史。
  await page.evaluate(() => window.tupletTest.overflow(5));
  await page.waitForFunction(() => document.querySelector('button[aria-label="5:3连音"]')?.getAttribute("aria-pressed") === "true");
  const beforeSetFailure = await snapshot();
  await type("5:4连音").click();
  assert.match(await page.getByRole("alert").innerText(), /容量不足/);
  await waitIdle();
  assert.deepEqual(await snapshot(), beforeSetFailure);
  assert.equal(await type("5:3连音").getAttribute("aria-pressed"), "true");
  // 删除由核心拒绝时，摘要、音乐及历史均原样保留。
  await page.evaluate(() => window.tupletTest.overflow());
  await page.waitForFunction(() => document.querySelector('button[aria-label="三连音"]')?.getAttribute("aria-pressed") === "true");
  const before = await snapshot();
  await page.getByRole("button", { name: /删除当前连音组/ }).click();
  assert.match(await page.getByRole("alert").innerText(), /容量不足/);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await type("三连音").getAttribute("aria-pressed"), "true");
  assert.deepEqual(errors, []);
  console.log("tuplet details: immediate apply, noop, retry, async selection, busy lock, delete/undo and overflow passed");
} finally { await browser?.close(); await server.close(); }
