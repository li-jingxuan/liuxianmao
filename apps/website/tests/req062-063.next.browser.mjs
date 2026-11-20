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
  const trigger = page.getByRole("button", { name: "快捷键", exact: true });
  const dialog = page.getByRole("dialog", { name: "快捷键", exact: true });
  const search = dialog.getByRole("textbox", { name: "搜索快捷键" });
  const tooltip = page.getByRole("tooltip", { name: "快捷键", exact: true });
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-open-shortcuts]");
    return button && Object.keys(button).some(key => key.startsWith("__reactProps$"));
  });
  await trigger.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await trigger.and(page.locator(":focus")).waitFor();
  await tooltip.waitFor();
  await trigger.press("Enter");
  await search.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await trigger.and(page.locator(":focus")).waitFor();

  await page.keyboard.press("Shift+Tab");
  await tooltip.waitFor({ state: "hidden" });
  await trigger.hover();
  await tooltip.waitFor();
  await trigger.click();
  await search.and(page.locator(":focus")).waitFor();
  await dialog.getByRole("button", { name: "关闭快捷键" }).click();
  await dialog.waitFor({ state: "hidden" });
  await trigger.and(page.locator(":focus")).waitFor();
  assert.deepEqual(errors, [], "Opening or closing the shortcuts dialog logged errors");

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
      assert.deepEqual(edges, [inset, inset], `${route} at ${width}px`);
    }
  }
  console.log("REQ-062/063 browser passed: shortcut dialog focus, no console errors, and shared header alignment.");
} finally {
  await browser.close();
}
