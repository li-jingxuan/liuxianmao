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
const server = await createServer({ root: website, configFile: false, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(website, "../..")] } }, plugins: [{ name: "parameter-enter-fixture", configureServer(dev) { dev.middlewares.use((request, response, next) => { if (!request.url?.startsWith("/__parameter-enter-test__")) return next(); response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><div id="root"></div><script type="module" src="/tests/editor-parameter-enter.browser.tsx"></script>'); }); } }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__parameter-enter-test__`);
  await page.waitForFunction(() => !!window.parameterEnterTest);
  const commands = () => page.evaluate(() => window.parameterEnterTest.commands());
  const count = async () => (await commands()).length;
  const title = page.locator("#settings-title");
  const label = page.locator("#settings-label");
  await title.fill("Enter 歌曲");
  await label.fill("Enter 段落");
  await title.press("Enter");
  assert.deepEqual((await commands()).map((command) => command.type), ["score.setInfo"]);
  assert.equal(await page.evaluate(() => window.parameterEnterTest.status().groups.label.dirty), true);
  await label.press("Enter");
  assert.deepEqual((await commands()).map((command) => command.type), ["score.setInfo", "measure.setSectionLabel"]);
  assert.equal(await page.evaluate(() => window.parameterEnterTest.status().groups.label.dirty), false);
  await page.locator("#settings-arranger").fill("Enter 作者");
  await page.locator("#settings-arranger").press("Enter");
  assert.equal(await page.evaluate(() => window.parameterEnterTest.document().score.arranger), "Enter 作者");

  // Select keeps Enter for option selection; neither settings nor copy auto-submit.
  const beforeSelect = await count();
  await page.locator("#settings-capo").click();
  await page.locator("#settings-capo").press("ArrowDown");
  await page.locator("#settings-capo").press("Enter");
  assert.equal(await count(), beforeSelect);
  assert.equal(await page.evaluate(() => window.parameterEnterTest.status().groups.capo.dirty), true);
  await page.locator("#settings-copy-start").evaluate((element) => { element.closest("details").open = true; });
  await page.locator("#settings-copy-start").click();
  await page.locator("#settings-copy-start").press("ArrowDown");
  await page.locator("#settings-copy-start").press("Enter");
  assert.equal(await count(), beforeSelect);

  const protectedEnter = async (input, composing) => {
    await input.evaluate((element, mode) => {
      if (mode === "composition") {
        element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      } else {
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: mode === "native", keyCode: mode === "229" ? 229 : 13 }));
      }
      // A fast follow-up Enter belongs to the composition ending buffer.
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }, composing);
  };
  for (const [input, value] of [[title, "IME 歌曲"], [label, "IME 段落"]]) {
    await input.fill(value);
    const before = await count();
    for (const mode of ["composition", "native", "229"]) {
      await protectedEnter(input, mode);
      assert.equal(await count(), before);
      await page.waitForFunction(() => !window.parameterEnterTest.status().composing);
    }
    await input.press("Enter");
    assert.equal(await count(), before + 1);
  }

  const parameters = page.locator("[data-technique-parameters]");
  const type = parameters.getByRole("combobox", { name: "选择吉他技巧", exact: true });
  await type.click();
  for (let step = 0; step < 10; step += 1) await type.press("ArrowDown");
  await type.press("Enter");
  const fret = parameters.getByRole("spinbutton", { name: "辅助品位", exact: true });
  assert.equal(await count(), beforeSelect + 2);
  await fret.fill("8");
  for (const mode of ["composition", "native", "229"]) {
    const before = await count();
    await protectedEnter(fret, mode);
    assert.equal(await count(), before);
    await page.waitForTimeout(70);
  }
  const beforeAdd = await count();
  await fret.press("Enter");
  await page.waitForFunction(() => window.parameterEnterTest.commands().at(-1)?.type === "technique.add");
  assert.equal(await count(), beforeAdd + 1);
  assert.equal((await commands()).at(-1).technique.auxiliaryFret, 8);
  await parameters.getByRole("button", { name: "应用更改", exact: true }).waitFor();
  await fret.fill("9");
  await fret.press("Enter");
  assert.equal((await commands()).at(-1).type, "technique.update");
  assert.equal((await commands()).at(-1).technique.auxiliaryFret, 9);

  const beforeInvalid = await count();
  for (const value of ["25", "-1", "7.5", "", "-"]) {
    await fret.fill(value);
    await fret.press("Enter");
    assert.equal(await count(), beforeInvalid, `invalid fret ${JSON.stringify(value)} must not submit a previous/clamped value`);
  }
  await fret.fill("10");
  await page.evaluate(() => window.parameterEnterTest.blocked(true));
  await page.waitForFunction(() => [...document.querySelectorAll("[data-technique-parameters] button")].find((button) => button.textContent === "应用更改")?.disabled);
  await fret.press("Enter");
  assert.equal(await count(), beforeInvalid);
  await page.evaluate(() => window.parameterEnterTest.blocked(false));
  await page.waitForFunction(() => [...document.querySelectorAll("[data-technique-parameters] button")].find((button) => button.textContent === "应用更改")?.disabled === false);
  await page.evaluate(() => window.parameterEnterTest.hold());
  await fret.press("Enter");
  assert.equal(await count(), beforeInvalid + 1, await parameters.innerText());
  await fret.press("Enter");
  assert.equal(await count(), beforeInvalid + 1, "busy blocks repeated submit");
  assert.equal((await commands()).some((command) => command.type === "technique.remove"), false);
  await page.evaluate(() => window.parameterEnterTest.finish());
  await page.waitForFunction(() => window.parameterEnterTest.document().score.tracks[0].techniques.at(-1)?.auxiliaryFret === 10);
  await fret.fill("11");
  await parameters.getByRole("button", { name: "应用更改", exact: true }).press("Enter");
  assert.equal((await commands()).at(-1).type, "technique.update", "focused action buttons keep native Enter");
  await parameters.getByRole("button", { name: "删除技巧", exact: true }).press("Enter");
  assert.equal((await commands()).at(-1).type, "technique.remove", "explicitly focused delete keeps its native behavior");
  assert.deepEqual(errors, []);
  console.log("parameter Enter: settings Portal groups, Select/copy isolation, IME/cooldown, technique add/update, domain validation, busy and native buttons passed");
} finally { await browser?.close(); await server.close(); }
