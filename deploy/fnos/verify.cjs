const assert = require('node:assert/strict');
const http = require('node:http');

const prefix = '/app/liuxianmao';
const socketPath = process.env.GATEWAY_SOCKET;
if (!socketPath) throw new Error('GATEWAY_SOCKET is required');

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path, headers: { host: 'localhost' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.setTimeout(4000, () => req.destroy(new Error(`Timed out: ${path}`)));
    req.on('error', reject);
  });
}

async function check(path, type) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  assert.equal(response.headers['content-type']?.split(';')[0], type, `${path}: content type`);
  assert.ok(response.body.length, `${path}: empty response`);
  return response.body;
}

async function checkPng(path) {
  const image = await check(path, 'image/png');
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path}: invalid PNG signature`);
}

async function verify() {
  const home = await check(prefix, 'text/html');
  if (process.argv[2] === 'home') return;

  // 同时验证首页渲染出的地址和图片响应，防止图片已打包但浏览器请求了站点根目录。
  const preview = `${prefix}/assets/home/editor-preview.png`;
  assert.ok(home.toString('utf8').includes(` src="${preview}"`), `${prefix}: missing preview image src ${preview}`);
  await checkPng(preview);

  const desktopPath = `${prefix}/`;
  const desktop = await request(desktopPath);
  if (desktop.status === 200) {
    assert.ok(desktop.headers['content-type']?.startsWith('text/html'), `${desktopPath}: content type`);
  } else {
    assert.ok([301, 302, 307, 308].includes(desktop.status), `${desktopPath}: HTTP ${desktop.status}`);
    assert.equal(desktop.headers.location, prefix, `${desktopPath}: redirect location`);
  }

  await check(`${prefix}/editor`, 'text/html');
  await checkPng(`${prefix}/assets/brand/liuxianmao-64.png`);

  const chords = `${prefix}/assets/chords`;
  const manifest = JSON.parse(await check(`${chords}/manifest.json`, 'application/json'));
  assert.equal(manifest.format, 'lxm-chord-catalog-manifest');
  assert.match(manifest.catalogUrl, /^\.\/catalog-[\d.]+\.json$/);
  const catalog = JSON.parse(await check(`${chords}/${manifest.catalogUrl.slice(2)}`, 'application/json'));
  assert.equal(catalog.format, 'lxm-chord-catalog');
  assert.equal(catalog.dataVersion, manifest.dataVersion);
  assert.ok(catalog.items?.length, 'Empty chord catalog');
}

verify().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
