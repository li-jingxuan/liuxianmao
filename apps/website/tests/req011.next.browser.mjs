import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { downloadScoreJson } from "./score-file-actions.browser.cjs";

const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ channel: process.env.LXM_BROWSER_CHANNEL });
const home = (process.env.REQ_NEXT_ORIGIN ?? "http://127.0.0.1:3031").replace(/\/$/, "");
const editor = `${home}/editor`;
const viewport = { width: 1440, height: 900 };
const editorLink = (page) => page.getByRole("link", { name: "打开 Web 编辑器" });
const openProductDetails = (page) => page.getByText("曲谱示例与开发者接入", { exact: true }).click();
const songTitle = (page) => page.getByRole("textbox", { name: "歌曲名称" });

async function openSongSettings(page) {
  // 大谱面初次载入时，静态工具栏可能先于编辑器水合显示。检查点击是否实际切换了面板。
  const tab = page.getByRole("tab", { name: "歌曲", exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await tab.click();
    if (await songTitle(page).waitFor({ timeout: 1500 }).then(() => true, () => false)) return;
  }
  await songTitle(page).waitFor();
}

try {
  // 禁用脚本后只读用户可见的正文，防止客户端脚本或 Next 序列化数据中的词被误计为公开说明。
  const reader = await browser.newPage({ viewport, javaScriptEnabled: false });
  assert.equal((await reader.goto(home, { waitUntil: "domcontentloaded" })).status(), 200);
  // REQ-015 保留原有正文与快捷操作，由页尾的原生折叠区打开。
  await openProductDetails(reader);
  const text = await reader.getByRole("main").innerText();
  for (const fact of ["六线猫", "浏览器", "六线谱（TAB）", "简谱", "歌词", "和弦指法", "风吹过山谷", ".lxm", "UTF-8 JSON", "A4 PNG", "打印", "PDF", "React 19", "播放计划"]) {
    assert.ok(text.includes(fact), `首页可见正文缺少 ${fact}`);
  }
  for (const name of ["@liuxianmao/lxm-editor-react", "@liuxianmao/lxm-editor"]) {
    await reader.locator("#developers").getByText(name, { exact: true }).waitFor();
  }
  assert.equal(new URL(await editorLink(reader).getAttribute("href"), reader.url()).href, editor);
  await reader.close();

  // 通过首页主入口改名并下载。重开浏览器上下文再导入下载字节，排除沿用旧会话的可能。
  const writer = await browser.newPage({ viewport });
  await writer.goto(home, { waitUntil: "domcontentloaded" });
  await editorLink(writer).click();
  await writer.waitForURL(editor, { waitUntil: "domcontentloaded" });
  await openSongSettings(writer);
  const title = "GEO 验收练习谱";
  await songTitle(writer).fill(title);
  await writer.getByRole("button", { name: "应用曲谱信息" }).click();
  const download = await downloadScoreJson(writer);
  const buffer = await readFile(await download.path());
  const name = download.suggestedFilename();
  assert.ok(name.endsWith(".lxm"));
  assert.equal(JSON.parse(buffer.toString("utf8")).score.title, title);
  await writer.close();

  const reopened = await browser.newPage({ viewport });
  await reopened.goto(home, { waitUntil: "domcontentloaded" });
  await openProductDetails(reopened);
  await reopened.getByRole("button", { name: "导入曲谱", exact: true }).click();
  const importer = reopened.getByRole("dialog", { name: "导入曲谱" });
  await importer.getByLabel("选择六线猫曲谱文件").setInputFiles({ name, mimeType: "application/json", buffer });
  await importer.getByText(title, { exact: true }).waitFor();
  await importer.getByRole("button", { name: "打开曲谱" }).click();
  await reopened.waitForURL(editor, { waitUntil: "domcontentloaded" });
  await openSongSettings(reopened);
  assert.equal(await songTitle(reopened).inputValue(), title);
  console.log("REQ-011 passed: visible HTML without JavaScript, editor link, .lxm export and reimport");
} finally {
  await browser.close();
}
