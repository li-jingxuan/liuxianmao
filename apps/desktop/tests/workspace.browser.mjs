import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { _electron } = await import(isAbsolute(runtime) ? pathToFileURL(runtime).href : runtime);
const desktop = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(join(tmpdir(), "lxm-workspace-"));
const scorePath = join(profile, "理想.lxm");
let electron;
try {
  await copyFile(new URL("../../../packages/lxm-editor/example/ideal-score.lxm.json", import.meta.url), scorePath);
  electron = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [desktop, `--user-data-dir=${profile}`],
  });
  const page = await electron.firstWindow();
  const shell = page.locator("[data-editor-shell]");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "打开曲谱", exact: true }).waitFor();
  assert.equal((await shell.boundingBox()).height, 900, "空工作区应填满窗口");

  await electron.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ filePaths: [file], canceled: false });
  }, scorePath);
  await page.getByRole("button", { name: "打开曲谱", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "打开曲谱预览" });
  await preview.getByText("理想", { exact: true }).waitFor();
  await preview.getByRole("button", { name: "打开曲谱", exact: true }).click();
  const viewport = page.locator("[data-score-viewport]");
  await viewport.waitFor();
  const footer = shell.locator(":scope > [role=status]");
  const before = await footer.boundingBox();
  assert.ok(Math.abs(before.y + before.height - 900) < 1, "长谱的状态栏应贴合窗口底边");
  await viewport.hover({ position: { x: 100, y: 160 } });
  await page.mouse.wheel(0, 1000);
  await page.waitForFunction(() => document.querySelector("[data-score-viewport]").scrollTop > 300);
  assert.deepEqual(await footer.boundingBox(), before);
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);

  await page.setViewportSize({ width: 800, height: 600 });
  const pageHost = page.locator("[data-editor-page]");
  await pageHost.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const sidebar = await page.locator("[data-music-text-sidebar]").boundingBox();
  const header = await shell.locator(":scope > header").boundingBox();
  assert.equal((await shell.boundingBox()).width, 1400);
  assert.ok(Math.abs(sidebar.x + sidebar.width - 800) < 1, "横向滚动应能看到整个属性栏");
  assert.ok(Math.abs(header.x) < 1 && header.width === 800, "横移工作区时菜单应留在视口内");
  console.log("桌面空会话、多页谱面独立滚动、固定状态栏和窄窗横移通过。");
} finally {
  try { await electron?.close(); }
  finally { await rm(profile, { recursive: true, force: true }); }
}
