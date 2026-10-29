/* 真实点击、文件下载和撤销回归；不修改 React/store 内部状态。
 * PLAYWRIGHT_MODULE=/path/to/playwright EDITOR_URL=http://localhost:3108 node scripts/numbered-timeline.browser.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://localhost:3000");
    const svg = page.getByRole("application", { name: "六线谱编辑器" });
    await svg.waitFor();
    await page.evaluate(() => document.fonts.ready);
    // 等待客户端事件处理器生效后，从导出文件读取真实文档。
    const readDocument = async () => {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
      const file = await download;
      return JSON.parse(await fs.readFile(await file.path(), "utf8"));
    };
    const before = await readDocument();
    const original = before.score.tracks[0].measures[0];
    const text = page
      .locator('[data-system-index="0"] text')
      .filter({ hasText: /^1$/ })
      .first();
    const firstPoint = await text.evaluate((node) => {
      const point = new DOMPoint(
        Number(node.getAttribute("x")),
        Number(node.getAttribute("y")) - 5,
      ).matrixTransform(node.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(firstPoint.x, firstPoint.y);
    await page.getByText("简谱时值", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "设置为八分音符", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('button[aria-label="设置为八分音符"]')
          ?.getAttribute("aria-pressed") === "true",
    );
    const gapKey = `numbered/${original.id}/480/960`;
    const gap = svg.locator(`[data-paragraph-cell="${gapKey}"]`);
    await gap.waitFor();
    const box = await gap.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page
      .getByRole("textbox", { name: "连续简谱", exact: true })
      .fill("2");
    await page.getByRole("button", { name: "应用内容", exact: true }).click();
    await gap.waitFor({ state: "detached" });
    // 点击真实 TAB 弦格离开输入态，允许文件导出。
    const tabPoint = await svg.evaluate((root) => {
      const group = root.querySelector('[data-system-index="0"]');
      const first = group.querySelector("text");
      const line = [...group.querySelectorAll("line")].find(
        (line) =>
          line.getAttribute("y1") === line.getAttribute("y2") &&
          Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) >
            200,
      );
      const point = new DOMPoint(
        Number(first.getAttribute("x")),
        Number(line.getAttribute("y1")),
      ).matrixTransform(root.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(tabPoint.x, tabPoint.y);
    const after = await readDocument();
    const measure = after.score.tracks[0].measures[0];
    assert.deepEqual(
      measure.numberedVoice.events.map((event) => event.tick),
      [0, 480, 960, 1920, 2880],
    );
    assert.deepEqual(
      measure.numberedVoice.events.slice(0, 2).map((event) => event.rhythm),
      [
        { base: "eighth", dots: 0 },
        { base: "eighth", dots: 0 },
      ],
    );
    assert.deepEqual(measure.beats, original.beats);
    assert.deepEqual(measure.lyrics, original.lyrics);
    assert.deepEqual(
      after.score.tracks[0].numberedMarks,
      before.score.tracks[0].numberedMarks,
    );
    assert.equal(
      measure.numberedVoice.events[0].id,
      original.numberedVoice.events[0].id,
    );
    // 满小节延长：先取消预览，再确认同一规划，保留后续事件和歌词。
    await text.click();
    await page
      .getByRole("button", { name: "设置为四分音符", exact: true })
      .click();
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: "简谱时值影响确认" });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /压缩 1 个后续事件/);
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "设置为四分音符", exact: true })
      .click();
    await dialog.getByRole("button", { name: "确认修改", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.mouse.click(tabPoint.x, tabPoint.y);
    const expanded = await readDocument();
    const expandedMeasure = expanded.score.tracks[0].measures[0];
    assert.deepEqual(
      expandedMeasure.numberedVoice.events.map((event) => event.id),
      measure.numberedVoice.events.map((event) => event.id),
    );
    assert.deepEqual(
      expandedMeasure.numberedVoice.events.map((event) => event.tick),
      [0, 960, 1440, 1920, 2880],
    );
    assert.deepEqual(expandedMeasure.lyrics, original.lyrics);
    assert.deepEqual(expandedMeasure.beats, original.beats);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.deepEqual(
      (await readDocument()).score.tracks[0].measures[0],
      measure,
    );
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    const undone = await readDocument();
    assert.deepEqual(
      undone.score.tracks[0].measures[0].numberedVoice.events.map(
        (event) => event.tick,
      ),
      [0, 960, 1920, 2880],
    );
    assert.equal(
      undone.score.tracks[0].measures[0].numberedVoice.events[0].rhythm.base,
      "eighth",
    );
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.deepEqual(
      (await readDocument()).score.tracks[0].measures[0],
      original,
    );
    // 撤销使空白重新被原音占用时，不得继续保留空白录入焦点。
    await text.click();
    await page
      .getByRole("button", { name: "设置为八分音符", exact: true })
      .click();
    await gap.waitFor();
    const undoGap = await gap.boundingBox();
    await page.mouse.click(
      undoGap.x + undoGap.width / 2,
      undoGap.y + undoGap.height / 2,
    );
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await gap.waitFor({ state: "detached" });
    assert.equal(
      await svg.locator('[data-paragraph-focus="numbered"]').count(),
      0,
    );
    await page.mouse.click(tabPoint.x, tabPoint.y);
    await page
      .getByRole("button", { name: "导出 A4 图片", exact: true })
      .click();
    const generate = page.getByRole("button", {
      name: "仅生成当前页",
      exact: true,
    });
    await generate.waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent.includes("仅生成当前页") && !button.disabled,
      ),
    );
    await generate.click();
    const image = page.getByRole("link", { name: "下载图片", exact: true });
    await image.waitFor();
    const downloading = page.waitForEvent("download");
    await image.click();
    const png = await fs.readFile(await (await downloading).path());
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.ok(png.length > 10000);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 顶部缩短 → 点击半拍占位 → 独立填音 → 压缩预览取消/确认 → 文件往返核对 TAB/歌词/记号 → 每步独立撤销 → 生成下载 PNG",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
