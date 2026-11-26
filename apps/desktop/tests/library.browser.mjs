import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runtime = process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright";
const { _electron } = await import(isAbsolute(runtime) ? pathToFileURL(runtime).href : runtime);
const desktop = fileURLToPath(new URL("../", import.meta.url));
const work = await mkdtemp(join(tmpdir(), "lxm-library-"));
const profile = join(work, "profile");
const indexPath = join(profile, "score-library.json");
const firstPath = join(work, "我的曲谱.lxm");
const copyPath = join(work, "另存曲谱.lxm");
const originalPath = join(work, "理想.LXM");
const secondOriginalPath = join(work, "其他", "理想.LXM");
const movedPath = join(work, "归档", "理想.LXM");
const malformedPath = join(work, "损坏.lxm");
const legacyPath = join(work, "旧练习.lxm");
const retryPath = join(work, "已保存待登记.lxm");
let electron;
let page;
const errors = [];
const remoteRequests = [];
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const catalog = async () => (await readJson(indexPath)).entries;
const button = (context, name) => context.getByRole("button", { name, exact: true });
const sheet = (name) => page.getByRole("dialog", { name, exact: true });
const row = (name) => button(page, `打开 ${name}`);
const back = () => page.getByRole("link", { name: "返回谱库", exact: true });
const leave = () => sheet("离开前保存曲谱？");
const saveAndLeave = () => leave().getByRole("button", { name: /^(?:loading )?保存并继续$/ });
const editor = () => page.locator("[data-editor-shell]");
const song = () => page.getByRole("textbox", { name: "歌曲名称" });

async function launch() {
  electron = await _electron.launch({
    executablePath: process.env.LXM_ELECTRON_EXECUTABLE ?? createRequire(import.meta.url)("electron"),
    args: [desktop, `--user-data-dir=${profile}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  page = await electron.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()); });
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("heading", { name: "六线谱库", exact: true }).waitFor();
}

// 只替换原生对话框的选择回执。文件校验、IPC、窗口、编辑器及索引仍使用安装包同一运行路径。
async function pick(filePath) {
  await electron.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => path ? { filePaths: [path], canceled: false } : { filePaths: [], canceled: true };
  }, filePath);
}

async function saveTo(filePath) {
  await electron.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => path ? { filePath: path, canceled: false } : { canceled: true };
  }, filePath);
}

async function nativeFile(label, accelerator) {
  const actual = await electron.evaluate(({ Menu, BrowserWindow }, name) => {
    const action = Menu.getApplicationMenu().items.find((item) => item.label === "文件").submenu.items.find((item) => item.label === name);
    action.click(action, BrowserWindow.getAllWindows()[0]);
    return action.accelerator;
  }, label);
  assert.equal(actual, accelerator);
}

async function newScore(title, arranger = "") {
  await button(page, "新建曲谱").click();
  const dialog = sheet("新建曲谱");
  await dialog.getByLabel("曲名").fill(title);
  await dialog.getByLabel("编配（选填）").fill(arranger);
  await button(dialog, "开始写谱").click();
  await editor().waitFor();
}

async function importPreview(path, action = "加入谱库") {
  await pick(path);
  await button(page, "导入曲谱").click();
  const dialog = sheet("导入曲谱预览");
  await dialog.getByText(path.split(/[\\/]/).at(-1), { exact: true }).waitFor();
  await button(dialog, action).waitFor();
  return dialog;
}

async function setSongTitle(value) {
  await song().fill(value);
  await button(page, "应用曲谱信息").click();
  await editor().locator("header").getByText(value, { exact: true }).waitFor();
}

try {
  await mkdir(join(work, "归档"));
  await mkdir(join(work, "其他"));
  await copyFile(new URL("../../../packages/lxm-editor/example/ideal-score.lxm.json", import.meta.url), originalPath);
  await copyFile(originalPath, secondOriginalPath);
  await writeFile(malformedPath, Buffer.from([0xff, 0xfe, 0x00]));
  await launch();
  await page.getByRole("heading", { name: "谱库里还没有曲谱" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1440);
  assert.equal(await editor().count(), 0);
  await assert.rejects(stat(indexPath), { code: "ENOENT" });

  // 单独检查取消入口和新谱草稿：先放弃未应用输入，再处理已提交的空谱。
  await button(page, "新建曲谱").click();
  await button(sheet("新建曲谱"), "取消").click();
  await newScore("我的首份曲谱", "本机编配");
  await page.getByRole("tab", { name: "歌曲", exact: true }).click();
  await song().fill("暂未应用");
  await back().click();
  const draft = sheet("先处理未应用的输入");
  await button(draft, "返回编辑").click();
  await draft.waitFor({ state: "hidden" });
  assert.equal(await song().inputValue(), "暂未应用");
  await back().click();
  await button(draft, "放弃全部草稿").click();
  await button(draft, "确认放弃 1 处").click();
  await leave().waitFor();
  await button(leave(), "继续编辑").click();
  assert.equal(await song().inputValue(), "我的首份曲谱");
  const tempo = page.getByLabel("曲谱速度", { exact: true });
  await tempo.fill("128");
  await button(page, "应用演奏设置").click();
  await back().click();
  await saveTo(null);
  await saveAndLeave().click();
  await leave().locator("button.ant-btn-primary:not(.ant-btn-loading)").waitFor();
  await saveTo(firstPath);
  await saveAndLeave().click();
  await row("我的首份曲谱").waitFor();
  const saved = await readJson(firstPath);
  assert.equal(saved.score.title, "我的首份曲谱");
  assert.equal(saved.score.arranger, "本机编配");
  assert.equal(saved.score.tempoBpm, 128);
  assert.equal(saved.score.tracks[0].measures.length, 4);
  assert.deepEqual(saved.score.tracks[0].measures[0].timeSignature, { numerator: 4, denominator: 4 });
  const [first] = await catalog();
  assert.equal(first.tonality, "C 大调");

  // 确认导入留在列表，取消不登记，大小写扩展名可读，同名异路径仍分别登记。
  const canceledImport = await importPreview(originalPath);
  await button(canceledImport, "取消").click();
  assert.equal((await catalog()).length, 1);
  const changedPreview = await importPreview(originalPath);
  await writeFile(originalPath, `${await readFile(originalPath, "utf8")}\n`);
  await button(changedPreview, "加入谱库").click();
  await changedPreview.getByRole("alert").filter({ hasText: "目标文件已被外部修改" }).waitFor();
  await button(changedPreview, "取消").click();
  assert.equal((await catalog()).length, 1);
  await pick(malformedPath);
  await button(page, "导入曲谱").click();
  await sheet("无法读取曲谱").getByText("文件不是有效的 UTF-8 曲谱文件").waitFor();
  await button(sheet("无法读取曲谱"), "取消").click();
  await button(await importPreview(originalPath), "加入谱库").click();
  await row("理想").waitFor();
  assert.equal((await catalog()).find((entry) => entry.name === "理想.LXM").openedAt, 0);
  await button(await importPreview(originalPath, "确认登记"), "确认登记").click();
  await sheet("导入曲谱预览").waitFor({ state: "hidden" });
  assert.equal((await catalog()).length, 2);
  await button(await importPreview(secondOriginalPath), "加入谱库").click();
  await page.waitForFunction(() => document.querySelectorAll(".library-row-name").length === 3);
  const search = page.getByRole("searchbox", { name: "搜索曲名、文件名或编配" });
  await search.fill("不存在");
  await button(page, "清除搜索").click();
  await search.fill("本机编配");
  assert.equal(await page.locator(".library-row-name").count(), 1);
  await search.fill("");
  await page.getByLabel("曲谱排序").selectOption("opened");
  assert.equal(await page.locator(".library-row-name").first().getAttribute("aria-label"), "打开 我的首份曲谱");
  await button(page, "管理 理想").first().click();
  await button(page, "重命名显示名…").click();
  await sheet("重命名显示名").getByLabel("库内显示名").fill("馆内别名");
  await button(sheet("重命名显示名"), "保存显示名").click();
  await row("馆内别名").waitFor();
  const alias = (await catalog()).find((item) => item.displayName === "馆内别名");
  assert.equal((await readJson(alias.path)).score.title, "理想");

  // 路径不能作为条目 ID。移走后先拒绝已登记文件，再保留旧条目 ID 和别名完成定位。
  const invalidBindings = await page.evaluate(async (path) => {
    const bridge = window.desktopEditorHost;
    return bridge.openLibraryScore(path);
  }, alias.path);
  assert.equal(invalidBindings.status, "error");
  await pick(alias.path);
  const previewOnly = await page.evaluate(async () => {
    const bridge = window.desktopEditorHost;
    const preview = await bridge.importScore();
    if (preview.status !== "ok") throw new Error("无法创建权限测试预览");
    const save = await bridge.saveScore({ fileId: preview.value.id, suggestedName: "试写.lxm", text: "{}" }, {
      title: "试写", arranger: "", tonality: "C 大调", meter: "4/4", measures: 4,
    });
    await bridge.discardScore(preview.value.id);
    return save;
  });
  assert.equal(previewOnly.status, "error");
  assert.match(previewOnly.message, /窗口授权/);
  await rename(alias.path, movedPath);
  await row("馆内别名").click();
  const missing = sheet("无法打开曲谱");
  await missing.getByText(alias.path, { exact: true }).waitFor();
  const other = (await catalog()).find((entry) => entry.name === "理想.LXM" && entry.id !== alias.id);
  await pick(other.path);
  await button(missing, "重新定位…").click();
  await sheet("无法读取曲谱").getByText(/另一条谱库记录登记/).waitFor();
  await pick(movedPath);
  await button(sheet("无法读取曲谱"), "重新选择").click();
  await button(sheet("确认新的文件位置"), "更新位置并打开").click();
  await editor().waitFor();
  await back().click();
  await row("馆内别名").waitFor();
  const relocated = (await catalog()).find((entry) => entry.id === alias.id);
  assert.equal(relocated.displayName, "馆内别名");
  assert.equal(relocated.path, await realpath(movedPath));
  assert.equal(relocated.savedAt, alias.savedAt);
  assert.ok(relocated.openedAt > 0);

  await button(page, "管理 馆内别名").click();
  await button(page, "从谱库移除…").click();
  await sheet("从谱库移除").getByText(relocated.path, { exact: true }).waitFor();
  await button(sheet("从谱库移除"), "取消").click();
  await row("馆内别名").waitFor();
  await button(page, "管理 馆内别名").click();
  await button(page, "从谱库移除…").click();
  await button(sheet("从谱库移除"), "仅从谱库移除").click();
  await row("馆内别名").waitFor({ state: "hidden" });
  assert.equal((await readJson(movedPath)).score.title, "理想");

  // 原生打开必须先预览；编辑器里换谱还需确认已应用未保存内容。
  await pick(movedPath);
  await nativeFile("打开…", "CommandOrControl+O");
  const nativePreview = sheet("打开曲谱预览");
  await button(nativePreview, "取消").click();
  assert.equal((await catalog()).some((item) => item.path === relocated.path), false);
  await nativeFile("打开…", "CommandOrControl+O");
  await button(nativePreview, "打开曲谱").click();
  await editor().waitFor();
  await page.getByRole("tab", { name: "歌曲", exact: true }).click();
  await setSongTitle("准备放弃的修改");
  await pick(firstPath);
  await nativeFile("打开…", "CommandOrControl+O");
  await button(nativePreview, "打开曲谱").click();
  await button(leave(), "不保存并继续").click();
  await editor().locator("header").getByText("我的首份曲谱", { exact: true }).waitFor();
  assert.equal((await readJson(movedPath)).score.title, "理想");

  // 文件外部改写后保存失败。在同一个离开保护内另存可恢复，且外部内容仍在磁盘上。
  await page.getByRole("tab", { name: "歌曲", exact: true }).click();
  await setSongTitle("会保全的编辑");
  await writeFile(firstPath, JSON.stringify({ ...saved, score: { ...saved.score, title: "外部改写" } }));
  await back().click();
  await saveAndLeave().click();
  await leave().getByRole("alert").getByText(/目标文件已被外部修改/).waitFor();
  await saveTo(copyPath);
  await button(leave(), "另存为…").click();
  await row("会保全的编辑").waitFor();
  assert.equal((await readJson(firstPath)).score.title, "外部改写");
  assert.equal((await readJson(copyPath)).score.title, "会保全的编辑");
  assert.ok((await catalog()).some((item) => item.id === first.id));

  // 从真实 v7 形状读入，取消升级时不触碰原件；显式确认才进行 v8 覆盖。
  const legacy = structuredClone(saved);
  legacy.schemaVersion = 7;
  legacy.score.title = "旧练习";
  delete legacy.score.tempoBpm;
  for (const track of legacy.score.tracks) {
    delete track.numberedMarks;
    for (const measure of track.measures) delete measure.numberedVoice;
  }
  await writeFile(legacyPath, JSON.stringify(legacy));
  const oldPreview = await importPreview(legacyPath);
  await oldPreview.getByText(/v7 旧谱/).waitFor();
  await button(oldPreview, "加入谱库").click();
  await row("旧练习").click();
  await editor().waitFor();
  await electron.evaluate(({ dialog }) => {
    globalThis.upgradeResponses = 0;
    dialog.showMessageBox = async () => { globalThis.upgradeResponses++; return { response: 1 }; };
  });
  await nativeFile("保存", "CommandOrControl+S");
  await button(page, "保存").click({ trial: true });
  assert.equal(await electron.evaluate(() => globalThis.upgradeResponses), 1);
  assert.equal((await readJson(legacyPath)).schemaVersion, 7);
  await electron.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
  await nativeFile("保存", "CommandOrControl+S");
  await page.getByText("已保存「旧练习.lxm」。", { exact: true }).waitFor();
  assert.equal((await readJson(legacyPath)).schemaVersion, 8);
  await back().click();

  // 模拟索引升级不兼容。原件先落盘，恢复索引后重试只登记，文件时间与内容均不二次提交。
  await newScore("原件保存成功");
  const previousIndex = await readFile(indexPath);
  await writeFile(indexPath, JSON.stringify({ version: 99, entries: [] }));
  await saveTo(retryPath);
  await back().click();
  await saveAndLeave().click();
  await page.getByRole("alert").filter({ hasText: "原件已保存" }).waitFor();
  assert.equal((await readJson(retryPath)).score.title, "原件保存成功");
  assert.equal((await readJson(indexPath)).version, 99);
  const onDisk = await stat(retryPath, { bigint: true });
  await writeFile(indexPath, previousIndex);
  await button(page, "重试登记").click();
  await row("原件保存成功").waitFor();
  assert.equal((await stat(retryPath, { bigint: true })).mtimeNs, onDisk.mtimeNs);

  // 完全退出并断网重启同一份用户数据。来自原件的谱内值优先于索引缓存，编辑器绑定可直接写回。
  await electron.close();
  electron = undefined;
  await launch();
  await page.getByRole("heading", { name: "最近打开", exact: true }).waitFor();
  assert.ok((await page.locator(".library-recent").count()) <= 3);
  assert.equal(await page.locator(".library-recent .library-cover svg text").first().textContent(), "TAB");
  await button(page, "管理 我的首份曲谱").click();
  const actions = page.locator(".library-manage-menu").getByRole("button");
  assert.deepEqual(await actions.allTextContents(), ["打开曲谱", "重命名显示名…", "从谱库移除…"]);
  await actions.first().click();
  await editor().locator("header").getByText("外部改写", { exact: true }).waitFor();
  await electron.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.print = (options, respond) => {
      globalThis.printOptions = options;
      respond(false, "Print job canceled");
    };
  });
  await nativeFile("打印…", "CommandOrControl+P");
  const print = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "A4 打印预览", exact: true }) });
  await print.locator("[data-image-export-status=ready]").waitFor();
  await button(print, "打开打印窗口").click();
  await print.getByText("已取消打印，可重新打印。", { exact: true }).waitFor();
  assert.deepEqual(await electron.evaluate(() => globalThis.printOptions), {
    silent: false, printBackground: true, pageSize: "A4", margins: { marginType: "none" },
  });
  await button(print, "关闭预览").click();
  await page.getByRole("tab", { name: "歌曲", exact: true }).click();
  assert.equal(await page.getByLabel("曲谱速度", { exact: true }).inputValue(), "128");
  await setSongTitle("断网重启后直存");
  await nativeFile("关闭窗口", "CommandOrControl+W");
  await button(leave(), "继续编辑").click();
  if (process.platform === "darwin") {
    await electron.evaluate(({ app, Menu }) => {
      const quit = Menu.getApplicationMenu().items[0].submenu.items.find((item) => item.label === `退出${app.name}`);
      quit.click(quit);
    });
    await button(leave(), "继续编辑").click();
  }
  await back().click();
  await saveAndLeave().click();
  await row("断网重启后直存").waitFor();
  assert.equal((await readJson(firstPath)).score.title, "断网重启后直存");
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
  console.log("REQ-016 真实 Electron 谱库、原件读写、草稿与保存保护、恢复与离线重启通过。");
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(await page.locator('dialog[open], [role="dialog"]:visible, [role="alert"]:visible').allTextContents());
  }
  throw error;
} finally {
  try {
    if (electron) {
      // 失败时可能还在编辑器保护框，用测试进程关闭临时窗口，确保错误能够及时上报。
      await electron.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
      await electron.close();
    }
  }
  finally { await rm(work, { recursive: true, force: true }); }
}
