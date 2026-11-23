const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../../../..');
const pnpm = path.join(root, 'node_modules/.pnpm');
const packageDirectory = fs.readdirSync(pnpm).find(name => name.startsWith('esbuild@'));
if (!packageDirectory) throw new Error('请先安装工作区依赖。');
const esbuild = require(path.join(pnpm, packageDirectory, 'node_modules/esbuild'));
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'preview.jsx')],
  outfile: path.join(__dirname, 'preview.js'),
  bundle: true,
  minify: true,
  nodePaths: [path.join(root, 'apps/website/node_modules'), path.join(root, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'eof',
});
console.log('REQ031–039 设计稿已生成。');
