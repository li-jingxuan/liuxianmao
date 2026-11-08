/* 真实网站回归：文件导入、指针选择、工具按钮、填词补音、文件导出；不注入 store。
 * 先运行文档 reproduce.cjs 并启动网站。
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright EDITOR_URL=http://127.0.0.1:3000 node scripts/rhythm-sync.browser.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const output = path.resolve("artifacts/rhythm-sync-implementation");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [], results = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const record = (name) => { results.push(name); console.log(`PASS ${name}`); };
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  const popover = page.locator('[data-text-surface="popover"]');
  const action = (id) => page.locator(`[data-tool-action="${id}"]`);
  const exported = async () => {
    const waiting = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
    const download = await waiting;
    return JSON.parse(await fs.readFile(await download.path(), "utf8"));
  };
  const importFixture = async (name) => {
    await page.locator('input[type="file"]').setInputFiles(path.resolve(`artifacts/rhythm-sync-20261109/${name}.lxm`));
    await page.getByRole("button", { name: "导入并替换", exact: true }).click();
    await svg.getByText(name, { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  const select = async (from = 0, to = from) => {
    const points = await svg.evaluate((element) => {
      const group = element.querySelector('[data-system-index="0"]');
      const staffs = new Map();
      for (const line of group.querySelectorAll("line")) {
        if (line.getAttribute("y1") !== line.getAttribute("y2") || Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) <= 50) continue;
        const key = `${line.getAttribute("x1")}/${line.getAttribute("x2")}`;
        if (!staffs.has(key)) staffs.set(key, []);
        staffs.get(key).push(Number(line.getAttribute("y1")));
      }
      // Numbered shared underlines occur before TAB primitives in the scene.
      // Locate six matching staff lines instead of taking the first horizontals.
      const ys = [...staffs.values()].find((values) => values.length === 6)?.sort((a, b) => a - b);
      if (!ys) throw new Error("Missing six TAB staff lines");
      const xs = [...new Set([...group.querySelectorAll("text")]
        .filter((text) => /^[0-9x]+$/.test(text.textContent) && text.getAttribute("font-family")?.startsWith("Arial") && ys.some((y) => Math.abs(Number(text.getAttribute("y")) - y) < 5))
        .map((text) => Number(text.getAttribute("x"))))].sort((a, b) => a - b);
      return xs.map((x) => {
        // Select on the lowest string so a tie above the first string does not
        // take pointer priority and select its two-beat technique span.
        const point = new DOMPoint(x, ys[5]).matrixTransform(element.getScreenCTM());
        return { x: point.x, y: point.y };
      });
    });
    assert.ok(points[to], "TAB 指针目标存在");
    await page.mouse.move(points[from].x, points[from].y);
    await page.mouse.down();
    if (from !== to) await page.mouse.move(points[to].x, points[to].y, { steps: 5 });
    await page.mouse.up();
  };
  const clickCell = async (value) => {
    const cell = svg.locator(`[data-paragraph-cell="${value}"]`);
    await cell.waitFor();
    const box = await cell.boundingBox();
    assert.ok(box, `空位可见: ${value}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const measure = (document) => document.score.tracks[0].measures[0];
  const confirm = async (combined = false) => {
    await page.getByRole("dialog").getByRole("button", { name: combined ? "拆分并同步" : "应用细分", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  };
  const undo = () => page.getByRole("toolbar").getByRole("button", { name: "撤销", exact: true }).click();
  try {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3000", { waitUntil: "networkidle" });
    await importFixture("A-after-eighths");
    const initial = await exported();
    await select(0, 1);
    await action("numbered-align-to-tab").click();
    await page.getByRole("dialog").getByRole("button", { name: /^取\s*消$/ }).click();
    assert.deepEqual(await exported(), initial);
    record("事后细分预览取消零写入");
    await action("numbered-align-to-tab").click();
    await confirm();
    const aligned = await exported();
    const a = measure(aligned), original = measure(initial);
    const gap = a.numberedVoice.events.find((event) => event.tick === 480);
    assert.equal(gap.kind, "gap");
    assert.equal(gap.rhythm.base, "eighth");
    assert.equal(a.numberedVoice.events[0].id, original.numberedVoice.events[0].id);
    assert.deepEqual(a.numberedVoice.events[0].items, original.numberedVoice.events[0].items);
    assert.deepEqual(a.lyrics, original.lyrics);
    assert.equal(aligned.documentRevision, initial.documentRevision + 1);
    record("事后细分保留原音与原词、新增半拍空位");

    await select(0, 1);
    await action("numbered-align-to-tab").click();
    assert.deepEqual(await exported(), aligned);
    record("重复细分无文档变更");

    await clickCell(`lyric/${a.id}/${gap.id}/1`);
    const lyric = popover.getByRole("textbox", { name: /^(连续歌词|歌词文本)$/ });
    await lyric.fill("新");
    await lyric.press("Shift+Enter");
    await page.keyboard.press("Escape");
    const withLyric = await exported();
    assert.ok(measure(withLyric).lyrics.some((item) => item.eventId === gap.id && item.text === "新"));
    await clickCell(`numbered/${a.id}/${gap.id}/960`);
    const input = popover.getByRole("textbox", { name: /^(单音组简谱|音符内容)$/ });
    await input.fill("6");
    await input.press("Enter");
    await page.keyboard.press("Escape");
    const filled = await exported();
    const filledGap = measure(filled).numberedVoice.events.find((event) => event.id === gap.id);
    assert.equal(filledGap.kind, "notes");
    assert.equal(filledGap.rhythm.base, "eighth");
    assert.deepEqual(measure(filled).lyrics, measure(withLyric).lyrics);
    record("真实空位先填词再补音，身份与八分时值保留");
    await svg.screenshot({ path: path.join(output, "A-filled.png") });
    await undo();
    await undo();
    await undo();
    assert.deepEqual(measure(await exported()).numberedVoice, original.numberedVoice);
    record("补音、填词、细分按各自一次历史撤销");

    await importFixture("B-after-tab-sixteenth-sixteenth-eighth");
    const bBefore = await exported();
    await select(0, 2);
    await action("numbered-align-to-tab").click();
    await confirm();
    const bAfter = await exported(), b = measure(bAfter);
    const bGap = b.numberedVoice.events.find((event) => event.tick === 240);
    assert.equal(bGap.kind, "gap");
    assert.equal(bGap.rhythm.base, "sixteenth");
    assert.deepEqual(b.numberedVoice.events.find((event) => event.tick === 480), measure(bBefore).numberedVoice.events[1]);
    await clickCell(`numbered/${b.id}/${bGap.id}/480`);
    await popover.getByRole("textbox", { name: /^(单音组简谱|音符内容)$/ }).fill("2");
    await popover.getByRole("textbox", { name: /^(单音组简谱|音符内容)$/ }).press("Enter");
    await page.keyboard.press("Escape");
    const bFilled = measure(await exported());
    assert.deepEqual(bFilled.numberedVoice.events.slice(0, 3).map((event) => [event.tick, event.rhythm.base]), [[0, "sixteenth"], [240, "sixteenth"], [480, "eighth"]]);
    const mixedGeometry = await svg.evaluate((element, ids) => {
      const nodes = [...element.querySelectorAll("[data-numbered-event]")].filter((node) => ids.includes(node.getAttribute("data-numbered-event")));
      const third = nodes.find((node) => node.tagName.toLowerCase() === "text" && node.getAttribute("data-numbered-event") === ids[2]);
      const baseline = Number(third.getAttribute("y"));
      return {
        // Shared underlines deliberately have no selected event identity.
        lines: [...element.querySelectorAll("line")].filter((line) => line.getAttribute("y1") === line.getAttribute("y2") && Number(line.getAttribute("y1")) > baseline && Number(line.getAttribute("y1")) < baseline + 14).map((line) => ({ x2: Number(line.getAttribute("x2")), y: Number(line.getAttribute("y1")) })),
        thirdX: Number(third.getAttribute("x")),
      };
    }, bFilled.numberedVoice.events.slice(0, 3).map((event) => event.id));
    assert.equal(mixedGeometry.lines.length, 2);
    const [upper, lower] = mixedGeometry.lines.sort((a, b) => a.y - b.y);
    assert.ok(upper.x2 > mixedGeometry.thirdX && lower.x2 < mixedGeometry.thirdX, "真实 SVG 第二层减时线必须在八分音之前结束");
    await svg.screenshot({ path: path.join(output, "B-mixed-filled.png") });
    record("B 中间空位补音形成两个十六分加一个八分");

    await importFixture("A-before-quarter");
    const cBefore = await exported();
    await select();
    await action("beat-split-and-align-numbered").click();
    await confirm(true);
    const cAfter = await exported();
    assert.equal(cAfter.documentRevision, cBefore.documentRevision + 1);
    assert.deepEqual(measure(cAfter).beats.slice(0, 2).map((beat) => [beat.tick, beat.rhythm.base]), [[0, "eighth"], [480, "eighth"]]);
    assert.equal(measure(cAfter).numberedVoice.events.find((event) => event.tick === 480).kind, "gap");
    await undo();
    const undone = await exported();
    assert.deepEqual(measure(undone), measure(cBefore));
    assert.deepEqual(undone.score.tracks[0].techniques, cBefore.score.tracks[0].techniques);
    await page.getByRole("toolbar").getByRole("button", { name: "重做", exact: true }).click();
    assert.deepEqual(measure(await exported()), measure(cAfter));
    await select();
    await action("beat-split-and-align-numbered").click();
    await confirm(true);
    const twice = measure(await exported());
    assert.deepEqual(twice.numberedVoice.events.slice(0, 3).map((event) => [event.tick, event.rhythm.base]), [[0, "sixteenth"], [240, "sixteenth"], [480, "eighth"]]);
    await svg.screenshot({ path: path.join(output, "C-combined-twice.png") });
    record("组合拆分单次历史整体撤销重做，并可再次细分首八分");
    const saved = await exported();
    await page.locator('input[type="file"]').setInputFiles({ name: "rhythm-sync-roundtrip.lxm", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
    await page.getByRole("button", { name: "导入并替换", exact: true }).click();
    const reopened = await exported();
    assert.deepEqual(measure(reopened), measure(saved));
    assert.deepEqual(reopened.score.tracks[0].techniques, saved.score.tracks[0].techniques);
    record("保存文件重新导入保留两层节奏、歌词及连接关系");
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ results, errors }, null, 2) + "\n");
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
    await fs.writeFile(path.join(output, "failure.txt"), await page.locator("body").innerText());
    console.error("Browser errors:", errors);
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
