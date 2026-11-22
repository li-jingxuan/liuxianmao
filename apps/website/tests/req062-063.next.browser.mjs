import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(runtime.startsWith("/") ? pathToFileURL(runtime).href : runtime);
const browser = await chromium.launch({
  channel: process.env.LXM_BROWSER_CHANNEL,
  executablePath: process.env.LXM_BROWSER_EXECUTABLE,
});
const editorUrl = process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor";

try {
  const page = await browser.newPage({ viewport: { width: 1710, height: 960 } });
  const errors = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(editorUrl);
  const trigger = page.getByRole("button", { name: "帮助", exact: true });
  const shortcut = page.getByRole("menuitem", { name: "快捷键", exact: true });
  const dialog = page.getByRole("dialog", { name: "快捷键", exact: true });
  const search = dialog.getByRole("textbox", { name: "搜索快捷键" });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-editor-menu="help"]');
    return button && Object.keys(button).some(key => key.startsWith("__reactProps$"));
  });
  const file = page.getByRole("button", { name: "文件", exact: true });
  const view = page.getByRole("button", { name: "视图", exact: true });
  await file.press("ArrowUp");
  await page.getByRole("menuitem", { name: "返回首页", exact: true }).and(page.locator(":focus")).waitFor();
  await page.keyboard.press("ArrowLeft");
  await shortcut.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Escape");
  await trigger.and(page.locator(":focus")).waitFor();
  await shortcut.waitFor({ state: "hidden" });
  await view.press("ArrowDown");
  await page.getByRole("menuitem", { name: "隐藏侧栏", exact: true }).and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Tab");
  await trigger.and(page.locator(":focus")).waitFor();

  await trigger.press("ArrowDown");
  await shortcut.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Enter");
  await search.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await trigger.and(page.locator(":focus")).waitFor();

  await trigger.click();
  await shortcut.click();
  await search.and(page.locator(":focus")).waitFor();
  await dialog.getByRole("button", { name: "关闭快捷键" }).click();
  await dialog.waitFor({ state: "hidden" });
  await trigger.and(page.locator(":focus")).waitFor();
  assert.deepEqual(errors, [], "Opening or closing the shortcuts dialog logged errors");

  await page.setViewportSize({ width: 375, height: 860 });
  const header = trigger.locator("xpath=ancestor::header");
  const exportButton = header.getByRole("button", { name: "导出", exact: true });
  const desktopWorkspace = page.locator('[class*="editorContentWrapper"]');
  assert.ok(await desktopWorkspace.evaluate(workspace => {
    const scroll = workspace.parentElement;
    scroll.scrollLeft = scroll.scrollWidth;
    return scroll.scrollLeft > 0;
  }));
  const icon = await header.getByRole("link", { name: "六线猫首页" }).locator("img, svg").boundingBox();
  const title = await header.locator(":scope > strong").boundingBox();
  const exportBounds = await exportButton.boundingBox();
  assert.deepEqual([icon.width, icon.height], [32, 32]);
  assert.ok(Math.abs(title.x + title.width / 2 - 187.5) < 1);
  assert.ok(exportBounds.x + exportBounds.width <= 375);
  await page.setViewportSize({ width: 320, height: 860 });
  for (const name of ["文件", "编辑", "视图", "帮助", "导出"]) {
    const menuButton = header.getByRole("button", { name, exact: true });
    await menuButton.click();
    await page.waitForFunction(label => {
      const menu = document.querySelector(`[role="menu"][aria-label="${label}"]`);
      if (!menu) return false;
      const { width, left, right } = menu.getBoundingClientRect();
      return width >= 200 && left >= -0.5 && right <= innerWidth + 0.5;
    }, name);
    const rows = page.getByRole("menu", { name, exact: true }).getByRole("menuitem");
    const rowHeights = await rows.evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
    assert.ok(rowHeights.length > 0 && rowHeights.every(height => height > 0 && height <= 36), name);
    await page.keyboard.press("Escape");
    await menuButton.and(page.locator(":focus")).waitFor();
  }

  for (const [width, inset] of [[1710, 24], [390, 16], [320, 16]]) {
    await page.setViewportSize({ width, height: 960 });
    for (const route of ["/", "/guitar-advanced", "/guitar-advanced/progress"]) {
      await page.goto(new URL(route, editorUrl).href);
      const edges = await page.getByRole("link", { name: "六线猫首页" }).evaluate(brand => {
        const header = brand.closest("header");
        const navigation = header.querySelector("nav");
        return [
          brand.getBoundingClientRect().left - header.getBoundingClientRect().left,
          header.getBoundingClientRect().right - navigation.getBoundingClientRect().right,
        ];
      });
      const expectedInset = route === "/" ? (width <= 760 ? 18 : (width - 1320) / 2) : inset;
      assert.deepEqual(edges, [expectedInset, expectedInset], `${route} at ${width}px`);
    }
  }
  console.log("REQ-062/063 browser passed: shortcut dialog focus, no console errors, and header alignment.");
} finally {
  await browser.close();
}
