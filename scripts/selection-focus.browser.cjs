/* 中文说明：真实页面通过点击图元和弦格验证选区，不直接修改 React/store 状态。 */
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://localhost:3000", {
      waitUntil: "domcontentloaded",
    });
    const svg = page.getByRole("application", { name: "六线谱编辑器" });
    await svg.waitFor();
    const sidebar = page.locator("#music-text-sidebar");
    const status = page.getByRole("status").filter({ hasText: "当前位置" });
    const cell = async (string = 0, offset = 0) =>
      svg.evaluate(
        (svg, { string, offset }) => {
          const group = svg.querySelector('[data-system-index="0"]');
          const texts = [...group.querySelectorAll("text")];
          const text =
            texts.find((t) => t.textContent === "试") ??
            texts.find((t) => t.textContent === "轻");
          const lines = [...group.querySelectorAll("line")].filter(
            (l) =>
              l.getAttribute("y1") === l.getAttribute("y2") &&
              Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")) > 200,
          );
          return {
            x: Number(text.getAttribute("x")) + offset,
            y: Number(lines[string].getAttribute("y1")),
          };
        },
        { string, offset },
      );
    const pointOfText = async (value, index = 0) =>
      svg.evaluate(
        (svg, { value, index }) => {
          const text = [
            ...svg.querySelectorAll('[data-system-index="0"] text'),
          ].filter((t) => t.textContent === value)[index];
          return {
            x: Number(text.getAttribute("x")),
            y: Number(text.getAttribute("y")) - 5,
          };
        },
        { value, index },
      );
    const screenPoint = (point) =>
      svg.evaluate((svg, point) => {
        const p = new DOMPoint(point.x, point.y).matrixTransform(
          svg.getScreenCTM(),
        );
        return { x: p.x, y: p.y };
      }, point);
    const click = async (point, modifiers = []) => {
      for (const key of modifiers) await page.keyboard.down(key);
      const screen = await screenPoint(point);
      await page.mouse.click(screen.x, screen.y);
      for (const key of modifiers) await page.keyboard.up(key);
    };
    const beatActive = async () => {
      await page.waitForTimeout(80);
      assert.equal(
        await svg.locator("[data-paragraph-focus]").count(),
        0,
        "点击 beat 应退出文字高亮，不被 TAB 接管",
      );
      const focused = await svg.evaluate((s) => document.activeElement === s);
      assert.equal(focused, true, "beat 应恢复 SVG 键盘焦点");
      assert.equal(
        await page
          .getByRole("button", { name: "设置为闷音音符 x" })
          .isEnabled(),
        true,
      );
    };
    const lyric = async () => click(await pointOfText("轻"));
    const numbered = async () => click(await pointOfText("1"));
    const confirm = page.getByRole("alertdialog");

    // 和弦也遵循同一对象切换契约，页签不再吞掉六线谱选择。
    await click(await pointOfText("C"));
    await page.getByLabel("和弦名称").fill("Dm");
    await click(await cell());
    await confirm.getByRole("button", { name: "继续编辑" }).click();
    assert.equal(await page.getByLabel("和弦名称").inputValue(), "Dm");
    await click(await cell());
    await confirm.getByRole("button", { name: "放弃并切换" }).click();
    await beatActive();
    console.log("PASS: 和弦 → beat，草稿保护一致");

    // 原始反馈环：同拍从歌词回到 beat，并实际修改品位。
    await lyric();
    assert.equal(
      await svg.locator('[data-paragraph-focus="lyric"]').count(),
      1,
    );
    await click(await cell());
    await beatActive();
    assert.equal(
      await sidebar
        .getByRole("tab", { name: "歌词", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    const sevenBefore = await svg
      .locator('[data-system-index="0"] text')
      .filter({ hasText: /^7$/ })
      .count();
    await page.keyboard.press("7");
    await page.waitForTimeout(80);
    assert.equal(
      await svg
        .locator('[data-system-index="0"] text')
        .filter({ hasText: /^7$/ })
        .count(),
      sevenBefore + 1,
      "数字键写入选中弦格",
    );
    console.log("PASS: 歌词 → 同拍 beat → 品位输入（页签保留）");

    // 页签浏览不激活文字；简谱输入才明确设置起点。
    await sidebar.getByRole("tab", { name: "简谱", exact: true }).click();
    assert.equal(await svg.locator("[data-paragraph-focus]").count(), 0);
    assert.equal(
      await page
        .getByLabel("连续简谱")
        .evaluate((e) => document.activeElement === e),
      false,
    );
    await sidebar
      .getByRole("button", { name: "从当前拍开始", exact: true })
      .click();
    assert.equal(
      await svg.locator('[data-paragraph-focus="numbered"]').count(),
      1,
    );
    assert.equal(
      await page
        .getByLabel("连续简谱")
        .evaluate((e) => document.activeElement === e),
      true,
    );
    await click(await cell());
    await beatActive();
    await page.waitForTimeout(100);
    assert.equal(
      await svg.locator("[data-paragraph-focus]").count(),
      0,
      "简谱 effect 不得重新夺回对象",
    );
    console.log("PASS: 简谱 TAB 浏览／明确起点／同拍回 beat");

    await numbered();
    await page.getByLabel("连续简谱").fill("2 3");
    const originalPosition = await status.innerText();
    await click(await cell(2, 60));
    await confirm.waitFor();
    assert.equal(
      await status.innerText(),
      originalPosition,
      "dirty 时不得先改选区、重挂载草稿",
    );
    assert.equal(await page.getByLabel("连续简谱").inputValue(), "2 3");
    await confirm.getByRole("button", { name: "继续编辑" }).click();
    assert.equal(await page.getByLabel("连续简谱").inputValue(), "2 3");
    assert.equal(
      await page
        .getByLabel("连续简谱")
        .evaluate((e) => document.activeElement === e),
      true,
    );
    await click(await cell(2, 60));
    await confirm.getByRole("button", { name: "放弃并切换" }).click();
    await beatActive();
    console.log("PASS: 简谱 dirty 继续／放弃，选区和草稿原子切换");

    await lyric();
    await page.getByLabel("连续歌词").fill("试 唱");
    await click(await cell(1, 60));
    await confirm.getByRole("button", { name: "应用并切换" }).click();
    await beatActive();
    assert.equal(
      await svg
        .locator('[data-system-index="0"] text')
        .filter({ hasText: /^试$/ })
        .count(),
      1,
    );
    console.log("PASS: 歌词应用到原目标后切换 beat");

    await numbered();
    await page.getByLabel("连续简谱").fill("2 3");
    await page.getByRole("checkbox", { name: /允许替换已有简谱/ }).check();
    await click(await cell(2, 60));
    await confirm.getByRole("button", { name: "应用并切换" }).click();
    await beatActive();
    console.log("PASS: 简谱应用并切换");

    // 非法草稿不可应用；Esc 先取消确认，再请求返回 beat，不能丢输入。
    await click(await pointOfText("试"));
    await page.getByLabel("连续歌词").fill("\n");
    await page.getByLabel("连续歌词").press("Escape");
    await confirm.waitFor();
    assert.equal(
      await confirm.getByRole("button", { name: "应用并切换" }).isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByLabel("连续歌词").inputValue(), "\n");
    await page.getByLabel("连续歌词").press("Escape");
    await confirm.getByRole("button", { name: "放弃并切换" }).click();
    await beatActive();
    console.log("PASS: 非法草稿、确认 Esc 与返回 beat");

    // 指针拖选和 Shift 扩选走原矩形选择。
    const start = await screenPoint(await cell());
    const end = await screenPoint(await cell(3, 60));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    assert.match(
      await page.locator("body").innerText(),
      /已选择 (?:[2-9]|[1-9]\d+) 格/,
    );
    await click(await cell(5, 100), ["Shift"]);
    assert.match(await page.locator("body").innerText(), /已选择 [1-9]\d* 格/);
    await page.keyboard.press("ArrowRight");
    await beatActive();
    console.log("PASS: 拖选／Shift 扩选／方向键");

    // 设置表单也共用同拍选区保护，不能因为 measureId 相同绕过确认。
    await sidebar.getByRole("tab", { name: "谱面设置", exact: true }).click();
    const title = page.getByLabel("歌曲名称");
    const titleBefore = await title.inputValue();
    await title.fill("尚未应用的标题");
    await click(await cell());
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "放弃并切换" }).click();
    await beatActive();
    assert.equal(await title.inputValue(), titleBefore);
    // 从普通 beat 直接聚焦简谱框不会因“激活目标”重挂载而丢掉首次输入。
    await sidebar.getByRole("tab", { name: "段落编辑", exact: true }).click();
    await sidebar.getByRole("tab", { name: "简谱", exact: true }).click();
    await page.getByLabel("连续简谱").fill("9");
    assert.equal(await page.getByLabel("连续简谱").inputValue(), "9");
    assert.equal(
      await svg.locator('[data-paragraph-focus="numbered"]').count(),
      1,
    );
    await click(await cell());
    await confirm.getByRole("button", { name: "放弃并切换" }).click();
    await beatActive();
    console.log("PASS: 直接聚焦简谱输入不丢首字符");
    // 未提交的两位品位前缀，在转入文字时取消计时器，不允许晚到修改。
    await click(await cell());
    const noteCountBefore = await svg
      .locator('[data-system-index="0"] text')
      .filter({ hasText: /^1$/ })
      .count();
    await page.keyboard.press("1");
    await click(await pointOfText("试"));
    await page.waitForTimeout(750);
    assert.equal(
      await svg
        .locator('[data-system-index="0"] text')
        .filter({ hasText: /^1$/ })
        .count(),
      noteCountBefore,
    );
    await page
      .getByLabel("连续歌词")
      .dispatchEvent("compositionstart", { data: "测" });
    await click(await cell());
    assert.equal(
      await svg.locator('[data-paragraph-focus="lyric"]').count(),
      1,
      "组合输入期间不接受对象切换",
    );
    assert.equal(await confirm.count(), 0);
    await page
      .getByLabel("连续歌词")
      .dispatchEvent("compositionend", { data: "测" });
    await page.waitForTimeout(60);
    await click(await cell());
    await beatActive();
    console.log("PASS: 延迟品位取消、组合输入对象切换守卫");
    // 简谱单拍模式被动跟随当前选拍；点击输入时不丢首次字符。
    await sidebar.getByRole("tab", { name: "简谱", exact: true }).click();
    await page.getByLabel("简谱录入方式").selectOption("single");
    assert.equal(await svg.locator("[data-paragraph-focus]").count(), 0);
    await page.getByLabel("单拍简谱").fill("6");
    assert.equal(await page.getByLabel("单拍简谱").inputValue(), "6");
    await page.getByLabel("单拍简谱").press("Escape");
    await confirm.getByRole("button", { name: "放弃并切换" }).click();
    await beatActive();
    await click(await cell(0, 60));
    await sidebar.getByRole("tab", { name: "谱面设置", exact: true }).click();
    await title.fill("继续编辑保留输入焦点");
    await click(await cell());
    await confirm.getByRole("button", { name: "继续编辑" }).click();
    assert.equal(
      await title.evaluate((e) => document.activeElement === e),
      true,
    );
    await click(await cell());
    await confirm.getByRole("button", { name: "放弃并切换" }).click();
    await beatActive();
    console.log("PASS: 简谱单拍输入、设置继续编辑焦点恢复");
    assert.deepEqual(errors, [], "无页面 React／运行时异常");
    await page.screenshot({
      path: "artifacts/selection-focus/beat-selection.png",
      fullPage: true,
    });
    console.log("PASS: 设置草稿保护；无页面异常");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
