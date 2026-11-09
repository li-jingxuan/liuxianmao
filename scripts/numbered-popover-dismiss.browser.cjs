// NODE_PATH=<playwright node_modules> BASE_URL=http://localhost:3000 node scripts/numbered-popover-dismiss.browser.cjs
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    for (const size of ["14", "13"]) {
      await page.goto(process.env.BASE_URL || "http://localhost:3000");
      const target = page.locator(`[role="application"] text[font-size="${size}"]`).first();
      const popover = page.locator("#music-text-edit-popover");
      await target.click();
      await popover.waitFor({ state: "visible" });
      await page.getByRole("application").click({ position: { x: 10, y: 10 } });
      assert.equal(await popover.getAttribute("aria-hidden"), "true");
      const visibleDuringDismiss = await popover.evaluate(async (panel) => {
        const visible = [];
        // 连续绘制帧检查，避免等待过渡结束后才断言而漏掉残影。
        for (let frame = 0; frame < 4; frame++) {
          await new Promise(requestAnimationFrame);
          for (const control of panel.querySelectorAll("input, textarea, button")) {
            if (getComputedStyle(control).visibility === "visible" && control.getClientRects().length)
              visible.push(control.outerHTML);
          }
        }
        return visible;
      });
      assert.deepEqual(visibleDuringDismiss, []);
      await target.click();
      await popover.waitFor({ state: "visible" });
      assert.notEqual(await popover.getAttribute("aria-hidden"), "true");
      console.log(`PASS ${size === "14" ? "简谱" : "歌词"}气泡收起无残影，重新点选恢复`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
