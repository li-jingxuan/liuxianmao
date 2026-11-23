import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(runtime.startsWith("/") ? pathToFileURL(runtime).href : runtime);
const browser = await chromium.launch({ headless: true, channel: process.env.LXM_BROWSER_CHANNEL });

const rhythm = { base: "quarter", dots: 0 };
const measure = (id, notes) => ({
  id, timeSignature: { numerator: 4, denominator: 4 }, barline: "single",
  tuplets: [], chordSymbols: [],
  beats: Array.from({ length: 4 }, (_, index) => ({
    id: `${id}-b${index}`, tick: index * 960, kind: "notes", rhythm,
    notes: [{ id: `${id}-tab${index}`, string: 1, fret: index }],
  })),
  numberedVoice: { tuplets: [], events: notes.map(([tick, token]) => ({
    id: `${id}-n${tick}`, tick, kind: "notes", rhythm,
    items: [{ id: `${id}-item${tick}`, token }],
  })) },
  lyrics: notes.map(([tick, , text]) => ({ id: `${id}-l${tick}`, eventId: `${id}-n${tick}`, verse: 1, text })),
});
const fixture = {
  schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
  score: {
    id: "req058-score", title: "左右导航", arranger: "", keySignature: "C", meta: {},
    tracks: [{
      id: "track", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
      tuning: { strings: ["E4", "B3", "G3", "D3", "A2", "E2"].map((pitch, index) => ({
        index: index + 1, pitch, midi: [64, 59, 55, 50, 45, 40][index],
      })) },
      techniques: [], numberedMarks: [],
      measures: [measure("left", [[2880, "1", "的"]]), measure("right", [[0, "2", "美"], [960, "3", "梦"]])],
    }],
  },
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  await page.goto(process.env.REQ_NEXT_URL ?? "http://localhost:3031/editor", { waitUntil: "domcontentloaded", timeout: 30000 });
  const score = page.locator('svg[aria-label="六线谱编辑器"]');
  await score.waitFor();
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    return svg && Object.keys(svg).some(key => key.startsWith("__reactFiber$"));
  });
  const imported = await score.evaluate((svg, fixture) => {
    const key = Object.keys(svg).find(key => key.startsWith("__reactFiber$"));
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const session = fiber.memoizedProps?.session;
      if (session?.getState().document) return session.getState().replaceDocument(JSON.stringify(fixture), "file");
    }
    throw new Error("Editor session unavailable");
  }, fixture);
  assert.equal(imported.ok, true, JSON.stringify(imported.errors));

  const popover = page.locator("#music-text-edit-popover");
  const lyric = popover.getByRole("textbox", { name: "连续歌词" });
  const numbered = popover.getByRole("textbox", { name: "简谱内容" });
  const waitForInput = async (input, value) => {
    const id = await input.getAttribute("id");
    await page.waitForFunction(({ id, value }) => {
      const active = document.activeElement;
      return (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.id === id && active.value === value;
    }, { id, value }).catch(async error => {
      const active = await page.evaluate(() => document.activeElement?.id);
      throw new Error(`Expected ${id} focused with ${JSON.stringify(value)}. Active: ${active}. Value: ${JSON.stringify(await input.inputValue())}`, { cause: error });
    });
  };

  await score.locator("text").filter({ hasText: /^美$/u }).click();
  assert.equal(await lyric.inputValue(), "美");
  await lyric.evaluate(node => node.setSelectionRange(1, 1));
  await lyric.press("ArrowLeft");
  assert.equal(await lyric.evaluate(node => node.selectionStart), 0);
  await lyric.press("Alt+ArrowLeft");
  await waitForInput(lyric, "的");
  await lyric.press("Alt+ArrowRight");
  await waitForInput(lyric, "美");
  await lyric.dispatchEvent("keydown", { key: "ArrowRight", altKey: true, isComposing: true });
  await waitForInput(lyric, "美");
  await lyric.fill("新");
  await lyric.press("Alt+ArrowRight");
  const confirm = page.getByRole("dialog", { name: "当前草稿尚未应用" });
  await confirm.waitFor();
  assert.equal(await page.locator("#music-text-sidebar footer").getByText("当前草稿尚未应用").count(), 0);
  const bounds = await confirm.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 3);
  assert.ok(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) < 3);
  await page.waitForFunction(() => document.activeElement?.textContent === "继续编辑");
  await page.keyboard.press("Tab");
  assert.equal(await confirm.getByRole("button", { name: "应用并切换" }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await confirm.getByRole("button", { name: "继续编辑" }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Escape");
  await confirm.waitFor({ state: "hidden" });
  await waitForInput(lyric, "新");
  assert.equal(await lyric.evaluate(node => node === document.activeElement), true);
  await lyric.press("Alt+ArrowRight");
  await confirm.getByRole("button", { name: "应用并切换" }).click();
  await waitForInput(lyric, "梦");
  await lyric.press("Alt+ArrowLeft");
  await waitForInput(lyric, "新");

  await page.locator('text[data-numbered-event="right-n0"]').first().click();
  await waitForInput(numbered, "2");
  await numbered.press("Alt+ArrowLeft");
  await waitForInput(numbered, "1");
  await numbered.press("Alt+ArrowRight");
  await waitForInput(numbered, "2");
  await numbered.press("Alt+ArrowRight");
  await waitForInput(numbered, "3");
  await numbered.press("Alt+ArrowRight");
  await waitForInput(numbered, "");
  await numbered.press("Alt+ArrowLeft");
  await waitForInput(numbered, "3");
  await numbered.fill("4");
  await numbered.press("Alt+ArrowLeft");
  await confirm.getByRole("button", { name: "放弃并切换" }).click();
  await waitForInput(numbered, "2");
  await numbered.press("Alt+ArrowRight");
  await waitForInput(numbered, "3");
  console.log("REQ-058 browser passed: lyric and numbered navigation, cross-bar moves, blank slot, caret, IME and protected drafts.");
} finally {
  await browser.close();
}
