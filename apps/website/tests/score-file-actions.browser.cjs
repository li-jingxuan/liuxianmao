const button = (page, name) => page.getByRole("button", { name, exact: true });

async function selectScoreAction(page, group, item, { dispatch = false } = {}) {
  const trigger = button(page, group);
  if (dispatch) await trigger.dispatchEvent("click");
  else await trigger.click();
  const option = page.getByRole("menuitem", { name: item, exact: true });
  if (dispatch) await option.dispatchEvent("click");
  else await option.click();
}

async function downloadScoreJson(page) {
  await selectScoreAction(page, "导出", "JSON 曲谱");
  const dialog = page.getByRole("dialog", { name: "导出 JSON", exact: true });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    button(dialog, "导出 JSON").click(),
  ]);
  await dialog.waitFor({ state: "hidden" });
  return download;
}

function openScorePng(page, options) {
  return selectScoreAction(page, "导出", "PNG 图片", options);
}

async function openScoreImport(page, file, options) {
  await selectScoreAction(page, "文件", "导入曲谱", options);
  return page.getByRole("dialog", { name: "导入曲谱", exact: true })
    .getByLabel("选择六线猫曲谱文件", { exact: true }).setInputFiles(file);
}

async function confirmScoreImport(page) {
  const importer = page.getByRole("dialog", { name: "导入曲谱", exact: true });
  await button(importer, "打开曲谱").click();
  await importer.waitFor({ state: "hidden" });
  const leave = page.getByRole("dialog", { name: "离开前导出曲谱？", exact: true });
  if (await leave.isVisible()) await button(leave, "不导出并继续").click();
}

module.exports = { selectScoreAction, downloadScoreJson, openScorePng, openScoreImport, confirmScoreImport };
