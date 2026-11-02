// Optional browser regression: LXM_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node <this file>
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
      name: "numbered-popover-fixture",
      configureServer(dev) {
        dev.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith("/__numbered-test__")) return next();
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!doctype html><div id="root"></div><script type="module" src="/tests/numbered-editor-popover.browser.tsx"></script>',
          );
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}/__numbered-test__`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async (scenario = "event") => {
    await page.goto(`${base}?scenario=${scenario}`);
    await page.locator('[data-presentation="popover"] textarea').waitFor();
  };
  const snapshot = () => page.evaluate(() => window.numberedTest.snapshot());
  const commandCount = () =>
    page.evaluate(() => window.numberedTest.commands.length);
  const toolbar = () => page.getByRole("group", { name: "常用时值" });
  const applyContent = () =>
    page.getByRole("button", { name: "应用", exact: true });

  await open();
  const textarea = page.locator("textarea");
  await textarea.fill("#5");
  await textarea.evaluate((node) => {
    window.originalInput = node;
    node.focus();
    node.setSelectionRange(1, 2);
  });
  const before = await snapshot();
  await page.getByRole("button", { name: "更多编辑" }).click();
  assert.equal(
    await page.evaluate(
      () => window.originalInput === document.querySelector("textarea"),
    ),
    true,
  );
  assert.equal(await textarea.inputValue(), "#5");
  await page.evaluate(() => window.numberedTest.surface("popover"));
  await page.locator('[data-presentation="popover"]').waitFor();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    await textarea.evaluate((node) => [node.selectionStart, node.selectionEnd]),
    [1, 2],
  );
  assert.equal(await commandCount(), 0);
  assert.equal(await page.getByLabel("简谱节奏模板").isVisible(), false);
  assert.equal(
    await page
      .getByLabel("简谱节奏模板")
      .evaluate((node) => !!node.closest("[hidden][inert]")),
    true,
  );

  await open();
  await toolbar()
    .getByRole("button", { name: "八分音符", exact: true })
    .click();
  assert.equal((await snapshot()).base, "eighth");
  assert.equal(await commandCount(), 0);
  assert.equal(await applyContent().isDisabled(), true);
  await page.getByRole("button", { name: "应用时值", exact: true }).click();
  assert.equal(await commandCount(), 1);
  assert.equal(
    await page.evaluate(() => window.numberedTest.commands[0].type),
    "numbered.event.setRhythm",
  );

  await open();
  await toolbar()
    .getByRole("button", { name: "八分音符", exact: true })
    .click();
  await page.locator("textarea").fill("6");
  assert.equal(await applyContent().isDisabled(), true);
  assert.match(
    await page.getByLabel("简谱紧凑摘要").innerText(),
    /先应用或恢复事件时值组/,
  );
  assert.equal(await commandCount(), 0);

  await open();
  await page.evaluate(() => window.numberedTest.focus("itemPitch"));
  await page.locator('[data-presentation="sidebar"]').waitFor();
  assert.equal(
    await page.evaluate(() => window.numberedTest.requests[0]),
    "itemPitch",
  );
  assert.equal(
    await page.evaluate(
      () =>
        document.activeElement?.closest('[data-numbered-group="itemPitch"]') !==
        null,
    ),
    true,
  );

  await open();
  await page.locator("textarea").fill("6");
  await applyContent().click();
  assert.equal(await commandCount(), 1);
  assert.equal(
    await page.evaluate(() => window.numberedTest.commands[0].type),
    "numbered.event.set",
  );
  assert.equal(
    await page.evaluate(() => "rhythm" in window.numberedTest.commands[0]),
    false,
  );

  await open();
  await toolbar()
    .getByRole("button", { name: "二分音符", exact: true })
    .click();
  await page.getByRole("button", { name: "应用时值", exact: true }).click();
  const impact = page.getByRole("dialog", { name: "确认简谱修改影响" });
  await impact.waitFor();
  assert.equal(
    await impact.evaluate((node) => node.closest("[hidden], [inert]") === null),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "更多编辑" }).isDisabled(),
    true,
  );
  await impact.getByRole("button", { name: /取.*消/ }).click();
  assert.equal(await commandCount(), 0);
  assert.equal((await snapshot()).base, "half");

  await open("blank");
  await page.locator("textarea").fill("1 2");
  await toolbar()
    .getByRole("button", { name: "八分音符", exact: true })
    .click();
  assert.equal((await snapshot()).templateBase, "eighth");
  assert.equal(await commandCount(), 0);
  assert.equal(
    await page.getByRole("button", { name: "应用时值", exact: true }).count(),
    0,
  );
  await applyContent().click();
  assert.equal(await commandCount(), 1);
  assert.equal(
    await page.evaluate(() => window.numberedTest.commands[0].type),
    "numbered.sequence.insert",
  );

  await open("double-dot");
  assert.match(
    await page.locator('[data-presentation="popover"]').innerText(),
    /双附点/,
  );
  assert.equal(
    await toolbar()
      .getByRole("button", { name: "附点", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal((await snapshot()).dots, 2);
  await page.getByRole("button", { name: "侧栏编辑", exact: true }).click();
  await page.locator('[data-presentation="sidebar"]').waitFor();
  assert.equal((await snapshot()).dots, 2);

  await open("custom");
  const custom = await snapshot();
  assert.match(
    await page.locator('[data-presentation="popover"]').innerText(),
    /使用自定义节奏/,
  );
  assert.match(
    await page.getByLabel("简谱紧凑摘要").innerText(),
    /另有音高修改/,
  );
  await page.getByRole("button", { name: "侧栏编辑", exact: true }).click();
  await page.locator('[data-presentation="sidebar"]').waitFor();
  assert.deepEqual(
    { ...(await snapshot()), activeGroup: undefined },
    { ...custom, activeGroup: undefined },
  );
  assert.equal(await commandCount(), 0);
  await page
    .locator("summary")
    .filter({ hasText: "高级录入范围与复杂节奏" })
    .click();
  await page.getByRole("button", { name: "恢复均分", exact: true }).click();
  assert.equal((await snapshot()).template, "uniform");
  assert.equal((await snapshot()).fixedRange, false);
  assert.deepEqual((await snapshot()).customRhythms, []);
  assert.equal(await commandCount(), 0);
  await page.evaluate(() => window.numberedTest.surface("popover"));
  await page.locator('[data-presentation="popover"]').waitFor();
  assert.equal(
    await toolbar()
      .getByRole("button", { name: "八分音符", exact: true })
      .isDisabled(),
    false,
  );

  await open();
  await page.locator("textarea").fill("6");
  await page.locator("textarea").dispatchEvent("compositionstart");
  assert.equal(await applyContent().isDisabled(), true);
  assert.equal(
    await page.getByRole("button", { name: "更多编辑" }).isDisabled(),
    true,
  );
  await page.locator("textarea").dispatchEvent("compositionend");
  await page.waitForFunction(
    () =>
      !document.querySelector('button[title="应用正文（Ctrl/Cmd+Enter）"]')
        ?.disabled,
  );
  assert.equal(await commandCount(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "NumberedEditor browser regressions passed: stable input/selection, hidden+inert advanced fields, independent rhythm, content dependency blocking, blank insertion, complex/double-dot preservation, IME guard.",
  );
} finally {
  await browser?.close();
  await server.close();
}
