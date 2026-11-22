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

async function verify() {
  await check(prefix, 'text/html');
  if (process.argv[2] === 'home') return;

  const desktopPath = `${prefix}/`;
  const desktop = await request(desktopPath);
  if (desktop.status === 200) {
    assert.ok(desktop.headers['content-type']?.startsWith('text/html'), `${desktopPath}: content type`);
  } else {
    assert.ok([301, 302, 307, 308].includes(desktop.status), `${desktopPath}: HTTP ${desktop.status}`);
    assert.equal(desktop.headers.location, prefix, `${desktopPath}: redirect location`);
  }

  await check(`${prefix}/editor`, 'text/html');
  const brand = await check(`${prefix}/assets/brand/liuxianmao-64.png`, 'image/png');
  assert.equal(brand.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Invalid PNG signature');

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
