// 沿用仓库既有音乐 SVG，转换成设计稿中需要的透明图标。
const fs = require('fs');
const path = require('path');
const { createRequire } = require('node:module');
// 归档中的设计源文件继续读取仓库内的两套原始图标素材。
const root = path.resolve(__dirname, '../../../../../../..');
// 使用网站安装的 Sharp，由依赖安装过程匹配本机平台和架构。
const nextPackage = require.resolve('next/package.json', { paths: [path.join(root, 'apps/website')] });
const sharp = createRequire(nextPackage)('sharp');
const base = path.join(root, 'apps/website/assets/svg/music-controls');
const out = path.join(__dirname, 'icons');
fs.mkdirSync(out, { recursive: true });
const names = ['note-whole', 'note-half', 'note-quarter', 'note-eighth', 'note-sixteenth', 'note-thirty-second'];
(async () => {
  for (const name of names) {
    const svg = fs.readFileSync(path.join(base, `${name}.svg`), 'utf8').replaceAll('currentColor', '#344157');
    await sharp(Buffer.from(svg)).resize(48, 48).png().toFile(path.join(out, `${name}.png`));
  }
  // 简谱升降记号同样复用仓库音乐矢量，避免以普通字母 b 代替降号。
  for (const name of ['note-sharp24','note-flat24']) {
    const source = path.join(root, 'docs/archive/mvp/extracted-svg-icons', `${name}.svg`);
    const svg = fs.readFileSync(source,'utf8').replaceAll('currentColor','#202838');
    await sharp(Buffer.from(svg)).resize(48,48).png().toFile(path.join(out,`${name}.png`));
  }
})().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
