import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: website, configFile: false,
  cacheDir: path.resolve(website, "node_modules/.vite/numbered-sequence"),
  optimizeDeps: { entries: ["tests/numbered-sequence-overwrite.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "numbered-sequence-fixture", configureServer(dev) { dev.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/__sequence__")) return next();
    response.setHeader("Content-Type", "text/html");
    response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/numbered-sequence-overwrite.browser.tsx"></script>'));
  }); } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.LXM_BROWSER_CHANNEL, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const input = () => page.getByRole("textbox", { name: "简谱内容", exact: true });
  const rhythm = scope => scope.getByRole("group", { name: "常用时值", exact: true });
  const events = () => page.evaluate(() => window.numberedSequenceTest.document().score.tracks[0].measures[0].numberedVoice.events);
  for (const scenario of ["mixed", "blank", "explicit"]) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=${scenario}`);
    await input().waitFor();
    const initial = await events();
    if (scenario === "explicit") {
      await rhythm(page).getByRole("button", { name: "八分音符", exact: true }).click();
      await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 1 && !window.numberedSequenceTest.groups().content.dirty);
    }
    const prepared = await events();
    const propertyCommands = scenario === "explicit" ? 1 : 0;
    await input().fill(scenario === "explicit" ? "1 2" : "2 3 3");
    await input().press("Enter");
    await page.waitForFunction(count => window.numberedSequenceTest.commands.length === count && !window.numberedSequenceTest.groups().content.dirty, propertyCommands + 1);
    const first = await events();
    assert.deepEqual(first.filter(event => event.tick < 960).map(event => [event.tick, event.rhythm.base, event.items[0]?.token]), scenario === "explicit" ? [[0, "eighth", "1"], [480, "eighth", "2"]] : [[0, "sixteenth", "2"], [240, "sixteenth", "3"], [480, "sixteenth", "3"]]);
    assert.deepEqual(await page.evaluate(() => window.numberedSequenceTest.selections), []);
    assert.equal((await page.evaluate(() => window.numberedSequenceTest.snapshot())).start, 0);
    await input().fill(scenario === "explicit" ? "3 4" : "5 6 7");
    await input().press("Enter");
    await page.waitForFunction(count => window.numberedSequenceTest.commands.length === count && !window.numberedSequenceTest.groups().content.dirty, propertyCommands + 2);
    const second = await events();
    assert.equal(second.filter(event => event.tick < 960).length, first.filter(event => event.tick < 960).length);
    assert.equal(second[0].id, first[0].id);
    assert.equal(second[0].items[0].token, scenario === "explicit" ? "3" : "5");
    await page.evaluate(() => window.numberedSequenceTest.undo());
    assert.deepEqual(await events(), first);
    await page.evaluate(() => window.numberedSequenceTest.undo());
    assert.deepEqual(await events(), prepared);
    if (scenario === "explicit") {
      await page.evaluate(() => window.numberedSequenceTest.undo());
      assert.deepEqual(await events(), initial);
      await page.evaluate(() => window.numberedSequenceTest.redo());
      assert.deepEqual(await events(), prepared);
    }
    await page.evaluate(() => window.numberedSequenceTest.redo());
    assert.deepEqual(await events(), first);
  }
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=selection`);
  await input().waitFor();
  assert.equal(await input().inputValue(), "1 _ 3 _");
  await input().fill("2 _ 3 _");
  await input().press("Enter");
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 1 && !window.numberedSequenceTest.groups().content.dirty);
  assert.deepEqual((await events()).filter(event => event.tick < 960).map(event => [event.id, event.tick, event.items[0]?.token]), [["first", 0, "2"], ["middle", 480, "3"]]);

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=dependency`);
  await input().waitFor();
  await rhythm(page).getByRole("button", { name: "二分音符", exact: true }).click();
  await input().fill("5");
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.groups().content.canApply), true);
  await page.evaluate(() => window.numberedSequenceTest.externalLater());
  await page.waitForFunction(() => /本组内容已改变/.test(window.numberedSequenceTest.groups().content.blockedReason ?? ""));
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.groups().content.canApply), false);
  await input().press("Enter");
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 0);
  assert.equal((await events()).find(event => event.id === "later").items[0].token, "6");

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=properties`);
  const sidebar = page.locator('[data-presentation="sidebar"]');
  const popover = page.getByTestId("numbered-portal");
  const sidebarInput = sidebar.getByRole("textbox", { name: "简谱内容", exact: true });
  const popoverInput = popover.getByRole("textbox", { name: "简谱内容", exact: true });
  await sidebarInput.waitFor();
  await popoverInput.waitFor();
  assert.equal(await rhythm(sidebar).count(), 1);
  assert.equal(await rhythm(popover).count(), 1);
  assert.equal(await popover.getByRole("group", { name: "简谱单音符八度" }).count(), 0);
  assert.equal(await popover.getByText("节拍映射预览", { exact: true }).count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: /^恢复|^应用/ }).count(), 1);
  assert.equal(await sidebar.getByRole("group", { name: "简谱单音符八度" }).isVisible(), true);

  await sidebar.getByRole("button", { name: "升号", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 1 && !window.numberedSequenceTest.groups().content.dirty);
  assert.deepEqual((await events())[0].items.map(item => item.token), ["1", "#3"]);
  assert.equal(await sidebarInput.inputValue(), "1+#3");
  assert.equal(await popoverInput.inputValue(), "1+#3");
  await sidebar.getByRole("button", { name: "高八度", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 2);
  assert.deepEqual((await events())[0].items.map(item => item.token), ["1", "#3'"]);

  await popoverInput.fill("5 6");
  assert.equal(await sidebarInput.inputValue(), "5 6");
  const draftEighth = rhythm(sidebar).getByRole("button", { name: "八分音符", exact: true });
  await draftEighth.click();
  assert.equal(await popoverInput.inputValue(), "5 6");
  assert.equal(await rhythm(popover).getByRole("button", { name: "八分音符", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await rhythm(popover).getByRole("button", { name: "延音", exact: true }).isDisabled(), true);
  assert.equal(await sidebar.getByRole("button", { name: "降号", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 2);
  await page.evaluate(() => window.numberedSequenceTest.discard());

  await rhythm(popover).getByRole("button", { name: "八分音符", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 3 && !Object.values(window.numberedSequenceTest.groups()).some(group => group.dirty));
  assert.equal((await events())[0].rhythm.base, "eighth");
  await rhythm(sidebar).getByRole("button", { name: "单附点", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 4);
  assert.equal((await events())[0].rhythm.dots, 1);
  await rhythm(popover).getByRole("button", { name: "单附点", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 5);
  assert.equal((await events())[0].rhythm.dots, 0);

  await rhythm(popover).getByRole("button", { name: "延音", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 6 && !Object.values(window.numberedSequenceTest.groups()).some(group => group.dirty));
  assert.equal(await sidebarInput.inputValue(), "-");
  assert.equal(await popoverInput.inputValue(), "-");
  assert.equal((await events())[0].rhythm.base, "eighth");
  assert.equal((await events())[0].tick, 0);
  await rhythm(sidebar).getByRole("button", { name: "延音", exact: true }).click();
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 6);
  assert.deepEqual(await page.evaluate(() => window.numberedSequenceTest.selections), []);
  await page.evaluate(() => window.numberedSequenceTest.undo());
  assert.deepEqual((await events())[0].items.map(item => item.token), ["1", "#3'"]);
  await page.waitForFunction(() => window.numberedSequenceTest.snapshot().raw === "1+#3'" && !Object.values(window.numberedSequenceTest.groups()).some(group => group.dirty));
  assert.equal(await sidebarInput.inputValue(), "1+#3'");
  assert.equal(await popoverInput.inputValue(), "1+#3'");
  assert.equal(await sidebar.getByRole("button", { name: "高八度", exact: true }).isEnabled(), true);
  assert.equal(await sidebar.getByRole("button", { name: "高八度", exact: true }).getAttribute("aria-pressed"), "true");
  await page.evaluate(() => window.numberedSequenceTest.redo());
  await page.waitForFunction(() => window.numberedSequenceTest.snapshot().raw === "-");
  assert.equal(await sidebarInput.inputValue(), "-");
  assert.equal(await rhythm(sidebar).getByRole("button", { name: "延音", exact: true }).getAttribute("aria-pressed"), "true");
  await page.evaluate(() => window.numberedSequenceTest.undo());
  await page.waitForFunction(() => window.numberedSequenceTest.snapshot().raw === "1+#3'");
  await popoverInput.fill("5 6");
  await popoverInput.press("Enter");
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 7 && !window.numberedSequenceTest.groups().content.dirty);
  assert.equal(await sidebarInput.inputValue(), "5 6");
  assert.equal(await popoverInput.inputValue(), "5 6");
  assert.deepEqual((await events()).filter(event => event.tick < 960).map(event => event.items[0]?.token), ["5", "6"]);
  assert.deepEqual(await page.evaluate(() => window.numberedSequenceTest.selections), []);
  await page.evaluate(() => window.numberedSequenceTest.externalRemoveFirst());
  await popoverInput.fill("7");
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.groups().content.canApply), false);
  await popoverInput.press("Enter");
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 7);
  assert.equal((await events()).some(event => event.id === "first"), false);

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=blank`);
  await input().waitFor();
  await rhythm(page).getByRole("button", { name: "八分音符", exact: true }).click();
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 0);
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.groups().content.dirty), false);
  await rhythm(page).getByRole("button", { name: "延音", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 1 && !window.numberedSequenceTest.groups().content.dirty);
  assert.equal(await input().inputValue(), "-");
  assert.equal((await events())[0].rhythm.base, "eighth");
  await rhythm(page).getByRole("button", { name: "延音", exact: true }).click();
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 1);
  await page.evaluate(() => window.numberedSequenceTest.undo());
  assert.deepEqual(await events(), []);

  for (const scenario of ["blank", "properties"]) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=${scenario}`);
    const content = scenario === "blank" ? input() : sidebarInput;
    const toolbar = rhythm(scenario === "blank" ? page : sidebar);
    await content.waitFor();
    const before = await events();
    await content.fill("2");
    await toolbar.getByRole("button", { name: "八分音符", exact: true }).click();
    assert.deepEqual(await events(), before);
    await content.press("Enter");
    await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 1 && !window.numberedSequenceTest.groups().content.dirty);
    const [entered] = await events();
    assert.equal(entered.items[0].token, "2");
    assert.equal(entered.rhythm.base, "eighth");
    await page.evaluate(() => window.numberedSequenceTest.undo());
    assert.deepEqual(await events(), before);
  }

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=dots&tick=960`);
  await input().fill("4");
  await rhythm(page).getByRole("button", { name: "全音符", exact: true }).click();
  assert.equal(await input().inputValue(), "4");
  assert.equal(await page.getByRole("button", { name: "应用简谱内容" }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 0);
  await rhythm(page).getByRole("button", { name: "三十二分音符", exact: true }).click();
  await input().press("Enter");
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 1);
  const retried = (await events()).find(event => event.id === "dot-960");
  assert.equal(retried.items[0].token, "4");
  assert.equal(retried.rhythm.base, "thirtySecond");

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=confirmation`);
  await input().waitFor();
  const originalEvents = await events();
  const dialog = page.getByRole("dialog", { name: "确认简谱修改影响" });
  await rhythm(page).getByRole("button", { name: "二分音符", exact: true }).click();
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /将合并第1拍、第2拍，确认修改吗？/);
  assert.deepEqual(await events(), originalEvents);
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 0);
  assert.equal(await input().isDisabled(), true);
  await dialog.getByRole("button", { name: /取\s*消/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.snapshot().inputRhythmExplicit), false);
  assert.deepEqual(await events(), originalEvents);
  await rhythm(page).getByRole("button", { name: "二分音符", exact: true }).click();
  await dialog.getByRole("button", { name: "确认修改", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 1 && !Object.values(window.numberedSequenceTest.groups()).some(group => group.dirty));
  assert.equal((await events())[0].rhythm.base, "half");
  assert.equal((await events()).some(event => event.id === "later"), false);
  await page.evaluate(() => window.numberedSequenceTest.undo());
  assert.deepEqual(await events(), originalEvents);

  await rhythm(page).getByRole("button", { name: "延音", exact: true }).click();
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /将删除 1 个记号/);
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.commands.length), 1);
  await dialog.getByRole("button", { name: /取\s*消/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await events(), originalEvents);
  await rhythm(page).getByRole("button", { name: "延音", exact: true }).click();
  await dialog.getByRole("button", { name: "确认修改", exact: true }).click();
  await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 2 && !Object.values(window.numberedSequenceTest.groups()).some(group => group.dirty));
  assert.equal(await input().inputValue(), "-");
  assert.deepEqual(await page.evaluate(() => window.numberedSequenceTest.document().score.tracks[0].numberedMarks), []);
  await page.evaluate(() => window.numberedSequenceTest.undo());
  assert.deepEqual(await events(), originalEvents);
  assert.equal(await page.evaluate(() => window.numberedSequenceTest.document().score.tracks[0].numberedMarks[0].id), "property-slur");
  for (const tick of [0, 240, 480]) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__sequence__?scenario=dots&tick=${tick}`);
    await input().waitFor();
    const original = await page.evaluate(() => window.numberedSequenceTest.document().score.tracks[0]);
    await rhythm(page).getByRole("button", { name: "单附点", exact: true }).click();
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /互补调整紧邻后音/);
    assert.deepEqual(await events(), original.measures[0].numberedVoice.events);
    await dialog.getByRole("button", { name: "确认修改", exact: true }).click();
    await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 1 && !Object.values(window.numberedSequenceTest.groups()).some(group => group.dirty));
    assert.deepEqual((await events()).map(event => event.tick), [0, 240, 480, 720, 960].map(value => value === tick + 240 ? value + 120 : value));
    await rhythm(page).getByRole("button", { name: "单附点", exact: true }).click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "确认修改", exact: true }).click();
    await page.waitForFunction(() => window.numberedSequenceTest.commands.length === 2 && !Object.values(window.numberedSequenceTest.groups()).some(group => group.dirty));
    assert.deepEqual(await page.evaluate(() => window.numberedSequenceTest.document().score.tracks[0]), original);
    await page.evaluate(() => window.numberedSequenceTest.undo());
    assert.equal((await events()).find(event => event.id === `dot-${tick}`).rhythm.dots, 1);
    await page.evaluate(() => window.numberedSequenceTest.redo());
    assert.deepEqual(await page.evaluate(() => window.numberedSequenceTest.document().score.tracks[0]), original);
  }
  assert.deepEqual(errors, []);
  console.log("BUG017/020 + numbered properties browser: overwrite, repeated Enter, stable IDs, undo/redo, selection skips, external conflict, portal sync, member pitch, immediate rhythm/dots/sustain, dirty protection, no advance, fixed-window merge and mark confirmation guards passed");
} finally { await browser?.close(); await server.close(); }
