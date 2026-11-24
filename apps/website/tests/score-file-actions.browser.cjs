/* global module */

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
  await selectScoreAction(page, "导出", "六线猫专用谱(.lxm)");
  const label = "导出六线猫专用谱(.lxm)";
  const dialog = page.getByRole("dialog", { name: label, exact: true });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    button(dialog, label).click(),
  ]);
  await dialog.waitFor({ state: "hidden" });
  return download;
}

function openScorePng(page, options) {
  return selectScoreAction(page, "导出", "图片(.png)", options);
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
