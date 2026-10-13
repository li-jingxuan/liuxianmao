// 从项目已安装的 Ant Design 读取实际 token 与官方图标，不手工重画通用图标。
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../..');
const requireFromAntd = require('module').createRequire(fs.realpathSync(path.join(root, 'apps/website/node_modules/antd/package.json')));
const antd = requireFromAntd('antd');
const iconsPackage = requireFromAntd.resolve('@ant-design/icons/package.json');
const requireFromIcons = require('module').createRequire(iconsPackage);
const svgPackage = requireFromIcons.resolve('@ant-design/icons-svg/package.json');
const svgRoot = path.dirname(svgPackage);
const sharp = require('/Users/lz0785/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const output = path.join(__dirname, 'antd-icons');
fs.mkdirSync(output, { recursive: true });
const names = ['SaveOutlined','PlusOutlined','SearchOutlined','DownOutlined','LeftOutlined','RightOutlined','UndoOutlined','RedoOutlined','AppstoreOutlined','BarsOutlined','MoreOutlined','StarOutlined','StarFilled','DeleteOutlined','CopyOutlined','EditOutlined','CloseOutlined','SettingOutlined','FileTextOutlined','FolderOutlined','HistoryOutlined','CheckCircleFilled','ExclamationCircleFilled','InfoCircleFilled','CloseCircleFilled','DownloadOutlined','LoadingOutlined','CheckOutlined','UpOutlined','MinusOutlined','QuestionCircleOutlined','EyeOutlined','TableOutlined','StopOutlined','FormOutlined','PictureOutlined'];
const theme = {
  token: { colorPrimary: '#285BE0', colorSuccess: '#19734F', colorWarning: '#92600C', colorError: '#BC3547', colorText: '#202838', colorTextSecondary: '#626E82', colorBgLayout: '#F4F6FA', colorBorder: '#D9D9D9', borderRadius: 6, fontSize: 14, controlHeight: 32 },
};
const escapeAttr = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;');
const serialize = node => `<${node.tag} ${Object.entries(node.attrs || {}).map(([k,v]) => `${k}="${escapeAttr(v)}"`).join(' ')}>${(node.children || []).map(serialize).join('')}</${node.tag}>`;
(async () => {
  for (const name of names) {
    const definition = require(path.join(svgRoot, 'lib/asn', `${name}.js`)).default;
    const icon = { ...definition.icon, attrs: { ...definition.icon.attrs, width: 32, height: 32, fill: '#202838', xmlns: 'http://www.w3.org/2000/svg' } };
    const svg = serialize(icon);
    fs.writeFileSync(path.join(output, `${name}.svg`), svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(output, `${name}.png`));
  }
  const licensePath = path.join(path.dirname(iconsPackage),'LICENSE');
  if (fs.existsSync(licensePath)) fs.copyFileSync(licensePath,path.join(output,'LICENSE'));
  fs.writeFileSync(path.join(output,'PROVENANCE.md'), '图标来自 @ant-design/icons-svg；源包声明 MIT。仅做尺寸转换与状态着色，未修改官方矢量路径。\n');
  const tokens = antd.theme.getDesignToken(theme);
  const provenance = { antdVersion: requireFromAntd('antd/package.json').version, iconsSvgVersion: require(svgPackage).version, theme, tokens, icons: names };
  fs.writeFileSync(path.join(__dirname,'antd-design-tokens.json'), JSON.stringify(provenance,null,2));
  process.stdout.write(JSON.stringify({version:provenance.antdVersion, icons:names.length, controlHeight:tokens.controlHeight, borderRadius:tokens.borderRadius}));
})().catch(error => { process.stderr.write(error.stack); process.exitCode=1; });
