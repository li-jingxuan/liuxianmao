/* 真实应用回归：通过文件导入、谱面指针与可访问按钮操作，不注入 store。 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const output = path.resolve(
    process.env.EDITOR_ARTIFACTS || "artifacts/toolbar-history",
  );
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];
  const results = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const record = (name, detail = {}) => {
    results.push({ name, ...detail });
    console.log(`PASS ${name}`);
  };
  try {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:3012", {
      waitUntil: "domcontentloaded",
    });
    const svg = page.getByRole("application", { name: "六线谱编辑器" });
    await svg.waitFor();
    const root = page.locator("[data-layout]").first();
    const toolbar = page.getByRole("toolbar");
    const history = page.locator("#editor-history-panel");
    const sidebar = page.locator("#music-text-sidebar");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(output, "default-1440.png") });
    await page.setViewportSize({ width: 375, height: 650 });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(output, "default-375.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(120);
    const source = JSON.parse(
      await fs.readFile(
        path.join(
          __dirname,
          "../packages/lxm-editor/example/technique-rhythm-score.json",
        ),
        "utf8",
      ),
    );
    const fixture = structuredClone(source);
    fixture.score.title = "工具栏历史功能回归";
    const track = fixture.score.tracks[0];
    track.techniques = [];
    track.numberedMarks = [];
    track.measures = [track.measures[0]];
    const measure = track.measures[0];
    measure.lyrics = [];
    measure.beats = [3, 5, 2, 4].map((fret, index) => ({
      id: `toolbar-beat-${index}`,
      tick: index * 960,
      rhythm: { base: "quarter", dots: 0 },
      kind: "notes",
      notes: [1, 2].map((string) => ({
        id: `toolbar-note-${index}-${string}`,
        string,
        fret: fret + (string - 1) * 2,
      })),
    }));
    const importFixture = async () => {
      await page.locator('input[type="file"]').setInputFiles({
        name: "toolbar-history.lxm",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
      await page
        .getByRole("button", { name: "导入并替换", exact: true })
        .click();
      await page
        .getByText("工具栏历史功能回归", { exact: true })
        .first()
        .waitFor();
      await page.waitForTimeout(150);
    };
    const exported = async () => {
      const waiting = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
      const download = await waiting;
      return JSON.parse(await fs.readFile(await download.path(), "utf8"));
    };
    await importFixture();
    const points = await svg.evaluate((element) => {
      const group = element.querySelector('[data-system-index="0"]');
      const lines = [...group.querySelectorAll("line")].filter(
        (line) =>
          line.getAttribute("y1") === line.getAttribute("y2") &&
          Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) >
            50,
      );
      const y = Number(lines[0].getAttribute("y1"));
      const texts = [...group.querySelectorAll("text")].filter(
        (text) =>
          Math.abs(Number(text.getAttribute("y")) - y) < 5 &&
          ["3", "5", "2", "4"].includes(text.textContent),
      );
      return {
        xs: texts
          .map((text) => Number(text.getAttribute("x")))
          .sort((a, b) => a - b),
        ys: lines.slice(0, 6).map((line) => Number(line.getAttribute("y1"))),
      };
    });
    assert.equal(points.xs.length, 4, "fixture has four TAB beat targets");
    const screen = (beat = 0, string = 0) =>
      svg.evaluate(
        (element, point) => {
          const result = new DOMPoint(point.x, point.y).matrixTransform(
            element.getScreenCTM(),
          );
          return { x: result.x, y: result.y };
        },
        { x: points.xs[beat], y: points.ys[string] },
      );
    const select = async (
      startBeat = 0,
      startString = 0,
      endBeat = startBeat,
      endString = startString,
    ) => {
      await page.waitForTimeout(100);
      points.ys = await svg.locator('[data-system-index="0"]').evaluate((element) =>
        [...element.querySelectorAll("line")]
          .filter((line) => line.getAttribute("y1") === line.getAttribute("y2") &&
            Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) > 50)
          .slice(0, 6).map((line) => Number(line.getAttribute("y1"))),
      );
      const start = await screen(startBeat, startString),
        end = await screen(endBeat, endString);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      if (startBeat !== endBeat || startString !== endString)
        await page.mouse.move(end.x, end.y, { steps: 4 });
      await page.mouse.up();
    };
    const names = {
      整拍休止: "切换休止",
      下扫: "下扫：从低音弦到高音弦，箭头向上",
      上扫: "上扫：从高音弦到低音弦，箭头向下",
      下琶音: "下琶音：从低音弦到高音弦，箭头向上",
      上琶音: "上琶音：从高音弦到低音弦，箭头向下",
      "H 击弦": "击弦 H",
    };
    const action = (name) =>
      toolbar.getByRole("button", { name: names[name] || name, exact: true });
    const undo = () => action("撤销").click();
    const requireEnabled = async (name) => {
      const button = action(name);
      if (!(await button.isEnabled())) {
        await button.hover();
        const reason = await page.getByRole("tooltip").allTextContents();
        const textTargets = await svg.locator('[data-system-index="0"] text').evaluateAll((elements) => elements.map((element) => ({ text: element.textContent, x: element.getAttribute("x"), y: element.getAttribute("y") })));
        throw new Error(`${name} disabled: ${reason.join("; ")}; targets=${JSON.stringify(points)}; texts=${JSON.stringify(textTargets)}`);
      }
    };

    await select();
    const rest = action("整拍休止");
    const restGlyph = await rest.locator("svg text").evaluate(async (element) => {
      const style = getComputedStyle(element);
      await document.fonts.load(`${style.fontSize} Bravura`, "\uE4E5");
      const box = element.getBBox();
      return {
        glyph: element.textContent,
        fontFamily: style.fontFamily,
        fontLoaded: document.fonts.check(`${style.fontSize} Bravura`, "\uE4E5") &&
          [...document.fonts].some((font) => font.family.replace(/["']/g, "") === "Bravura" && font.status === "loaded"),
        bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    });
    assert.equal(restGlyph.glyph, "\uE4E5");
    assert.match(restGlyph.fontFamily, /^Bravura(?:,|$)/);
    assert.equal(restGlyph.fontLoaded, true);
    assert.ok(restGlyph.bbox.width > 0 && restGlyph.bbox.height > 0);
    assert.ok(Object.values(restGlyph.bbox).every(Number.isFinite));
    record("休止使用已加载Bravura字体与E4E5真实SVG字形", restGlyph);
    await rest.hover();
    const restTip = page.getByRole("tooltip").filter({ hasText: "休止影响整拍全部弦" });
    await restTip.waitFor();
    assert.equal(await rest.getAttribute("aria-describedby"), await restTip.getAttribute("id"));
    await rest.focus();
    await page.keyboard.press("Escape");
    await restTip.waitFor({ state: "hidden" });
    assert.equal(await rest.evaluate((element) => document.activeElement === element), true);
    record("符号Tooltip关联、破坏性说明、Escape关闭且保留焦点");
    await rest.click();
    let document = await exported();
    assert.equal(document.score.tracks[0].measures[0].beats[0].kind, "rest");
    assert.equal(document.score.tracks[0].measures[0].beats[0].notes.length, 0);
    assert.equal(await rest.getAttribute("aria-pressed"), "true");
    await rest.click();
    document = await exported();
    assert.equal(document.score.tracks[0].measures[0].beats[0].kind, "notes");
    assert.equal(document.score.tracks[0].measures[0].beats[0].notes.length, 0);
    await undo();
    await undo();
    document = await exported();
    assert.equal(document.score.tracks[0].measures[0].beats[0].notes.length, 2);
    record("休止整拍清音、取消为空拍、撤销恢复音符");

    await select(0, 0, 0, 1);
    await action("下扫").click();
    document = await exported();
    const strum = document.score.tracks[0].techniques[0];
    assert.equal(strum.stroke, "down");
    assert.deepEqual([strum.minString, strum.maxString], [1, 2]);
    await action("上扫").click();
    document = await exported();
    assert.equal(document.score.tracks[0].techniques.length, 1);
    assert.equal(document.score.tracks[0].techniques[0].id, strum.id);
    assert.equal(document.score.tracks[0].techniques[0].stroke, "up");
    assert.equal(await action("上扫").getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "操作历史", exact: true }).click();
    const count = await history.locator("[data-entry-id]").count();
    await action("上扫").click();
    assert.equal(await history.locator("[data-entry-id]").count(), count);
    await undo();
    assert.equal(await history.getByText("已撤销", { exact: true }).count(), 1);
    await page.screenshot({ path: path.join(output, "history-1440.png") });
    await page.getByRole("button", { name: "关闭操作历史" }).click();
    record("上下扫原子替换保留ID、重复no-op、已撤销历史");

    await select(2, 0);
    await requireEnabled("H 击弦");
    await action("H 击弦").click();
    document = await exported();
    assert.ok(
      document.score.tracks[0].techniques.some(
        (technique) =>
          technique.type === "hammerOn" &&
          technique.fromNoteId === "toolbar-note-2-1" &&
          technique.toNoteId === "toolbar-note-3-1",
      ),
    );
    assert.equal(
      await action("重做").isEnabled(),
      false,
      "branch truncates future",
    );
    record("H同弦下一音直接添加、分叉清future");

    await select(1, 0, 1, 1);
    await requireEnabled("下琶音");
    await action("下琶音").click();
    document = await exported();
    const arpeggio = document.score.tracks[0].techniques.find(
      (technique) => technique.type === "arpeggio",
    );
    assert.ok(arpeggio, "down arpeggio shortcut directly adds a technique");
    assert.equal(arpeggio.direction, "ascending");
    assert.deepEqual([arpeggio.minString, arpeggio.maxString], [1, 2]);
    assert.equal(await action("下琶音").getAttribute("aria-pressed"), "true");
    await action("上琶音").click();
    document = await exported();
    const arpeggios = document.score.tracks[0].techniques.filter(
      (technique) => technique.type === "arpeggio",
    );
    assert.equal(arpeggios.length, 1);
    assert.equal(arpeggios[0].id, arpeggio.id);
    assert.equal(arpeggios[0].direction, "descending");
    assert.equal(await action("上琶音").getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "操作历史", exact: true }).click();
    const arpeggioHistoryCount = await history.locator("[data-entry-id]").count();
    await action("上琶音").click();
    assert.equal(await history.locator("[data-entry-id]").count(), arpeggioHistoryCount);
    assert.deepEqual(await exported(), document, "repeated arpeggio shortcut leaves export unchanged");
    await undo();
    document = await exported();
    assert.equal(document.score.tracks[0].techniques.find((technique) => technique.id === arpeggio.id).direction, "ascending");
    await undo();
    document = await exported();
    assert.equal(document.score.tracks[0].techniques.some((technique) => technique.id === arpeggio.id), false);
    await page.getByRole("button", { name: "关闭操作历史" }).click();
    record("上下琶音直接添加、原子替换保留ID、重复no-op与两步撤销");

    await svg.locator("[data-numbered-event]").first().click();
    assert.equal(await rest.isEnabled(), false);
    assert.equal(await action("下扫").isEnabled(), false);
    assert.equal(await action("下琶音").isEnabled(), false);
    assert.equal(await action("上琶音").isEnabled(), false);
    record("简谱焦点禁用旧TAB快捷目标");
    await page.keyboard.press("Escape");

    for (const width of [
      1920, 1600, 1599, 1440, 1280, 1200, 1199, 1024, 960, 959, 768, 375,
    ]) {
      await page.setViewportSize({ width, height: 650 });
      await page.waitForTimeout(100);
      const metrics = await root.evaluate((element) => ({
        width: element.clientWidth,
        mode: element.dataset.layout,
        scroll: document.documentElement.scrollWidth,
        viewport: innerWidth,
        scale: Number(
          element.querySelector("[data-score-scale]").dataset.scoreScale,
        ),
      }));
      assert.ok(
        metrics.scroll <= width + 1,
        `outer overflow at ${width}: ${metrics.scroll}`,
      );
      assert.equal(
        metrics.mode,
        width >= 1600
          ? "wide"
          : width >= 1200
            ? "desktop"
            : width >= 960
              ? "compact"
              : "narrow",
      );
      assert.ok(metrics.scale > 0 && metrics.scale <= 1);
      assert.equal(await page.getByRole("button", { name: "100%", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "适合宽度", exact: true }).count(), 0);
      const restBox = await action("整拍休止").boundingBox();
      const rhythmBox = await action("设置为四分音符").boundingBox();
      if (width < 960) {
        assert.ok(
          restBox.y >= rhythmBox.y + rhythmBox.height,
          "narrow toolbar has two independent rows",
        );
        assert.ok(
          restBox.x >= 0 && restBox.x + restBox.width <= width,
          "rest reachable at row start",
        );
        assert.ok(await action("更多工具").isVisible());
      } else
        assert.ok(
          Math.abs(restBox.y - rhythmBox.y) < 4,
          "desktop toolbar stays on one row",
        );
      const historyToggle = page.getByRole("button", {
        name: "操作历史",
        exact: true,
      });
      if ((await historyToggle.getAttribute("aria-expanded")) !== "true")
        await historyToggle.click();
      assert.equal(await history.isVisible(), true);
      if (width < 1200) {
        assert.equal(await sidebar.isVisible(), false);
        assert.equal(await history.getAttribute("aria-modal"), "true");
      }
      const panelBox = await history.boundingBox();
      assert.ok(panelBox.x >= 39 && panelBox.x + panelBox.width <= width + 1);
      if ([1920, 1440, 1024, 768, 375].includes(width))
        await page.screenshot({
          path: path.join(output, `layout-${width}.png`),
        });
      await page.keyboard.press("Escape");
      if (width >= 1200 && (await history.isVisible()))
        await page.getByRole("button", { name: "关闭操作历史" }).click();
      assert.equal(await history.isVisible(), false);
      if (width < 1200)
        assert.equal(
          await historyToggle.evaluate(
            (element) => element === document.activeElement,
          ),
          true,
        );
      record(`宿主 ${width}×650 布局/历史/焦点`, metrics);
    }
    await page.setViewportSize({ width: 1920, height: 900 });
    await root.evaluate((element) => (element.style.width = "768px"));
    await page.waitForTimeout(100);
    assert.equal(await root.getAttribute("data-layout"), "narrow");
    await root.evaluate((element) => element.style.removeProperty("width"));
    record("1920 viewport中768px宿主按容器断点");

    await page.waitForTimeout(100);
    const wideScale = Number(await page.locator("[data-score-scale]").getAttribute("data-score-scale"));
    assert.equal(wideScale, 1, "wide viewport fits the page at its native size");
    const baseWidthAt1920 = await page
      .getByRole("main", { name: "A4 乐谱页面" })
      .evaluate((element) => element.offsetWidth);
    await page.setViewportSize({ width: 375, height: 650 });
    await page.waitForTimeout(100);
    const narrowScale = Number(await page.locator("[data-score-scale]").getAttribute("data-score-scale"));
    assert.ok(narrowScale > 0 && narrowScale < wideScale, "narrow viewport automatically fits the page");
    const narrowPaper = await page
      .getByRole("main", { name: "A4 乐谱页面" })
      .evaluate((element) => ({ baseWidth: element.offsetWidth, renderedWidth: element.getBoundingClientRect().width }));
    assert.equal(baseWidthAt1920, 780);
    assert.equal(narrowPaper.baseWidth, baseWidthAt1920);
    assert.ok(Math.abs(narrowPaper.renderedWidth - baseWidthAt1920 * narrowScale) < 1);
    assert.ok(narrowPaper.renderedWidth < 375, "scaled page fits the narrow viewport");
    record("无fit/100%控件、固定780基准宽度随宿主自动适配", { wideScale, narrowScale, ...narrowPaper });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "导出 A4 图片" }).click();
    await page
      .getByRole("button", { name: "生成全部图片", exact: true })
      .click();
    const downloadLink = page.getByRole("link", {
      name: "下载图片",
      exact: true,
    });
    await downloadLink.waitFor({ timeout: 20000 });
    const waitingPNG = page.waitForEvent("download");
    await downloadLink.click();
    const png = await waitingPNG;
    await png.saveAs(path.join(output, "presentation.png"));
    const bytes = await fs.readFile(await png.path());
    assert.equal(bytes.readUInt32BE(16), 2480);
    assert.equal(bytes.readUInt32BE(20), 3508);
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    record("PNG实际生成固定A4像素2480×3508");

    await page.getByRole("button", { name: "操作历史", exact: true }).click();
    await action("整拍休止").hover();
    await page.emulateMedia({ media: "print" });
    assert.equal(await toolbar.isVisible(), false);
    assert.equal(await history.isVisible(), false);
    assert.equal(
      await page.locator(".ant-tooltip").filter({ visible: true }).count(),
      0,
    );
    assert.ok(await page.locator("[data-score-print-layer]").isVisible());
    await page.pdf({
      path: path.join(output, "native-print.pdf"),
      preferCSSPageSize: true,
      printBackground: true,
    });
    await page.emulateMedia({ media: "screen" });
    record("原生打印媒体隔离工作区与portal并生成PDF");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "validation.json"),
      JSON.stringify(
        { browser: await browser.version(), results, errors },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
