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
  cacheDir: path.resolve(website, "node_modules/.vite/numbered-popover"),
  optimizeDeps: {
    entries: ["tests/numbered-editor-popover.browser.tsx"],
    include: ["react/jsx-dev-runtime"],
  },
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { ignored: ["**/.next/**"] },
    fs: { allow: [path.resolve(website, "../..")] },
  },
  plugins: [
    {
      name: "numbered-popover-fixture",
      configureServer(dev) {
        dev.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/__numbered-test__")) return next();
          response.setHeader("Content-Type", "text/html");
          response.end(
            await dev.transformIndexHtml(request.url,
              '<!doctype html><div id="root"></div><script type="module" src="/tests/numbered-editor-popover.browser.tsx"></script>',
            ),
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
  browser = await chromium.launch({ headless: true, channel: process.env.LXM_BROWSER_CHANNEL, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async (scenario = "event", input) => {
    const query = new URLSearchParams({ scenario });
    if (input !== undefined) query.set("input", input);
    await page.goto(`${base}?${query}`);
    await page
      .locator('[data-presentation="popover"] input[placeholder]')
      .waitFor();
    if (input !== undefined)
      await page.waitForFunction(
        (value) => window.numberedTest?.snapshot().raw === value,
        input,
      );
  };
  const snapshot = () => page.evaluate(() => window.numberedTest.snapshot());
  const commandCount = () =>
    page.evaluate(() => window.numberedTest.commands.length);
  const toolbar = () => page.getByRole("group", { name: "常用时值" });
  const applyContent = () =>
    page.getByRole("button", { name: "应用", exact: true });
  const compactInput = () =>
    page.locator('[data-presentation="popover"] input[placeholder]');
  const surface = async (value) => {
    await page.evaluate((next) => window.numberedTest.surface(next), value);
    await page.locator(`[data-presentation="${value}"]`).waitFor();
  };
  const select = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    const dropdown = page.locator(".ant-select-dropdown:visible");
    await dropdown.getByText(option, { exact: true }).click();
    await dropdown.waitFor({ state: "hidden" });
  };

  await open();
  await compactInput().fill("#5");
  const before = await snapshot();
  await surface("sidebar");
  assert.equal(await page.getByLabel("单音组简谱", { exact: true }).inputValue(), "#5");
  assert.deepEqual(await snapshot(), before);
  await surface("popover");
  assert.equal(await compactInput().inputValue(), "#5");
  assert.deepEqual(await snapshot(), before);
  assert.equal(await commandCount(), 0);
  assert.equal(await page.getByLabel("简谱节奏模板").isVisible(), false);
  assert.equal(
    await page
      .getByLabel("简谱节奏模板")
      .evaluate((node) => !!node.closest("[hidden][inert]")),
    true,
  );

  // Single-group sidebar uses a real Input and Enter; composition cannot submit.
  await open();
  await surface("sidebar");
  const singleInput = page.getByRole("textbox", { name: "单音组简谱", exact: true });
  assert.equal(await singleInput.evaluate((node) => node.tagName), "INPUT");
  await singleInput.fill("6");
  await singleInput.dispatchEvent("compositionstart");
  await singleInput.press("Enter");
  assert.equal(await commandCount(), 0);
  await singleInput.dispatchEvent("compositionend");
  await page.waitForFunction(() => !window.numberedTest.readStatus().composing);
  await singleInput.press("Enter");
  await page.waitForFunction(() => window.numberedTest.commands.length === 1);
  assert.equal(await commandCount(), 1);
  await page.evaluate(() => window.numberedTest.focus("rhythm"));
  assert.equal(await page.getByLabel("简谱时值", { exact: true }).evaluate((node) => node.closest("details").open), true);

  // Continuous input keeps plain Enter local and uses Ctrl+Enter for one command.
  await open("blank");
  await surface("sidebar");
  const continuousInput = page.getByRole("textbox", { name: "音符内容", exact: true });
  await continuousInput.fill("1");
  await continuousInput.press("Enter");
  assert.equal(await commandCount(), 0);
  await continuousInput.fill("1");
  await continuousInput.press("Control+Enter");
  await page.waitForFunction(() => window.numberedTest.commands.length === 1);

  // A valid parse outside the available range exposes both range disclosures.
  await open("blank");
  await surface("sidebar");
  await page.getByRole("textbox", { name: "音符内容", exact: true }).fill("1 2 3");
  await page.waitForFunction(() => [...document.querySelectorAll("summary")].filter((node) => /节奏与范围|高级录入范围/.test(node.textContent)).every((node) => node.parentElement.open));
  assert.equal(await commandCount(), 0);

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
  await compactInput().fill("6");
  assert.equal(await applyContent().isDisabled(), false);
  assert.equal(await commandCount(), 0);
  const multiple = await page.evaluate(() => window.numberedTest.apply(false));
  assert.equal(multiple.status, "blocked");
  assert.match(multiple.message, /多个分组/);
  await applyContent().click();
  await page.waitForFunction(() => !window.numberedTest.groups().content.dirty);
  assert.equal(await commandCount(), 1);
  assert.equal((await snapshot()).base, "eighth");
  assert.equal(await page.evaluate(() => window.numberedTest.groups().rhythm.dirty), true);
  assert.deepEqual(await page.evaluate(() => window.numberedTest.selections), []);
  assert.equal(await page.evaluate(() => window.numberedTest.document().score.tracks[0].measures[0].numberedVoice.events[0].rhythm.base), "quarter");

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
  await compactInput().fill("6");
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
  await impact.getByRole("button", { name: /取.*消/ }).click();
  assert.equal(await commandCount(), 0);
  assert.equal((await snapshot()).base, "half");

  await open("blank");
  await compactInput().fill("1 2");
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
  await surface("sidebar");
  await page.locator("textarea").fill("1 2 3");
  await page.locator("summary").filter({ hasText: "节奏与范围" }).evaluate((node) => { node.parentElement.open = true; });
  await select("简谱节奏模板", "自定义成员时值");
  await select("模板成员时值", "八分");
  await page
    .locator("summary")
    .filter({ hasText: "高级录入范围与复杂节奏" })
    .evaluate((node) => { node.parentElement.open = true; });
  await select("简谱第1音时值", "八分");
  await select("简谱第2音时值", "十六分");
  await select("简谱第3音时值", "十六分");
  await page.evaluate(() => window.numberedTest.focus("itemPitch"));
  await select("简谱单音符变音", "升号 ♯");
  await surface("popover");
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
  await compactInput().fill("6");
  await compactInput().dispatchEvent("compositionstart");
  assert.equal(await applyContent().isDisabled(), true);
  await compactInput().dispatchEvent("compositionend");
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="应用"]')?.disabled,
  );
  assert.equal(await commandCount(), 0);
  assert.deepEqual(errors, []);

  await open("event", "");
  const clearBefore = await page.evaluate(() => window.numberedTest.document());
  const clearResult = await page.evaluate(() =>
    window.numberedTest.apply(false),
  );
  assert.equal(clearResult.status, "applied");
  const clearAfter = await page.evaluate(() => window.numberedTest.document());
  const originalEvent =
    clearBefore.score.tracks[0].measures[0].numberedVoice.events[0];
  const clearedEvent =
    clearAfter.score.tracks[0].measures[0].numberedVoice.events[0];
  assert.deepEqual(clearedEvent, { ...originalEvent, kind: "gap", items: [] });
  assert.deepEqual(
    clearAfter.score.tracks[0].measures[0].lyrics,
    clearBefore.score.tracks[0].measures[0].lyrics,
  );
  assert.deepEqual(
    await page.evaluate(() => window.numberedTest.selections),
    [],
  );
  await open("gap", " ");
  assert.equal(
    (await page.evaluate(() => window.numberedTest.apply(false))).status,
    "noop",
  );
  assert.equal(await commandCount(), 0);
  assert.deepEqual(errors, []);

  // A content-only insertion advances using the actual planner focus.
  await open("blank");
  await compactInput().fill("1");
  await toolbar().getByRole("button", { name: "八分音符", exact: true }).click();
  await applyContent().click();
  await page.waitForFunction(() => window.numberedTest.selections.length === 1);
  assert.equal(await page.evaluate(() => window.numberedTest.selections[0].tick), 480);

  // Group restore reads its structured applied baseline and leaves the others dirty.
  await open();
  await compactInput().fill("6");
  await applyContent().click();
  await page.waitForFunction(() => !window.numberedTest.groups().content.dirty);
  const appliedBaseline = (await snapshot()).contentBaselineValue;
  await compactInput().fill("5");
  await toolbar().getByRole("button", { name: "八分音符", exact: true }).click();
  assert.equal(await page.evaluate(() => window.numberedTest.restoreGroup("content")), true);
  await page.waitForFunction((raw) => window.numberedTest.snapshot().raw === raw, appliedBaseline.raw);
  assert.equal((await snapshot()).raw, appliedBaseline.raw);
  assert.equal((await snapshot()).base, "eighth");
  assert.equal(await page.evaluate(() => window.numberedTest.groups().rhythm.dirty), true);
  await compactInput().dispatchEvent("compositionstart");
  assert.equal(await page.evaluate(() => window.numberedTest.restoreGroup("rhythm")), false);
  await compactInput().dispatchEvent("compositionend");
  await page.waitForFunction(() => !window.numberedTest.readStatus().composing);
  assert.equal(await page.evaluate(() => window.numberedTest.restoreGroup("rhythm")), true);

  // Own content commits can regenerate member IDs without invalidating the owner.
  await open("explicit-member");
  await toolbar().getByRole("button", { name: "八分音符", exact: true }).click();
  await compactInput().fill("6");
  await applyContent().click();
  await page.waitForFunction(() => !window.numberedTest.groups().content.dirty);
  assert.equal(await page.evaluate(() => window.numberedTest.groups().rhythm.dirty), true);
  assert.equal(await page.evaluate(() => window.numberedTest.groups().rhythm.blockedReason), null);
  assert.equal(await compactInput().inputValue(), "6");
  assert.deepEqual(await page.evaluate(() => window.numberedTest.selections), []);

  // External changes block the old candidate without replacing the current text.
  await open();
  await compactInput().fill("#5");
  await page.evaluate(() => window.numberedTest.external("change"));
  await page.waitForFunction(() => !!window.numberedTest.groups().content.blockedReason);
  assert.equal((await snapshot()).raw, "#5");
  assert.match(await page.evaluate(() => window.numberedTest.groups().content.blockedReason), /已改变/);
  assert.equal(await applyContent().isDisabled(), true);
  await compactInput().fill("#6");
  assert.equal(await applyContent().isDisabled(), false);
  await page.evaluate(() => window.numberedTest.external("remove"));
  await page.waitForFunction(() => /已失效/.test(window.numberedTest.groups().content.blockedReason ?? ""));
  assert.equal(await compactInput().inputValue(), "#6");
  assert.equal(await applyContent().isDisabled(), true);

  // A member selector requests the complete new business target through its parent.
  await open("members");
  await page.evaluate(() => window.numberedTest.focus("itemPitch"));
  await select("简谱单音符变音", "升号 ♯");
  await select("简谱技巧起始音符", "2：3");
  assert.equal(await page.evaluate(() => window.numberedTest.targetRequests[0].itemId), "member-test-second");
  assert.equal((await snapshot()).itemDraft, "#1");
  // The owner renders its main actions into the stable host and focus changes the group.
  await page.locator('[data-testid="numbered-actions"]').getByRole("button", { name: "应用单音符音高", exact: true }).waitFor();
  assert.equal(await commandCount(), 0);

  // 侧栏按设计默认折叠；就地按钮仍走原有分组提交和依赖保护。
  await open();
  await surface("sidebar");
  assert.equal(await page.locator("summary").filter({ hasText: /^(节奏与范围|音高与连接|复制与粘贴|移除当前事件)/ }).count(), 4);
  assert.equal(await page.locator("summary").filter({ hasText: /^(节奏与范围|音高与连接|复制与粘贴|移除当前事件)/ }).evaluateAll((nodes) => nodes.every((node) => !node.parentElement.open)), true);
  await page.evaluate(() => window.numberedTest.focus("itemPitch"));
  await select("简谱单音符八度", "低2八度");
  assert.equal((await snapshot()).itemDraft, "1..");
  await page.getByRole("button", { name: "恢复音高", exact: true }).click();
  assert.equal((await snapshot()).itemDraft, "1");
  await select("简谱单音符变音", "还原号 ♮");
  await page.getByRole("button", { name: "应用单个音高", exact: true }).click();
  await page.waitForFunction(() => !window.numberedTest.groups().itemPitch.dirty);
  assert.equal(await page.evaluate(() => window.numberedTest.commands[0].type), "numbered.event.set");
  assert.equal(await page.evaluate(() => !!window.numberedTest.commands[0].itemId), true);
  await page.getByRole("textbox", { name: "单音组简谱", exact: true }).fill("5");
  await select("简谱单音符变音", "升号 ♯");
  assert.equal(await page.getByRole("button", { name: "应用单个音高", exact: true }).isDisabled(), true);
  assert.match(await page.locator('[data-numbered-group="itemPitch"]').innerText(), /先应用或恢复内容组/);
  assert.equal(await commandCount(), 1);
  await open();
  await surface("sidebar");
  await page.evaluate(() => window.numberedTest.focus("rhythm"));
  await select("简谱时值", "八分");
  await page.locator('[data-numbered-group="rhythm"]').getByRole("button", { name: "应用时值", exact: true }).click();
  await page.waitForFunction(() => !window.numberedTest.groups().rhythm.dirty);
  assert.equal(await page.evaluate(() => window.numberedTest.commands[0].type), "numbered.event.setRhythm");

  console.log(
    "NumberedEditor browser regressions passed: shared surfaces, group submission/restore, compatible dirty group retention, planner advance, external conflict/invalidation, member requests, action Portal, complex rhythm, IME guard.",
  );
} finally {
  await browser?.close();
  await server.close();
}
