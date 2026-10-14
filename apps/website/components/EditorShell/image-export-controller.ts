import { createMusicTextMetricReader } from "./music-text-metric-reader";
import {
  buildLayout,
  collectMusicTextMeasureRequests,
  A4_CONTENT_WIDTH,
  paginateLayout,
  type ILXMDocument,
  type ILXMLayoutDensity,
  type ILXMPageLayout,
  type ILXMMusicTextMetrics,
} from "@liuxianmao/lxm-editor";
import { buildScoreScene, type ScoreScene } from "./score-scene";
import { renderPageCanvas } from "./score-canvas-renderer";
import { setPngResolution } from "./png-resolution";

export interface PreparedScoreImages {
  scene: ScoreScene;
  pages: ILXMPageLayout[];
  title: string;
}
export const MAX_IMAGE_PAGES = 100;
export const MAX_IMAGE_BYTES = 200 * 1024 * 1024;
/** Windows 和 macOS 均可读的文件名，避免标题变成路径。 */
export const imageBasename = (title: string) =>
  [...title]
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "乐谱";
export const pageImageName = (title: string, index: number) =>
  `${imageBasename(title)}_${String(index + 1).padStart(3, "0")}.png`;
const checkCancelled = (signal: AbortSignal) => signal.throwIfAborted();
/** 非可中断的字体/编码任务超时后，迟到结果不进入当前输出。 */
const bounded = <T>(
  task: Promise<T>,
  signal: AbortSignal,
  ms: number,
  message: string,
): Promise<T> =>
  new Promise((resolve, reject) => {
    checkCancelled(signal);
    const cancel = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(message));
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    signal.addEventListener("abort", cancel, { once: true });
    task.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e) => {
        cleanup();
        reject(e);
      },
    );
  });

/** 在真实 SVG 中度量一次完整请求集；finally 保证错误和取消不遗留节点。 */
const measureScoreText = (
  score: ILXMDocument,
  showChordDiagrams: boolean,
): ILXMMusicTextMetrics => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText =
    "position:fixed;left:-10000px;opacity:0;pointer-events:none;overflow:visible";
  svg.setAttribute("aria-hidden", "true");
  document.body.appendChild(svg);
  const metrics: Record<string, ILXMMusicTextMetrics[string]> = {};
  try {
    const readMetric = createMusicTextMetricReader(svg);
    for (const r of collectMusicTextMeasureRequests(score, showChordDiagrams)) {
      if (!r.text) continue;
      const b = readMetric(r);
      if (
        ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
        b.width <= 0 ||
        b.height <= 0
      )
        throw new Error("文字度量失败，请重试图片导出");
      metrics[r.key] = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    return metrics;
  } finally {
    svg.remove();
  }
};

/** 字体就绪后生成快照，不读取旧布局或尚未应用的表单草稿。 */
export const prepareScorePresentation = async (
  score: ILXMDocument,
  density: ILXMLayoutDensity,
  showChordDiagrams: boolean,
  signal: AbortSignal,
): Promise<PreparedScoreImages> => {
  const fonts = await bounded(
    Promise.all([
      document.fonts.load("22px Bravura", "\uE4E5\uE240"),
      document.fonts.ready,
    ]),
    signal,
    10000,
    "字体准备超时，请重试",
  );
  checkCancelled(signal);
  if (!fonts[0].length || !document.fonts.check("22px Bravura", "\uE4E5\uE240"))
    throw new Error("音乐字体加载失败，无法导出清晰乐谱");
  const metrics = measureScoreText(score, showChordDiagrams);
  checkCancelled(signal);
  const layout = buildLayout(score, {
    purpose: "presentation",
    systemWidth: A4_CONTENT_WIDTH,
    density,
    showChordDiagrams,
    musicTextMetrics: metrics,
  });
  const result = paginateLayout(layout);
  if (!result.ok) {
    const d = result.diagnostics[0]!;
    const names = {
      "empty-score": "没有可以导出的谱面",
      "invalid-geometry": "谱面坐标无效",
      "header-overflow": "标题信息超过 A4 页面范围",
      "system-too-wide": "谱行超过 A4 宽度",
      "system-too-tall": "谱行超过 A4 高度",
      "first-page-overflow": "标题和首行无法完整放入 A4 首页",
    };
    const measure = score.score.tracks[0]?.measures.findIndex(
      (m) => m.id === d.measureIds[0],
    );
    throw new Error(
      `${names[d.code]}${measure !== undefined && measure >= 0 ? `（第 ${measure + 1} 小节）` : ""}，请调整内容后重试`,
    );
  }
  return {
    scene: buildScoreScene(layout),
    pages: result.pages,
    title: score.score.title,
  };
};
/** 兼容图片调用入口；打印与预览使用同一成品准备过程。 */
export const prepareScoreImages = prepareScorePresentation;
/** 一页一个画布，图片编码完成后立即释放像素内存。 */
export const encodeScorePage = async (
  prepared: PreparedScoreImages,
  index: number,
  signal: AbortSignal,
): Promise<Blob> => {
  checkCancelled(signal);
  const page = prepared.pages[index];
  if (!page) throw new Error("页面不存在");
  const canvas = renderPageCanvas(prepared.scene, page);
  try {
    const png = await bounded(
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("图片编码失败，请重试")),
          "image/png",
        ),
      ),
      signal,
      15000,
      "图片编码超时，请重试",
    );
    checkCancelled(signal);
    const bytes = new Uint8Array(await png.arrayBuffer());
    checkCancelled(signal);
    return new Blob([setPngResolution(bytes).buffer as ArrayBuffer], {
      type: "image/png",
    });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
};
/** 多页按 STORE 打包；禁止并行持有整谱高分辨率画布。 */
export const exportScoreImages = async (
  prepared: PreparedScoreImages,
  signal: AbortSignal,
  onProgress: (page: number) => void,
): Promise<{ blob: Blob; name: string }> => {
  if (prepared.pages.length === 1) {
    onProgress(1);
    return {
      blob: await encodeScorePage(prepared, 0, signal),
      name: pageImageName(prepared.title, 0),
    };
  }
  if (prepared.pages.length > MAX_IMAGE_PAGES)
    throw new Error("超过 100 页，请在预览中按页下载");
  const { Zip, ZipPassThrough } = await import("fflate");
  checkCancelled(signal);
  const chunks: ArrayBuffer[] = [];
  let zipError: Error | null = null;
  let total = 0;
  const zip = new Zip((error, data) => {
    if (error) zipError = error;
    else chunks.push(data.slice().buffer as ArrayBuffer);
  });
  try {
    for (let i = 0; i < prepared.pages.length; i++) {
      checkCancelled(signal);
      onProgress(i + 1);
      const blob = await encodeScorePage(prepared, i, signal);
      total += blob.size;
      if (total > MAX_IMAGE_BYTES)
        throw new Error("图片总大小超过 200MiB，请按页下载");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      checkCancelled(signal);
      const entry = new ZipPassThrough(pageImageName(prepared.title, i));
      zip.add(entry);
      entry.push(bytes, true);
      if (zipError) throw zipError;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    checkCancelled(signal);
    zip.end();
    if (zipError) throw zipError;
    return {
      blob: new Blob(chunks, { type: "application/zip" }),
      name: `${imageBasename(prepared.title)}_A4图片.zip`,
    };
  } finally {
    zip.terminate();
  }
};
