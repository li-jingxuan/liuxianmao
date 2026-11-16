// LXM_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node <this file>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { nextBrowserDefines } from "./next-browser-env.fixture.mjs";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: website, configFile: false, define: nextBrowserDefines,
  cacheDir: path.resolve(website, "node_modules/.vite/score-settings-portals"),
  optimizeDeps: { entries: ["tests/score-settings-portals.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [path.resolve(website, "../..")] } }, plugins: [{ name: "settings-fixture", configureServer(dev) { dev.middlewares.use(async (request, response, next) => { if (!request.url?.startsWith("/__settings-test__")) return next(); response.setHeader("Content-Type", "text/html"); response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/score-settings-portals.browser.tsx"></script>')); }); } }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async () => { await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__settings-test__`); await page.locator("#settings-title").waitFor(); await page.waitForFunction(() => !!window.settingsTest); };
  const status = () => page.evaluate(() => window.settingsTest.status());
  const snapshot = () => page.evaluate(() => ({ document: window.settingsTest.document(), commands: window.settingsTest.commands(), history: window.settingsTest.history() }));
  const label = page.locator("#settings-label");
  const help = page.getByRole("button", { name: "段落标记说明", exact: true });
  await open();
  // 边界入口保留完整小节表面；重复导航聚焦常驻分组标题。
  await page.evaluate(() => window.settingsTest.surface("measure"));
  const boundary = page.getByRole("region", { name: "小节线与反复", exact: true });
  for (let repeat = 0; repeat < 2; repeat += 1) {
    assert.equal(await page.evaluate(() => window.settingsTest.boundary()), true);
    await page.waitForFunction(() => document.activeElement?.tagName === "H3" && document.activeElement.textContent === "小节线与反复");
    assert.equal(await boundary.locator("summary").count(), 0);
    assert.equal(await boundary.getByRole("group", { name: "六类小节线" }).isVisible(), true);
    assert.equal(await page.locator("#tool-measure-signature").isVisible(), true);
    assert.equal(await page.locator("#settings-label").isVisible(), true);
    await label.focus();
  }
  assert.equal(await page.locator('[data-settings-group="label"]').getByRole("button", { name: /应用|恢复/ }).count(), 0);
  assert.equal(await page.locator('[data-settings-surface="actions"]').count(), 0);
  assert.equal(await page.locator('[data-settings-surface="measure"]').getByText("段落名称是小节标记，不会新增歌词或简谱行。", { exact: true }).count(), 0);
  await help.focus();
  await page.getByRole("tooltip").waitFor();
  assert.equal(await page.getByRole("tooltip").innerText(), "段落名称是小节标记，不会新增歌词或简谱行。");
  assert.equal(await help.evaluate((element) => element === document.activeElement), true);
  await page.evaluate(() => window.settingsTest.surface("song"));
  assert.equal(await page.locator("#settings-label").count(), 1);
  assert.equal(await page.locator('[data-settings-surface="song"] #settings-label').count(), 0);
  await page.locator("#settings-title").fill("未应用名称");
  await page.evaluate(() => window.settingsTest.externalCapo(5));
  await page.waitForFunction(() => document.querySelector("#settings-capo")?.closest(".ant-select")?.textContent.includes("5 品"));
  assert.equal(await page.locator("#settings-title").inputValue(), "未应用名称");
  assert.match(await page.locator(".ant-select").filter({ has: page.locator("#settings-capo") }).innerText(), /5 品/);
  assert.equal((await status()).groups.info.canApply, true);
  await page.evaluate(() => window.settingsTest.external("外部名称"));
  assert.equal(await page.locator("#settings-title").inputValue(), "未应用名称");
  assert.equal((await status()).groups.info.canApply, false);
  assert.equal(await page.evaluate(() => window.settingsTest.apply("info")), false);
  await page.locator("#settings-title").fill("核对后的名称");
  assert.equal((await status()).groups.info.canApply, false);
  await page.getByRole("button", { name: "核对并保留输入", exact: true }).click();
  assert.equal((await status()).groups.info.canApply, true);
  assert.equal(await page.evaluate(() => window.settingsTest.apply("info")), true);
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.title), "核对后的名称");

  // 正文中的曲谱信息与变调夹独立提交；基础拍号只读，不再有底栏或恢复本组。
  const info = page.locator('[data-settings-group="info"]');
  const capo = page.locator('[data-settings-group="capo"]');
  const applyInfo = info.getByRole("button", { name: "应用曲谱信息", exact: true });
  const applyCapo = capo.getByRole("button", { name: "应用变调夹", exact: true });
  assert.equal(await page.locator('[data-settings-surface="actions"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: "恢复本组", exact: true }).count(), 0);
  assert.equal(await page.locator("dd#settings-signature").count(), 1);
  assert.equal(await page.locator("#settings-signature").innerText(), await page.evaluate(() => {
    const signature = window.settingsTest.document().score.tracks[0].measures[0].timeSignature;
    return `${signature.numerator}/${signature.denominator}`;
  }));
  assert.equal(await page.locator(".ant-select").filter({ has: page.locator("#settings-signature") }).count(), 0);
  const beforeGroups = await snapshot();
  await page.locator("#settings-title").fill("独立提交的名称");
  await page.locator("#settings-arranger").fill("独立提交的作者");
  await page.locator("#settings-capo").click();
  for (let step = 0; step < 7; step += 1) await page.locator("#settings-capo").press("ArrowDown");
  await page.locator("#settings-capo").press("Enter");
  assert.match(await page.locator(".ant-select").filter({ has: page.locator("#settings-capo") }).innerText(), /12 品/);
   assert.equal(await applyInfo.isEnabled(), true);
   assert.equal(await applyCapo.isEnabled(), true);
   assert.deepEqual(await page.evaluate(() => window.settingsTest.pending()), []);
   assert.equal(await page.evaluate(() => window.settingsTest.protectedDirty()), false);
  await applyCapo.click();
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.tracks[0].capo), 12);
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.title), beforeGroups.document.score.title);
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.arranger), beforeGroups.document.score.arranger);
  assert.equal(await page.locator("#settings-title").inputValue(), "独立提交的名称");
  assert.equal(await page.locator("#settings-arranger").inputValue(), "独立提交的作者");
   assert.equal((await status()).groups.info.dirty, true);
   assert.equal(await applyInfo.isEnabled(), true);
   assert.deepEqual(await page.evaluate(() => window.settingsTest.pending()), []);
  assert.equal((await status()).groups.signature.dirty, false);
  assert.equal((await status()).groups.capo.dirty, false);
  assert.equal(await applyCapo.isDisabled(), true);
  await applyInfo.click();
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.title), "独立提交的名称");
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.arranger), "独立提交的作者");
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.tracks[0].capo), 12);
  assert.deepEqual(await page.evaluate((start) => window.settingsTest.commands().slice(start).map((command) => command.type), beforeGroups.commands.length), ["track.setCapo", "score.setInfo"]);
  assert.equal(await page.evaluate(() => window.settingsTest.history()), beforeGroups.history + 2);
   assert.equal((await status()).groups.info.dirty, false);
   assert.equal(await applyInfo.isDisabled(), true);

   // 应用信息仍保留变调夹草稿；离开到小节或收起时才丢弃所有未应用歌曲输入。
   for (const surface of ["measure", null]) {
     await page.locator("#settings-capo").click();
     await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content').getByText("11 品", { exact: true }).click();
     const appliedTitle = `离开到 ${surface ?? "收起"} 前已应用`;
     await page.locator("#settings-title").fill(appliedTitle);
     await applyInfo.click();
     const applied = await snapshot();
     assert.equal(applied.document.score.title, appliedTitle);
     assert.equal(applied.document.score.tracks[0].capo, 12);
     assert.match(await page.locator(".ant-select").filter({ has: page.locator("#settings-capo") }).innerText(), /11 品/);
     assert.equal((await status()).groups.capo.dirty, true);
     assert.equal(await applyCapo.isEnabled(), true);
     await page.locator("#settings-title").fill("离开即丢弃的名称");
     await page.locator("#settings-arranger").fill("离开即丢弃的作者");
     assert.equal((await status()).groups.info.dirty, true);
     assert.deepEqual(await page.evaluate(() => window.settingsTest.pending()), []);
     assert.equal(await page.evaluate(() => window.settingsTest.protectedDirty()), false);
     assert.deepEqual(await page.evaluate(() => window.settingsTest.discardAll()), { status: "accepted", discarded: 0 });
     assert.equal(await page.locator("#settings-title").inputValue(), "离开即丢弃的名称");
     assert.equal((await status()).groups.capo.dirty, true);
     await page.evaluate((surface) => window.settingsTest.surface(surface), surface);
     assert.equal(await applyInfo.count(), 0);
     for (const group of ["info", "capo", "signature"]) assert.equal((await status()).groups[group].dirty, false);
     assert.deepEqual(await page.evaluate(() => window.settingsTest.pending()), []);
     await page.evaluate(() => window.settingsTest.surface("song"));
     assert.equal(await page.locator("#settings-title").inputValue(), appliedTitle);
     assert.equal(await page.locator("#settings-arranger").inputValue(), applied.document.score.arranger ?? "");
     assert.match(await page.locator(".ant-select").filter({ has: page.locator("#settings-capo") }).innerText(), /12 品/);
     assert.equal(await applyInfo.isDisabled(), true);
     assert.equal(await applyCapo.isDisabled(), true);
     assert.deepEqual(await snapshot(), applied);
   }

  await page.evaluate(() => window.settingsTest.focus("label"));
  await page.waitForFunction(() => document.activeElement?.id === "settings-label");
  // Enter 与真实失焦立即走 owner 提交；无变化的 Enter/失焦不新增历史。
  const beforeLabel = await snapshot();
  await label.fill("Enter 标记");
  await label.press("Enter");
  assert.equal((await status()).groups.label.dirty, false);
  let saved = await snapshot();
  assert.deepEqual(saved.commands.slice(beforeLabel.commands.length).map((command) => command.type), ["measure.setSectionLabel"]);
  assert.equal(saved.history, beforeLabel.history + 1);
  assert.equal(saved.document.score.tracks[0].measures[0].sectionLabel, "Enter 标记");
  await label.press("Enter");
  await help.focus();
  assert.deepEqual(await snapshot(), saved);
  await label.fill("失焦标记");
  await help.focus();
  assert.equal((await status()).groups.label.dirty, false);
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.tracks[0].measures[0].sectionLabel), "失焦标记");
  assert.equal(await page.evaluate(() => window.settingsTest.history()), beforeLabel.history + 2);
  assert.equal(await page.locator('[data-settings-surface="actions"]').count(), 0);
  await label.fill("   ");
  await label.press("Enter");
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.tracks[0].measures[0].sectionLabel), undefined);
  assert.equal((await status()).groups.label.dirty, false);
  saved = await snapshot();
  await label.press("Enter");
  await help.focus();
  assert.deepEqual(await snapshot(), saved);

  // 请求新目标不制造失焦；脏输入仍绑定原小节，提交后才跟随新目标。
  await label.fill("原小节标记");
  const bound = (await status()).measureId;
  const secondLabel = await page.evaluate(() => window.settingsTest.document().score.tracks[0].measures[1].sectionLabel);
  await page.evaluate(() => window.settingsTest.measure(1));
  assert.equal((await status()).measureId, bound);
  assert.equal(await label.evaluate((element) => element === document.activeElement), true);
  await help.focus();
  assert.equal(await page.evaluate((id) => window.settingsTest.document().score.tracks[0].measures.find((measure) => measure.id === id).sectionLabel, bound), "原小节标记");
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.tracks[0].measures[1].sectionLabel), secondLabel);
  assert.notEqual((await status()).measureId, bound);
  assert.equal((await status()).groups.label.dirty, false);
  await label.fill("切换表面保存");
  await page.evaluate(() => window.settingsTest.focus("info"));
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.tracks[0].measures[1].sectionLabel), "切换表面保存");
  assert.equal((await status()).groups.label.dirty, false);
  // 标签外部改写与目标删除都保留用户输入，失败提交不改写原文档。
  await page.evaluate(() => window.settingsTest.focus("label"));
  await label.fill("冲突本地输入");
  await page.evaluate(() => window.settingsTest.externalLabel("冲突外部输入"));
  await page.waitForFunction(() => !!window.settingsTest.status().groups.label.blockedReason);
  assert.equal(await label.inputValue(), "冲突本地输入");
  assert.equal(await page.evaluate(() => window.settingsTest.apply("label")), false);
   assert.equal(await page.evaluate(() => window.settingsTest.document().score.tracks[0].measures[1].sectionLabel), "冲突外部输入");
   assert.equal(await label.inputValue(), "冲突本地输入");
   // 冲突标签可与歌曲输入并存；丢弃歌曲及离开歌曲都保留标签保护和目录记录。
   await page.evaluate(() => window.settingsTest.focus("info"));
   const beforeSongDiscard = await snapshot();
   const labelPending = await page.evaluate(() => window.settingsTest.pending());
   assert.deepEqual(labelPending, [{ label: "段落标记", dirty: true, composing: false, canApply: false }]);
   for (const destination of ["discardSong", "measure", null]) {
     await page.locator("#settings-title").fill("与标签并存的歌曲草稿");
     await page.locator("#settings-capo").click();
     await page.locator("#settings-capo").press("ArrowUp");
     await page.locator("#settings-capo").press("Enter");
     assert.equal((await status()).groups.info.dirty, true);
     assert.equal((await status()).groups.capo.dirty, true);
     assert.equal((await status()).groups.label.dirty, true);
     assert.deepEqual(await page.evaluate(() => window.settingsTest.pending()), labelPending);
     if (destination === "discardSong") assert.equal(await page.evaluate(() => window.settingsTest.discardSong()), true);
     else await page.evaluate((surface) => window.settingsTest.surface(surface), destination);
     assert.equal((await status()).groups.info.dirty, false);
     assert.equal((await status()).groups.capo.dirty, false);
     assert.equal((await status()).groups.label.dirty, true);
     assert.equal(await page.evaluate(() => window.settingsTest.protectedDirty()), true);
     assert.deepEqual(await page.evaluate(() => window.settingsTest.pending()), labelPending);
     assert.equal(await label.inputValue(), "冲突本地输入");
     await page.evaluate(() => window.settingsTest.surface("song"));
     assert.equal(await page.locator("#settings-title").inputValue(), beforeSongDiscard.document.score.title);
     assert.match(await page.locator(".ant-select").filter({ has: page.locator("#settings-capo") }).innerText(), /12 品/);
     assert.deepEqual(await snapshot(), beforeSongDiscard);
   }
   assert.equal(await page.evaluate(() => window.settingsTest.restore("label")), true);
  assert.equal(await label.inputValue(), "冲突外部输入");
  assert.equal((await status()).groups.label.dirty, false);
  await page.evaluate(() => window.settingsTest.focus("info"));
  await page.locator("#settings-title").fill("另一个未应用名称");
  await page.evaluate(() => window.settingsTest.focus("label"));
  await page.locator("#settings-label").fill("待处理标记");
   assert.deepEqual((await page.evaluate(() => window.settingsTest.pending())).filter((entry) => entry.dirty).map((entry) => entry.label), ["段落标记"]);
   assert.equal(await page.evaluate(() => window.settingsTest.protectedDirty()), true);
   assert.equal(await page.evaluate(() => window.settingsTest.restore("label")), true);
   assert.equal((await status()).groups.info.dirty, false);
   assert.equal((await status()).groups.label.dirty, false);
   assert.equal(await page.evaluate(() => window.settingsTest.protectedDirty()), false);

  // 两个 Portal 的原生 composition 都必须经过同一个同步闸门。
  for (const [group, field] of [["info", "settings-title"], ["label", "settings-label"]]) {
    await page.evaluate((group) => window.settingsTest.focus(group), group);
     await page.locator(`#${field}`).dispatchEvent("compositionstart");
     assert.equal((await status()).composing, true);
     assert.deepEqual(await page.evaluate(() => window.settingsTest.pending()), [{ label: group === "info" ? "曲谱信息" : "段落标记", dirty: false, composing: true, canApply: false }]);
     assert.equal((await page.evaluate(() => window.settingsTest.discardAll())).status, "blocked");
    assert.equal(await page.evaluate((group) => window.settingsTest.apply(group), group), false);
    assert.equal(await page.evaluate((group) => window.settingsTest.restore(group), group), false);
    assert.equal(await page.evaluate(() => window.settingsTest.discard()), false);
    await page.locator(`#${field}`).dispatchEvent("compositionend");
    assert.equal((await status()).composing, true);
    await page.waitForFunction(() => !window.settingsTest.status().composing);
  }
  await page.evaluate(() => window.settingsTest.discard());
  // compositionend 后仍有 50ms 闸门；前后发生的失焦都必须延迟保存最终文本。
  for (const blurFirst of [true, false]) {
    await page.evaluate(() => window.settingsTest.focus("label"));
    await label.dispatchEvent("compositionstart");
    const text = blurFirst ? "输入法失焦后结束" : "输入法结束后失焦";
    await label.fill(text);
    const beforeComposition = await snapshot();
    const during = await page.evaluate(async (blurFirst) => {
      const input = document.querySelector("#settings-label");
      const help = document.querySelector('[aria-label="段落标记说明"]');
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true, bubbles: true }));
      if (blurFirst) help.focus();
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      if (!blurFirst) help.focus();
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { composing: window.settingsTest.status().composing, commands: window.settingsTest.commands().length, history: window.settingsTest.history() };
    }, blurFirst);
    assert.equal(during.composing, true);
    assert.equal(during.commands, beforeComposition.commands.length);
    assert.equal(during.history, beforeComposition.history);
    await page.waitForFunction(() => !window.settingsTest.status().composing && !window.settingsTest.status().groups.label.dirty);
    const afterComposition = await snapshot();
    assert.equal(afterComposition.history, beforeComposition.history + 1);
    assert.deepEqual(afterComposition.commands.slice(beforeComposition.commands.length).map((command) => command.type), ["measure.setSectionLabel"]);
    assert.equal(afterComposition.document.score.tracks[0].measures[1].sectionLabel, text);
    assert.equal(await label.inputValue(), text);
  }
   // 收起歌曲丢弃未应用名称；切到复制也不再被歌曲草稿阻塞。
   await page.evaluate(() => window.settingsTest.focus("info"));
   const beforeClose = await snapshot();
   await page.locator("#settings-title").fill("收起后丢弃");
  await page.evaluate(() => window.settingsTest.surface(null));
  assert.equal(await page.getByRole("button", { name: "应用曲谱信息", exact: true }).count(), 0);
  await page.evaluate(() => window.settingsTest.focus("info"));
   assert.equal(await page.locator("#settings-title").inputValue(), beforeClose.document.score.title);
   assert.deepEqual(await snapshot(), beforeClose);
   await page.locator("#settings-title").fill("切到复制后丢弃");
  await page.evaluate(() => window.settingsTest.focus("copy"));
  await page.waitForFunction(() => document.activeElement?.id === "settings-copy-start");
   assert.equal((await status()).groups.info.dirty, false);
   assert.deepEqual(await page.evaluate(() => window.settingsTest.pending()), []);
   assert.equal(await page.getByRole("button", { name: "应用复制小节范围", exact: true }).isEnabled(), true);
  await page.evaluate(() => window.settingsTest.discard());
  const commandsBeforeCopy = await page.evaluate(() => window.settingsTest.commands().length);
  const historyBeforeCopy = await page.evaluate(() => window.settingsTest.history());
  await page.getByRole("button", { name: "应用复制小节范围", exact: true }).click();
  assert.equal((await status()).busy, true);
  assert.equal(await page.getByRole("button", { name: "应用复制小节范围", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.settingsTest.focus("label")), false);
  assert.equal(await page.evaluate(() => window.settingsTest.commands().length), commandsBeforeCopy + 1);
  await page.evaluate(() => window.settingsTest.finishCopy());
  await page.waitForFunction(() => !window.settingsTest.status().busy);
  assert.equal(await page.evaluate(() => window.settingsTest.history()), historyBeforeCopy);
  await page.evaluate(() => window.settingsTest.focus("label"));
  await page.locator("#settings-label").fill("失效原文");
  await page.evaluate(() => window.settingsTest.remove());
  assert.equal(await page.locator("#settings-label").inputValue(), "失效原文");
  assert.equal((await status()).groups.label.canApply, false);
  assert.equal(await page.locator('[data-settings-host="measure"]').count(), 1);
  assert.equal(await page.evaluate(() => window.settingsTest.apply("label")), false);
  // 设置交接只授权 info；按钮和普通 Enter 经同一个 owner 闸门。
  await open();
  await page.evaluate(() => window.settingsTest.allow("info"));
  await page.locator("#settings-title").fill("交接中的信息");
  assert.equal(await page.evaluate(() => window.settingsTest.applyAll()), false);
  assert.equal(await page.evaluate(() => window.settingsTest.commands().length), 0);
  assert.match(await page.locator('[data-settings-surface="song"]').innerText(), /不允许提交此设置组/);
   await applyInfo.click();
   assert.deepEqual(await page.evaluate(() => window.settingsTest.commands().map((command) => command.type)), ["score.setInfo"]);
   await page.locator("#settings-capo").click();
   await page.locator("#settings-capo").press("ArrowDown");
   await page.locator("#settings-capo").press("Enter");
   assert.match(await page.locator(".ant-select").filter({ has: page.locator("#settings-capo") }).innerText(), /1 品/);
  assert.equal(await page.evaluate(() => window.settingsTest.apply("capo")), false);
  assert.equal(await page.evaluate(() => window.settingsTest.commands().length), 1);
  await page.evaluate(() => window.settingsTest.restore("capo"));
  // 调性整组只读并跟随最新文档；外部调性更新不与已有信息草稿冲突。
  const tonality = page.locator('dl[aria-label="曲谱调性（只读）"]');
  const tonalityFields = () => tonality.locator("div").evaluateAll((rows) => rows.map((row) => [row.querySelector("dt").textContent, row.querySelector("dd").textContent]));
  assert.equal(await tonality.count(), 1);
  assert.equal(await tonality.locator("input, select, button, [role=combobox]").count(), 0);
  assert.equal(await page.locator("#settings-mode, #settings-tonic, #settings-minor-degree, #settings-key-signature").count(), 0);
  assert.equal(await page.evaluate(() => window.settingsTest.document().score.meta["lxm:tonality"]), undefined);
   assert.match(await tonality.innerText(), /调性未确认/);
   const beforeTonality = await snapshot();
   const readonlySignature = ["基础拍号", await page.locator("#settings-signature").innerText()];
  await page.locator("#settings-title").fill("保留最新调性的名称");
  await page.locator("#settings-arranger").fill("保留最新调性的作者");
  const minor = { version: 1, tonic: "A", mode: "minor", minorTonicDegree: 6 };
  const major = { version: 1, tonic: "D", mode: "major" };
  for (const value of [minor, major]) {
    await page.evaluate((value) => window.settingsTest.externalTonality(value), value);
    await page.waitForFunction((tonic) => document.querySelector('dl[aria-label="曲谱调性（只读）"]')?.textContent.includes(`${tonic}${tonic === "A" ? "小调" : "大调"}`), value.tonic);
    assert.deepEqual(await tonalityFields(), value.mode === "minor" ? [
       ["数字 1 的音高", "1=C"], ["调性", "A小调"], ["主音拼写", "A"], readonlySignature, ["小调主音记法", "主音记作 6"],
     ] : [["数字 1 的音高", "1=D"], ["调性", "D大调"], ["主音拼写", "D"], readonlySignature]);
    assert.equal(await page.locator("#settings-title").inputValue(), "保留最新调性的名称");
    assert.equal(await page.locator("#settings-arranger").inputValue(), "保留最新调性的作者");
    assert.equal((await status()).groups.info.canApply, true);
    assert.equal(await applyInfo.isEnabled(), true);
    assert.equal(await page.getByRole("region", { name: "曲谱信息冲突核对", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.settingsTest.document().score.keySignature), value.mode === "minor" ? "C" : "D");
    assert.deepEqual(await page.evaluate(() => window.settingsTest.document().score.meta["lxm:tonality"]), value);
  }
  const latestTonality = await snapshot();
  assert.equal(latestTonality.commands.length, beforeTonality.commands.length);
  await page.locator("#settings-title").press("Enter");
  const savedInfo = await snapshot();
  assert.equal(savedInfo.document.score.title, "保留最新调性的名称");
  assert.equal(savedInfo.document.score.arranger, "保留最新调性的作者");
  assert.equal(savedInfo.document.score.keySignature, "D");
  assert.deepEqual(savedInfo.document.score.meta["lxm:tonality"], major);
  assert.equal(savedInfo.history, latestTonality.history + 1);
  assert.equal((await status()).groups.info.dirty, false);
  assert.deepEqual(await page.evaluate(() => window.settingsTest.commands().map((command) => command.type)), ["score.setInfo", "score.setInfo"]);
  await page.evaluate(() => window.settingsTest.undo());
  const undoneInfo = await snapshot();
  assert.equal(undoneInfo.document.score.title, latestTonality.document.score.title);
  assert.equal(undoneInfo.document.score.arranger, latestTonality.document.score.arranger);
  assert.equal(undoneInfo.document.score.keySignature, "D");
  assert.deepEqual(undoneInfo.document.score.meta["lxm:tonality"], major);
  assert.equal(undoneInfo.history, latestTonality.history);
   assert.deepEqual(await tonalityFields(), [["数字 1 的音高", "1=D"], ["调性", "D大调"], ["主音拼写", "D"], readonlySignature]);
  const hooks = await page.evaluate(() => window.settingsTest.hooks());
  assert.deepEqual(hooks.guards.map((entry) => entry.group), [undefined, "info", "capo", "info"]);
  assert.ok(hooks.guards.every((entry) => entry.liveOwner));
  assert.equal(hooks.infoApplied.length, 2);
  assert.equal(hooks.settled.length, 4);
  assert.deepEqual(errors, []);
   console.log("score-settings portals: independent actions, song navigation discard without global confirmation, readonly tonality rebasing/undo, conflicts, label protection, pinned/invalid target, focus and IME passed");
} finally { await browser?.close(); await server.close(); }
