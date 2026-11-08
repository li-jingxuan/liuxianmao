// LXM_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node <this file>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(
  pathToFileURL(viteRequire.resolve("vite")).href
);
const { chromium } = await import(
  process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright"
);
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: website,
  configFile: false,
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [path.resolve(website, "../..")] },
  },
  plugins: [
    {
      name: "history-feedback-fixture",
      configureServer(dev) {
        dev.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith("/__history-test__")) return next();
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!doctype html><div id="root"></div><script type="module" src="/tests/editor-history-feedback.browser.tsx"></script>',
          );
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LXM_CHROMIUM_EXECUTABLE,
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__history-test__`,
  );
  await page.waitForFunction(() => !!window.historyFeedbackTest);
  await page.getByRole("button", { name: "操作历史", exact: true }).click();
  const panel = page.locator("#editor-history-panel");
  assert.deepEqual(
    await panel
      .locator("[data-entry-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-entry-id")),
      ),
    ["C", "B", "A"],
  );
  await panel
    .locator('[data-entry-id="C"]')
    .getByRole("button", { name: "影响详情" })
    .click();
  assert.match(await panel.innerText(), /此操作已撤销/);
  assert.equal(
    await page.getByRole("textbox", { name: "未应用草稿" }).inputValue(),
    "保留输入",
  );
  await page.evaluate(() => window.historyFeedbackTest.prune("C"));
  await page.waitForFunction(
    () => !window.historyFeedbackTest.status().expanded.includes("C"),
  );
  await page.evaluate(() => window.historyFeedbackTest.modal(true));
  await panel.getByRole("button", { name: "关闭操作历史" }).click();
  await page.evaluate(() => window.historyFeedbackTest.allowed(false));
  await page.evaluate(() => window.historyFeedbackTest.send("command", "B"));
  await page.getByRole("button", { name: "查看影响", exact: true }).click();
  assert.equal(await panel.isVisible(), false);
  assert.match(
    await page.locator("[data-editor-feedback]").innerText(),
    /等待面板可用后打开/,
  );
  await page.evaluate(() => window.historyFeedbackTest.hidden(true));
  await page.evaluate(() => window.historyFeedbackTest.allowed(true));
  await page.clock.runFor(6000);
  assert.equal(await panel.isVisible(), false);
  await page.evaluate(() => window.historyFeedbackTest.hidden(false));
  await panel.waitFor({ state: "visible" });
  assert.equal(await panel.getAttribute("role"), "dialog");
  assert.equal(await panel.getAttribute("aria-modal"), "true");
  assert.equal(
    await panel
      .locator('[data-entry-id="B"]')
      .getByRole("button", { name: "影响详情" })
      .getAttribute("aria-expanded"),
    "true",
  );

  // Actual DOM focus pauses the timer. Leaving both pointer and focus resumes it.
  await page.getByRole("button", { name: "查看影响", exact: true }).focus();
  await page.clock.runFor(6000);
  assert.equal(
    await page
      .getByRole("button", { name: "查看影响", exact: true })
      .isVisible(),
    true,
  );
  await page.getByRole("textbox", { name: "未应用草稿" }).focus();
  await page.mouse.move(895, 10);
  await page.clock.runFor(4001);
  assert.equal(
    await page.getByRole("button", { name: "查看影响", exact: true }).count(),
    0,
  );

  await page.evaluate(() => window.historyFeedbackTest.send("clipboard"));
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  const copyDetails = page.getByRole("region", { name: "复制遗漏详情" });
  assert.match(await copyDetails.innerText(), /源曲谱未改变/);
  assert.equal(
    await page
      .getByRole("button", { name: "查看详情", exact: true })
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await page.evaluate(() => {
    window.lowerEscapeCount = 0;
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") window.lowerEscapeCount++;
      },
      true,
    );
  });
  await copyDetails.focus();
  await copyDetails.press("Escape");
  assert.equal(await copyDetails.count(), 0);
  assert.equal(await page.evaluate(() => window.lowerEscapeCount), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "查看详情", exact: true })
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.mouse.move(895, 10);
  await page.getByRole("textbox", { name: "未应用草稿" }).focus();
  await page.clock.runFor(4001);
  assert.equal(
    await page.getByRole("button", { name: "查看详情", exact: true }).count(),
    0,
  );
  assert.equal(await copyDetails.isVisible(), true);
  await page.evaluate(() => window.historyFeedbackTest.hidden(true));
  assert.equal(await copyDetails.isVisible(), false);
  await page.evaluate(() => window.historyFeedbackTest.hidden(false));
  assert.equal(await copyDetails.isVisible(), true);
  await copyDetails.focus();
  await copyDetails.press("Escape");
  assert.equal(await copyDetails.count(), 0);
  assert.equal(
    await page
      .getByRole("textbox", { name: "未应用草稿" })
      .evaluate((input) => input === document.activeElement),
    false,
  );
  assert.equal(await page.evaluate(() => window.lowerEscapeCount), 0);
  await page.evaluate(() => window.historyFeedbackTest.send("clipboard"));
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.evaluate(() => window.historyFeedbackTest.switchSession());
  await copyDetails.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => window.historyFeedbackTest.status().expanded.length === 0,
  );
  assert.equal(
    await page.getByRole("textbox", { name: "未应用草稿" }).inputValue(),
    "保留输入",
  );
  assert.deepEqual(errors, []);
  console.log("history-feedback browser checks passed");
} finally {
  await browser?.close();
  await server.close();
}
