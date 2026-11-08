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
const server = await createServer({
  root: website, configFile: false, esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "score-view-fixture", configureServer(dev) {
    dev.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith("/__score-view-test__")) return next();
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><div id="root"></div><script type="module" src="/tests/score-view.browser.tsx"></script>');
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1920, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__score-view-test__`);
  await page.waitForFunction(() => !!window.scoreViewTest);
  const status = () => page.evaluate(() => window.scoreViewTest.status());
  const stage = page.locator("[data-stage]");
  const viewport = page.locator("[data-viewport]");
  const initialTop = (await stage.boundingBox()).y;
  await page.getByRole("button", { name: "actual", exact: true }).click();
  assert.equal((await status()).scale, 1);
  assert.equal((await stage.boundingBox()).y, initialTop, "controls do not alter stage origin");
  await page.evaluate(() => window.scoreViewTest.wide(true));
  await page.waitForFunction(() => window.scoreViewTest.status().baseWidth > 1400);
  await page.evaluate(() => window.scoreViewTest.resize(768));
  await page.waitForFunction(() => document.querySelector('[data-layout="narrow"]'));
  assert.equal((await page.locator("[data-paper]").boundingBox()).width, 780);
  assert.equal(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth), true);
  await page.getByRole("button", { name: "fit", exact: true }).click();
  await page.waitForFunction(() => window.scoreViewTest.status().scale < 1);
  await page.waitForFunction(() => { const element = document.querySelector("[data-viewport]"); return element.scrollWidth <= element.clientWidth + 1; });

  await page.evaluate(() => window.scoreViewTest.resize(1600));
  await page.waitForFunction(() => window.scoreViewTest.status().width > 1000);
  await viewport.evaluate((element) => { element.scrollTop = 900; });
  await page.waitForFunction(() => document.querySelector("[data-viewport]").scrollTop === 900);
  const logicalCenter = await viewport.evaluate((element) => (element.scrollTop + element.clientHeight / 2 - 30) / window.scoreViewTest.status().scale);
  await page.evaluate(() => window.scoreViewTest.history(true));
  await page.waitForFunction(() => window.scoreViewTest.status().width < 1250);
  const afterCenter = await viewport.evaluate((element) => (element.scrollTop + element.clientHeight / 2 - 30) / window.scoreViewTest.status().scale);
  assert.ok(Math.abs(afterCenter - logicalCenter) < 2, "later-page logical center survives panel resize");
  assert.ok((await status()).changes > 0);

  for (const width of [375, 768, 959, 960, 1199, 1200, 1599, 1600, 1920]) {
    await page.evaluate((value) => window.scoreViewTest.resize(value), width);
    await page.waitForFunction((value) => Math.round(document.querySelector("[data-layout]").getBoundingClientRect().width) === value, width);
    const metrics = await page.evaluate(() => {
      const host = document.querySelector("[data-layout]");
      const panel = document.querySelector("[data-history-panel]");
      return { width: host.clientWidth, scrollWidth: host.scrollWidth, position: getComputedStyle(panel).position };
    });
    assert.ok(metrics.scrollWidth <= metrics.width + 1, `host ${width} has no outer horizontal overflow`);
    assert.equal(metrics.position, width >= 1600 ? "relative" : "absolute");
    await page.evaluate(() => window.scoreViewTest.sidebar(true));
    const sidebar = page.locator('[data-viewport] ~ aside');
    await sidebar.waitFor({ state: "visible" });
    const sidebarBox = await sidebar.boundingBox();
    assert.ok(sidebarBox.width <= Math.min(352, width - 40) + 1);
    assert.ok(Math.abs(sidebarBox.width - Math.min(352, width - 40)) < 1);
    assert.equal(await sidebar.evaluate((element) => getComputedStyle(element).position), width < 1200 ? "absolute" : "static");
    const outer = await page.locator('[data-layout]').first().evaluate((element) => ({ scroll: element.scrollWidth, width: element.clientWidth }));
    assert.ok(outer.scroll <= outer.width + 1, `sidebar at ${width}: ${JSON.stringify(outer)}`);
    await page.evaluate(() => window.scoreViewTest.sidebar(false));
  }
  await page.getByRole("button", { name: "actual", exact: true }).click();
  await page.evaluate(() => window.scoreViewTest.session());
  await page.waitForFunction(() => window.scoreViewTest.status().mode === "fit");
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator("[data-score-print-layer]").isVisible(), true);
  assert.equal(await page.locator("[data-external-portal]").isVisible(), false);
  assert.equal(await stage.isVisible(), false);
  assert.deepEqual(errors, []);
  console.log("score view browser: fit/actual, scroll anchor, responsive host, print portal isolation passed");
} finally {
  await browser?.close();
  await server.close();
}
