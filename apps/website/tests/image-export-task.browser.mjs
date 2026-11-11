// LXM_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node <this file>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: website, configFile: false, esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{
    name: "image-task-lifecycle-fixture",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./image-export-controller" && importer?.endsWith("/use-image-export-task.ts"))
        return path.join(website, "tests/image-export-task-controller.fixture.ts");
    },
    configureServer(dev) {
      dev.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/__image-task-test__")) return next();
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><div id="root"></div><script type="module" src="/tests/image-export-task.browser.tsx"></script>');
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.LXM_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const load = async () => {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__image-task-test__`);
    await page.waitForFunction(() => window.imageTaskTest?.state().preparations.length === 2);
  };
  const call = (method, ...args) => page.evaluate(([name, values]) => window.imageTaskTest[name](...values), [method, args]);
  const state = () => call("state");
  const wait = (status) => page.waitForFunction((value) => window.imageTaskTest.state().status === value, status);
  await load();
  assert.deepEqual((await state()).preparations, [true, false], "StrictMode aborts first preparation");
  await call("prepare", 0, "old");
  assert.equal((await state()).status, "preparing");
  await call("prepare", 1, "active");
  await wait("ready");
  assert.equal((await state()).title, "active");

  await call("generate");
  await call("cancel");
  await call("encode", 0);
  assert.equal((await state()).status, "ready");
  assert.deepEqual((await state()).created, [], "late cancellation cannot allocate URL");
  await call("generate");
  await call("font");
  await call("encode", 1, true);
  await wait("stale");
  assert.deepEqual((await state()).encodings, [true, true]);
  assert.deepEqual((await state()).created, []);
  await call("reprepare");
  await call("prepare", 2, "fresh");
  await wait("ready");

  await call("generate");
  await call("encode", 2);
  await wait("generated");
  await call("inspect", 1);
  assert.deepEqual((await state()).revoked, (await state()).created, "page switch releases URL");
  await call("generate");
  await call("encode", 3);
  await wait("generated");
  await call("range");
  assert.deepEqual((await state()).revoked, (await state()).created, "range switch releases URL");
  await call("generate");
  await call("encode", 4);
  await wait("generated");
  await call("font");
  assert.deepEqual((await state()).revoked, (await state()).created, "font change releases URL");
  await call("reprepare");
  await call("prepare", 3, "closing");
  await wait("ready");
  await call("generate");
  await call("stop");
  assert.equal((await state()).encodings.at(-1), true, "closing synchronously aborts");
  await call("encode", 5);
  assert.equal((await state()).created.length, 3, "late closing result cannot allocate URL");
  await call("unmount");
  assert.deepEqual((await state()).revoked, (await state()).created);

  await load();
  await call("current", false);
  await call("prepare", 1, "stale");
  assert.deepEqual((await state()).invalid, ["prepare"]);
  await load();
  await call("prepare", 1, "ready");
  await wait("ready");
  await call("generate");
  await call("current", false);
  await call("encode", 0);
  assert.deepEqual((await state()).invalid, ["generate"]);
  assert.equal(await call("validate"), false, "download checks current snapshot");
  assert.deepEqual((await state()).invalid, ["generate", "generate"]);
  assert.deepEqual((await state()).created, []);

  await load();
  await call("prepare", 1, "closing URL");
  await wait("ready");
  await call("generate");
  await call("encode", 0);
  await wait("generated");
  const closingUrl = (await state()).download.url;
  await call("stop");
  await call("font");
  await call("reprepare");
  await call("generate");
  await call("range");
  await call("inspect", 1);
  assert.equal((await state()).status, "generated", "closing ignores font invalidation");
  assert.equal((await state()).download.url, closingUrl, "closing retains URL until unmount");
  assert.equal((await state()).preparations.length, 2, "closing blocks preparation retry");
  assert.equal((await state()).encodings.length, 1, "closing blocks generation");
  assert.deepEqual((await state()).revoked, []);
  await call("unmount");
  assert.deepEqual((await state()).revoked, [closingUrl]);

  await load();
  await call("stop");
  await call("prepare", 1, "late while closing");
  await call("font");
  await call("reprepare");
  assert.equal((await state()).status, "preparing", "closing ignores late preparation");
  assert.equal((await state()).preparations.length, 2);

  await load();
  await call("unmount");
  await call("prepare", 1, "unmounted", true);
  assert.deepEqual((await state()).invalid, [], "unmounted late rejection cannot close a new modal");
  assert.deepEqual(errors, []);
  console.log("image export task browser: StrictMode, cancel, font invalidation, URL ownership, close and stale stages passed");
} finally {
  await browser?.close();
  await server.close();
}
