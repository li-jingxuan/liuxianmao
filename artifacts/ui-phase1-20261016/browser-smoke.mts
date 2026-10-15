import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const runtime = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(runtime);
const { expect } = require(`${runtime}/test`);
const output = path.resolve("artifacts/ui-phase1-20261016");
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
const shot = async (name: string) => {
  // 等有限的进出场动画结束再取证，避免把过渡帧当作最终画面。
  await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  return page.screenshot({
    path: path.join(output, `${name}.png`),
    animations: "disabled",
  });
};
const song = () => page.getByRole("tab", { name: /歌曲$/ }).click();
const title = page.getByRole("textbox", { name: "歌曲名称", exact: true });
const capo = page.getByRole("spinbutton", { name: "Capo", exact: true });
const apply = (name: string) =>
  page.getByRole("button", { name, exact: true }).click();
const view = page.getByRole("button", { name: "视图与排版", exact: true });
try {
  await page.goto(process.env.EDITOR_URL ?? "http://127.0.0.1:3100/", {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("tab", { name: /选区$/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText("开始编写你的曲谱", { exact: true }),
  ).toBeVisible();
  await shot("default-1440");
  await page.setViewportSize({ width: 1280, height: 800 });
  await shot("default-1280");
  checks.push("默认选区空态与 1440/1280 工作台截图");

  await song();
  const originalCapo = await capo.inputValue();
  const originalNode = await title.elementHandle();
  await title.fill("阶段一歌曲草稿");
  for (const width of [1440, 1280, 1024, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(title).toHaveValue("阶段一歌曲草稿");
    assert.equal(
      await title.evaluate(
        (node: Element, old: Element) => node === old,
        originalNode,
      ),
      true,
    );
    const boxes = await page
      .locator('[class*="editorWorkspace"] > *')
      .evaluateAll((nodes: Element[]) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      );
    assert.equal(boxes.length, 2);
    if (width >= 1200) {
      assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 2);
      assert.equal(Math.round(boxes[1].width), 344);
    } else {
      assert.ok(boxes[1].y > boxes[0].y);
    }
    if (width < 1200) await shot(`song-draft-${width}`);
  }
  checks.push(
    "1280 并列344px侧栏、1024/768上下布局，歌曲 input DOM 与草稿未重建",
  );
  await capo.fill("13");
  await apply("应用歌曲信息");
  await expect(title).toHaveValue("阶段一歌曲草稿");
  await expect(capo).toHaveValue("13");
  await expect(page.locator("header").first()).toContainText("阶段一歌曲草稿");
  await apply("导出 A4 图片");
  await expect(
    page.getByRole("alert").filter({ hasText: "请先完成当前输入" }).first(),
  ).toBeVisible();
  checks.push(
    "信息分组应用保留非法Capo草稿，头部只显示已提交标题，A4受草稿保护",
  );
  for (const raw of ["", "1.5", "13", "abc"]) {
    await capo.fill(raw);
    await apply("应用 Capo");
    await expect(capo).toHaveValue(raw);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /变调夹/ })
        .last(),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "1 处待处理草稿" }),
    ).toBeVisible();
  }
  checks.push(
    "Capo 清空、小数、越界和非数字原文在失焦/拒绝提交后保持，草稿仍登记",
  );
  await capo.fill("2");
  await apply("应用 Capo");
  await expect(
    page.getByRole("status").filter({ hasText: "待处理草稿" }),
  ).toHaveCount(0);
  await apply("撤销");
  await expect(capo).toHaveValue(originalCapo);
  await apply("重做");
  await expect(capo).toHaveValue("2");
  await title.scrollIntoViewIfNeeded();
  await shot("song-settings-1440");
  checks.push("Capo 有效值独立提交、撤销和重做");

  await title.fill("菜单期间保留");
  await view.click();
  await page.getByText("舒适排版", { exact: true }).click();
  await page.getByRole("switch", { name: "显示和弦指法图" }).click();
  await shot("view-menu-1440");
  await page.getByRole("button", { name: /快捷键帮助/ }).click();
  const help = page.getByRole("dialog", { name: "编辑快捷键" });
  await expect(help).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
    )
    .toBe(true);
  await page.keyboard.press("Control+z");
  await expect(title).toHaveValue("菜单期间保留");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(view).toBeFocused();
  await expect(title).toHaveValue("菜单期间保留");
  checks.push(
    "视图弹层保留草稿，帮助隔离背景快捷键，Esc恢复可见视图触发按钮焦点",
  );

  await title.dispatchEvent("compositionstart", { data: "中" });
  await expect(
    page.getByRole("button", { name: "应用歌曲信息", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "输入法输入中" }),
  ).toBeVisible();
  await title.dispatchEvent("compositionend", { data: "中" });
  await expect(
    page.getByRole("button", { name: "应用歌曲信息", exact: true }),
  ).toBeEnabled();
  checks.push("合成组合态阻止设置提交并准确释放（不替代真实系统IME）");

  await page.getByRole("tab", { name: /选区$/ }).click();
  await apply("继续编辑");
  await expect(title).toHaveValue("菜单期间保留");
  await page.getByRole("tab", { name: /选区$/ }).click();
  await apply("放弃并切换");
  await song();
  await expect(title).toHaveValue("阶段一歌曲草稿");
  await title.fill("保护流程应用");
  await page.getByRole("tab", { name: /选区$/ }).click();
  await apply("应用并切换");
  await song();
  await expect(title).toHaveValue("保护流程应用");
  checks.push("歌曲栏目切换继续/放弃/应用三条保护路径");

  await page.setViewportSize({ width: 1280, height: 650 });
  const copyButton = page.getByRole("button", {
    name: "复制小节范围",
    exact: true,
  });
  await copyButton.scrollIntoViewIfNeeded();
  await expect(copyButton).toBeInViewport();
  await page.getByRole("combobox", { name: "插入位置", exact: true }).click();
  await expect(
    page
      .locator(".ant-select-dropdown:visible")
      .getByText("谱首", { exact: true }),
  ).toBeVisible();
  await shot("low-height-popup-1280x650");
  await page.keyboard.press("Escape");
  await copyButton.click();
  await apply("撤销");
  checks.push("650px 高度最末复制控件可达，Select popup未裁剪，复制与撤销可用");

  const downloadPromise = page.waitForEvent("download");
  await apply("导出曲谱");
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith(".json"));
  await apply("导出 A4 图片");
  await expect(page.getByRole("dialog", { name: "A4 图片预览" })).toBeVisible();
  await shot("output-entry");
  await page
    .getByRole("dialog", { name: "A4 图片预览" })
    .getByRole("button", { name: /取消|关闭/ })
    .first()
    .click();
  checks.push("草稿清理后JSON真实下载与A4原有导出流程启动");

  await page.setViewportSize({ width: 1440, height: 900 });
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  const glyphs = score.locator('g[data-system-index="0"] text');
  const candidates = await glyphs.evaluateAll((nodes: Element[]) =>
    nodes
      .map((node, index) => ({
        index,
        text: node.textContent ?? "",
        x: Number(node.getAttribute("x")),
        y: Number(node.getAttribute("y")),
      }))
      .filter((node) => /^[1-7]$/.test(node.text))
      .sort((a, b) => b.y - a.y || a.x - b.x),
  );
  assert.ok(candidates.length >= 2);
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
  for (const width of [1280, 1024, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(numbered).toHaveValue("1 2 3");
    await expect(
      page.getByRole("status").filter({ hasText: "2 处待处理草稿" }),
    ).toBeVisible();
  }
  await shot("numbered-drafts-1440");
  checks.push("真实字形点击建立简谱A/B独立草稿，1440/1280/1024/768往返保持");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header").first()).toBeHidden();
  await expect(page.locator('[class*="editorToolbar"]').first()).toBeHidden();
  await expect(page.locator('[class*="editorWorkspace"]')).toBeHidden();
  checks.push("打印媒体排除头部、工具带、工作区及状态带，仅保留原成品打印层");
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "browser-smoke-report.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        checks,
        errors,
        note: "阶段1自动化证据；真实系统IME另行人工验收。",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length, checks, errors }));
} catch (error) {
  await shot("smoke-failure");
  console.error(JSON.stringify({ checks, errors, failure: String(error) }));
  throw error;
} finally {
  await browser.close();
}
