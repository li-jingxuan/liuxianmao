/* Actual UI parameter-owner regression; no store injection. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const output = path.resolve(process.env.EDITOR_ARTIFACTS || "artifacts/technique-parameters");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [], results = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const record = (name) => { results.push(name); console.log(`PASS ${name}`); };
  try {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3012", { waitUntil: "domcontentloaded" });
    const svg = page.getByRole("application", { name: "六线谱编辑器" });
    await svg.waitFor();
    await page.waitForTimeout(300);
    const fixture = JSON.parse(await fs.readFile(path.join(__dirname, "../packages/lxm-editor/example/technique-rhythm-score.json"), "utf8"));
    fixture.score.title = "技巧参数 owner 回归";
    const track = fixture.score.tracks[0];
    track.techniques = []; track.numberedMarks = []; track.measures = [track.measures[0]];
    const measure = track.measures[0]; measure.lyrics = [];
    measure.beats = [3, 5, 2, 4].map((fret, index) => ({ id: `owner-beat-${index}`, tick: index * 960,
      rhythm: { base: "quarter", dots: 0 }, kind: "notes",
      notes: [1, 2].map((string) => ({ id: `owner-note-${index}-${string}`, string, fret: fret + string - 1 })) }));
    const importFixture = async () => {
      await page.locator('input[type="file"]').setInputFiles({ name: "owner.lxm", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
      await page.getByRole("button", { name: "导入并替换", exact: true }).click();
      await page.getByText("技巧参数 owner 回归", { exact: true }).first().waitFor();
      await page.waitForTimeout(100);
    };
    const exported = async () => {
      const waiting = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
      return JSON.parse(await fs.readFile(await (await waiting).path(), "utf8"));
    };
    await importFixture();
    const points = await svg.evaluate((element) => {
      const group = element.querySelector('[data-system-index="0"]');
      const lines = [...group.querySelectorAll("line")].filter((line) => line.getAttribute("y1") === line.getAttribute("y2") && Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) > 50);
      const y = Number(lines[0].getAttribute("y1"));
      return { xs: [...group.querySelectorAll("text")].filter((text) => Math.abs(Number(text.getAttribute("y")) - y) < 5 && ["3", "5", "2", "4"].includes(text.textContent))
        .map((text) => Number(text.getAttribute("x"))).sort((a, b) => a - b), ys: lines.slice(0, 6).map((line) => Number(line.getAttribute("y1"))) };
    });
    const select = async (startBeat = 0, startString = 0, endBeat = startBeat, endString = startString) => {
      const screen = (beat, string) => svg.evaluate((element, point) => {
        const result = new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM()); return { x: result.x, y: result.y };
      }, { x: points.xs[beat], y: points.ys[string] });
      const start = await screen(startBeat, startString), end = await screen(endBeat, endString);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      if (startBeat !== endBeat || startString !== endString) await page.mouse.move(end.x, end.y, { steps: 4 });
      await page.mouse.up();
    };
    const toolbar = page.getByRole("toolbar");
    const action = (name) => toolbar.getByRole("button", { name, exact: true });
    const panel = page.locator('[data-tool-panel="technique"]');
    const parameters = panel.locator("[data-technique-parameters]");
    const choose = async (label, option) => {
      await panel.getByRole("combobox", { name: label, exact: true }).click();
      await page.locator(".ant-select-item-option-content").getByText(option, { exact: true }).click();
      await page.waitForTimeout(150);
    };
    const add = () => parameters.getByRole("button", { name: "添加技巧", exact: true });
    const close = async () => { await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" }); };

    const slide = action("滑音");
    const slideAvailability = async (up, down) => {
      assert.equal(await slide.isEnabled(), up || down, "S 按起终音自动判断滑音方向");
    };
    const submitSlide = async (button) => {
      await button.click();
      assert.equal(await panel.isVisible(), false, "滑音快捷提交不打开参数");
    };
    await select(0, 0, 1, 0);
    await slideAvailability(true, false);
    await submitSlide(slide);
    let document = await exported();
    assert.deepEqual(document.score.tracks[0].techniques.map((item) => item.type), ["slideUp"]);
    const initialSlide = document.score.tracks[0].techniques[0];
    assert.equal(initialSlide.fromNoteId, "owner-note-0-1");
    assert.equal(initialSlide.toNoteId, "owner-note-1-1");
    await submitSlide(slide);
    assert.deepEqual((await exported()).score.tracks[0].techniques, [initialSlide]);
    await action("撤销").click();
    assert.deepEqual((await exported()).score.tracks[0].techniques, [], "重复上滑音不增加撤销步骤");
    await action("重做").click();
    assert.deepEqual((await exported()).score.tracks[0].techniques, [initialSlide]);
    record("S 自动上滑、重复noop、撤销重做");

    await select(1, 0, 0, 0);
    await slideAvailability(true, false);
    await submitSlide(slide);
    assert.deepEqual((await exported()).score.tracks[0].techniques, [initialSlide], "反向选区仍按时间顺序连接");
    await action("撤销").click();
    assert.deepEqual((await exported()).score.tracks[0].techniques, []);
    await action("重做").click();
    await select(2, 1, 1, 1);
    await slideAvailability(false, true);
    await submitSlide(slide);
    document = await exported();
    assert.deepEqual(document.score.tracks[0].techniques.map((item) => item.type), ["slideUp", "slideDown"]);
    assert.equal(document.score.tracks[0].techniques[1].fromNoteId, "owner-note-1-2");
    assert.equal(document.score.tracks[0].techniques[1].toNoteId, "owner-note-2-2");
    await action("撤销").click();
    assert.deepEqual((await exported()).score.tracks[0].techniques, [initialSlide]);
    record("上下滑音反向选区按时间解析、下滑音直达提交并可撤销");

    await select(1, 1);
    await slideAvailability(false, true);
    await submitSlide(slide);
    document = await exported();
    const nextStringSlide = document.score.tracks[0].techniques[1];
    assert.equal(nextStringSlide.type, "slideDown");
    assert.equal(nextStringSlide.fromNoteId, "owner-note-1-2");
    assert.equal(nextStringSlide.toNoteId, "owner-note-2-2");
    await submitSlide(slide);
    assert.deepEqual((await exported()).score.tracks[0].techniques, [initialSlide, nextStringSlide]);
    await action("撤销").click();
    assert.deepEqual((await exported()).score.tracks[0].techniques, [initialSlide]);
    await select(0, 0, 1, 1);
    await slideAvailability(false, false);
    await select(3, 1);
    await slideAvailability(false, false);
    assert.equal(await panel.isVisible(), false);
    record("单音滑音寻找同弦下一音、下滑重复noop、跨弦及无下一音时禁用");

    for (const name of ["撤销", "重做"]) {
      const button = action(name);
      const buttonBox = await button.boundingBox(), iconBox = await button.locator("svg").boundingBox();
      assert.equal(buttonBox.width, 36); assert.equal(buttonBox.height, 36);
      assert.equal(iconBox.width, 16); assert.equal(iconBox.height, 16);
    }
    assert.equal(await slide.innerText(), "S");
    assert.equal(await action("上滑音").count(), 0);
    assert.equal(await action("下滑音").count(), 0);
    const slideBox = await slide.boundingBox();
    assert.equal(slideBox.width, 36); assert.equal(slideBox.height, 36);
    const letterStyle = (element) => { const style = getComputedStyle(element); return [style.fontFamily, style.fontSize, style.fontWeight]; };
    assert.deepEqual(await slide.evaluate(letterStyle), await action("击弦 H").evaluate(letterStyle));
    await select(0, 0, 1, 0);
    await page.mouse.move(0, 0);
    await slide.hover();
    assert.equal(await page.getByRole("tooltip").innerText(), "滑音");
    assert(await svg.locator("text").filter({ hasText: /^S$/ }).count() > 0);
    await page.getByText("技巧参数 owner 回归", { exact: true }).first().hover();
    await toolbar.screenshot({ path: path.join(output, "toolbar-desktop-slide-s.png") });
    record("S 与 H 字母样式及36px热区一致、悬停滑音、谱面S标记");

    // Arpeggio directions now submit immediately, just like strumming.
    await select(2, 0, 2, 1);
    await action("上琶音：从高音弦到低音弦，箭头向下").click();
    assert.equal(await panel.isVisible(), false);
    document = await exported();
    assert.deepEqual(document.score.tracks[0].techniques.map((item) => item.type), ["slideUp", "arpeggio"]);
    assert.equal(document.score.tracks[0].techniques[1].direction, "descending");
    record("上下琶音直接快捷提交，不再打开方向参数");

    // Unapplied edits disappear when the panel closes; no discard action is offered.
    await action("技巧工具").click();
    await panel.getByRole("button", { name: "新增技巧：选择全部 16 类…", exact: true }).click();
    await page.getByRole("dialog").getByText("琶音", { exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "下一步：参数", exact: true }).click();
    await panel.waitFor({ state: "visible" });
    await add().click();
    await panel.waitFor({ state: "hidden" });
    await action("技巧工具").click();
    await choose("选择技巧方向", "下行");
    assert.equal(await panel.getByRole("button", { name: "丢弃参数更改", exact: true }).count(), 0);
    await page.setViewportSize({ width: 375, height: 650 });
    await page.waitForTimeout(150);
    assert.match(await parameters.textContent(), /下行/);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(150);
    await close();
    await action("技巧工具").click();
    assert.match(await parameters.textContent(), /上行/);
    await choose("选择技巧方向", "下行");
    await parameters.getByRole("button", { name: "应用更改", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    document = await exported();
    assert.equal(document.score.tracks[0].techniques[1].direction, "descending");
    record("关闭默认丢弃未应用参数、无丢弃按钮、显式应用仍生效、打开时跨断点保留");

    await action("技巧工具").click();
    assert.equal(await parameters.getByRole("button", { name: "应用更改", exact: true }).count(), 1);
    await close();

    await action("技巧工具").click();
    await panel.getByRole("button", { name: "新增技巧：选择全部 16 类…", exact: true }).click();
    await page.getByRole("dialog").getByText("颤音奏 tr", { exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "下一步：参数", exact: true }).click();
    await panel.waitFor({ state: "visible" });
    const fret = panel.getByRole("spinbutton", { name: "辅助品位" });
    await fret.fill("9"); await fret.press("Tab");
    await fret.dispatchEvent("compositionstart", { data: "1" });
    // Click-away cannot close a composing owner.
    await page.getByText("技巧参数 owner 回归", { exact: true }).first().click();
    assert.equal(await panel.isVisible(), true);
    await fret.dispatchEvent("compositionend", { data: "1" });
    await panel.waitFor({ state: "hidden" });
    await action("技巧工具").click();
    assert.equal(await fret.count(), 0);
    assert.match(await parameters.textContent(), /击弦 H/);
    await close();
    await panel.waitFor({ state: "hidden" });
    await action("撤销").click();
    document = await exported();
    assert.deepEqual(document.score.tracks[0].techniques.map((item) => item.type), ["slideUp", "arpeggio"]);
    assert.equal(document.score.tracks[0].techniques[1].direction, "ascending");
    record("输入法期间延迟关闭，结束后默认丢弃，未应用参数不阻断撤销");

    await importFixture();
    await select(1, 0, 1, 1);
    await action("技巧工具").click();
    await panel.getByRole("button", { name: "新增技巧：选择全部 16 类…", exact: true }).click();
    await page.getByRole("dialog").getByText("扫弦", { exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "下一步：参数", exact: true }).click();
    await panel.waitFor({ state: "visible" });
    assert.equal(await add().isEnabled(), true);
    await add().click();
    await panel.waitFor({ state: "hidden" });
    document = await exported();
    assert.equal(document.score.tracks[0].techniques[0].stroke, "down");
    record("更多技巧扫弦参数窗口保持默认down并可直接提交");

    const strumId = document.score.tracks[0].techniques[0].id;
    await action("技巧工具").click();
    await panel.getByRole("button", { name: "新增技巧：选择全部 16 类…", exact: true }).click();
    await page.getByRole("dialog").getByText("琶音", { exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "下一步：参数", exact: true }).click();
    await panel.waitFor({ state: "visible" });
    await add().click();
    await panel.waitFor({ state: "hidden" });
    document = await exported();
    assert.equal(document.score.tracks[0].techniques.length, 1);
    assert.equal(document.score.tracks[0].techniques[0].type, "arpeggio");
    assert.equal(document.score.tracks[0].techniques[0].id, strumId);
    await action("技巧工具").click();
    await choose("选择吉他技巧", "扫弦");
    await parameters.getByRole("button", { name: "应用更改", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    document = await exported();
    assert.equal(document.score.tracks[0].techniques.length, 1);
    assert.equal(document.score.tracks[0].techniques[0].type, "strum");
    assert.equal(document.score.tracks[0].techniques[0].id, strumId);
    record("完整技巧参数新增琶音直接替换扫弦，修改类型可反向替换并保留ID");

    await page.setViewportSize({ width: 375, height: 650 });
    await page.waitForTimeout(150);
    const rows = await toolbar.locator("[data-toolbar-row]").evaluateAll((items) => items.map((item) => ({ top: item.getBoundingClientRect().top, width: item.clientWidth, scroll: item.scrollWidth })));
    assert.equal(rows.length, 2); assert.ok(rows[1].top > rows[0].top);
    assert.ok(rows.every((row) => row.width <= 375 && row.scroll >= row.width));
    const restBox = await action("切换休止").boundingBox();
    assert.ok(restBox.x >= 0 && restBox.x + restBox.width <= 375);
    assert.equal(await action("小节工具").isVisible(), false);
    await action("更多工具").click();
    await page.getByRole("button", { name: "拍点工具", exact: true }).filter({ visible: true }).click();
    assert.equal(await page.locator('[data-tool-panel="beat"]').isVisible(), true);
    await close();
    await page.screenshot({ path: path.join(output, "toolbar-two-rows-375.png") });
    record("375工具栏双行独立滚动、休止首屏、低频工具更多可达");

    await page.setViewportSize({ width: 1920, height: 900 });
    const root = page.locator("[data-layout]").first();
    await root.evaluate((element) => { element.style.width = "375px"; element.style.marginLeft = "120px"; });
    await page.waitForTimeout(150);
    await action("技巧工具").click();
    await panel.waitFor({ state: "visible" });
    const hostBox = await root.boundingBox(), popupBox = await panel.locator("xpath=..").locator("xpath=..").boundingBox();
    assert.ok(popupBox.x >= hostBox.x && popupBox.x + popupBox.width <= hostBox.x + hostBox.width + 1);
    await panel.getByRole("combobox", { name: "选择技巧方向", exact: true }).click();
    const dropdown = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):not(.ant-slide-up-leave)");
    const dropdownBox = await dropdown.boundingBox();
    assert.ok(dropdownBox.x >= hostBox.x && dropdownBox.x + dropdownBox.width <= hostBox.x + hostBox.width + 1);
    assert.equal(await dropdown.locator("xpath=ancestor::*[contains(@class, 'ant-popover')]").count(), 1);
    await page.keyboard.press("Escape"); // first Escape dismisses the direction picker only
    await page.waitForFunction(() => !document.querySelector('[data-technique-parameters] [role="combobox"][aria-expanded="true"]'));
    assert.equal(await panel.isVisible(), true);
    await close();
    await panel.waitFor({ state: "hidden" });
    await page.screenshot({ path: path.join(output, "embedded-toolbar-375.png") });
    record("1920内嵌375宿主参数及Select有界、Escape仅关闭最上层菜单");
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "validation.json"), JSON.stringify({ browser: await browser.version(), results, errors }, null, 2));
  } catch (error) {
    console.error(await page.evaluate(() => ({ active: document.activeElement?.tagName,
      popups: [...document.querySelectorAll('.ant-popover')].map((element) => ({ style: element.getAttribute("style"), box: element.getBoundingClientRect().toJSON() })),
      expanded: [...document.querySelectorAll('[aria-expanded="true"]')].map((element) => element.outerHTML) })));
    await page.screenshot({ path: path.join(output, "failure.png") });
    await fs.writeFile(path.join(output, "failure.txt"), await page.locator("body").innerText());
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
