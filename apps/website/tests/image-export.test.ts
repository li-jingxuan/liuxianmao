import { describe, it, expect, vi, afterEach } from "vitest";
import { deflateSync } from "node:zlib";
import {
  buildLayout,
  createQualityScore,
  A4_CONTENT_WIDTH,
} from "@liuxianmao/lxm-editor";
import {
  pngCrc32,
  readPngChunks,
  setPngResolution,
} from "../components/EditorShell/png-resolution";
import {
  imageBasename,
  pageImageName,
  prepareScoreImages,
  encodeScorePage,
  exportScoreImages,
  type PreparedScoreImages,
} from "../components/EditorShell/image-export-controller";
import { renderPageCanvas } from "../components/EditorShell/score-canvas-renderer";
vi.mock("../components/EditorShell/score-canvas-renderer", () => ({
  renderPageCanvas: vi.fn(),
}));
import { buildScoreScene } from "../components/EditorShell/score-scene";

// 测试输入由独立 zlib 编码产生，校验后再交给 PNG 密度处理。
const chunk = (type: string, data: Uint8Array) => {
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(data, 8);
  view.setUint32(
    result.length - 4,
    pngCrc32(result.subarray(4, result.length - 4)),
  );
  return result;
};
const tinyPng = () => {
  const header = new Uint8Array(13);
  const v = new DataView(header.buffer);
  v.setUint32(0, 1);
  v.setUint32(4, 1);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(new Uint8Array([0, 255, 255, 255, 255]))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("A4 图片文件与图元", () => {
  it("编码失败和取消都释放画布，不发布迟到结果", async () => {
    const layout = buildLayout(createQualityScore(16), {
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact",
    });
    const pages = (await import("@liuxianmao/lxm-editor")).paginateLayout(
      layout,
    ).pages;
    const prepared: PreparedScoreImages = {
      scene: buildScoreScene(layout),
      pages,
      title: "验收",
    };
    const failed = {
      width: 2480,
      height: 3508,
      toBlob: (callback: BlobCallback) => callback(null),
    };
    vi.mocked(renderPageCanvas).mockReturnValue(
      failed as unknown as HTMLCanvasElement,
    );
    await expect(
      encodeScorePage(prepared, 0, new AbortController().signal),
    ).rejects.toThrow(/编码失败/);
    expect(failed.width).toBe(1);
    let callback: BlobCallback | undefined;
    const pending = {
      width: 2480,
      height: 3508,
      toBlob: (cb: BlobCallback) => {
        callback = cb;
      },
    };
    vi.mocked(renderPageCanvas).mockReturnValue(
      pending as unknown as HTMLCanvasElement,
    );
    const controller = new AbortController();
    const output = encodeScorePage(prepared, 0, controller.signal);
    controller.abort();
    await expect(output).rejects.toMatchObject({ name: "AbortError" });
    expect(pending.height).toBe(1);
    callback?.(
      new Blob([tinyPng().buffer as ArrayBuffer], { type: "image/png" }),
    );
  });
  it("真实 ZIP 编码包含全部有序 PNG，超页数拒绝整包", async () => {
    const layout = buildLayout(createQualityScore(16), {
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact",
    });
    const pages = (await import("@liuxianmao/lxm-editor")).paginateLayout(
      layout,
    ).pages;
    const prepared: PreparedScoreImages = {
      scene: buildScoreScene(layout),
      pages,
      title: "验收",
    };
    vi.mocked(renderPageCanvas).mockImplementation(
      () =>
        ({
          width: 2480,
          height: 3508,
          toBlob: (cb: BlobCallback) =>
            cb(
              new Blob([tinyPng().buffer as ArrayBuffer], {
                type: "image/png",
              }),
            ),
        }) as unknown as HTMLCanvasElement,
    );
    const { blob, name } = await exportScoreImages(
      prepared,
      new AbortController().signal,
      () => {},
    );
    expect(name).toBe("验收_A4图片.zip");
    const { unzipSync } = await import("fflate");
    const contents = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(contents)).toEqual(
      pages.map((_, i) => pageImageName("验收", i)),
    );
    for (const data of Object.values(contents))
      expect(readPngChunks(data).some((c) => c.type === "pHYs")).toBe(true);
    await expect(
      exportScoreImages(
        { ...prepared, pages: Array.from({ length: 101 }, () => pages[0]!) },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(/100 页/);
  });

  it("新增/替换 DPI 不修改像素数据，密度唯一且位于 IDAT 前", () => {
    const source = tinyPng();
    const once = setPngResolution(source, 96);
    const result = setPngResolution(once, 300);
    const chunks = readPngChunks(result);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    const density = chunks[1]!.data;
    const v = new DataView(
      density.buffer,
      density.byteOffset,
      density.byteLength,
    );
    expect(v.getUint32(0)).toBe(11811);
    expect(v.getUint32(4)).toBe(11811);
    expect(density[8]).toBe(1);
    expect(chunks[2]!.data).toEqual(readPngChunks(source)[1]!.data);
    expect(setPngResolution(result)).toEqual(result);
  });
  it("拒绝截断/错误校验 PNG 和非法 DPI", () => {
    const png = tinyPng();
    expect(() => setPngResolution(png.subarray(0, png.length - 1))).toThrow();
    png[20] ^= 1;
    expect(() => setPngResolution(png)).toThrow(/校验/);
    expect(() => setPngResolution(tinyPng(), NaN)).toThrow(RangeError);
  });
  it("中文文件名保持可读，清理路径字符并正确排序", () => {
    expect(imageBasename('主歌/副歌:*?"<>|')).toBe("主歌_副歌_______");
    expect(imageBasename("...")).toBe("乐谱");
    expect(pageImageName("中文谱", 8)).toBe("中文谱_009.png");
    expect(imageBasename("长".repeat(100))).toHaveLength(80);
  });
  it("混合谱图元保留全部音乐文字、Bravura、技巧箭头和白色描边", () => {
    const layout = buildLayout(createQualityScore(16), {
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact",
    });
    const scene = buildScoreScene(layout);
    const items = scene.systems.flatMap((s) => s.items);
    expect(scene.systems.map((s) => s.index)).toEqual(
      layout.systems.map((s) => s.index),
    );
    expect(
      items.some((p) => p.kind === "text" && p.fontFamily.includes("Bravura")),
    ).toBe(true);
    expect(items.some((p) => p.kind === "polygon" && p.techniqueId)).toBe(true);
    expect(
      items.some(
        (p) => p.kind === "text" && p.text === "12" && p.stroke === "#fff",
      ),
    ).toBe(true);
    expect(items.some((p) => p.kind === "text" && p.text === "春")).toBe(true);
  });
  it("字体失败和已取消任务不会生成估算图片", async () => {
    vi.stubGlobal("document", {
      fonts: {
        load: vi.fn().mockResolvedValue([]),
        ready: Promise.resolve(),
        check: () => false,
      },
    });
    await expect(
      prepareScoreImages(
        createQualityScore(16),
        "compact",
        true,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/音乐字体/);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      prepareScoreImages(
        createQualityScore(16),
        "compact",
        true,
        cancelled.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
