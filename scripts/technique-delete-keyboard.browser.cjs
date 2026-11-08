/* Real score selection and keyboard deletion; snapshots come from native downloads. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const output = path.resolve("artifacts/technique-delete-keyboard");
  await fs.mkdir(output, { recursive: true });
  const results = [], errors = [];
  try {
    for (const key of ["Backspace", "Delete"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3000", { waitUntil: "networkidle" });
      const svg = page.getByRole("application", { name: "六线谱编辑器" });
      const exported = async () => {
        const waiting = page.waitForEvent("download");
        await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
        return JSON.parse(await fs.readFile(await (await waiting).path(), "utf8"));
      };
      const before = await exported();
      const track = before.score.tracks[0];
      const ring = track.techniques.find((item) => item.type === "letRing");
      assert.ok(ring);
      const label = () => svg.locator("text").getByText("let ring", { exact: true });
      await label().click();
      await page.screenshot({ path: path.join(output, `${key}-selected.png`) });
      await page.keyboard.press(key);
      await label().waitFor({ state: "detached" });
      const after = await exported();
      assert.deepEqual(after.score.tracks[0].measures, track.measures, "all notes stay unchanged");
      assert.deepEqual(after.score.tracks[0].techniques, track.techniques.filter((item) => item.id !== ring.id));
      assert.equal(after.documentRevision, before.documentRevision + 1);
      await page.screenshot({ path: path.join(output, `${key}-removed.png`) });
      await page.getByRole("toolbar").getByRole("button", { name: "撤销", exact: true }).click();
      await label().waitFor();
      assert.deepEqual((await exported()).score, before.score, "one undo restores the whole score");
      await page.getByRole("toolbar").getByRole("button", { name: "重做", exact: true }).click();
      await label().waitFor({ state: "detached" });
      assert.deepEqual((await exported()).score, after.score);
      results.push(`${key}: selected let ring only, notes/arpeggio/strum unchanged, undo/redo`);
      console.log(`PASS ${results.at(-1)}`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3000", { waitUntil: "networkidle" });
    const svg = page.getByRole("application", { name: "六线谱编辑器" });
    const beforeDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
    const before = JSON.parse(await fs.readFile(await (await beforeDownload).path(), "utf8"));
    const fret = svg.locator('text').filter({ hasText: /^12$/ }).first();
    await fret.click();
    await page.keyboard.press("Backspace");
    const waiting = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
    const after = JSON.parse(await fs.readFile(await (await waiting).path(), "utf8"));
    const notes = (document) => document.score.tracks.flatMap((track) => track.measures.flatMap((measure) => measure.beats.flatMap((beat) => beat.notes)));
    const removed = notes(before).filter((note) => !notes(after).some((candidate) => candidate.id === note.id));
    assert.equal(notes(after).length, notes(before).length - 1);
    assert.equal(removed.length, 1);
    assert.equal(removed[0].fret, 12);
    assert.ok(after.score.tracks[0].techniques.some((item) => item.type === "letRing"));
    results.push("ordinary fret selection still deletes the note and keeps let ring");
    console.log(`PASS ${results.at(-1)}`);
    await page.close();
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "validation.json"), JSON.stringify({ results, errors }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
