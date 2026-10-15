import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// 可使用项目自行安装的 Playwright，或通过环境变量指定本机打包运行时。
const require = createRequire(import.meta.url);
const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(playwrightModule);
const { expect } = require(`${playwrightModule}/test`);
const output = path.resolve("artifacts/ui-foundation-20261016");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
const checks: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
try {
  await page.goto(process.env.EDITOR_URL ?? "http://127.0.0.1:3100/", {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("application", { name: "六线谱编辑器" }),
  ).toBeVisible();
  const title = page.getByRole("textbox", { name: "歌曲名称", exact: true });
  const original = await title.inputValue();
  await title.fill("协调层烟测草稿");
  await expect(
    page.getByRole("status").filter({ hasText: "1 处待处理草稿" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "导出 A4 图片", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "请先完成当前输入" }),
  ).toBeVisible();
  checks.push("歌曲设置草稿登记并阻断图片输出");

  const help = page.getByRole("button", { name: "快捷键帮助" });
  await help.click();
  const dialog = page.getByRole("dialog", { name: "编辑快捷键" });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: path.join(output, "keyboard-help-1440.png") });
  await page.keyboard.press("Control+z");
  await expect(title).toHaveValue("协调层烟测草稿");
  await dialog.getByRole("button", { name: /^关\s*闭$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
  checks.push("帮助弹层隔离背景快捷键、保留输入、关闭后恢复触发按钮焦点");

  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(title).toHaveValue("协调层烟测草稿");
    await expect(
      page.getByRole("status").filter({ hasText: "1 处待处理草稿" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(output, `settings-draft-${width}.png`),
    });
  }
  checks.push("1024/768 布局变化保持歌曲表单与草稿登记");

  // 合成事件验证组合态保护；真实中文 IME 验收仍需操作系统输入法路径。
  await title.dispatchEvent("compositionstart", { data: "中" });
  await expect(
    page.getByRole("status").filter({ hasText: "输入法输入中" }),
  ).toBeVisible();
  await title.dispatchEvent("compositionend", { data: "中" });
  await expect(
    page.getByRole("status").filter({ hasText: "输入法输入中" }),
  ).toHaveCount(0);
  checks.push("合成 composition 事件进入并释放输入法保护");

  await page.getByRole("tab", { name: /选区$/ }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(title).toHaveValue("协调层烟测草稿");
  await page.getByRole("tab", { name: /选区$/ }).click();
  await page.getByRole("button", { name: "放弃并切换", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "待处理草稿" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /歌曲$/ }).click();
  await expect(title).toHaveValue(original);
  checks.push("原有三选项草稿保护保留，放弃后协调器解除阻断");

  await title.fill("协调层已提交");
  await page.getByRole("button", { name: "应用歌曲信息", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "待处理草稿" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(title).toHaveValue(original);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(title).toHaveValue("协调层已提交");
  checks.push("设置提交、撤销、重做与草稿清理保持一致");

  await page.setViewportSize({ width: 1440, height: 900 });
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const glyphs = score.locator('g[data-system-index="0"] text');
  // 从真实渲染结果定位第一谱行的简谱字形，不向产品注入选区或绕过点击命中。
  const candidates = await glyphs.evaluateAll((nodes: Element[]) =>
    nodes
      .map((node, index) => ({
        index,
        text: node.textContent ?? "",
        x: Number(node.getAttribute("x")),
        y: Number(node.getAttribute("y")),
      }))
      .filter((node: { text: string }) => /^[1-7]$/.test(node.text))
      .sort(
        (a: { x: number; y: number }, b: { x: number; y: number }) =>
          b.y - a.y || a.x - b.x,
      ),
  );
  assert.ok(candidates.length >= 2, "需要两个真实简谱目标");
  await glyphs.nth(candidates[0].index).click();
  const numbered = page.getByRole("textbox", { name: "连续简谱", exact: true });
  await expect(numbered).toBeVisible();
  await numbered.fill("1 2 3");
  await glyphs.nth(candidates[1].index).click();
  await numbered.fill("5 6");
  await glyphs.nth(candidates[0].index).click();
  await expect(numbered).toHaveValue("1 2 3");
  await expect(
    page.getByRole("status").filter({ hasText: "2 处待处理草稿" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "导出 A4 图片", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "请先完成当前输入" }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(output, "numbered-drafts-1440.png"),
  });
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(numbered).toHaveValue("1 2 3");
  await expect(
    page.getByRole("status").filter({ hasText: "2 处待处理草稿" }),
  ).toBeVisible();
  checks.push("简谱 A/B 草稿独立登记、暂存恢复、窄窗口保留且阻断输出");

  assert.deepEqual(errors, [], "页面不能产生运行时异常");
  await writeFile(
    path.join(output, "browser-smoke-report.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        checks,
        errors,
        note: "基础协调层烟测；不代表阶段 1 视觉验收或真实操作系统 IME 验收。",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length, checks, errors }));
} catch (error) {
  await page.screenshot({ path: path.join(output, "smoke-failure.png") });
  console.error(JSON.stringify({ checks, errors, failure: String(error) }));
  throw error;
} finally {
  await browser.close();
}
