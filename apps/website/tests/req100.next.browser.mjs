// REQ_NEXT_ORIGIN=http://127.0.0.1:<port> LXM_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node apps/website/tests/req100.next.browser.mjs
// 实际 PDF 栅格化使用 Poppler 的 pdftoppm，macOS 可使用系统 Swift / CoreGraphics。
// REQ100_PRINT_TRACE=1 输出打印媒体、字体事件和逐页几何。失败时自动输出。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { applyScoreCommand, loadDocument, LXMScoreCommandEnum } from "@liuxianmao/lxm-editor";
import { unzipSync } from "fflate";
import { confirmScoreImport, downloadScoreJson, openScoreImport, selectScoreAction } from "./score-file-actions.browser.cjs";

assert.ok(process.env.REQ_NEXT_ORIGIN, "请设置用于本次验证的 REQ_NEXT_ORIGIN");
const editorUrl = `${process.env.REQ_NEXT_ORIGIN.replace(/\/$/, "")}/editor`;
const { chromium } = await import(process.env.LXM_PLAYWRIGHT_MODULE ?? "playwright");
const exec = promisify(execFile);
const scratch = await mkdtemp(path.join(tmpdir(), "lxm-req100-"));
const watermarkSelector = "[data-score-watermark]";
const printLayerSelector = '[data-score-print-layer][data-print-ready="true"]';
const text = "A&B <练习> e\u0301";
const logoName = "透明水印回归.png";

async function multiPageScore() {
  // 使用领域复制命令保留技巧、和弦和歌词的引用，并重新分配复制范围内的 ID。
  const source = await readFile(new URL("../../../packages/lxm-editor/example/ideal-score.lxm.json", import.meta.url), "utf8");
  const loaded = loadDocument(source);
  assert.ok(loaded.ok, loaded.errors?.join("；"));
  const track = loaded.document.score.tracks[0];
  const copy = applyScoreCommand(loaded.document, {
    type: LXMScoreCommandEnum.CopyMeasureRange,
    trackId: track.id,
    sourceStartMeasureId: track.measures[0].id,
    sourceEndMeasureId: track.measures[19].id,
    afterMeasureId: track.measures.at(-1).id,
  });
  assert.ok(copy.ok, copy.message);
  const bytes = JSON.stringify(copy.document);
  const verified = loadDocument(bytes);
  assert.ok(verified.ok, verified.errors?.join("；"));
  return { name: "REQ-100 多页输出.lxm", mimeType: "application/json", buffer: Buffer.from(bytes) };
}

const swiftPdfRenderer = `
import AppKit

let pdf = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let document = CGPDFDocument(pdf as CFURL)!
for index in 1...document.numberOfPages {
    let page = document.page(at: index)!
    let box = page.getBoxRect(.mediaBox)
    let ctx = CGContext(data: nil, width: Int(ceil(box.width)), height: Int(ceil(box.height)),
        bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(gray: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: ctx.width, height: ctx.height))
    ctx.translateBy(x: -box.minX, y: -box.minY)
    ctx.drawPDFPage(page)
    let bitmap = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try bitmap.representation(using: .png, properties: [:])!
        .write(to: output.appendingPathComponent("pdf-page-\\(index).png"))
}
`;

async function rasterizePdf(pdf) {
  const pdfPath = path.join(scratch, "score.pdf");
  await writeFile(pdfPath, pdf);
  try {
    await exec("pdftoppm", ["-r", "72", "-png", pdfPath, path.join(scratch, "pdf-page")]);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    assert.equal(process.platform, "darwin", "PDF 像素验证需要 pdftoppm 或 macOS Swift");
    await exec("swift", ["-e", swiftPdfRenderer, pdfPath, scratch], { timeout: 120000 });
  }
  const names = (await readdir(scratch)).filter((name) => /^pdf-page-\d+\.png$/.test(name));
  return Promise.all(names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => readFile(path.join(scratch, name))));
}

async function createTransparentLogo(page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0040";
    ctx.fillRect(8, 43, 20, 18);
    ctx.fillStyle = "rgba(0, 80, 255, 0.5)";
    ctx.fillRect(68, 5, 22, 18);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return { name: logoName, mimeType: "image/png", buffer: Buffer.from(png, "base64") };
}

// 探针由上传图本身的色块坐标和用户选的角度计算。每个探针取小窗中的多个像素，容许谱线覆盖少数像素。
const probesAt = (angle) => {
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotate = (x, y) => [x * cos - y * sin, x * sin + y * cos];
  return { red: rotate(-32, 20), blue: rotate(29, -18), hole: [0, 0], horizontal: [-32, 20] };
};

function readProbes(page, png, angle) {
  return page.evaluate(async ({ base64, probes }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const radius = Math.max(3, Math.round(width * 0.005));
    const side = radius * 2 + 1;
    const samples = Object.fromEntries(Object.entries(probes).map(([key, [x, y]]) => {
      const scale = width * 0.38 / 100;
      const pixelX = Math.round(width / 2 + x * scale);
      const pixelY = Math.round(height / 2 + y * scale);
      return [key, [...ctx.getImageData(pixelX - radius, pixelY - radius, side, side).data]];
    }));
    return { width, height, samples };
  }, { base64: Buffer.from(png).toString("base64"), probes: probesAt(angle) });
}

function assertRotatedPixels(samples, label, clean) {
  const majority = (key, min, max, high, low) => {
    let eligible = 0;
    let matching = 0;
    for (let offset = 0; offset < samples[key].length; offset += 4) {
      // 对有基线的颜色探针跳过原来就被谱面占据的像素，精确比较白纸上的混色。
      if (clean && clean[key].slice(offset, offset + 3).some((channel) => channel < 250)) continue;
      eligible++;
      const delta = samples[key][offset + high] - samples[key][offset + low];
      if (delta >= min && delta <= max && samples[key][offset + 3] === 255) matching++;
    }
    assert.ok(eligible >= 10 && matching > eligible / 2, `${label} ${key} 色块的旋转坐标或透明度错误，命中 ${matching}/${eligible}`);
  };
  majority("red", 32, 57, 0, 1);
  majority("blue", 13, 31, 2, 0);
  if (clean) {
    assert.deepEqual(samples.hole, clean.hole, `${label} 透明镂空像素`);
    assert.deepEqual(samples.horizontal, clean.horizontal, `${label} 水平旧坐标像素`);
  } else {
    // PDF 渲染器可能重做颜色管理，用近灰范围确认镂空与旧坐标均无彩色块。
    majority("hole", -3, 3, 0, 1);
    majority("horizontal", -3, 3, 0, 1);
  }
}

async function assertTextPng(page, actual, clean) {
  const { dimensions, rightInk, leftInk } = await page.evaluate(async ({ actual, clean }) => {
    const decode = (base64) => createImageBitmap(new Blob([
      Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
    ], { type: "image/png" }));
    const [marked, baseline] = await Promise.all([decode(actual), decode(clean)]);
    const { width, height } = marked;
    const canvas = document.createElement("canvas");
    // 仅检查纸面底部，比较同一页的白纸像素以排除原有谱面。
    canvas.width = width;
    canvas.height = Math.round(height * 0.12);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = (bitmap) => {
      ctx.drawImage(bitmap, 0, canvas.height - height);
      bitmap.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const before = pixels(baseline);
    const after = pixels(marked);
    let rightInk = 0;
    let leftInk = 0;
    for (let offset = 0; offset < after.length; offset += 4) {
      const x = (offset / 4) % width;
      if (before[offset] < 250 || before[offset + 1] < 250 || before[offset + 2] < 250) continue;
      const gray = after[offset];
      if (gray < 135 || gray > 150 || after[offset + 1] !== gray || after[offset + 2] !== gray) continue;
      if (x > width * 0.5) rightInk++;
      if (x < width * 0.25) leftInk++;
    }
    return { dimensions: [width, height], rightInk, leftInk };
  }, { actual: actual.toString("base64"), clean: Buffer.from(clean).toString("base64") });
  assert.deepEqual(dimensions, [2480, 3508]);
  assert.ok(rightInk > 100, `PNG 右下应有 45% 不透明度的文字像素，实际 ${rightInk}`);
  assert.equal(leftInk, 0, "PNG 左下不应出现新增文字像素");
}

function zipPages(bytes, expectedCount) {
  const pages = Object.entries(unzipSync(bytes)).sort(([a], [b]) => a.localeCompare(b));
  assert.equal(pages.length, expectedCount);
  for (const [index, [name]] of pages.entries()) {
    assert.ok(name.endsWith(`_${String(index + 1).padStart(3, "0")}.png`), name);
  }
  return pages.map(([, bytes]) => bytes);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.LXM_BROWSER_CHANNEL ? { channel: process.env.LXM_BROWSER_CHANNEL } : {}),
    ...(process.env.LXM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LXM_CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.stack ?? error.message);
  });
  await page.route("https://**/*", (route) => route.abort());
  await page.addInitScript(({ printLayerSelector, watermarkSelector }) => {
    const revoke = URL.revokeObjectURL.bind(URL);
    window.req100RevokedUrls = [];
    URL.revokeObjectURL = (url) => {
      window.req100RevokedUrls.push(url);
      revoke(url);
    };
    // 接管系统对话框入口，交给 Chromium 的真实打印管线。保留 afterprint，以便实际输出期间沿用生产打印范围。
    window.req100PrintCalls = [];
    window.print = () => {
      const layer = document.querySelector(printLayerSelector);
      const transforms = [...(layer?.querySelectorAll(watermarkSelector) ?? [])]
        .map((mark) => mark.getAttribute("transform"));
      window.req100PrintCalls.push(transforms);
      window.req100PrintTrace?.sample("window.print");
    };
  }, { printLayerSelector, watermarkSelector });
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });

  const button = (root, name) => root.getByRole("button", { name, exact: typeof name === "string" });
  const dialog = (heading) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
  const image = dialog("A4 图片预览");
  const print = dialog("A4 打印预览");
  const main = (root) => root.locator('[aria-label="A4 成品页预览"]');
  const thumbnails = (root) => root.locator('[aria-label="页面缩略图"]');
  const printLayer = page.locator(printLayerSelector);
  const toggle = (root) => root.getByRole("switch", { name: "自定义水印", exact: true });
  const slider = (root, name) => root.getByRole("slider", { name, exact: true });
  const angle = (root) => slider(root, "旋转角度");
  const input = (root) => root.getByRole("textbox", { name: /水印文字/ });
  const apply = (root) => button(root, "应用到全部页");
  const restore = (root) => button(root, "还原");
  const position = (root, name) => button(root.getByRole("group", { name: "每页位置" }), name);
  const previewMode = (root, name) => button(root.getByRole("group", { name: "预览方式" }), name);
  const printButton = button(print, "打开打印窗口");
  const status = () => page.locator("[data-file-status]").innerText({ timeout: 45000 });
  const ready = (root) => root.locator('[data-image-export-status="ready"]').waitFor({ timeout: 45000 });
  const close = async (root) => {
    await button(root, "关闭预览").click();
    await root.waitFor({ state: "hidden" });
  };
  const open = async (root, label) => {
    await selectScoreAction(page, "导出", label);
    await ready(root);
  };
  const openImage = () => open(image, "图片(.png)");
  const openPrint = () => open(print, "打印");
  const link = (name) => image.getByRole("link", { name, exact: true });
  const allImages = () => button(image, "生成全部图片");
  const currentImage = () => button(image, "仅生成当前页");
  const anglePreset = (root, degrees) => button(root, {
    "-30": /逆时针|[−-]30°/,
    0: /水平/,
    30: /顺时针|\+30°/,
  }[degrees]);
  const sliderAngle = (root) => angle(root).evaluate((element) => Number(element.getAttribute("aria-valuenow") ?? element.value));
  const markCount = (root) => root.locator(watermarkSelector).count();
  const textMark = (root) => root.locator('[data-score-watermark="text"]');
  const defaultTextStyle = { size: 40, opacity: 12, angle: -30, position: "居中" };
  const assertTextMarks = async (root, expectedCount, style = defaultTextStyle) => {
    const marks = await textMark(root).evaluateAll((nodes) => nodes.map((node) => {
      const transform = node.transform.baseVal;
      const { e: x, f: y } = transform.getItem(0).matrix;
      const { width, height } = node.ownerSVGElement.viewBox.baseVal;
      return {
        text: node.textContent,
        size: Number(node.querySelector("text").getAttribute("font-size")),
        opacity: Number(node.getAttribute("opacity")),
        angle: transform.getItem(1).angle,
        x: x / width,
        y: y / height,
      };
    }));
    assert.equal(marks.length, expectedCount);
    for (const { x, y, ...mark } of marks) {
      assert.deepEqual(mark, { text, size: style.size, opacity: style.opacity / 100, angle: style.angle });
      if (style.position === "居中") {
        assert.ok(Math.abs(x - 0.5) < 0.001 && Math.abs(y - 0.5) < 0.001, `水印应居中，实际为 ${x}, ${y}`);
      } else {
        const correctSide = style.position === "左下" ? x < 0.5 : x > 0.5;
        assert.ok(correctSide && y > 0.75 && y < 1, `水印应在${style.position}，实际为 ${x}, ${y}`);
      }
    }
  };
  const assertAngles = async (root, expectedCount, degrees) => {
    const marks = root.locator(watermarkSelector);
    const transforms = await marks.evaluateAll((nodes) => nodes.map((node) => ({
      kind: node.getAttribute("data-score-watermark"),
      angle: Number(node.getAttribute("transform")?.match(/rotate\(([-\d.]+)/)?.[1] ?? NaN),
    })));
    assert.deepEqual(transforms, Array.from({ length: expectedCount }, () => ({ kind: "image", angle: degrees })));
  };
  const assertOff = async (root) => {
    assert.equal(await toggle(root).getAttribute("aria-checked"), "false");
    assert.equal(await markCount(root), 0);
    await printLayer.waitFor({ state: "attached" });
    assert.equal(await markCount(printLayer), 0);
  };
  const downloadImage = async (trigger, name, extension) => {
    await trigger.click();
    await image.locator('[data-image-export-status="generated"]').waitFor({ timeout: 45000 });
    const downloadLink = link(name);
    const url = await downloadLink.getAttribute("href");
    assert.match(url, /^blob:/);
    const [download] = await Promise.all([page.waitForEvent("download"), downloadLink.click()]);
    assert.ok(download.suggestedFilename().endsWith(extension), download.suggestedFilename());
    return { url, bytes: await readFile(await download.path()) };
  };
  const waitRevoked = (url) => page.waitForFunction((value) => window.req100RevokedUrls.includes(value), url);

  const exampleStatus = await status();
  await openScoreImport(page, await multiPageScore());
  await confirmScoreImport(page);
  const initialStatus = await status();
  assert.equal(initialStatus, "与导入文件一致");
  await openImage();
  await assertOff(image);
  const pageCount = await thumbnails(image).getByRole("button", { name: /^第 \d+ 页$/ }).count();
  assert.ok(pageCount >= 3, `示例谱应至少有三页，实际为 ${pageCount}`);
  assert.equal(await printLayer.getByRole("img", { includeHidden: true }).count(), pageCount);
  const cleanZip = await downloadImage(allImages(), "下载图片包", ".zip");
  const cleanPages = zipPages(cleanZip.bytes, pageCount);

  await toggle(image).click();
  await button(image, "文字水印").click();
  await input(image).fill("   ");
  assert.equal(await apply(image).isDisabled(), true);
  assert.equal(await markCount(main(image)), 0);
  await input(image).fill("e\u0301".repeat(33));
  assert.equal(await apply(image).isDisabled(), true);
  await input(image).fill("e\u0301".repeat(32));
  assert.equal(await apply(image).isEnabled(), true);
  await input(image).fill(`  ${text}  `);
  for (const [label, min, max, value] of [
    ["文字大小", "12", "96", "40"],
    ["不透明度", "5", "45", "12"],
    ["旋转角度", "-180", "180", "-30"],
  ]) {
    const control = slider(image, label);
    assert.deepEqual([await control.getAttribute("min"), await control.getAttribute("max"), await control.inputValue()], [min, max, value]);
  }
  assert.equal(await anglePreset(image, -30).getAttribute("aria-pressed"), "true");
  assert.equal(await position(image, "居中").getAttribute("aria-pressed"), "true");
  await assertTextMarks(main(image), 1);
  assert.equal(await image.getByText("当前页试排", { exact: true }).isVisible(), true);
  assert.equal(await markCount(thumbnails(image)), 0);
  assert.equal(await markCount(printLayer), 0);
  assert.equal(await link("下载图片包").count(), 0);
  await restore(image).click();
  await assertOff(image);
  assert.equal(await link("下载图片包").getAttribute("href"), cleanZip.url);
  assert.equal(await page.evaluate((url) => window.req100RevokedUrls.includes(url), cleanZip.url), false);

  await toggle(image).click();
  await button(image, "文字水印").click();
  await input(image).fill(`  ${text}  `);
  await apply(image).click();
  await ready(image);
  assert.equal(await link("下载图片包").count(), 0);
  await waitRevoked(cleanZip.url);
  await assertTextMarks(main(image), 1);
  await assertTextMarks(thumbnails(image), pageCount);
  await assertTextMarks(printLayer, pageCount);

  await button(thumbnails(image), "第 2 页").click();
  await slider(image, "文字大小").press("ArrowRight");
  assert.equal(await input(image).inputValue(), text);
  assert.equal(await apply(image).isEnabled(), true);
  assert.equal(await allImages().isDisabled(), true);
  assert.equal(await currentImage().isDisabled(), true);
  assert.equal(await previewMode(image, "打印").isDisabled(), true);
  await assertTextMarks(main(image), 1, { ...defaultTextStyle, size: 41 });
  await assertTextMarks(thumbnails(image), pageCount);
  await assertTextMarks(printLayer, pageCount);
  await restore(image).click();
  await assertTextMarks(main(image), 1);
  assert.equal(await slider(image, "文字大小").inputValue(), "40");
  assert.equal(await allImages().isEnabled(), true);

  await input(image).fill("W".repeat(32));
  await slider(image, "文字大小").press("End");
  const fitted = await textMark(main(image)).locator("text").evaluate((node) => ({
    size: Number(node.getAttribute("font-size")),
    widthRatio: node.getComputedTextLength() / node.ownerSVGElement.viewBox.baseVal.width,
  }));
  assert.ok(fitted.size < 96 && fitted.widthRatio >= 0.72 && fitted.widthRatio <= 0.76, JSON.stringify(fitted));
  await input(image).fill("W".repeat(33));
  assert.equal(await apply(image).isDisabled(), true);
  assert.equal(await allImages().isDisabled(), true);
  await assertTextMarks(main(image), 1);
  assert.equal(await image.getByText("当前页试排", { exact: true }).count(), 0);
  await restore(image).click();

  await slider(image, "文字大小").press("ArrowRight");
  await slider(image, "不透明度").press("End");
  await anglePreset(image, 30).click();
  assert.equal(await sliderAngle(image), 30);
  await assertTextMarks(main(image), 1, { size: 41, opacity: 45, angle: 30, position: "居中" });
  await anglePreset(image, 0).click();
  await position(image, "右下").click();
  const styledText = { size: 41, opacity: 45, angle: 0, position: "右下" };
  await assertTextMarks(main(image), 1, styledText);
  await assertTextMarks(thumbnails(image), pageCount);
  await assertTextMarks(printLayer, pageCount);
  await apply(image).click();
  await ready(image);
  await assertTextMarks(thumbnails(image), pageCount, styledText);
  await assertTextMarks(printLayer, pageCount, styledText);
  assert.equal(await button(thumbnails(image), "第 2 页").getAttribute("aria-current"), "page");
  const styledPng = await downloadImage(currentImage(), "下载图片", ".png");
  await assertTextPng(page, styledPng.bytes, cleanPages[1]);
  await position(image, "左下").click();
  assert.equal(await link("下载图片").count(), 0);
  await restore(image).click();
  assert.equal(await link("下载图片").getAttribute("href"), styledPng.url);

  await previewMode(image, "打印").click();
  await ready(print);
  await waitRevoked(styledPng.url);
  assert.equal(await button(thumbnails(print), "第 2 页").getAttribute("aria-current"), "page");
  assert.equal(await slider(print, "文字大小").inputValue(), "41");
  assert.equal(await slider(print, "不透明度").inputValue(), "45");
  assert.equal(await anglePreset(print, 0).getAttribute("aria-pressed"), "true");
  assert.equal(await position(print, "右下").getAttribute("aria-pressed"), "true");
  await assertTextMarks(main(print), 1, styledText);
  await position(print, "左下").click();
  assert.equal(await printButton.isDisabled(), true);
  await assertTextMarks(main(print), 1, { ...styledText, position: "左下" });
  await assertTextMarks(thumbnails(print), pageCount, styledText);
  await assertTextMarks(printLayer, pageCount, styledText);
  await restore(print).click();
  assert.equal(await printButton.isEnabled(), true);
  await assertTextMarks(main(print), 1, styledText);
  await position(print, "左下").click();
  await apply(print).click();
  const leftText = { ...styledText, position: "左下" };
  await assertTextMarks(thumbnails(print), pageCount, leftText);
  await assertTextMarks(printLayer, pageCount, leftText);
  await previewMode(print, "图片").click();
  await ready(image);
  await assertTextMarks(main(image), 1, leftText);
  console.log("PASS 文字水印试排、样式还原及应用、跨预览同步和第 2 页 PNG 右下文字像素");

  const logo = await createTransparentLogo(page);
  const chooseLogo = async (root) => {
    await button(root, "图片水印").click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button(root, "选择图片").click()]);
    await chooser.setFiles(logo);
    await angle(root).waitFor();
  };
  await chooseLogo(image);
  assert.equal(await sliderAngle(image), 0);
  await assertAngles(main(image), 1, 0);
  assert.equal(await thumbnails(image).locator('[data-score-watermark="text"]').count(), pageCount);
  assert.equal(await allImages().isDisabled(), true);
  assert.equal(await currentImage().isDisabled(), true);

  const [replacement] = await Promise.all([page.waitForEvent("filechooser"), button(image, "替换图片").click()]);
  await replacement.setFiles({ name: "损坏.png", mimeType: "image/png", buffer: logo.buffer.subarray(0, 12) });
  await image.getByText(/已保留原图/).waitFor();
  await image.getByText(logoName, { exact: true }).waitFor();
  await assertAngles(main(image), 1, 0);

  assert.equal(await angle(image).getAttribute("min"), "-180");
  assert.equal(await angle(image).getAttribute("max"), "180");
  await anglePreset(image, -30).click();
  assert.equal(await sliderAngle(image), -30);
  await assertAngles(main(image), 1, -30);
  await anglePreset(image, 0).click();
  assert.equal(await sliderAngle(image), 0);
  await anglePreset(image, 30).click();
  assert.equal(await sliderAngle(image), 30);
  await angle(image).press("ArrowRight");
  assert.equal(await sliderAngle(image), 31);
  await assertAngles(main(image), 1, 31);
  assert.equal(await thumbnails(image).locator('[data-score-watermark="text"]').count(), pageCount);
  await apply(image).click();
  await ready(image);
  assert.equal(await button(thumbnails(image), "第 2 页").getAttribute("aria-current"), "page");
  assert.equal(await image.locator("[data-image-export-range]").getAttribute("data-image-export-range"), "all");
  await assertAngles(thumbnails(image), pageCount, 31);
  await assertAngles(printLayer, pageCount, 31);

  const rotatedZip = await downloadImage(allImages(), "下载图片包", ".zip");
  const rotatedPages = zipPages(rotatedZip.bytes, pageCount);
  for (const [index, bytes] of rotatedPages.entries()) {
    const clean = await readProbes(page, cleanPages[index], 31);
    const actual = await readProbes(page, bytes, 31);
    assert.deepEqual([actual.width, actual.height], [2480, 3508]);
    assertRotatedPixels(actual.samples, `ZIP 第 ${index + 1} 页`, clean.samples);
  }
  console.log(`PASS 默认关闭、图片上传和旋转试排、旧下载恢复和回收、ZIP ${pageCount} 页 +31° 实际透明像素`);

  // 关闭预览丢弃尚未应用的角度；切换到打印后仍显示已应用的版本。
  await anglePreset(image, 0).click();
  await assertAngles(main(image), 1, 0);
  await assertAngles(thumbnails(image), pageCount, 31);
  assert.equal(await link("下载图片包").count(), 0);
  await close(image);
  await waitRevoked(rotatedZip.url);
  await openPrint();
  await assertAngles(main(print), 1, 31);
  assert.equal(await sliderAngle(print), 31);
  await anglePreset(print, -30).click();
  await assertAngles(main(print), 1, -30);
  await assertAngles(thumbnails(print), pageCount, 31);
  await assertAngles(printLayer, pageCount, 31);
  assert.equal(await printButton.isDisabled(), true);
  await page.evaluate(() => {
    const layer = document.querySelector("[data-score-print-layer]");
    const media = matchMedia("print");
    const started = performance.now();
    const records = [];
    const sample = (event) => {
      records.push({
        event,
        milliseconds: Math.round(performance.now() - started),
        printMedia: media.matches,
        active: Boolean(layer.closest("[data-lxm-print-active]")),
        fontStatus: document.fonts.status,
        ready: layer.getAttribute("data-print-ready"),
        pages: [...layer.querySelectorAll(":scope > svg")].map((svg) => {
          const { x, y, width, height } = svg.getBoundingClientRect();
          return { x, y, width, height, transform: svg.querySelector("[data-score-watermark]")?.getAttribute("transform") };
        }),
      });
    };
    const listen = (event) => sample(event.type);
    const observe = new MutationObserver(() => sample("print layer updated"));
    observe.observe(layer, { attributeFilter: ["data-print-ready", "data-watermark-version"], childList: true });
    for (const name of ["beforeprint", "afterprint"]) window.addEventListener(name, listen);
    for (const name of ["loading", "loadingdone", "loadingerror"]) document.fonts.addEventListener(name, listen);
    media.addEventListener("change", listen);
    window.req100PrintTrace = {
      sample,
      records,
      stop() {
        observe.disconnect();
        for (const name of ["beforeprint", "afterprint"]) window.removeEventListener(name, listen);
        for (const name of ["loading", "loadingdone", "loadingerror"]) document.fonts.removeEventListener(name, listen);
        media.removeEventListener("change", listen);
        return records;
      },
    };
    sample("before applying print watermark");
  });
  let pdfPageCount;
  try {
    await apply(print).click();
    await printButton.click();
    await page.waitForFunction(() => window.req100PrintCalls.length > 0);
    const calls = await page.evaluate(() => window.req100PrintCalls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, pageCount);
    for (const transform of calls[0]) assert.match(transform, /rotate\(-30\)/);
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.getByRole("button", { name: "导出", exact: true }).isVisible(), false);
    await page.evaluate(() => window.req100PrintTrace.sample("before page.pdf"));
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 59[45](?:\.\d+)? 84[12](?:\.\d+)?\]/);
    await page.emulateMedia({ media: "screen" });
    await print.getByText("已关闭打印窗口，可继续编辑或重新打印。", { exact: true }).waitFor();
    const pdfPages = await rasterizePdf(pdf);
    pdfPageCount = pdfPages.length;
    assert.equal(pdfPageCount, pageCount);
    for (const [index, bytes] of pdfPages.entries()) {
      const { samples } = await readProbes(page, bytes, -30);
      assertRotatedPixels(samples, `PDF 第 ${index + 1} 页`);
    }

    // 模拟字体就绪通知，保留未就绪提交时的实测页面，避免自然字体时序偶尔跳过此分支。
    await printLayer.waitFor({ state: "attached" });
    const firstInvalidated = await page.evaluate(() => {
      const start = window.req100PrintTrace.records.length;
      document.fonts.dispatchEvent(new Event("loadingdone"));
      return start;
    });
    const invalidated = await page.waitForFunction((start) => {
      return window.req100PrintTrace.records.slice(start).find((record) => record.ready === "false");
    }, firstInvalidated);
    const duringRefresh = await invalidated.jsonValue();
    assert.equal(duringRefresh.pages.length, pageCount, "重准备字体期间保留同一份谱的所有打印页");
    for (const { transform } of duringRefresh.pages) assert.match(transform, /rotate\(-30\)/);
    await printLayer.waitFor({ state: "attached" });
  } catch (error) {
    const trace = await page.evaluate(() => window.req100PrintTrace.stop());
    console.error(JSON.stringify({ pdfPageCount, trace }));
    throw error;
  }
  const trace = await page.evaluate(() => window.req100PrintTrace.stop());
  if (process.env.REQ100_PRINT_TRACE) console.log(JSON.stringify({ pdfPageCount, trace }));
  await close(print);
  console.log(`PASS 打印入口读到刚应用的水印，关闭背景图形时实际 PDF ${pageCount} 页 −30° 旋转像素正确`);

  await openImage();
  await assertAngles(main(image), 1, -30);
  await toggle(image).click();
  await apply(image).click();
  await ready(image);
  await assertOff(image);
  const cleanPng = await downloadImage(currentImage(), "下载图片", ".png");
  assert.deepEqual(cleanPng.bytes, Buffer.from(cleanPages[0]), "关闭水印后生成的首页与基线一致");
  await close(image);
  assert.equal(await status(), initialStatus);
  const baselineDownload = await downloadScoreJson(page);
  const baselineFile = await readFile(await baselineDownload.path());
  const applyText = async () => {
    await toggle(image).click();
    await button(image, "文字水印").click();
    await input(image).fill(text);
    await apply(image).click();
    await ready(image);
    await close(image);
  };
  await openImage();
  await applyText();
  const savedBeforeImport = await status();
  const exported = await downloadScoreJson(page);
  assert.deepEqual(JSON.parse(await readFile(await exported.path(), "utf8")).score, JSON.parse(baselineFile).score);
  assert.equal(await status(), savedBeforeImport);
  await openScoreImport(page, { name: baselineDownload.suggestedFilename(), mimeType: "application/json", buffer: baselineFile });
  await confirmScoreImport(page);
  await openImage();
  await assertOff(image);
  await applyText();

  await selectScoreAction(page, "文件", "新建曲谱");
  const newScore = page.getByRole("dialog", { name: "新建曲谱", exact: true });
  await newScore.getByRole("textbox", { name: "曲名" }).fill("REQ-100 会话回归");
  await button(newScore, "创建曲谱").click();
  await newScore.waitFor({ state: "hidden" });
  await openImage();
  await assertOff(image);
  await applyText();

  await page.reload({ waitUntil: "domcontentloaded" });
  await openImage();
  await assertOff(image);
  await close(image);
  assert.equal(await status(), exampleStatus);
  assert.deepEqual(errors, []);
  console.log("PASS 关闭水印恢复干净 PNG，水印不写入曲谱，重复导入、新建和刷新均重置会话水印");
} finally {
  await browser?.close();
  await rm(scratch, { recursive: true, force: true });
}
