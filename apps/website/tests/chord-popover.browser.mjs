// LXM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node apps/website/tests/chord-popover.browser.mjs
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
const artifacts = path.resolve(website, "../../artifacts/chord-popover");
const server = await createServer({
  root: website, configFile: false,
  cacheDir: path.resolve(website, "node_modules/.vite/coexist-v2"),
  optimizeDeps: { entries: ["tests/music-text-coexist.browser.tsx"], include: ["react/jsx-dev-runtime"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.next/**"] }, fs: { allow: [path.resolve(website, "../..")] } },
  plugins: [{ name: "chord-popover-fixture", configureServer(dev) {
    dev.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__chord__") return next();
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
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__chord__`, { waitUntil: "commit" });
  const sidebar = page.getByRole("complementary", { name: "编辑器属性" });
  await sidebar.waitFor({ timeout: 90000 });
  const svg = page.getByRole("application", { name: "六线谱编辑器" });
  const tool = page.getByRole("button", { name: /^(添加|编辑)和弦$/ });
  const popover = page.locator('#chord-edit-popover');
  const input = page.locator('#chord-popover-name');
  const fullInput = sidebar.getByRole('textbox', { name: '和弦名称', exact: true });
  const snapshot = () => page.evaluate(() => ({ document: window.coexistStore.getState().document, history: window.coexistStore.getState().historyDepth }));
  const currentChord = () => page.evaluate(() => {
    const state = window.coexistStore.getState();
    const target = state.selection.focus;
    return state.document.score.tracks.find(t => t.id === target.trackId).measures.find(m => m.id === target.measureId).chordSymbols.find(c => c.beatId === target.beatId);
  });
  assert.equal(await tool.isDisabled(), true, 'no implicit TAB target');
  const baseline = await snapshot();
  const initial = await page.evaluate(() => {
    const track = window.coexistStore.getState().document.score.tracks[0];
    const measure = track.measures.find(m => m.chordSymbols.length);
    return { trackId: track.id, measureId: measure.id, chord: measure.chordSymbols[0] };
  });
  await svg.getByText(initial.chord.chord.name, { exact: true }).first().click();
  await popover.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.id === 'chord-popover-name');
  assert.equal(await popover.getByRole('button', { name: '结束编辑', exact: true }).count(), 0);
  assert.equal(await popover.getByRole('button', { name: '完整设置', exact: true }).count(), 0);
  assert.equal(await popover.locator('footer button').count(), 1);
  assert.equal(await input.inputValue(), initial.chord.chord.name);
  assert.equal(await tool.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('[data-chord-focus]').count(), 1);
  assert.deepEqual(await snapshot(), baseline, 'opening never writes');
  await input.fill('Cmaj7');
  assert.equal(await fullInput.inputValue(), 'Cmaj7');
  assert.deepEqual((await currentChord()).chord, initial.chord.chord, 'draft does not alter score');
  await input.press('Enter');
  assert.deepEqual(await snapshot(), baseline, 'ordinary Enter does not apply');
  await tool.click();
  assert.equal(await input.inputValue(), 'Cmaj7', 'same-target reentry preserves draft');
  await fullInput.click();
  assert.equal(await fullInput.inputValue(), 'Cmaj7');
  await fullInput.fill('Side draft');
  assert.equal(await input.inputValue(), 'Side draft');
  const morePresets = sidebar.getByRole('button',{name:'其他常用和弦预设',exact:true});
  await morePresets.click();
  await page.locator('.ant-dropdown:visible').waitFor();
  await morePresets.press('Escape');
  await page.locator('.ant-dropdown:visible').waitFor({state:'hidden'});
  assert.equal(await input.inputValue(),'Side draft');
  assert.equal(await popover.isVisible(),true);
  await morePresets.click();
  const menuItem = page.locator('.ant-dropdown:visible [role="menuitem"]').first();
  await menuItem.focus();
  await menuItem.press('Escape');
  await page.locator('.ant-dropdown:visible').waitFor({state:'hidden'});
  assert.equal(await input.inputValue(),'Side draft');
  await page.getByRole('button', { name: '编辑面板', exact: true }).click();
  assert.equal(await sidebar.isVisible(), false);
  assert.equal(await input.inputValue(), 'Side draft');
  await tool.click();
  await page.waitForFunction(()=>document.activeElement?.id==='chord-popover-name');
  assert.equal(await input.inputValue(),'Side draft');
  await page.getByRole('button', { name: '编辑面板', exact: true }).click();
  const preset = popover.getByRole('button', { name: 'Am', exact: true });
  await preset.click();
  assert.equal(await preset.evaluate(node => node === document.activeElement), true);
  assert.equal(await input.inputValue(), 'Am');
  await input.press('Control+Enter');
  assert.equal((await currentChord()).chord.name, 'Am');
  assert.equal((await snapshot()).history.past, baseline.history.past + 1);
  assert.equal(await popover.getByRole('button', { name: '应用和弦', exact: true }).isDisabled(), true);
  await input.fill('Unapplied');
  await popover.getByRole('button', { name: '结束和弦编辑', exact: true }).click();
  await popover.waitFor({ state: 'hidden' });
  assert.equal(await svg.evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal((await currentChord()).chord.name, initial.chord.chord.name);
  await tool.click();
  await popover.waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), initial.chord.chord.name);
  await input.dispatchEvent('compositionstart');
  assert.equal(await tool.isDisabled(), true);
  assert.equal(await input.getAttribute('readonly'), null, 'IME continues receiving input');
  await input.fill('输入法');
  assert.equal(await fullInput.inputValue(), '输入法');
  assert.equal(await popover.getByRole('button', { name: '应用和弦', exact: true }).isDisabled(), true);
  assert.equal(await popover.getByRole('button', { name: '结束和弦编辑', exact: true }).isDisabled(), true);
  await input.press('Control+Enter');
  assert.equal((await currentChord()).chord.name, initial.chord.chord.name);
  await input.dispatchEvent('compositionend');
  await page.waitForFunction(() => !document.querySelector('#chord-edit-popover footer button')?.disabled);
  await input.press('Escape');
  // Select an actual empty TAB beat through the real store, then use the toolbar.
  await page.evaluate(() => {
    const store = window.coexistStore.getState();
    const track = store.document.score.tracks[0];
    const measure = track.measures.find(m => m.beats.some(b => !m.chordSymbols.some(c => c.beatId === b.id)));
    const beat = measure.beats.find(b => !measure.chordSymbols.some(c => c.beatId === b.id));
    const focus = { trackId: track.id, measureId: measure.id, beatId: beat.id, string: 1 };
    store.setSelection({ anchor: focus, focus });
  });
  await page.waitForFunction(() => document.querySelector('button[aria-label="添加和弦"]')?.disabled === false);
  assert.equal(await popover.isVisible(), false, 'selection alone does not open');
  const emptyBaseline = await snapshot();
  await tool.click();
  await popover.waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), '');
  assert.equal(await popover.getByRole('group', { name: '和弦显示方式', exact: true }).count(), 0);
  await input.fill('Dm7');
  await popover.getByRole('button', { name: '应用和弦', exact: true }).click();
  assert.equal((await currentChord()).chord.name, 'Dm7');
  assert.equal((await currentChord()).chord.diagram, null);
  assert.equal((await snapshot()).history.past, emptyBaseline.history.past + 1);
  await popover.getByRole('button', { name: 'C', exact: true }).click();
  await fullInput.click();
  const range = sidebar.locator('details').filter({ hasText: '横按与显示范围' });
  await range.locator('summary').click();
  await range.getByRole('spinbutton', { name: '起始品位', exact: true }).fill('');
  assert.equal(await popover.getByRole('button', { name: '应用和弦', exact: true }).isDisabled(), true);
  assert.equal(await popover.getByRole('img', { name: '指法图预览' }).count(), 0);
  await sidebar.getByRole('combobox', { name: '和弦显示方式', exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('仅名称', { exact: true }).click();
  assert.equal(await popover.getByRole('button', { name: '应用和弦', exact: true }).isDisabled(), true, 'hidden invalid diagram still blocks');
  await popover.getByRole('button', { name: '前往修正', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '起始品位');
  await range.getByRole('spinbutton', { name: '起始品位', exact: true }).fill('1');
  await sidebar.getByRole('combobox', {name:'5弦手指',exact:true}).click();
  await page.locator('.ant-select-dropdown:visible').getByText('2 中指',{exact:true}).click();
  await popover.getByRole('button',{name:'前往修正',exact:true}).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '5弦手指');
  await popover.getByRole('button',{name:'C',exact:true}).click();
  await input.fill('Layout draft');
  for (const viewport of [{width:1440,height:900},{width:1440,height:720},{width:1920,height:1080}]) {
    await page.setViewportSize(viewport);
    await popover.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#chord-edit-popover')?.dataset.popoverPlacement);
    await page.waitForFunction(() => {
      const bubble = document.querySelector('#chord-edit-popover')?.getBoundingClientRect();
      const anchor = document.querySelector('[data-chord-focus]')?.getBoundingClientRect();
      return bubble && anchor && (bubble.right <= anchor.left || bubble.left >= anchor.right || bubble.bottom <= anchor.top || bubble.top >= anchor.bottom);
    });
    assert.equal((await popover.boundingBox()).width, 360);
    const bubble = await popover.boundingBox();
    const anchor = await page.locator('[data-chord-focus]').boundingBox();
    assert.ok(bubble.x + bubble.width <= anchor.x || bubble.x >= anchor.x + anchor.width || bubble.y + bubble.height <= anchor.y || bubble.y >= anchor.y + anchor.height, 'target remains visible');
    await page.screenshot({ path: path.join(artifacts, `chord-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({width:1440,height:350});
  await popover.waitFor({state:'hidden'});
  assert.equal(await fullInput.inputValue(), 'Layout draft');
  await page.setViewportSize({width:1440,height:900});
  await popover.waitFor({state:'visible'});
  assert.equal(await input.inputValue(), 'Layout draft');
  await sidebar.getByRole('tab', {name:'歌曲',exact:true}).click();
  assert.equal(await sidebar.getByRole('alertdialog').count(),0);
  assert.equal(await popover.isVisible(), false);
  // A plain TAB pointer selection while browsing chord settings must stay a selection.
  await sidebar.getByRole('tab', {name:'和弦',exact:true}).click();
  await svg.getByText('14', {exact:true}).first().click();
  assert.equal(await popover.isVisible(), false);
  await tool.click();
  await popover.waitFor({state:'visible'});
  assert.notEqual(await input.inputValue(),'Layout draft');
  await input.press('Escape');
  // Lyric activation must not reuse the residual TAB selection for the toolbar.
  await svg.getByText('旋', {exact:true}).first().click();
  assert.equal(await tool.isDisabled(),true);
  await page.locator('[data-text-surface="popover"]').getByRole('button',{name:'结束文字编辑',exact:true}).click();
  // Replace the fixture through the public loader to exercise nonstandard tuning.
  await page.evaluate(() => {
    const state = window.coexistStore.getState();
    const doc = structuredClone(state.document);
    doc.score.tracks[0].tuning.strings[5].pitch = 'D2';
    doc.score.tracks[0].tuning.strings[5].midi = 38;
    const result = state.replaceDocument(JSON.stringify(doc));
    if (!result.ok) throw new Error(result.errors.join('；'));
  });
  await svg.getByText(initial.chord.chord.name, {exact:true}).first().click();
  await popover.waitFor({state:'visible'});
  assert.equal(await popover.getByRole('group',{name:'常用和弦预设'}).locator('button:disabled').count(),6);
  assert.deepEqual(errors, []);
  console.log('Chord popover browser regression passed: toolbar states, shared draft/caret, presets, apply/undo, IME, empty/invalid diagram, placement, discard and nonstandard tuning.');
} catch (error) {
  if (page) await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
