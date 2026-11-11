// LXM_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node apps/website/tests/image-export.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: website,
  configFile: false,
  define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/image-export"),
  optimizeDeps: {
    entries: ["tests/music-text-coexist.browser.tsx"],
    include: ["react/jsx-dev-runtime"],
  },
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { ignored: ["**/.next/**"] },
    fs: { allow: [path.resolve(website, "../..")] },
  },
  plugins: [{
    name: "image-export-product-fixture",
    configureServer(dev) {
      dev.middlewares.use(async (request, response, next) => {
        if (request.url !== "/__image_export__") return next();
        response.setHeader("Content-Type", "text/html");
        response.end(await dev.transformIndexHtml(request.url,
          '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
      });
    },
  }],
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
    ...(process.env.LXM_BROWSER_CHANNEL ? { channel: process.env.LXM_BROWSER_CHANNEL } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.stack ?? error.message);
  });
  // 保留真实 URL 行为，只观测分配/回收，验证任务提取后没有泄露或复用旧链接。
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    window.exportUrlAudit = { created: [], revoked: [] };
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.exportUrlAudit.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.exportUrlAudit.revoked.push(url);
      revoke(url);
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__image_export__`);
  await page.getByRole("application").waitFor({ timeout: 90000 });
  await page.locator('[data-score-print-layer][data-print-ready="true"]').waitFor({ state: "attached" });
  const baseline = await page.evaluate(() => ({
    document: window.coexistStore.getState().document,
    history: window.coexistStore.getState().historyDepth,
  }));
  const trigger = page.getByRole("button", { name: "导出 A4 图片", exact: true });
  const dialog = page.getByRole("dialog");
  await trigger.click();
  await dialog.locator('[data-image-export-status="ready"]').waitFor();
  assert.ok(await dialog.getByRole("button", { name: /^第 \d+ 页$/ }).count() > 0);
  await dialog.getByRole("button", { name: "仅生成当前页", exact: true }).click();
  await dialog.locator('[data-image-export-status="generated"]').waitFor({ timeout: 30000 });
  const downloadLink = dialog.getByRole("link", { name: "下载图片", exact: true });
  const firstUrl = await downloadLink.getAttribute("href");
  assert.match(firstUrl, /^blob:/);
  const [download] = await Promise.all([page.waitForEvent("download"), downloadLink.click()]);
  const png = await readFile(await download.path());
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 2480);
  assert.equal(png.readUInt32BE(20), 3508);

  await dialog.getByRole("combobox", { name: "输出范围", exact: true }).click();
  await page.getByRole("option", { name: "当前第 1 页", exact: true }).click();
  await dialog.locator('[data-image-export-status="ready"]').waitFor();
  assert.equal(await downloadLink.count(), 0);
  assert.equal(await page.evaluate((url) => window.exportUrlAudit.revoked.includes(url), firstUrl), true);

  await dialog.getByRole("button", { name: "生成第 1 页图片", exact: true }).click();
  await dialog.locator('[data-image-export-status="generated"]').waitFor({ timeout: 30000 });
  const secondUrl = await downloadLink.getAttribute("href");
  assert.notEqual(secondUrl, firstUrl);
  await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction((url) => window.exportUrlAudit.revoked.includes(url), secondUrl);
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "导出 A4 图片").catch(async (error) => {
    console.error("关闭后的焦点", await page.evaluate(() => ({
      active: document.activeElement?.outerHTML.slice(0, 500),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => ({
        html: node.outerHTML.slice(0, 300), visible: node.getClientRects().length > 0,
      })),
    })));
    throw error;
  });

  await trigger.click();
  await dialog.locator('[data-image-export-status="ready"]').waitFor();
  assert.equal(await downloadLink.count(), 0);
  await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => ({
    document: window.coexistStore.getState().document,
    history: window.coexistStore.getState().historyDepth,
  })), baseline);
  // 打印媒体下主动触发字体失效，实际测量节点仍须可用，业务浮窗继续隐藏。
  await page.emulateMedia({ media: "print" });
  await page.evaluate(async () => {
    document.fonts.dispatchEvent(new Event("loadingdone"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await page.locator('[data-score-print-layer][data-print-ready="true"]').waitFor({ state: "attached" });
  assert.ok(await page.locator('[data-score-print-layer] svg').count() > 0);
  assert.equal(await page.locator('svg[aria-label="六线谱编辑器"]').isVisible(), false);
  assert.equal(await page.locator('[data-score-text-measure]').count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS 图片预览、真实 PNG 尺寸、下载、范围切换 URL 回收、关闭焦点与重开、打印期间字体重准备，文档和历史不变");
} finally {
  await browser?.close();
  await server.close();
}
