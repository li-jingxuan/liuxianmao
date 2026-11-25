import assert from "node:assert/strict";

const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const origin = (process.env.REQ_NEXT_ORIGIN ?? "http://127.0.0.1:3031").replace(/\/$/, "");
const browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/editor`);
  const score = page.locator('svg[aria-label="六线谱编辑器"]');
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    return svg && Object.keys(svg).some(key => key.startsWith("__reactFiber"));
  });

  // 默认《理想》第一房跨第 32–33 小节。按实际括线点击，检验侧栏切换到范围尾部时仍打开起始房子。
  const target = score.locator("[data-repeat-ending-target]").first();
  const selected = target.locator("[data-repeat-ending-selected]");
  const preview = score.locator("[data-repeat-ending-preview]").first();
  await target.locator("[data-repeat-ending-hit]").click();
  const dialog = page.getByRole("dialog", { name: /编辑反复房子/ });
  await dialog.waitFor();
  assert.equal(await selected.getAttribute("stroke-width"), "1");
  assert.equal(await preview.count(), 0);
  await dialog.locator('[name="passCount"]').selectOption("3");
  await preview.waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await preview.waitFor({ state: "detached" });

  // 等候关闭动画交还焦点，从用户此刻的真实焦点再次按 Esc，避免测试手动 focus 掩盖键盘失效。
  await page.waitForFunction(() => document.activeElement?.closest('svg[aria-label="六线谱编辑器"]'));
  await page.keyboard.press("Escape");
  await selected.waitFor({ state: "detached" });
  await target.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  assert.ok(await target.evaluate(node => node === document.activeElement && node.matches(":focus-visible")));
  assert.equal(await target.locator("[data-repeat-ending-focus]").evaluate(node => getComputedStyle(node).visibility), "visible");
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  console.log("BUG-090 passed: cross-measure pointer entry, clean selection, draft, Escape and keyboard focus");
} finally {
  await browser.close();
}
