import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime);
const { expect } = require(`${runtime}/test`);
const output = path.resolve("artifacts/ui-phase6-20261022");
const fixtures = path.resolve("artifacts/ui-phase3-20261018");
const shots = path.resolve(
  "artifacts/ui-phase6-20261022/regression-shots",
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
let success = false;
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
const url = process.env.EDITOR_URL ?? "http://127.0.0.1:3110/";
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
    .setInputFiles(path.join(fixtures, fixture));
  await button("导入并替换").click();
  await expect(page.getByRole("banner")).toContainText("阶段3固定验收谱");
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

const numberedText = () =>
  page.getByRole("textbox", { name: "连续简谱", exact: true });
const numberedNote = (value: string) =>
  score()
    .locator('g[data-system-index="0"] text:not([stroke="#fff"])')
    .filter({ hasText: new RegExp(`^${value}$`) })
    .first();
const lyricText = () =>
  page.getByRole("textbox", { name: "连续歌词", exact: true });
const openLyric = async () => {
  await score().locator("text").filter({ hasText: /^验$/ }).first().click();
  await expect(lyricText()).toBeVisible();
};
const closeNumbered = async () => {
  await button("取消").click();
  if (await button("放弃并切换").isVisible())
    await button("放弃并切换").click();
};
const openChord = async () => {
  await note(1).click();
  await page.getByRole("tab", { name: /和弦$/ }).click();
  if (await button("编辑当前拍").isVisible())
    await button("编辑当前拍").click();
};
try {
  await reset();
  await openLyric();
  await choose("歌词录入方式", "单拍编辑");
  const single = page.getByRole("textbox", { name: "歌词文本", exact: true });
  for (const verse of [1, 2, 3, 4]) {
    await choose("歌词段号", `第 ${verse} 段`);
    await single.fill(`词${verse}`);
    await single.press("Shift+Enter");
    await expect(single).toHaveValue(`词${verse}`);
  }
  await shot("04-01_单拍歌词与四段独立");
  let doc = await exported();
  assert.deepEqual(
    doc.score.tracks[0].measures[0].lyrics
      .filter((l: any) => l.beatId === "p2-b0-0")
      .map((l: any) => l.text),
    ["词1", "词2", "词3", "词4"],
  );
  await single.fill("下一拍");
  await single.press("Enter");
  await expect(page.locator("[class*=sidebarTarget]")).toContainText("第 2 拍");
  record("04-01 四段独立、Shift+Enter仅应用、Enter下一拍");

  await reset();
  await openLyric();
  await lyricText().fill("风 _ 山 谷 跨 小 节");
  await expect(page.getByLabel("歌词对应预览")).toContainText("2 小节");
  await expect(page.getByLabel("歌词对应预览")).toContainText("跳过");
  await shot("04-02_连续歌词跨小节对应预览");
  await page.getByRole("button", { name: /^应用全部/ }).click();
  doc = await exported();
  assert.equal(doc.score.tracks[0].measures[0].lyrics.length, 3);
  assert.equal(doc.score.tracks[0].measures[1].lyrics.length, 3);
  await undo().click();
  await expect(undo()).toBeDisabled();
  record("04-02 跨小节、跳拍、覆盖计数和整批一次撤销");
  await openLyric();
  await lyricText().fill("改写");
  await page.getByRole("checkbox", { name: /允许替换预览/ }).uncheck();
  await expect(page.getByRole("button", { name: /^应用全部/ })).toBeDisabled();
  await expect(lyricText()).toHaveValue("改写");
  record("歌词关闭覆盖许可后阻断并保留输入");

  await reset();
  await openLyric();
  await lyricText().fill(Array(15).fill("超").join(" "));
  await expect(page.getByRole("button", { name: /^应用全部/ })).toBeDisabled();
  await expect(page.getByLabel("歌词对应预览")).toContainText("超出谱尾");
  assert.equal(
    await page.getByLabel("歌词对应预览").locator("tbody tr").count(),
    15,
  );
  await expect(undo()).toBeDisabled();
  await shot("04-03_谱尾错误保留全部预览");
  record("04-03 超谱尾整批拒绝、15行预览保留且零历史");

  await reset();
  await page.getByRole("tab", { name: /段落$/ }).click();
  await shot("04-08_无目标与添加内容行");
  await button("添加歌词行").click();
  await expect(lyricText()).toBeVisible();
  await expect(undo()).toBeDisabled();
  record("04-08 无目标添加歌词只打开编辑，零历史");
  await reset("four-verses.lxm.json");
  await page.getByRole("tab", { name: /段落$/ }).click();
  await button("添加歌词行").click();
  await expect(
    page.getByText("当前谱行已有 4 段歌词，请选择段号编辑已有行。"),
  ).toBeVisible();
  await expect(undo()).toBeDisabled();
  record("已有四段禁止新增第五段");
  await reset("empty-voice.lxm.json");
  await page.getByRole("tab", { name: /段落$/ }).click();
  await button("添加简谱行").click();
  await expect(numberedText()).toBeVisible();
  await expect(undo()).toBeDisabled();
  record("空voice可打开独立时间窗，未制造假Beat或休止");

  await reset();
  await numberedNote("1").click();
  await choose("简谱录入方式", "单音组编辑");
  const group = page.getByRole("textbox", { name: "单音组简谱", exact: true });
  await group.fill("1+3+5");
  await shot("04-04_独立多音组内容预览");
  await button("应用内容").click();
  await closeNumbered();
  doc = await exported();
  assert.deepEqual(
    doc.score.tracks[0].measures[0].numberedVoice.events[0].items.map(
      (i: any) => i.token,
    ),
    ["1", "3", "5"],
  );
  await numberedNote("1").click();
  await choose("简谱录入方式", "单音组编辑");
  await choose("简谱技巧起始音符", "2：3");
  await page
    .getByRole("textbox", { name: "简谱单音符音高", exact: true })
    .fill("#3'");
  await shot("04-10_单item音高时值与技巧");
  await button("应用单音符音高").click();
  await closeNumbered();
  doc = await exported();
  assert.deepEqual(
    doc.score.tracks[0].measures[0].numberedVoice.events[0].items.map(
      (i: any) => i.token,
    ),
    ["1", "#3'", "5"],
  );
  record("04-04/10 同时多音与单item音高分别提交，其他成员保持");

  await reset();
  await numberedNote("1").click();
  await numberedText().fill("7 _ 6 5 4");
  await page
    .getByRole("checkbox", { name: "允许覆盖此时间范围的简谱" })
    .check();
  await expect(page.getByLabel("简谱修改预览")).toContainText("2 小节");
  await expect(page.getByLabel("简谱修改预览")).toContainText("跳过");
  await shot("04-05_连续简谱跨小节覆盖预览");
  await button("应用内容").click();
  await closeNumbered();
  doc = await exported();
  assert.equal(
    doc.score.tracks[0].measures[1].numberedVoice.events[0].items[0].token,
    "4",
  );
  assert.equal(
    doc.score.tracks[0].measures[0].numberedVoice.events[0].rhythm.base,
    "quarter",
  );
  await undo().click();
  await expect(undo()).toBeDisabled();
  record("04-05 跨小节均匀内容完整预览、跳拍、保留时值和一次撤销");

  await reset();
  await numberedNote("1").click();
  await choose("简谱节奏模板", "前八后十六");
  await numberedText().fill("1 2 3");
  await page
    .getByRole("checkbox", { name: "允许覆盖此时间范围的简谱" })
    .check();
  await expect(page.getByLabel("简谱修改预览")).toContainText("第1拍 + 1/2");
  await expect(page.getByLabel("简谱修改预览")).toContainText("第1拍 + 3/4");
  await button("应用内容").click();
  await closeNumbered();
  doc = await exported();
  assert.deepEqual(
    doc.score.tracks[0].measures[0].numberedVoice.events
      .slice(0, 3)
      .map((e: any) => e.tick),
    [0, 480, 720],
  );
  record("前八后十六模板按0/480/720落位，分数拍位正确");

  await reset();
  await numberedNote("1").click();
  await choose("简谱节奏模板", "自选节奏连音");
  for (const ratio of ["2:3", "3:2", "4:3", "5:4", "5:3", "6:4"])
    await choose("简谱连音比例", ratio);
  await choose("简谱节奏模板", "自定义成员时值");
  await numberedText().fill("1 2 3");
  await choose("简谱第2音时值", "十六分");
  await choose("简谱第2音附点", "单附点");
  await expect(
    page.getByRole("combobox", { name: "简谱第2音时值", exact: true }),
  ).toBeVisible();
  for (const name of [
    "复制简谱范围",
    "覆盖简谱",
    "插入简谱",
    "合并至终点",
    "等分持续音",
    "添加延音线",
    "添加连音线",
    "切换延长记号",
  ])
    await expect(button(name)).toBeVisible();
  await button("恢复内容组").click();
  await button("取消").click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(undo()).toBeDisabled();
  record(
    "六比例、自定义成员/附点及旧高级入口完整；恢复后停用参数不产生永久dirty",
  );

  await reset();
  await numberedNote("1").click();
  await choose("简谱录入方式", "单音组编辑");
  await page
    .getByRole("textbox", { name: "单音组简谱", exact: true })
    .fill("#1+3");
  await score()
    .locator('g[data-system-index="0"] text:not([stroke="#fff"])')
    .filter({ hasText: /^1$/ })
    .nth(1)
    .click();
  await choose("简谱录入方式", "连续录入");
  await numberedText().fill("7");
  await page
    .getByRole("checkbox", { name: "允许覆盖此时间范围的简谱" })
    .check();
  await button("应用内容").click();
  await button("返回暂存草稿 1").click();
  await expect(
    page.getByRole("textbox", { name: "单音组简谱", exact: true }),
  ).toHaveValue("#1+3");
  await expect(
    page.getByRole("combobox", { name: "简谱录入方式", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await button("导出曲谱").click();
  await expect(
    page.getByText("请先应用或取消当前输入，再导入或导出曲谱。"),
  ).toBeVisible();
  await shot("S01_A模式与草稿跨B无关提交恢复");
  record("A暂存后B改模式并应用无关命令，返回A恢复原模式和raw且输出仍阻断");

  await reset("impact.lxm.json");
  await numberedNote("1").click();
  await page
    .getByRole("textbox", { name: "简谱单音符音高", exact: true })
    .fill("2");
  await button("取消").click();
  await button("应用并切换").click();
  const impact = page.locator("dialog[open]");
  await expect(impact).toBeVisible();
  await expect(impact).toContainText("将删除 1 个记号");
  assert.equal(await page.locator('[aria-modal="true"]:visible').count(), 0);
  await impact.getByRole("button", { name: "确认修改", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(impact.getByRole("button", { name: /^取\s*消$/ })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    impact.getByRole("button", { name: "确认修改", exact: true }),
  ).toBeFocused();
  await shot("S3-A_影响确认与单一活动模态");
  await page.keyboard.press("Escape");
  await expect(impact).toBeHidden();
  await expect(undo()).toBeDisabled();
  await button("应用并切换").click();
  await expect(impact).toBeVisible();
  await impact.getByRole("button", { name: "确认修改", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  doc = await exported();
  assert.equal(doc.score.tracks[0].numberedMarks.length, 0);
  await undo().click();
  await expect(undo()).toBeDisabled();
  doc = await exported();
  assert.equal(doc.score.tracks[0].numberedMarks.length, 1);
  record("影响确认Tab双向循环、Esc取消零历史、异步导航成功及内容记号一起撤销");

  await reset();
  await openChord();
  await choose("常用和弦预设", "C");
  await shot("04-06_和弦真实预览与六弦编辑");
  await button("应用").click();
  doc = await exported();
  assert.equal(doc.score.tracks[0].measures[0].chordSymbols[0].chord.name, "C");
  await button("新增横按").click();
  await shot("04-07_横按四字段与错误");
  const barre = page.getByRole("spinbutton", {
    name: "横按1fret",
    exact: true,
  });
  await barre.fill("");
  await expect(button("应用")).toBeDisabled();
  await expect(barre).toHaveValue("");
  await page.getByText("横按设置（1/4）", { exact: true }).click();
  await page.getByText("横按设置（1/4）", { exact: true }).click();
  await expect(barre).toHaveValue("");
  await button("取消").click();
  await button("放弃并切换").click();
  doc = await exported();
  assert.equal(
    doc.score.tracks[0].measures[0].chordSymbols[0].chord.diagram.barres.length,
    0,
  );
  record("04-06/07 预设应用、非法数字空值保留、横按折叠保持和取消零写入");

  await openChord();
  await button("清除指法图").click();
  await expect(
    page.getByRole("textbox", { name: "和弦名称", exact: true }),
  ).toHaveValue("C");
  await button("取消").click();
  await button("放弃并切换").click();
  doc = await exported();
  assert(doc.score.tracks[0].measures[0].chordSymbols[0].chord.diagram);
  await openChord();
  await button("清除指法图").click();
  await button("应用").click();
  doc = await exported();
  assert.equal(
    doc.score.tracks[0].measures[0].chordSymbols[0].chord.diagram,
    null,
  );
  assert.equal(doc.score.tracks[0].measures[0].chordSymbols[0].chord.name, "C");
  record("清图保留名称；取消可恢复，统一应用才提交");
  await reset("nonstandard.lxm.json");
  await openChord();
  await expect(
    page.getByRole("combobox", { name: "常用和弦预设", exact: true }),
  ).toBeDisabled();
  await button("创建指法图").click();
  await expect(
    page.getByRole("combobox", { name: "1弦品位", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("spinbutton", { name: "起始品位", exact: true })
    .fill("");
  await expect(button("应用")).toBeDisabled();
  await shot("04-09_非标准调弦与高级错误");
  record("04-09 非标准调弦禁预设保留自定义；起始品位空白校验");

  await reset();
  await numberedNote("1").click();
  await numberedText().fill("2 3");
  const owner = await numberedText().elementHandle();
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [768, 900],
    [1280, 650],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(numberedText()).toHaveValue("2 3");
    assert(await owner.evaluate((el: HTMLElement) => el.isConnected));
    await button("恢复内容组").scrollIntoViewIfNeeded();
    await expect(button("恢复内容组")).toBeInViewport();
    await shot(`布局_${width}x${height}_草稿保持`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  record("五组窗口尺寸下同一输入owner、raw保持，分组动作可达");
  await page
    .getByRole("combobox", { name: "当前简谱事件", exact: true })
    .click();
  for (const width of [899, 900, 1199, 1200]) {
    const actual = await page.evaluate((width: number) => {
      const editor = Array.from(
        document.querySelectorAll<HTMLElement>("div"),
      ).find(
        (element) => getComputedStyle(element).containerName === "score-editor",
      )!;
      editor.style.width = `${width}px`;
      return editor.getBoundingClientRect().width;
    }, width);
    assert.equal(actual, width);
    await expect(numberedText()).toHaveValue("2 3");
    assert(await owner.evaluate((el: HTMLElement) => el.isConnected));
    await expect(
      page.getByRole("combobox", { name: "当前简谱事件", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  }
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    Array.from(document.querySelectorAll<HTMLElement>("div")).find(
      (element) => getComputedStyle(element).containerName === "score-editor",
    )!.style.width = "";
  });
  record("实测899/900/1199/1200容器边界，Select保持打开、草稿与owner保持");
  await numberedText().dispatchEvent("compositionstart", { data: "中" });
  await numberedText().press("Enter");
  await numberedText().press("Escape");
  await expect(numberedText()).toHaveValue("2 3");
  await expect(undo()).toBeDisabled();
  await numberedText().dispatchEvent("compositionend", { data: "中" });
  record(
    "合成composition期间Enter/Esc不提交音乐或迁移目标；真实系统IME另列人工项",
  );

  await closeNumbered();
  await page.goto(url, { waitUntil: "networkidle" });
  await shot("04-11_核心符号与成品回归");
  await button("导出 A4 图片").click();
  await expect(
    page.getByRole("heading", { name: "A4 图片预览" }),
  ).toBeVisible();
  const imageWorkspace = page.locator("[data-image-export-status]");
  await expect(imageWorkspace).toHaveAttribute(
    "data-image-export-status",
    "ready",
  );
  await choose("输出范围", "当前第 1 页");
  await button("生成第 1 页图片").click();
  await expect(imageWorkspace).toHaveAttribute(
    "data-image-export-status",
    "generated",
  );
  const imageLink = page.getByRole("link", { name: "下载图片", exact: true });
  await expect(imageLink).toBeVisible();
  const download = page.waitForEvent("download");
  await imageLink.click();
  const imageDownload = await download;
  assert(imageDownload.suggestedFilename().endsWith(".png"));
  await imageDownload.saveAs(path.join(output, "presentation.png"));
  await button("关闭预览").click();
  record("04-11 成品图片单页生成下载与输出烟测");
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleIssues, []);
  record("生产浏览器pageerror及功能console错误为零");
  success = true;
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
    path.join(output, "browser-regression-report.json"),
    JSON.stringify(
      {
        success,
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
