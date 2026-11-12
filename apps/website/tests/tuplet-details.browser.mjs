// 与现有浏览器回归共用 Vite / Playwright，聚焦连音草稿与异步结果。
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
  const group = page.getByRole("group", { name: "待应用连音类型" });
  const type = (name) => group.getByRole("button", { name, exact: true });
  const pending = page.getByRole("status");
  const apply = () => page.getByRole("button", { name: /应用/ });
  assert.equal(await group.getByRole("button").count(), 6);
  assert.equal(await type("五连音（5:4）").getAttribute("aria-pressed"), "true");
  assert.equal(await pending.count(), 0);
  assert.equal(await apply().isDisabled(), true);
  // 选类型只改本地草稿；同值 noop 也显式清理，不创建历史。
  await type("五连音（5:4）").click();
  assert.equal(await pending.innerText(), "待应用五连音（5:4）");
  assert.equal(await page.evaluate(() => window.tupletTest.commands().length), 0);
  await apply().click();
  await pending.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.tupletTest.history().past), 0);
  // 失败和取消保留合法草稿，允许重试；最终应用只创建一条记录。
  await type("五连音（5:3）").click();
  for (const mode of ["blocked", "cancelled"]) {
    await page.evaluate((mode) => window.tupletTest.mode(mode), mode);
    await apply().click();
    await page.getByRole("alert").waitFor();
    assert.equal(await pending.innerText(), "待应用五连音（5:3）");
    assert.equal(await page.evaluate(() => window.tupletTest.history().past), 0);
  }
  await page.evaluate(() => window.tupletTest.mode("normal"));
  await apply().click();
  await pending.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.tupletTest.history().past), 1);
  assert.equal(await type("五连音（5:3）").getAttribute("aria-pressed"), "true");
  await page.evaluate(() => window.tupletTest.undo());
  await page.waitForFunction(() => document.querySelector('button[aria-label="五连音（5:4）"]')?.getAttribute("aria-pressed") === "true");
  // 选区改变立即取消草稿；提交中锁住重复操作，旧 noop 不污染新范围。
  await type("五连音（5:3）").click();
  await page.evaluate(() => window.tupletTest.select(4));
  await pending.waitFor({ state: "detached" });
  await type("五连音（5:3）").click();
  await page.evaluate(() => window.tupletTest.mode("deferred"));
  await apply().click();
  assert.equal(await apply().isDisabled(), true);
  assert.equal(await type("五连音（5:4）").isDisabled(), true);
  await page.evaluate(() => window.tupletTest.select(3));
  await pending.waitFor({ state: "detached" });
  await page.evaluate(() => window.tupletTest.finish());
  await page.waitForFunction(() => !document.querySelector('button[aria-label="五连音（5:4）"]')?.disabled);
  assert.equal(await pending.count(), 0);
  assert.equal(await type("五连音（5:4）").getAttribute("aria-pressed"), "true");
  // 删除由核心拒绝时，摘要、音乐及历史均原样保留。
  await page.evaluate(() => window.tupletTest.overflow());
  await page.waitForFunction(() => document.querySelector('button[aria-label="三连音"]')?.getAttribute("aria-pressed") === "true");
  const before = await page.evaluate(() => ({ document: window.tupletTest.document(), history: window.tupletTest.history() }));
  await page.getByRole("button", { name: /删除当前连音组/ }).click();
  assert.match(await page.getByRole("alert").innerText(), /容量不足/);
  assert.deepEqual(await page.evaluate(() => ({ document: window.tupletTest.document(), history: window.tupletTest.history() })), before);
  assert.equal(await type("三连音").getAttribute("aria-pressed"), "true");
  assert.deepEqual(errors, []);
  console.log("tuplet details: draft isolation, noop, retry, async selection, busy lock and delete overflow passed");
} finally { await browser?.close(); await server.close(); }
