/* Actual SVG boundaries, native downloads and print output; no store injection. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const output = path.resolve("artifacts/system-justification");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [], results = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const record = (name, detail = {}) => {
    results.push({ name, ...detail });
    console.log(`PASS ${name}`);
  };
  const boundaries = async (root, selector = "[data-system-index]") => root.locator(selector).evaluateAll((groups) =>
    groups.map((group, index) => {
      const lines = [...group.querySelectorAll("line")].filter((line) =>
        line.getAttribute("y1") === line.getAttribute("y2") &&
        Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) > 50);
      return {
        index: group.hasAttribute("data-system-index") ? Number(group.getAttribute("data-system-index")) : index,
        left: Math.min(...lines.map((line) => Number(line.getAttribute("x1")))),
        right: Math.max(...lines.map((line) => Number(line.getAttribute("x2")))),
        lineCount: lines.length,
      };
    }).filter((group) => group.lineCount > 0));
  const expectAligned = (rows) => {
    assert.ok(rows.length > 1, "default score has multiple systems");
    for (const row of rows) {
      assert.ok(row.lineCount >= 6);
      assert.ok(Math.abs(row.left - rows[0].left) < 0.001, "same left boundary");
      assert.ok(Math.abs(row.right - 733.228346456693) < 0.001, "fills A4 content width");
    }
  };
  try {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3000", { waitUntil: "networkidle" });
    const svg = page.getByRole("application", { name: "六线谱编辑器" });
    await svg.waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const rows = await boundaries(svg);
      expectAligned(rows);
      await page.screenshot({ path: path.join(output, `aligned-${width}.png`), fullPage: true });
      record(`${width}px screen systems align`, { rows });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const exported = async () => {
      const waiting = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
      return JSON.parse(await fs.readFile(await (await waiting).path(), "utf8"));
    };
    const before = await exported();
    const ring = before.score.tracks[0].techniques.find((item) => item.type === "letRing");
    assert.ok(ring);
    const label = svg.locator("text").getByText("let ring", { exact: true });
    await label.click();
    await page.keyboard.press("Backspace");
    await label.waitFor({ state: "detached" });
    const after = await exported();
    assert.deepEqual(after.score.tracks[0].measures, before.score.tracks[0].measures);
    assert.deepEqual(after.score.tracks[0].techniques, before.score.tracks[0].techniques.filter((item) => item.id !== ring.id));
    expectAligned(await boundaries(svg));
    await page.screenshot({ path: path.join(output, "aligned-after-delete.png"), fullPage: true });
    await page.getByRole("toolbar").getByRole("button", { name: "撤销", exact: true }).click();
    await label.waitFor();
    assert.deepEqual((await exported()).score, before.score);
    expectAligned(await boundaries(svg));
    record("real selection/delete/export/undo preserves notes and alignment");

    await page.getByRole("button", { name: "导出 A4 图片" }).click();
    await page.getByRole("button", { name: "生成全部图片", exact: true }).click();
    const link = page.getByRole("link", { name: "下载图片", exact: true });
    await link.waitFor({ timeout: 20000 });
    const waiting = page.waitForEvent("download");
    await link.click();
    const download = await waiting;
    await download.saveAs(path.join(output, "presentation.png"));
    const bytes = await fs.readFile(await download.path());
    assert.equal(bytes.readUInt32BE(16), 2480);
    assert.equal(bytes.readUInt32BE(20), 3508);
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    record("presentation PNG downloads at 2480×3508");

    await page.locator('[data-score-print-layer][data-print-ready="true"]').waitFor({ state: "attached" });
    await page.emulateMedia({ media: "print" });
    const print = page.locator("[data-score-print-layer]");
    assert.ok(await print.isVisible());
    const printRows = await boundaries(print, "svg > g[transform]");
    expectAligned(printRows);
    await page.pdf({ path: path.join(output, "native-print.pdf"), preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: "screen" });
    record("presentation print systems align and native PDF generated", { rows: printRows });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "validation.json"), JSON.stringify({ results, errors }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
