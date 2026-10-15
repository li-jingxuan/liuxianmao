import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime);
const { expect } = require(`${runtime}/test`);
const output = path.resolve("artifacts/ui-phase1-20261016");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks: string[] = [];
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
try {
  await page.goto(process.env.EDITOR_URL ?? "http://127.0.0.1:3100/", {
    waitUntil: "networkidle",
  });
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  const view = page.getByRole("button", { name: "视图与排版", exact: true });
  await view.click();
  await page.getByText("舒适排版", { exact: true }).click();
  await page.getByRole("switch", { name: "显示和弦指法图" }).click();
  await expect(undo).toBeDisabled();
  await view.click();
  checks.push("密度和指法图变化不增加音乐历史");
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score
    .locator('g[data-system-index="0"] text[stroke="#fff"]')
    .filter({ hasText: /^1$/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "设置为四分音符", exact: true }),
  ).toBeEnabled();
  const beat = page.getByRole("button", { name: "拍点工具", exact: true });
  await beat.click();
  await page.getByRole("button", { name: "复制拍点", exact: true }).click();
  await page
    .getByRole("combobox", { name: "拍点粘贴方式" })
    .selectOption("overwrite");
  await page.getByRole("button", { name: "预览粘贴", exact: true }).click();
  const preview = page.getByRole("group", { name: "粘贴预览", exact: true });
  await expect(preview).toBeVisible();
  const summary = (await preview.textContent())!;
  await page.getByRole("checkbox", { name: "确认覆盖" }).check();
  await expect(
    page.getByRole("button", { name: "应用粘贴", exact: true }),
  ).toBeEnabled();
  await beat.click();
  await expect(preview).toBeHidden();
  await page.setViewportSize({ width: 768, height: 900 });
  await beat.click();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveText(summary);
  await expect(page.getByRole("checkbox", { name: "确认覆盖" })).toBeChecked();
  await expect(
    page.getByRole("button", { name: "应用粘贴", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "取消预览", exact: true }).click();
  await expect(undo).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(beat).toBeFocused();
  checks.push(
    "粘贴预览关闭/窄屏重排后保留摘要与确认，应用按钮不自锁，取消不写历史，Esc恢复焦点",
  );
  const technique = page.getByRole("button", { name: "技巧工具", exact: true });
  await technique.click();
  const types = page.getByRole("combobox", { name: "选择吉他技巧" });
  await expect(types.locator("option")).toHaveCount(16);
  await types.selectOption("bend");
  const amount = page.getByRole("combobox", { name: "推弦幅度" });
  await amount.selectOption("1");
  const node = await amount.elementHandle();
  await technique.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await technique.click();
  await expect(types).toHaveValue("bend");
  await expect(amount).toHaveValue("1");
  assert.equal(
    await amount.evaluate(
      (element: Element, original: Element) => element === original,
      node,
    ),
    true,
  );
  const popup = page.locator(".ant-popover:visible").filter({ has: types });
  await expect(popup).toBeInViewport();
  await expect(popup).toHaveCSS("opacity", "1");
  await popup.evaluate(async (element: HTMLElement) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await page.screenshot({
    path: path.join(output, "stable-technique-tools-1280.png"),
    animations: "disabled",
  });
  checks.push("16种技巧完整保留，推弦参数与DOM在关闭菜单/断点变化后保持");
  await technique.click();
  await page.getByRole("tab", { name: /歌曲$/ }).click();
  const label = page.getByRole("textbox", { name: "段落标记", exact: true });
  await label.fill("原目标段落草稿");
  // 从真实谱面键盘导航移动 focus；保持歌曲栏目即可验证原目标说明。
  await score.focus();
  for (let index = 0; index < 4; index++)
    await page.keyboard.press("ArrowRight");
  await expect(label).toHaveValue("原目标段落草稿");
  // 音乐草稿保护可阻止导航；目标锁定的失效处理另由纯适配测试覆盖。
  await page.getByRole("button", { name: "应用段落标记", exact: true }).click();
  await expect(label).toHaveValue("原目标段落草稿");
  await undo.click();
  await expect(label).not.toHaveValue("原目标段落草稿");
  checks.push("局部标记独立提交及一次撤销恢复");
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "tools-smoke-report.json"),
    JSON.stringify(
      { testedAt: new Date().toISOString(), checks, errors },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length, checks, errors }));
} catch (error) {
  await page.screenshot({ path: path.join(output, "tools-failure.png") });
  console.error(JSON.stringify({ checks, errors, failure: String(error) }));
  throw error;
} finally {
  await browser.close();
}
