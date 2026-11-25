import { SCORE_TEXT_FONT, type ILXMPageLayout } from "@liuxianmao/lxm-editor";

export interface WatermarkAsset {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly url: string;
  /** 与 PNG 地址来自同一帧的独立画布，可直接用于同步编码。 */
  readonly raster: HTMLCanvasElement;
}

export interface WatermarkStyle {
  size: number;
  opacity: number;
  angle: number;
  position: "center" | "left" | "right";
}

export type ScoreWatermark =
  | null
  | ({ kind: "text"; text: string } & WatermarkStyle)
  | ({ kind: "image"; asset: WatermarkAsset } & WatermarkStyle);

// 文字大小为 A4 逻辑像素字号，图片大小为长边占纸宽的百分比。保留各自原有的默认视觉效果。
export const DEFAULT_WATERMARK_STYLE = {
  text: { size: 40, opacity: 12, angle: -30, position: "center" },
  image: { size: 38, opacity: 18, angle: 0, position: "center" },
} as const satisfies Record<"text" | "image", Readonly<WatermarkStyle>>;

const commonLimits = {
  opacity: { min: 5, max: 45 },
  angle: { min: -180, max: 180 },
};

export const WATERMARK_LIMITS = {
  text: { ...commonLimits, size: { min: 12, max: 96 } },
  image: { ...commonLimits, size: { min: 10, max: 65 } },
} as const;

const unreadableImage = "无法读取这张图片，请重新导出或换一张。";

const createRaster = (width: number, height: number) => {
  const raster = document.createElement("canvas");
  raster.width = width;
  raster.height = height;
  const ctx = raster.getContext("2d");
  if (!ctx) throw new Error(unreadableImage);
  return { raster, ctx };
};

const freezeRaster = (
  name: string,
  raster: HTMLCanvasElement,
  width: number,
  height: number,
): WatermarkAsset => ({
  name,
  raster,
  width,
  height,
  url: raster.toDataURL("image/png"),
});

/** 依据文件头校验格式。实际解码后冻结一帧，预览、打印与编码都保留其透明通道。 */
export const readWatermarkAsset = async (
  file: File,
): Promise<WatermarkAsset> => {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("图片超过 5 MB，请压缩后重试。");

  let header: string;
  try {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    header = String.fromCharCode(...bytes);
  } catch {
    throw new Error(unreadableImage);
  }
  const mime = header.startsWith("\x89PNG\r\n\x1a\n")
    ? "image/png"
    : header.startsWith("\xff\xd8\xff")
      ? "image/jpeg"
      : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"
        ? "image/webp"
        : null;
  if (!mime) throw new Error("请选择 PNG、JPG 或 WebP 格式的图片。");

  const sourceUrl = URL.createObjectURL(file.slice(0, file.size, mime));
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new Error(unreadableImage);
    // 缩放上限覆盖 A4 成品的最大水印长边，布局仍依照源图尺寸计算原始比例。
    const scale = Math.min(1, 1800 / Math.max(width, height));
    const { raster, ctx } = createRaster(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    );
    ctx.drawImage(image, 0, 0, raster.width, raster.height);
    return freezeRaster(file.name, raster, width, height);
  } catch {
    throw new Error(unreadableImage);
  } finally {
    // 只有解码过程持有 Blob URL，冻结资源可随当前曲谱会话自然回收。
    URL.revokeObjectURL(sourceUrl);
  }
};

/** 原型中的示例标志也使用透明位图，试排与上传图片共享绘制过程。 */
export const createExampleWatermarkAsset = (): WatermarkAsset => {
  const { raster, ctx } = createRaster(630, 250);
  ctx.fillStyle = "#215745";
  ctx.beginPath();
  ctx.moveTo(108, 235);
  ctx.bezierCurveTo(94, 232, 14, 139, 14, 82);
  ctx.bezierCurveTo(14, -7, 203, -7, 203, 82);
  ctx.bezierCurveTo(203, 141, 125, 233, 108, 235);
  ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(108, 102, 37, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < 6; i++) ctx.fillRect(92 + i * 6, 64, 2.6, 76);
  ctx.font = 'bold 126px "Songti SC", "Noto Serif CJK SC", serif';
  ctx.fillText("青 禾", 241, 133);
  ctx.font = '46px "PingFang SC", sans-serif';
  ctx.fillText("吉 他 教 室", 251, 210);
  return freezeRaster("青禾吉他教室.png", raster, raster.width, raster.height);
};

const limitStyle = (
  watermark: NonNullable<ScoreWatermark>,
  key: keyof typeof WATERMARK_LIMITS.text,
) => {
  const { min, max } = WATERMARK_LIMITS[watermark.kind][key];
  const value = watermark[key];
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : DEFAULT_WATERMARK_STYLE[watermark.kind][key];
};

type PaperSize = Pick<ILXMPageLayout, "width" | "height">;

/** 文字墨迹与图片都绕自身中心旋转。角位按旋转后的外框对齐纸边，保持纸宽 6% 的边距。 */
const getPlacement = (
  page: PaperSize,
  width: number,
  height: number,
  angle: number,
  position: WatermarkStyle["position"],
) => {
  if (position === "center")
    return { centerX: page.width / 2, centerY: page.height / 2 };

  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = angle % 180 === 0 ? 0 : Math.abs(Math.sin(radians));
  const halfOuterWidth = (width * cos + height * sin) / 2;
  const halfOuterHeight = (width * sin + height * cos) / 2;
  const margin = page.width * 0.06;
  return {
    centerX:
      position === "left"
        ? margin + halfOuterWidth
        : page.width - margin - halfOuterWidth,
    centerY: page.height - margin - halfOuterHeight,
  };
};

let textMeasureContext: CanvasRenderingContext2D | undefined;

/** 在 A4 逻辑坐标内计算同一份变换参数，SVG 与 Canvas 都绕水印中心旋转。 */
export const getScoreWatermarkLayout = (
  watermark: ScoreWatermark | undefined,
  page: PaperSize,
) => {
  if (!watermark) return null;
  const size = limitStyle(watermark, "size");
  const angle = limitStyle(watermark, "angle");
  const opacity = limitStyle(watermark, "opacity") / 100;
  const { position = DEFAULT_WATERMARK_STYLE[watermark.kind].position } =
    watermark;
  if (watermark.kind === "text") {
    // Canvas 会将 ASCII 制表及换行字符画成空格，SVG 也使用同一行内容。
    const text = watermark.text.replace(/[\t\n\f\r]/g, " ");
    if (!text || typeof document === "undefined") return null;
    textMeasureContext ??=
      document.createElement("canvas").getContext("2d") ?? undefined;
    if (!textMeasureContext) return null;
    const ctx = textMeasureContext;
    ctx.direction = "ltr";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${size}px ${SCORE_TEXT_FONT}`;
    let metrics = ctx.measureText(text);
    const lineWidth = Math.max(
      metrics.width,
      metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
    );
    const maxWidth = page.width * 0.75;
    let fontSize = size;
    // 保留单行署名的宽度上限。长文字用选定字号试算后等比缩小，避免大字号旋转后越过纸边。
    if (lineWidth > maxWidth) {
      fontSize = (size * maxWidth) / lineWidth;
      ctx.font = `${fontSize}px ${SCORE_TEXT_FONT}`;
      metrics = ctx.measureText(text);
    }
    const {
      actualBoundingBoxLeft: left,
      actualBoundingBoxRight: right,
      actualBoundingBoxAscent: ascent,
      actualBoundingBoxDescent: descent,
    } = metrics;
    // 以可见墨迹而非字宽或字体行高定位，避免中英文混排和下伸字形在旋转、贴边时产生偏移。
    return {
      kind: "text" as const,
      text,
      fontFamily: SCORE_TEXT_FONT,
      fontSize,
      textX: (left - right) / 2,
      baseline: (ascent - descent) / 2,
      ...getPlacement(page, left + right, ascent + descent, angle, position),
      angle,
      opacity,
    };
  }

  const { asset } = watermark;
  const scale =
    (page.width * size) / (100 * Math.max(asset.width, asset.height));
  const width = asset.width * scale;
  const height = asset.height * scale;
  return {
    kind: "image" as const,
    asset,
    width,
    height,
    ...getPlacement(page, width, height, angle, position),
    angle,
    opacity,
  };
};
