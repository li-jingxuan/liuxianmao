// 沿用仓库既有音乐 SVG，转换成设计稿中需要的透明图标。
const fs = require('fs');
const path = require('path');
const sharp = require('/Users/lz0785/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const base = path.resolve(__dirname, '../../../../apps/website/assets/svg/music-controls');
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
    const source = path.resolve(__dirname, '../../../../docs/extracted-svg-icons', `${name}.svg`);
    const svg = fs.readFileSync(source,'utf8').replaceAll('currentColor','#202838');
    await sharp(Buffer.from(svg)).resize(48,48).png().toFile(path.join(out,`${name}.png`));
  }
})().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
