import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const fixture = JSON.parse(await readFile(new URL("../../../packages/lxm-editor/example/default-score.lxm.json", import.meta.url), "utf8"));
const track = fixture.score.tracks[0];
const [strum, arpeggio] = ["bug084-strum", "bug084-arpeggio"];
track.techniques = [
  { id: strum, type: "strum", beatId: track.measures[0].beats[0].id, stroke: "down", minString: 1, maxString: 4 },
  { id: arpeggio, type: "arpeggio", beatId: track.measures[1].beats[0].id, direction: "descending", minString: 2, maxString: 6 },
  { id: "bug084-unselected", type: "strum", beatId: track.measures[1].beats[3].id, stroke: "up", minString: 2, maxString: 5 },
];

try {
  await page.goto(process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor");
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const snapshot = (load) => score.evaluate((svg, data) => {
    const key = Object.keys(svg).find((name) => name.startsWith("__reactFiber$"));
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const state = fiber.memoizedProps?.session?.getState();
      if (!state?.document) continue;
      if (data) return state.replaceDocument(JSON.stringify(data), "file");
      return { document: state.document, active: state.selectedTechniqueId, ids: state.selectedTraversalIds, history: state.historyDepth };
    }
    return null;
  }, load);
  await score.waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    const key = svg && Object.keys(svg).find((name) => name.startsWith("__reactFiber$"));
    for (let fiber = key && svg[key]; fiber; fiber = fiber.return) {
      if (fiber.memoizedProps?.session?.getState()?.document) return true;
    }
    return false;
  });
  const loaded = await snapshot(fixture);
  assert.equal(loaded?.ok, true, loaded?.errors?.join("\n"));

  const inspector = page.getByRole("region", { name: "扫弦与琶音范围", exact: true });
  const fields = {
    minString: inspector.getByRole("combobox", { name: "上端弦" }),
    maxString: inspector.getByRole("combobox", { name: "下端弦" }),
  };
  const history = page.getByRole("group", { name: "历史", exact: true });
  const undo = () => history.getByRole("button", { name: "撤销", exact: true }).click();
  const redo = () => history.getByRole("button", { name: "重做", exact: true }).click();
  const hit = (id) => score.locator(`polygon[data-strum-id="${id}"][data-strum-hit="arrow"]`);
  const handle = (id, endpoint) => score.locator(`[data-strum-handle="${endpoint}"][data-strum-id="${id}"]`);
  const ink = (id) => score.locator(`:is(path, polygon)[data-strum-id="${id}"]:not([data-strum-hit])`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("d") ?? node.getAttribute("points")));
  const directions = () => Promise.all([strum, arpeggio].map((id) =>
    score.locator(`polygon[data-strum-id="${id}"]:not([data-strum-hit])`).evaluate((arrow) => {
      // 直线 marker 的中点是箭尖，琶音独立三角形的第一个点是箭尖。
      const [tip, base] = arrow.dataset.strumType === "strum" ? [1, 0] : [0, 1];
      return Math.sign(arrow.points[base].y - arrow.points[tip].y);
    })));
  const center = async (locator) => {
    const box = await locator.boundingBox();
    assert.ok(box, "选中的记号应有可拖动的谱面手柄");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  for (const [first, second, endpoint, requested, snapped, sideTarget] of [
    [strum, arpeggio, "minString", 6, 3, 2],
    [arpeggio, strum, "maxString", 1, 3, 5],
  ]) {
    await hit(first).click();
    await hit(second).click({ modifiers: ["Alt"] });
    await inspector.waitFor();
    const before = await snapshot();
    assert.deepEqual(before.ids, [strum, arpeggio]);
    assert.equal(before.active, first);
    assert.equal(await inspector.getByRole("combobox").count(), 2);
    assert.equal(await fields[endpoint].inputValue(), "");
    assert.ok(await fields[endpoint].locator(`option[value="${requested}"]`).isDisabled());
    const initialInk = await Promise.all(track.techniques.map(({ id }) => ink(id)));
    const initialDirections = await directions();
    assert.ok(initialDirections[0] * initialDirections[1] < 0);

    // 每次都从第二个点选的记号起拖，也就是当前非活动手柄。按其原有上下端换算当前缩放下的弦距。
    const beginDrag = async () => {
      const { minString, maxString } = track.techniques.find(({ id }) => id === second);
      const top = await center(handle(second, "minString"));
      const bottom = await center(handle(second, "maxString"));
      const start = endpoint === "minString" ? top : bottom;
      const target = top.y + (bottom.y - top.y) * (requested - minString) / (maxString - minString);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, target, { steps: 8 });
      for (const id of [strum, arpeggio]) {
        await score.locator(`[data-strum-handle="${endpoint}"][data-strum-id="${id}"][data-strum-string="${snapped}"]`).waitFor();
      }
      assert.equal(await score.locator("[data-strum-snap-line]").count(), 2);
      assert.equal(await fields[endpoint].inputValue(), String(snapped));
      assert.ok(await fields[endpoint].isDisabled());
      const previewInk = await Promise.all(track.techniques.map(({ id }) => ink(id)));
      assert.notDeepEqual(previewInk[0], initialInk[0]);
      assert.notDeepEqual(previewInk[1], initialInk[1]);
      assert.deepEqual(previewInk[2], initialInk[2]);
      assert.deepEqual(await directions(), initialDirections);
      assert.deepEqual(await snapshot(), before);
    };

    await beginDrag();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await score.locator("[data-strum-snap-line]").count(), 0);
    assert.deepEqual(await Promise.all(track.techniques.map(({ id }) => ink(id))), initialInk);
    assert.deepEqual(await snapshot(), before);

    const expectEdit = async (target) => {
      const expected = structuredClone(before.document);
      expected.documentRevision++;
      for (const technique of expected.score.tracks[0].techniques) {
        if (before.ids.includes(technique.id)) technique[endpoint] = target;
      }
      const after = await snapshot();
      assert.deepEqual(after.document, expected);
      assert.equal(after.history.past, before.history.past + 1);
      assert.deepEqual(after.ids, before.ids);
      await undo();
      assert.deepEqual((await snapshot()).document, before.document);
      await redo();
      assert.deepEqual((await snapshot()).document, expected);
      await undo();
      assert.deepEqual((await snapshot()).document, before.document);
    };

    await beginDrag();
    await page.mouse.up();
    await expectEdit(snapped);

    await fields[endpoint].selectOption(String(sideTarget));
    await expectEdit(sideTarget);

    // 聚焦非活动手柄后，方向键依旧按谱面上下方向调整整组。
    await handle(second, endpoint).press(endpoint === "minString" ? "ArrowDown" : "ArrowUp");
    await expectEdit(snapped);
  }

  assert.deepEqual(errors, []);
  console.log("BUG-084 Chrome verification passed for both mixed selection orders, non-active handles, sidebar, Escape, undo and redo.");
} finally {
  await browser.close();
}
