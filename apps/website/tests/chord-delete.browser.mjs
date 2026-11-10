// LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs LXM_BROWSER_CHANNEL=chrome node apps/website/tests/chord-delete.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const website = fileURLToPath(new URL("..", import.meta.url));
const artifacts = path.resolve(website, "../../artifacts/chord-delete");
const server = await createServer({
  root: website, configFile: false,
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""' },
  cacheDir: path.resolve(website, "node_modules/.vite/chord-delete"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
   server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "chord-delete-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__chord_delete__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end(await dev.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/tests/music-text-coexist.browser.tsx"></script>'));
    });
  } }],
});
let browser, page;
try {
  await mkdir(artifacts, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
    ...(process.env.LXM_BROWSER_CHANNEL ? { channel: process.env.LXM_BROWSER_CHANNEL } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__chord_delete__`, { waitUntil: "commit" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  await sidebar.waitFor({ timeout: 90000 });
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  const toolbar = page.getByRole('toolbar', {name:'节奏、小节与历史工具'});
  const chordGroup = toolbar.getByRole('group', {name:'和弦',exact:true});
  const deleteTool = chordGroup.getByRole('button', {name:'删除和弦',exact:true});
  const popover = page.locator('#chord-edit-popover');
  const input = page.locator('#chord-popover-name');
  const applyChord = popover.getByRole('button', {name:'应用和弦',exact:true});
  const undo = toolbar.getByRole('button', {name:'撤销',exact:true});
  const redo = toolbar.getByRole('button', {name:'重做',exact:true});
  const snapshot = () => page.evaluate(() => ({document:window.coexistStore.getState().document, history:window.coexistStore.getState().historyDepth}));
  const currentChord = () => page.evaluate(() => {
    const state = window.coexistStore.getState();
    const target = state.selection.focus;
    return state.document.score.tracks.find(t => t.id === target.trackId).measures.find(m => m.id === target.measureId).chordSymbols.find(c => c.beatId === target.beatId);
  });
  assert.equal(await deleteTool.count(),0,'no delete button without chord target');
  const initial = await page.evaluate(() => {
    const track = window.coexistStore.getState().document.score.tracks[0];
    const measure = track.measures.find(m => m.chordSymbols.some(c => c.chord.diagram));
    return measure.chordSymbols.find(c => c.chord.diagram);
  });
  await svg.getByText(initial.chord.name,{exact:true}).first().click();
  await popover.waitFor({state:'visible'});
  const baseline = await snapshot();
  const original = await currentChord();
  const target = await page.evaluate(() => window.coexistStore.getState().selection.focus);
  const expectedScore = structuredClone(baseline.document.score);
  const expectedMeasure = expectedScore.tracks.find(t => t.id === target.trackId).measures.find(m => m.id === target.measureId);
  expectedMeasure.chordSymbols = expectedMeasure.chordSymbols.filter(c => c.id !== original.id);
  const assertRemoved = async () => {
    assert.equal(await currentChord(),undefined);
    const after = await snapshot();
    assert.deepEqual(after.document.score,expectedScore,'only the selected chord is removed');
    assert.equal(after.history.past,baseline.history.past+1,'one deletion creates one history entry');
    assert.equal(await deleteTool.count(),0,'empty target hides deletion tool');
  };
  assert.equal(await deleteTool.isEnabled(),true,'clean selected chord permits toolbar deletion');
  assert.equal(await chordGroup.locator('button').count(),2,'delete button is adjacent to chord button');
  for (const emptyName of ['', '   ']) {
    await input.fill(emptyName);
    assert.equal(await input.getAttribute('aria-invalid'),'false');
    assert.equal(await applyChord.isEnabled(),true,'clearing existing chord permits apply');
    await applyChord.click();
    await assertRemoved();
    assert.equal(await applyChord.isDisabled(),true,'empty new chord cannot be applied');
    await undo.click();
    assert.deepEqual(await currentChord(),original,'undo restores complete chord');
  }
  await input.fill('C'.repeat(33));
  assert.equal(await applyChord.isDisabled(),true,'invalid nonempty name remains blocked');
  await input.fill('Unapplied chord');
  assert.equal(await deleteTool.isDisabled(),true,'dirty chord draft locks toolbar deletion');
  const dirtySnapshot = await snapshot();
  await deleteTool.dispatchEvent('click');
  assert.deepEqual(await snapshot(),dirtySnapshot,'disabled toolbar deletion never writes a dirty draft');
  assert.equal(await input.inputValue(),'Unapplied chord','disabled deletion preserves draft input');
  await input.fill(original.chord.name);
  await input.dispatchEvent('compositionstart');
  assert.equal(await deleteTool.isDisabled(),true,'IME locks toolbar deletion');
  assert.equal(await applyChord.isDisabled(),true);
  await input.dispatchEvent('compositionend');
  await sidebar.getByRole('button',{name:'编辑指法',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === '编辑指法' && !button.disabled));
  await page.waitForFunction(() => { const e=document.querySelector('#chord-popover-name'); return e && !e.readOnly; });
  await page.screenshot({path:path.join(artifacts,'selected-chord-delete-button.png'),animations:'disabled'});
  await deleteTool.click();
  await assertRemoved();
  await undo.click();
  assert.deepEqual(await currentChord(),original);
  await redo.click();
  await assertRemoved();
  await undo.click();
  // Invalid local diagrams never escape the custom editor into the parent draft.
  await sidebar.getByRole('button',{name:'编辑指法',exact:true}).click();
  const custom = page.getByRole('dialog',{name:'自定义指法',exact:true});
  await custom.getByRole('textbox',{name:'自定义和弦名称',exact:true}).fill('');
  assert.equal(await custom.getByRole('button',{name:'完成编辑',exact:true}).isDisabled(),true);
  await custom.getByRole('button',{name:'取消',exact:true}).click();
  await custom.waitFor({state:'hidden'});
  await page.waitForFunction(() => !document.querySelector('button[aria-label="删除和弦"]')?.disabled);
  assert.deepEqual(await currentChord(),original,'invalid local edit cancellation preserves full parent');
  await input.fill('');
  assert.equal(await applyChord.isEnabled(),true,'cleared existing name still permits deletion');
  await applyChord.click();
  await assertRemoved();
  await undo.click();
  assert.deepEqual(await currentChord(),original);
  // A lyric selection must not expose the residual TAB chord deletion target.
  await popover.getByRole('button',{name:'结束和弦编辑',exact:true}).click();
  const lyric = await page.evaluate(() => window.coexistStore.getState().document.score.tracks[0].measures.flatMap(m => m.lyrics)[0].text);
  await svg.getByText(lyric,{exact:true}).first().click();
  assert.equal(await deleteTool.count(),0);
  assert.deepEqual(errors,[]);
  console.log('Chord deletion browser regression passed: empty/whitespace apply, adjacent toolbar delete, dirty-draft/IME protection, invalid validation, undo/redo, complete score preservation and cross-layer targeting.');
} catch (error) {
  if (page) await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
