import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime);
const { expect } = require(`${runtime}/test`);
const output = path.resolve("artifacts/ui-phase3-20261018");
const shots = path.resolve(
  "docs/design/04_实施验收/验收截图/20261018_阶段3属性表单",
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
const url = process.env.EDITOR_URL ?? "http://127.0.0.1:3108/";
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
try {
  await reset();
  await numberedNote("1").click();
  await numberedText().fill("2 3");
  const owner = await numberedText().elementHandle();
  await choose("简谱时值", "八分");
  await button("应用当前音符时值").click();
  await expect(numberedText()).toHaveValue("2 3");
  assert.equal(await owner.evaluate((el: HTMLElement) => el.isConnected), true);
  await expect(button("恢复时值组")).toBeVisible();
  await button("导出曲谱").click();
  await expect(
    page.getByText("请先应用或取消当前输入，再导入或导出曲谱。"),
  ).toBeVisible();
  await shot("S3-A_时值应用保留内容与owner");
  record("时值单独应用保留raw、owner身份及输出保护");
  await button("恢复内容组").click();
  await page
    .getByRole("textbox", { name: "简谱单音符音高", exact: true })
    .fill("#1");
  await button("取消").click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await button("应用并切换").click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  const doc = await exported();
  assert.equal(
    doc.score.tracks[0].measures[0].numberedVoice.events[0].items[0].token,
    "#1",
  );
  assert.equal(
    doc.score.tracks[0].measures[0].numberedVoice.events[0].rhythm.base,
    "eighth",
  );
  record("仅item草稿经正确组应用并切换");

  await reset();
  await numberedNote("1").click();
  await numberedText().fill("7");
  await choose("简谱时值", "八分");
  await button("取消").click();
  await expect(button("应用并切换")).toBeDisabled();
  await button("继续编辑").click();
  await expect(numberedText()).toHaveValue("7");
  record("多分组导航禁用并保留所有输入");

  await reset();
  await numberedNote("1").click();
  await numberedText().fill("2 3");
  await numberedNote("3").click();
  await numberedText().fill("5 6");
  await page
    .getByRole("checkbox", { name: "允许覆盖此时间范围的简谱" })
    .check();
  await button("应用内容").click();
  await expect(
    page.getByText(
      "此操作会影响暂存简谱草稿，请先返回该目标应用或明确丢弃，再重新预览。",
    ),
  ).toBeVisible();
  await button("返回暂存草稿 1").click();
  await expect(numberedText()).toHaveValue("2 3");
  record("B操作影响缓存A时阻断，返回A恢复全部输入");
  assert.deepEqual(errors, []);
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
    path.join(output, "s3-a-browser-report.json"),
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
