/* Read-only real application verification. No store injection or app mutations.
 * Composition coverage dispatches DOM events; it does not verify a real OS IME.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const output = path.resolve(
    process.env.EDITOR_ARTIFACTS || "artifacts/toolbar-history-overlays",
  );
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [],
    errors = [];
  const source = JSON.parse(
    await fs.readFile(
      path.join(
        __dirname,
        "../packages/lxm-editor/example/technique-rhythm-score.json",
      ),
      "utf8",
    ),
  );
  source.score.title = "抽屉叠层验证";
  const fixture = {
    name: "toolbar-overlays.lxm",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  };
  const settle = (p) => p.waitForTimeout(220);
  const visible = (locator) => locator.isVisible();
  const focusState = (p) =>
    p.evaluate(() => ({
      tag: document.activeElement?.tagName,
      id: document.activeElement?.id,
      label: document.activeElement?.getAttribute("aria-label"),
      text: document.activeElement?.textContent?.slice(0, 60),
    }));
  const controls = (root) =>
    root.evaluate((el) =>
      [el, ...document.querySelectorAll(`[data-editor-associated-panel="${el.id}"]`)]
        .filter(root => root.getClientRects().length && !root.closest('[hidden],[aria-hidden=true]'))
        .flatMap(root => [...root.querySelectorAll(
          "button,input,textarea,select,a[href],[tabindex]",
        )])
        .filter(
          (e) =>
            e.tabIndex >= 0 &&
            !e.matches(":disabled") &&
            !e.closest("[hidden],[inert]") &&
            e.getClientRects().length &&
            getComputedStyle(e).visibility !== "hidden" &&
            !e.closest("[aria-hidden=true]"),
        )
        .map((e) => ({
          tag: e.tagName,
          id: e.id,
          label: e.getAttribute("aria-label"),
          text: e.textContent?.slice(0, 40),
        })),
    );
  const cycle = async (p, root) => {
    const list = await controls(root);
    assert.ok(list.length, "focusable controls exist");
    const atEnd = async (last) =>
      root.evaluate((el, last) => {
        const es = [el, ...document.querySelectorAll(`[data-editor-associated-panel="${el.id}"]`)]
          .filter(root => root.getClientRects().length && !root.closest('[hidden],[aria-hidden=true]'))
          .flatMap(root => [...root.querySelectorAll(
            "button,input,textarea,select,a[href],[tabindex]",
          )]).filter(
          (e) =>
            e.tabIndex >= 0 &&
            !e.matches(":disabled") &&
            !e.closest("[hidden],[inert]") &&
            e.getClientRects().length &&
            getComputedStyle(e).visibility !== "hidden" &&
            !e.closest("[aria-hidden=true]"),
        );
        (last ? es.at(-1) : es[0]).focus();
      }, last);
    await atEnd(true);
    await p.keyboard.press("Tab");
    const forward = await focusState(p);
    assert.equal(
      await root.evaluate((el) => [el, ...document.querySelectorAll(`[data-editor-associated-panel="${el.id}"]`)].some(domain => domain.contains(document.activeElement))),
      true,
      "Tab remains in active drawer",
    );
    await atEnd(false);
    await p.keyboard.press("Shift+Tab");
    const reverse = await focusState(p);
    assert.equal(
      await root.evaluate((el) => [el, ...document.querySelectorAll(`[data-editor-associated-panel="${el.id}"]`)].some(domain => domain.contains(document.activeElement))),
      true,
      "Shift+Tab remains in active drawer",
    );
    assert.deepEqual(forward, {
      tag: list[0].tag,
      id: list[0].id,
      label: list[0].label,
      text: list[0].text,
    });
    assert.deepEqual(reverse, {
      tag: list.at(-1).tag,
      id: list.at(-1).id,
      label: list.at(-1).label,
      text: list.at(-1).text,
    });
    return { controlCount: list.length, forward, reverse };
  };
  const run = async (name, width, task) => {
    const p = await browser.newPage({
      viewport: { width, height: 850 },
      acceptDownloads: true,
    });
    p.setDefaultTimeout(10000);
    p.on("pageerror", (error) => errors.push({ name, message: error.message }));
    try {
      await p.goto(process.env.EDITOR_URL || "http://127.0.0.1:3012", {
        waitUntil: "domcontentloaded",
      });
      await p.getByRole("application", { name: "六线谱编辑器" }).waitFor();
      // Host ResizeObserver and the initial narrow-panel collapse run after hydration.
      await p
        .locator('[data-layout="narrow"][data-sidebar-collapsed="true"]')
        .waitFor();
      await settle(p);
      const detail = await task(p);
      results.push({ name, width, status: "pass", ...detail });
      console.log("PASS", name, width);
    } catch (error) {
      results.push({
        name,
        width,
        status: "fail",
        error: error.message,
        stack: error.stack,
        focus: await focusState(p),
      });
      console.log("FAIL", name, width, error.message);
      await p.screenshot({
        path: path.join(output, `${name}-${width}-failure.png`),
        fullPage: true,
      });
      await fs.writeFile(
        path.join(output, `${name}-${width}-failure.txt`),
        await p.locator("body").innerText(),
      );
    } finally {
      await p.close();
    }
  };
  const sidebar = (p) => p.locator("#music-text-sidebar");
  const history = (p) => p.locator("#editor-history-panel");
  const historyButton = (p) =>
    p.getByRole("button", { name: "操作历史", exact: true });
  const openSidebar = async (p) => {
    if (!(await sidebar(p).isVisible()))
      await p.getByRole("button", { name: "编辑面板", exact: true }).click();
    await sidebar(p).waitFor({ state: "visible" });
    await settle(p);
  };
  const song = async (p) => {
    await openSidebar(p);
    await sidebar(p).getByRole("tab", { name: "歌曲", exact: true }).click();
    await p.getByRole("textbox", { name: "歌曲名称", exact: true }).waitFor();
    return p.getByRole("textbox", { name: "歌曲名称", exact: true });
  };
  const importFile = (p) =>
    p.locator("input[type=file]").setInputFiles(fixture);
  const exportDocument = async (p) => {
    const download = p.waitForEvent("download");
    await p.getByRole("button", { name: "导出曲谱", exact: true }).click();
    return JSON.parse(await fs.readFile(await (await download).path(), "utf8"));
  };
  try {
    for (const width of [768, 375]) {
      await run("drawer-focus-escape", width, async (p) => {
        await openSidebar(p);
        assert.equal(await sidebar(p).getAttribute("aria-modal"), "true");
        assert.equal(await visible(history(p)), false);
        const propertyCycle = await cycle(p, sidebar(p));
        const title = await song(p);
        await title.fill(`历史焦点验证-${width}`);
        await p
          .getByRole("button", { name: "应用曲谱信息", exact: true })
          .last()
          .click();
        await settle(p);
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(await visible(sidebar(p)), false);
        assert.equal(
          await p
            .getByRole("button", { name: "编辑面板", exact: true })
            .evaluate((e) => e === document.activeElement),
          true,
        );
        await historyButton(p).click();
        await settle(p);
        assert.equal(await visible(sidebar(p)), false);
        assert.equal(await history(p).getAttribute("aria-modal"), "true");
        assert.ok(
          (await history(p).locator("[data-entry-id]").count()) > 0,
          "history trap covers populated panel",
        );
        const historyCycle = await cycle(p, history(p));
        await p.screenshot({ path: path.join(output, `history-${width}.png`) });
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(await visible(history(p)), false);
        assert.equal(
          await historyButton(p).evaluate((e) => e === document.activeElement),
          true,
        );
        await openSidebar(p);
        assert.equal(await visible(history(p)), false);
        await p.screenshot({
          path: path.join(output, `properties-${width}.png`),
        });
        return { propertyCycle, historyCycle };
      });
      await run("song-dirty-breakpoint", width, async (p) => {
        const title = await song(p);
        const original = await title.inputValue();
        await title.fill(`未应用歌曲-${width}`);
        const node = await title.elementHandle();
        await p.screenshot({ path: path.join(output, `dirty-${width}.png`) });
        for (const next of [1440, 1199, 1200, width]) {
          await p.setViewportSize({ width: next, height: 850 });
          await settle(p);
          assert.equal(
            await node.evaluate(
              (el) => el === document.querySelector("#settings-title"),
            ),
            true,
            `same DOM node at ${next}`,
          );
          assert.equal(
            await p.locator("#settings-title").inputValue(),
            `未应用歌曲-${width}`,
          );
          if (!(await sidebar(p).isVisible())) await openSidebar(p);
        }
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(
          await visible(sidebar(p)),
          false,
          "dirty song settings may hide",
        );
        await historyButton(p).click();
        await settle(p);
        const entries = await history(p).locator("[data-entry-id]").count();
        assert.equal(entries, 0, "hiding does not commit settings");
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(
          await p
            .getByRole("main", { name: "A4 乐谱页面" })
            .getByText(original, { exact: true })
            .count(),
          1,
          "rendered committed title remains original",
        );
        await openSidebar(p);
        assert.equal(
          await p.locator("#settings-title").inputValue(),
          `未应用歌曲-${width}`,
        );
        assert.equal(
          await node.evaluate(
            (el) => el === document.querySelector("#settings-title"),
          ),
          true,
        );
        const retained = await title.inputValue();
        await p.getByRole("button", { name: "恢复本组", exact: true }).click();
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal((await exportDocument(p)).score.title, original);
        return {
          original,
          retained,
          entries,
          breakpoints: [1440, 1199, 1200, width],
          exportScope:
            "export verified after restoring draft because dirty settings intentionally block output",
        };
      });
      await run("select-layered-escape", width, async (p) => {
        await song(p);
        await p.getByRole("combobox", { name: "调性", exact: true }).click();
        await p
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .waitFor();
        await p.keyboard.press("Escape");
        await settle(p);
        await p
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .waitFor({ state: "hidden" });
        assert.equal(
          await p
            .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
            .count(),
          0,
        );
        assert.equal(
          await visible(sidebar(p)),
          true,
          "first Escape closes select only",
        );
        await p.screenshot({
          path: path.join(output, `select-escape-${width}.png`),
        });
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(
          await visible(sidebar(p)),
          false,
          "second Escape closes drawer",
        );
        return {};
      });
      await run("composition-history-delay", width, async (p) => {
        const title = await song(p),
          original = await title.inputValue();
        await title.focus();
        await title.dispatchEvent("compositionstart", { data: "" });
        await title.fill(`模拟组合草稿-${width}`);
        // Background history is inert; dispatch tests the pending UI intent handler.
        await historyButton(p).dispatchEvent("click");
        await settle(p);
        assert.equal(
          await visible(history(p)),
          false,
          "history waits while composing",
        );
        assert.equal(await visible(sidebar(p)), true);
        await title.dispatchEvent("compositionend", {
          data: `模拟组合草稿-${width}`,
        });
        await settle(p);
        await settle(p);
        assert.equal(
          await visible(history(p)),
          true,
          "history opens after simulated composition ends",
        );
        assert.equal(await visible(sidebar(p)), false);
        assert.equal(await history(p).locator("[data-entry-id]").count(), 0);
        await p.screenshot({
          path: path.join(output, `composition-history-${width}.png`),
        });
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(
          await p
            .getByRole("main", { name: "A4 乐谱页面" })
            .getByText(original, { exact: true })
            .count(),
          1,
        );
        await openSidebar(p);
        assert.equal(
          await p.locator("#settings-title").inputValue(),
          `模拟组合草稿-${width}`,
        );
        await p.getByRole("button", { name: "恢复本组", exact: true }).click();
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal((await exportDocument(p)).score.title, original);
        return {
          inputMethod: "DOM compositionstart/end event simulation only",
          historyRequest: "dispatchEvent(click) on inert background UI handler",
          original,
        };
      });
      await run("import-modal-over-history", width, async (p) => {
        await historyButton(p).click();
        await settle(p);
        await importFile(p);
        const confirm = p.getByRole("button", {
          name: "导入并替换",
          exact: true,
        });
        await confirm.waitFor();
        await settle(p);
        const state = await history(p).evaluate((el) => ({
          inert: !!el.closest("[inert]"),
          visible: el.getClientRects().length > 0,
        }));
        assert.equal(
          state.inert,
          true,
          "lower history is inert under import confirmation",
        );
        await p.screenshot({
          path: path.join(output, `import-over-history-${width}.png`),
        });
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(
          await confirm.isVisible(),
          false,
          "first Escape closes import confirmation",
        );
        assert.equal(
          await visible(history(p)),
          true,
          "history survives first Escape",
        );
        assert.equal(
          await history(p).evaluate((el) => !!el.closest("[inert]")),
          false,
          "history becomes interactive again",
        );
        assert.equal(
          await history(p).evaluate((el) =>
            el.contains(document.activeElement),
          ),
          true,
          "closing import restores focus inside lower history",
        );
        const restoredCycle = await cycle(p, history(p));
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(await visible(history(p)), false);
        return {
          opening: "native file input setInputFiles while drawer open",
          lowerLayer: state,
          restoredCycle,
        };
      });
      await run("output-modal-over-properties", width, async (p) => {
        await song(p);
        // Explicit DOM UI event opens output while the normal entry is inert.
        await p
          .getByRole("button", { name: "导出 A4 图片" })
          .dispatchEvent("click");
        const close = p.getByRole("button", { name: "关闭预览", exact: true });
        await close.waitFor();
        await settle(p);
        assert.equal(
          await sidebar(p).evaluate((el) => !!el.closest("[inert]")),
          true,
        );
        await p.screenshot({
          path: path.join(output, `output-over-properties-${width}.png`),
        });
        await p.keyboard.press("Escape");
        await settle(p);
        await close.waitFor({ state: "hidden" });
        assert.equal(await close.isVisible(), false);
        assert.equal(await visible(sidebar(p)), true);
        assert.equal(
          await sidebar(p).evaluate((el) => !!el.closest("[inert]")),
          false,
        );
        assert.equal(
          await sidebar(p).evaluate((el) =>
            el.contains(document.activeElement),
          ),
          true,
          "closing output restores focus inside lower properties",
        );
        const restoredCycle = await cycle(p, sidebar(p));
        await p.keyboard.press("Escape");
        await settle(p);
        assert.equal(await visible(sidebar(p)), false);
        return {
          opening: "dispatchEvent(click) on inert output entry",
          restoredCycle,
        };
      });
    }
  } finally {
    await fs.writeFile(
      path.join(output, "validation.json"),
      JSON.stringify(
        {
          browser: await browser.version(),
          url: process.env.EDITOR_URL || "http://127.0.0.1:3012",
          compositionScope: "DOM events only; no real OS IME verification",
          results,
          errors,
        },
        null,
        2,
      ),
    );
    await browser.close();
  }
  if (results.some((r) => r.status === "fail") || errors.length)
    process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
