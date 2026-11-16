import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const output = new URL("../../../output/playwright/req038-042-product/", import.meta.url);
const url = process.env.REQ_NEXT_URL ?? "http://127.0.0.1:3031/editor";
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
async function state(action, payload) {
  return page.evaluate(({ action, payload }) => {
    const svg = document.querySelector('svg[aria-label="六线谱编辑器"]');
    const key = Object.keys(svg).find(k => k.startsWith("__reactFiber$"));
    for (let fiber = svg[key]; fiber; fiber = fiber.return) {
      const store = fiber.memoizedProps?.session;
      if (typeof store?.getState !== "function" || !store.getState().document) continue;
      const current = store.getState();
      if (action === "execute") return current.execute(payload);
      if (action === "undo") { current.undo(); return; }
      return { document: current.document, history: current.historyDepth.past };
    }
    throw new Error("Editor session missing");
  }, { action, payload });
}
async function select(label, option) {
  await sidebar.getByRole("combobox", { name: label, exact: true }).click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: new RegExp(`^${option}$`) }).click();
}
async function shot(name) {
  await page.screenshot({ path: new URL(name + ".png", output).pathname, animations: "disabled" });
}
try {
  await mkdir(output, { recursive: true });
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("application", { name: "六线谱编辑器" }).waitFor();
  await sidebar.getByRole("tab", { name: "歌曲", exact: true }).click();
  const title = sidebar.getByRole("textbox", { name: "歌曲名称", exact: true });
  await title.waitFor();
  const before = await state();
  assert.equal(await sidebar.getByRole("combobox").count(), 1);
  assert.equal(await page.locator("[data-editor-actions-host]").count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: /编辑当前小节|清除调性|应用基础拍号|恢复本组/ }).count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: "应用曲谱信息", exact: true }).isDisabled(), true);
  assert.equal(await sidebar.locator("#settings-signature").innerText(), `${before.document.score.tracks[0].measures[0].timeSignature.numerator}/${before.document.score.tracks[0].measures[0].timeSignature.denominator}`);
  await shot("01-song-readonly");
  await title.fill("REQ040独立保存名称");
  const capo = before.document.score.tracks[0].capo === 2 ? 3 : 2;
  await select("变调夹", `${capo} 品`);
  for (const name of ["应用曲谱信息", "应用变调夹"]) {
    const apply = sidebar.getByRole("button", { name, exact: true });
    assert.match(await apply.getAttribute("class"), /ant-btn-primary/);
    assert.equal(Math.round((await apply.boundingBox()).height), 32);
    const exportColor = await page.getByRole("button", { name: "导出 A4 图片", exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
    await page.waitForFunction(({ name, color }) => {
      const button = document.querySelector(`button[aria-label="${name}"]`);
      return button && !button.disabled && getComputedStyle(button).backgroundColor === color;
    }, { name, color: exportColor });
    assert.equal(await apply.evaluate(el => getComputedStyle(el).backgroundColor), exportColor);
  }
  assert.equal(await sidebar.locator('dl[aria-label="曲谱调性（只读）"] #settings-signature').count(), 1);
  await shot("08-song-primary-buttons");
  await sidebar.getByRole("button", { name: "应用曲谱信息", exact: true }).click();
  let saved = await state();
  assert.equal(saved.document.score.title, "REQ040独立保存名称");
  assert.equal(saved.document.score.tracks[0].capo, before.document.score.tracks[0].capo);
  assert.deepEqual(saved.document.score.meta, before.document.score.meta);
  assert.equal(saved.document.score.keySignature, before.document.score.keySignature);
  await sidebar.getByRole("button", { name: "应用变调夹", exact: true }).click();
  saved = await state();
  assert.equal(saved.document.score.tracks[0].capo, capo);
  assert.equal(saved.history, before.history + 2);
  await state("undo");
  assert.equal((await state()).document.score.tracks[0].capo, before.document.score.tracks[0].capo);

  // 歌曲输入只在当前页等待应用，离开后不进入草稿确认。
  const applied = await state();
  async function dirtySong() {
    await title.fill("离开后应丢弃的名称");
    await sidebar.getByRole("textbox", { name: "编谱作者", exact: true }).fill("应丢弃的作者");
    await select("变调夹", `${capo} 品`);
  }
  async function assertDiscarded() {
    await page.waitForFunction(() => {
      const input = document.querySelector("#settings-title");
      return input && input.value !== "离开后应丢弃的名称";
    });
    assert.equal(await title.inputValue(), applied.document.score.title);
    assert.equal(await sidebar.getByRole("textbox", { name: "编谱作者", exact: true }).inputValue(), applied.document.score.arranger);
    assert.equal(await sidebar.getByRole("button", { name: "应用变调夹", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("dialog", { name: "先处理未应用的输入" }).count(), 0);
    assert.equal(await page.getByRole("alertdialog").count(), 0);
    assert.deepEqual(await state(), applied);
  }
  await dirtySong();
  await sidebar.getByRole("tab", { name: "选区", exact: true }).click();
  await sidebar.getByRole("tab", { name: "歌曲", exact: true }).click();
  await assertDiscarded();
  await dirtySong();
  await page.getByRole("button", { name: "编辑面板", exact: true }).click();
  await page.getByRole("button", { name: "编辑面板", exact: true }).click();
  await assertDiscarded();
  await dirtySong();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出曲谱", exact: true }).click();
  const download = await downloadEvent;
  await download.delete();
  await assertDiscarded();
  await dirtySong();
  await page.getByRole("button", { name: "导出 A4 图片", exact: true }).click();
  await page.getByRole("button", { name: "关闭预览", exact: true }).first().click();
  await assertDiscarded();
  await dirtySong();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入曲谱", exact: true }).click();
  await chooser;
  await assertDiscarded();
  await shot("07-song-discarded");
  // 外部调性更新不覆盖仍在歌曲页编辑的名称。
  await title.fill("保留的名称草稿");
  const old = (await state()).document;
  assert.equal((await state("execute", { type: "score.setInfo", title: old.score.title, arranger: old.score.arranger, keySignature: "C", tonality: { version: 1, tonic: "A", mode: "minor", minorTonicDegree: 6 } })).ok, true);
  await sidebar.getByText("A小调", { exact: true }).waitFor();
  assert.equal(await title.inputValue(), "保留的名称草稿");
  assert.equal(await sidebar.getByRole("button", { name: "应用曲谱信息", exact: true }).isDisabled(), false);
  await sidebar.getByRole("button", { name: "应用曲谱信息", exact: true }).click();
  assert.deepEqual((await state()).document.score.meta["lxm:tonality"], { version: 1, tonic: "A", mode: "minor", minorTonicDegree: 6 });
  await shot("02-song-minor-readonly");

  // 用真实核心校验错误检查短提示布局，不增加产品校验规则。
  await title.fill("错误\u0001名称");
  const alert = sidebar.locator('[data-settings-group="info"] [role="alert"]');
  await alert.waitFor();
  assert.match(await alert.innerText(), /格式不合法/);
  const box = await alert.boundingBox();
  assert.ok(box.width > 250 && box.height < 65);
  await shot("03-compact-error");
  // 即使输入校验失败，点击谱面离开也直接丢弃，不要求先恢复或应用。
  const beforeScoreClick = await state();
  const score = page.getByRole("application", { name: "六线谱编辑器" });
  await score.getByText("C", { exact: true }).first().click();
  const popover = page.locator("#chord-edit-popover");
  await popover.waitFor();
  await page.waitForFunction(() => document.querySelector("#settings-title")?.value === "保留的名称草稿");
  assert.equal(await page.getByRole("alertdialog").count(), 0);
  assert.deepEqual(await state(), beforeScoreClick);
  await popover.getByRole("button", { name: "更多和弦", exact: true }).click();
  const more = page.locator(".ant-dropdown:visible");
  await more.getByText("A小调·和弦推荐", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "设置调性", exact: true }).count(), 0);
  await shot("04-recommend-minor");
  await more.getByRole("button", { name: /和弦库/ }).click();
  const library = page.getByRole("dialog", { name: /^和弦库/ });
  const list = library.getByTestId("chord-library-scroll");
  await list.getByRole("button").first().waitFor();
  assert.equal(await list.getByRole("button").count(), 192);
  assert.equal(await list.locator("section").count(), 4);
  await library.getByText("其他和弦", { exact: true }).waitFor({ state: "attached" });
  await shot("05-library-restored");
  await page.setViewportSize({ width: 1400, height: 720 });
  await shot("06-library-1400x720");
  assert.deepEqual(errors, []);
  const result = { passed: true, url, checks: ["调性与基础拍号只读并合并紧凑展示", "两处应用与导出图片统一蓝色主按钮", "旧底栏与歌曲小节跳转入口已移除", "名称与变调夹独立应用及撤销", "外部只读调性更新保留名称草稿", "切页、收起、文件导入导出及图片导出直接丢弃歌曲输入，无草稿确认或文档历史变更", "真实校验错误紧凑展示", "小调推荐标题及设置入口删除", "恢复旧分组且192项齐全", "真实Next页面无运行错误"], errors };
  await writeFile(new URL("result.json", output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await shot("failure").catch(() => {});
  throw error;
} finally { await browser.close(); }
