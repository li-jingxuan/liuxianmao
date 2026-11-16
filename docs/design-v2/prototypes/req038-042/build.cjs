const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const pnpm = path.join(root, 'node_modules/.pnpm');
const directory = fs.readdirSync(pnpm).find(name => name.startsWith('esbuild@'));
if (!directory) throw new Error('请先安装工作区依赖。');
const esbuild = require(path.join(pnpm, directory, 'node_modules/esbuild'));
const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'preview.jsx')],
  bundle: true,
  minify: true,
  write: false,
  nodePaths: [path.join(root, 'apps/website/node_modules'), path.join(root, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>REQ038–042 · 交互设计稿</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`自包含原型已生成：${path.join(__dirname, 'index.html')} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
