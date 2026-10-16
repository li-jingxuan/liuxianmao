import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime);
const { expect } = require(`${runtime}/test`);
const output = path.resolve("artifacts/ui-phase2-20261017");
const shots = path.resolve(
  "docs/design/04_实施验收/验收截图/20261017_阶段2收尾",
);
await Promise.all([
  mkdir(output, { recursive: true }),
  mkdir(shots, { recursive: true }),
]);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
page.setDefaultTimeout(7000);
const checks: { name: string; details: unknown }[] = [];
const errors: string[] = [];
const consoleIssues: string[] = [];
const ignoredConsoleIssues: string[] = [];
page.on("console", (message) => {
  if (!["error", "warning"].includes(message.type())) return;
  const url = message.location().url;
  const text = `${url}: ${message.text()}`;
  // 现有站点未提供 favicon；只单列这一已定位资源，其他警告/错误均令验收失败。
  if (url.endsWith("/favicon.ico") && message.text().includes("404"))
    ignoredConsoleIssues.push(text);
  else consoleIssues.push(text);
});
page.on("pageerror", (error: Error) => errors.push(error.message));
const url = process.env.EDITOR_URL ?? "http://127.0.0.1:3103/";
const button = (name: string) =>
  page
    .getByRole("button", {
      name: new RegExp(
        Array.from(name)
          .map((c) => ("\\^$.*+?()[]{}|".includes(c) ? "\\" + c : c))
          .join("\\s*") + "$",
      ),
    })
    .first();
const score = () => page.getByRole("application", { name: "六线谱编辑器" });
const note = (fret: number) =>
  score()
    .locator('text[stroke="#fff"]')
    .filter({ hasText: new RegExp(`^${fret}$`) })
    .first();
const undo = () => button("撤销");
const record = (name: string, details: unknown = true) => {
  checks.push({ name, details });
  console.log(`PASS ${name}`);
};
const shot = async (name: string) => {
  // 等待挂载、定位与有限动画结束，避免把菜单的准备帧误存为验收截图。
  await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await page.screenshot({
    path: path.join(shots, `${name}.png`),
    animations: "disabled",
  });
};
const reset = async (fixture = "fixture.lxm.json") => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page
    .getByLabel("选择六线猫曲谱文件")
    .setInputFiles(path.join(output, fixture));
  await button("导入并替换").click();
  await expect(page.getByRole("banner")).toContainText("阶段2固定验收谱");
  await expect(undo()).toBeDisabled();
};
const select = async (fret = 1) => {
  await note(fret).click();
  await expect(button("设置为四分音符")).toBeEnabled();
};
const open = async (group: string) => {
  const more = button("更多工具");
  if (await more.isVisible()) {
    if ((await more.getAttribute("aria-expanded")) !== "true")
      await more.click();
    const popup = page.locator(".ant-popover:visible");
    await popup.evaluate(async (el: HTMLElement) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    const tab = popup.getByRole("tab", { name: group, exact: true });
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  } else {
    const trigger = button(`${group}工具`);
    if ((await trigger.getAttribute("aria-expanded")) !== "true")
      await trigger.click();
  }
};
const choose = async (name: string, label: string) => {
  const control = page.getByRole("combobox", { name, exact: true });
  await control.scrollIntoViewIfNeeded();
  await control.click();
  const listId = await control.getAttribute("aria-controls");
  const dropdown = page
    .locator(".ant-select-dropdown")
    .filter({ has: page.locator(`[id="${listId}"]`) });
  await expect(dropdown).toBeVisible();
  await dropdown.evaluate(async (element: HTMLElement) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => {})),
    );
  });
  const option = dropdown.locator(".ant-select-item-option-content").filter({
    hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  });
  if ((await option.count()) === 0)
    await dropdown
      .locator(".rc-virtual-list-holder")
      .evaluate((el: HTMLElement) => {
        el.scrollTop = el.scrollHeight;
      });
  await option.click();
};
// 所有常规音乐操作均走真实谱面命中、菜单、文件导入/导出，不访问内部 React/store。
const exported = async () => {
  const pending = page.waitForEvent("download");
  await button("导出曲谱").click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
};
const unchanged = async (before: unknown) =>
  assert.deepEqual(await exported(), before);
const popupInside = async () => {
  const rect = await page
    .locator(".ant-popover:visible")
    .evaluate((el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        w: innerWidth,
        h: innerHeight,
      };
    });
  assert(
    rect.x >= -1 &&
      rect.y >= -1 &&
      rect.right <= rect.w + 1 &&
      rect.bottom <= rect.h + 1,
    JSON.stringify(rect),
  );
  return rect;
};
try {
  await reset();
  const baseline = await exported();
  await select();
  await button("音符与休止详情").click();
  await expect(
    page.getByRole("region", { name: "音符与休止详情" }),
  ).toContainText("第 1 小节");
  await shot("03-08_音符与休止详情_1440x900");
  for (const action of [
    "将选中 Beat 设为休止并清空全部弦音符",
    "设置为闷音音符 x",
    "删除所选音符",
  ]) {
    await button(action).click();
    await expect(undo()).toBeEnabled();
    await undo().click();
    await expect(undo()).toBeDisabled();
    await unchanged(baseline);
  }
  await select();
  await button("设置为八分音符").click();
  await button("设置单附点").click();
  await button("设置双附点").click();
  const rhythm = await exported();
  assert.deepEqual(rhythm.score.tracks[0].measures[0].beats[0].rhythm, {
    base: "eighth",
    dots: 2,
  });
  for (let i = 0; i < 3; i++) await undo().click();
  await unchanged(baseline);
  record("音符、休止、闷音、删除与附点经真实入口提交并撤销");

  await select();
  await open("小节");
  await shot("05-09_小节工具菜单_1440x900");
  await button("小节属性…").click();
  await expect(
    page.getByRole("group", { name: "六类小节线" }).getByRole("button"),
  ).toHaveCount(6);
  await shot("05-01_小节属性_1440x900");
  await button("双小节线").click();
  assert.equal(
    (await exported()).score.tracks[0].measures[0].barline,
    "double",
  );
  await undo().click();
  await unchanged(baseline);
  await select(17);
  await open("小节");
  await button("六类小节线…").click();
  await expect(button("开始反复线")).toBeDisabled();
  await expect(button("双向反复线")).toBeDisabled();
  await expect(
    page.getByText("谱尾没有下一小节", { exact: true }),
  ).toBeVisible();
  await shot("05-11_六类边界与谱尾禁用_1440x900");
  record("六类边界、谱尾禁用、边界提交与撤销");

  await select();
  await open("拍点");
  await shot("05-10_拍点结构菜单_1440x900");
  await button("复制所选拍点（全部六弦）").click();
  await expect(page.locator('[data-tool-panel="beat"]')).toContainText("双谱");
  await choose("拍点复制谱层", "仅六线谱");
  await expect(page.locator('[data-tool-panel="beat"]')).toContainText("双谱");
  await button("复制所选拍点（全部六弦）").click();
  await expect(page.locator('[data-tool-panel="beat"]')).toContainText(
    "仅六线谱",
  );
  await choose("拍点复制谱层", "双谱");
  await button("复制所选拍点（全部六弦）").click();
  await page.keyboard.press("Escape");
  await select(3);
  await open("拍点");
  await button("从目标拍覆盖…").click();
  const modal = page.getByRole("dialog").filter({ has: button("应用粘贴") });
  await expect(modal).toContainText("源范围连接未复制");
  await expect(button("应用粘贴")).toBeDisabled();
  await shot("05-02_覆盖预览与源遗漏_1440x900");
  await page.getByRole("checkbox", { name: /我已核对/ }).check();
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("checkbox", { name: /我已核对/ }),
    ).toBeChecked();
  }
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press(i < 8 ? "Tab" : "Shift+Tab");
    assert(
      await modal.evaluate((el: HTMLElement) =>
        el.closest(".ant-modal-wrap")?.contains(document.activeElement),
      ),
      await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute("aria-label"),
      })),
    );
  }
  record("粘贴Modal跨宽窄窗口保留确认，Tab焦点始终受约束");
  await button("取消预览").click();
  await expect(button("拍点工具")).toBeFocused();
  await unchanged(baseline);
  await open("拍点");
  await button("从目标拍覆盖…").click();
  await page.getByRole("checkbox", { name: /我已核对/ }).check();
  await button("应用粘贴").click();
  if (await page.getByRole("checkbox", { name: /我已核对/ }).isVisible()) {
    await expect(
      page.getByRole("checkbox", { name: /我已核对/ }),
    ).not.toBeChecked();
    await shot("05-02_追加简谱记号影响_1440x900");
    await page.getByRole("checkbox", { name: /我已核对/ }).check();
    await button("应用粘贴").click();
  }
  await expect(button("应用粘贴")).toBeHidden();
  await expect(undo()).toBeEnabled();
  await undo().click();
  await expect(undo()).toBeDisabled();
  await unchanged(baseline);
  record("复制实际谱层、源连接遗漏、取消零修改与覆盖影响一次撤销");

  await reset("tuplet-fixture.lxm.json");
  const tupletBaseline = await exported();
  await note(9).click();
  await score().press("Shift+ArrowRight");
  await score().press("Shift+ArrowRight");
  await open("连音");
  await button("连音比例与选区详情…").click();
  await expect(page.getByRole("region", { name: "连音组详情" })).toContainText(
    "当前组：3:2",
  );
  await shot("05-03_连音组详情_1440x900");
  await page
    .getByRole("region", { name: "连音组详情" })
    .getByText("3:2", { exact: true })
    .click();
  await unchanged(tupletBaseline);
  await button("删除当前连音组").click();
  await undo().click();
  await expect(undo()).toBeDisabled();
  await unchanged(tupletBaseline);
  record("完整三连音选区、候选选择零提交及删除撤销");
  await reset("five-tuplet-fixture.lxm.json");
  await note(9).click();
  for (let i = 0; i < 4; i++) await score().press("Shift+ArrowRight");
  await open("连音");
  await button("连音比例与选区详情…").click();
  const beforeFive = await exported();
  await page
    .getByRole("region", { name: "连音组详情" })
    .getByText("5:3", { exact: true })
    .click();
  await unchanged(beforeFive);
  await button("应用 5:3 连音").click();
  assert.deepEqual(
    (await exported()).score.tracks[0].measures[1].tuplets[0].ratio,
    { actual: 5, normal: 3 },
  );
  await page
    .getByRole("region", { name: "连音组详情" })
    .getByText("5:4", { exact: true })
    .click();
  await button("应用 5:4 连音").click();
  assert.deepEqual(
    (await exported()).score.tracks[0].measures[1].tuplets[0].ratio,
    { actual: 5, normal: 4 },
  );
  record("5:4与5:3真实比例切换，选择候选零修改");
  await reset("tuplet-overflow-fixture.lxm.json");
  const beforeFailure = await exported();
  await note(9).click();
  await score().press("Shift+ArrowRight");
  await score().press("Shift+ArrowRight");
  await open("连音");
  await button("连音比例与选区详情…").click();
  await button("删除当前连音组").click();
  await expect(
    page.getByText("小节容量不足，无法保留全部连音成员", { exact: true }),
  ).toBeVisible();
  await expect(undo()).toBeDisabled();
  await unchanged(beforeFailure);
  record("连音容量失败保留完整文档且零历史");

  await reset();
  await select();
  await open("技巧");
  await button("新增技巧：选择全部 16 类…").click();
  await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(16);
  await page.getByRole("dialog").getByText("推弦", { exact: true }).click();
  await shot("05-04_16类技巧选择_1440x900");
  await button("取消").click();
  await expect(button("技巧工具")).toBeFocused();
  await unchanged(baseline);
  await open("技巧");
  await button("新增技巧：选择全部 16 类…").click();
  await page.getByRole("dialog").getByText("推弦", { exact: true }).click();
  await button("下一步：参数").click();
  await expect(page.getByRole("combobox", { name: "推弦幅度" })).toBeVisible();
  await choose("推弦幅度", "半音");
  const amount = await page
    .getByRole("combobox", { name: "推弦幅度" })
    .elementHandle();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 768, height: 900 });
  await open("技巧");
  await expect(page.getByRole("combobox", { name: "推弦幅度" })).toBeVisible();
  assert(
    await page
      .getByRole("combobox", { name: "推弦幅度" })
      .evaluate((el: Element, old: Element) => el === old, amount),
  );
  await expect(page.locator('[data-tool-panel="technique"]')).toContainText(
    "半音",
  );
  await popupInside();
  await shot("07-04_768更多工具_768x900");
  await page.keyboard.press("Escape");
  await expect(button("更多工具")).toBeFocused();
  await unchanged(baseline);
  record("16类选择取消/交接零修改，参数与DOM跨断点保持");

  await reset();
  await page.setViewportSize({ width: 768, height: 900 });
  await select();
  await score().press("2");
  await button("更多工具").click();
  await expect(
    page.getByRole("textbox", { name: "搜索更多工具" }),
  ).toBeFocused();
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await unchanged(baseline);
  await button("更多工具").click();
  const search = page.getByRole("textbox", { name: "搜索更多工具" });
  await search.fill("不存在的工具");
  await expect(page.getByText("没有匹配的工具")).toBeVisible();
  await button("清空搜索").click();
  await search.fill("覆盖");
  await search.press("Enter");
  await expect(button("在目标拍前插入…").locator("..")).toBeFocused();
  await search.focus();
  await search.dispatchEvent("compositionstart");
  await search.press("Escape");
  await expect(search).toBeVisible();
  await search.dispatchEvent("compositionend");
  await page.keyboard.press("Escape");
  await expect(button("更多工具")).toBeFocused();
  record("更多搜索/空态/Enter定位/Esc及合成IME隔离，品位计时输入被取消");

  await page.setViewportSize({ width: 1440, height: 900 });
  await open("拍点");
  await page.getByRole("combobox", { name: "拍点复制谱层" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-tool-panel="beat"]')).toBeVisible();
  await page.keyboard.press("Escape");
  record("Select Esc只关候选，第二次Esc关闭工具");

  for (const [width, height, name] of [
    [1280, 800, "07-01_1280并列"],
    [1024, 768, "07-02_1024上下分区"],
    [1280, 650, "07-03_650低高度"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open("小节");
    const rect = await popupInside();
    await shot(`${name}_${width}x${height}`);
    await page.keyboard.press("Escape");
    record(name, rect);
  }
  // 精确设置容器宽度，不把浏览器窗口宽度当作容器断点。
  const container = page
    .locator('[class*="editor_"]')
    .filter({ has: page.getByRole("banner") })
    .first();
  const boundaryMetrics = [];
  for (const width of [899, 900, 1199, 1200]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await container.evaluate((el: HTMLElement, w: number) => {
      el.style.width = `${w}px`;
      el.style.maxWidth = "none";
    }, width);
    await page.waitForTimeout(80);
    await open("技巧");
    const measured = await container.evaluate(
      (el: HTMLElement) => el.getBoundingClientRect().width,
    );
    assert.equal(measured, width);
    assert.equal(await button("更多工具").isVisible(), width < 900);
    boundaryMetrics.push({ width, measured, rect: await popupInside() });
    await page.keyboard.press("Escape");
  }
  await container.evaluate((el: HTMLElement) => {
    el.style.width = "899px";
  });
  await open("拍点");
  await page.getByRole("combobox", { name: "拍点复制谱层" }).click();
  for (const width of [900, 1199, 1200, 899]) {
    await container.evaluate((el: HTMLElement, w: number) => {
      el.style.width = `${w}px`;
    }, width);
    await expect(page.locator(".ant-select-dropdown:visible")).toBeVisible();
    await popupInside();
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  record("打开Select时跨899/900和1199/1200，候选及唯一工具宿主保持");
  await container.evaluate((el: HTMLElement) => {
    el.style.removeProperty("width");
    el.style.removeProperty("max-width");
  });
  record("编辑器容器899/900与1199/1200边界", boundaryMetrics);

  await reset();
  await select();
  await page.getByRole("tab", { name: /歌曲$/ }).click();
  const title = page.getByRole("textbox", { name: "歌曲名称", exact: true });
  await title.fill("未应用歌曲草稿");
  await open("小节");
  await button("配置小节范围复制…").click();
  await expect(button("继续编辑")).toBeVisible();
  await button("继续编辑").click();
  await expect(title).toHaveValue("未应用歌曲草稿");
  await open("小节");
  await button("配置小节范围复制…").click();
  await button("放弃并切换").click();
  await expect(
    page.getByRole("combobox", { name: "复制起始小节", exact: true }),
  ).toBeFocused();
  await shot("UI-D08_原范围表单定位_1440x900");
  await title.fill("应用并导航后的标题");
  await open("小节");
  await button("段落标记（仅元数据）…").click();
  await button("应用并切换").click();
  await expect(
    page.getByRole("textbox", { name: "段落标记", exact: true }),
  ).toBeFocused();
  assert.equal((await exported()).score.title, "应用并导航后的标题");
  record("保护导航继续/放弃/应用三分支及原歌曲字段可见聚焦");

  await reset();
  await select(5);
  await open("技巧");
  await choose("选择吉他技巧", "推弦");
  await choose("推弦幅度", "半音");
  await button("添加技巧").click();
  let doc = await exported();
  const created = doc.score.tracks[0].techniques.find(
    (t: { type: string }) => t.type === "bend",
  );
  assert.equal(created.semitones, 1);
  const createdId = created.id;
  await open("技巧");
  await choose("选择吉他技巧", "颤音奏 tr");
  await page.getByRole("spinbutton", { name: "辅助品位" }).fill("9");
  await button("应用更改").click();
  doc = await exported();
  assert.equal(
    doc.score.tracks[0].techniques.find(
      (t: { id: string }) => t.id === createdId,
    )?.auxiliaryFret,
    9,
    JSON.stringify(doc.score.tracks[0].techniques),
  );
  await score().press("Shift+ArrowDown");
  await open("技巧");
  await choose("选择吉他技巧", "扫弦");
  await choose("选择技巧方向", "上");
  await button("应用更改").click();
  doc = await exported();
  assert.equal(
    doc.score.tracks[0].techniques.find(
      (t: { id: string }) => t.id === createdId,
    )?.stroke,
    "up",
    JSON.stringify(doc.score.tracks[0].techniques),
  );
  await open("技巧");
  await button("删除技巧").click();
  doc = await exported();
  assert.equal(doc.score.tracks[0].techniques.length, 1);
  record("技巧添加/更新/删除及推弦、辅助品位、方向参数实际提交");

  await reset();
  await score()
    .locator('g[data-system-index="0"] text:not([stroke="#fff"])')
    .filter({ hasText: /^1$/ })
    .first()
    .click();
  const numbered = page.getByRole("textbox", { name: "连续简谱", exact: true });
  await numbered.fill("2 3");
  await score()
    .locator('g[data-system-index="0"] text:not([stroke="#fff"])')
    .filter({ hasText: /^3$/ })
    .first()
    .click();
  await numbered.fill("5 6");
  await score()
    .locator('g[data-system-index="0"] text:not([stroke="#fff"])')
    .filter({ hasText: /^1$/ })
    .first()
    .click();
  await expect(numbered).toHaveValue("2 3");
  await open("拍点");
  await expect(button("拆分当前拍点")).toBeDisabled();
  await page.keyboard.press("Escape");
  let downloadCount = 0;
  const onDownload = () => downloadCount++;
  page.on("download", onDownload);
  await button("导出曲谱").click();
  await expect(
    page.getByText("请先应用或取消当前输入，再导入或导出曲谱。"),
  ).toBeVisible();
  await button("导出 A4 图片").click();
  await expect(
    page.getByText("请先完成当前输入并应用或取消修改，再导出图片。"),
  ).toBeVisible();
  await page.waitForTimeout(100);
  assert.equal(downloadCount, 0);
  page.off("download", onDownload);
  await shot("多简谱草稿_输出阻断_1440x900");
  record("简谱A/B草稿恢复、TAB专用工具隔离及文件/图片输出阻断");

  await reset();
  await select();
  await score().locator("text").filter({ hasText: /^验$/ }).first().click();
  const lyric = page.getByRole("textbox", { name: "连续歌词", exact: true });
  await lyric.fill("收 尾 验 收");
  await page.getByRole("button", { name: /^应用全部/ }).click();
  assert.equal((await exported()).score.tracks[0].measures[0].lyrics.length, 4);
  await undo().click();
  await page.getByRole("tab", { name: /和弦$/ }).click();
  if (await button("编辑当前拍").isVisible())
    await button("编辑当前拍").click();
  await choose("常用和弦预设", "C");
  await button("应用").click();
  assert.equal(
    (await exported()).score.tracks[0].measures[0].chordSymbols[0].chord.name,
    "C",
  );
  await undo().click();
  await button("导出 A4 图片").click();
  await expect(
    page.getByRole("heading", { name: "A4 图片预览" }),
  ).toBeVisible();
  await button("生成此页图片").click();
  const imageLink = page.getByRole("link", { name: "下载图片", exact: true });
  await expect(imageLink).toBeVisible();
  const imageDownload = page.waitForEvent("download");
  await imageLink.click();
  assert((await imageDownload).suggestedFilename().endsWith(".png"));
  await button("关闭").click();
  record("歌词连续提交、和弦预设、文件往返及A4 PNG生成下载烟测");
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleIssues, []);
  record("浏览器pageerror为0");
} catch (error) {
  await page
    .screenshot({
      path: path.join(output, "failure.png"),
      animations: "disabled",
    })
    .catch(() => {});
  await writeFile(
    path.join(output, "failure-body.txt"),
    await page.locator("body").innerText(),
  );
  throw error;
} finally {
  await writeFile(
    path.join(output, "browser-smoke-report.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        url,
        checks,
        errors,
        consoleIssues,
        ignoredConsoleIssues,
        browser: browser.version(),
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
