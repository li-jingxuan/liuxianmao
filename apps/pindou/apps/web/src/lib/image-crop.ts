import imageCompression from "browser-image-compression";
import type { Area } from "react-easy-crop";

const DEFAULT_MAX_SIZE_MB = 10;
const DEFAULT_MAX_EDGE = 4096;

export type CropImageOptions = {
  mimeType?: string;
  quality?: number;
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
};

type DecodedImage = {
  image: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

/** 使用 createImageBitmap 优先纠正手机照片方向，旧浏览器回退到 img。 */
const decodeImage = async (file: File): Promise<DecodedImage> => {
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // 某些浏览器声明了 createImageBitmap，但不支持当前图片格式，继续走兼容路径。
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取图片，请重新选择后重试"));
      element.src = url;
    });

    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
};

const toBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片导出失败，请重试"))),
      mimeType,
      quality,
    );
  });

const getOutputType = (sourceType: string, requestedType?: string): string => {
  const type = requestedType ?? sourceType;
  return ["image/jpeg", "image/png", "image/webp"].includes(type)
    ? type
    : "image/png";
};

const getFileExtension = (mimeType: string): string => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
};

const createOutputName = (sourceFile: File, mimeType: string): string => {
  const basename = sourceFile.name.replace(/\.[^.]+$/, "") || "image";
  return `${basename}-cropped.${getFileExtension(mimeType)}`;
};

/** 将第三方裁剪组件返回的原图像素区域导出为新的 File。 */
export async function cropImageToFile(
  sourceFile: File,
  area: Area,
  options: CropImageOptions = {},
): Promise<File> {
  const mimeType = getOutputType(sourceFile.type, options.mimeType);
  const quality = options.quality ?? 0.92;
  const maxSizeMB = options.maxSizeMB ?? DEFAULT_MAX_SIZE_MB;
  const maxWidthOrHeight = options.maxWidthOrHeight ?? DEFAULT_MAX_EDGE;
  const decoded = await decodeImage(sourceFile);

  try {
    const x = Math.max(0, Math.min(Math.round(area.x), decoded.width - 1));
    const y = Math.max(0, Math.min(Math.round(area.y), decoded.height - 1));
    const width = Math.min(Math.max(1, Math.round(area.width)), decoded.width - x);
    const height = Math.min(Math.max(1, Math.round(area.height)), decoded.height - y);

    if (width <= 0 || height <= 0) {
      throw new Error("裁剪区域无效，请重新调整裁剪范围");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持图片裁剪");

    // area 坐标由 react-easy-crop 提供，单位是纠正方向后的原图像素。
    context.drawImage(decoded.image, x, y, width, height, 0, 0, width, height);
    const blob = await toBlob(canvas, mimeType, quality);
    let output = new File([blob], createOutputName(sourceFile, mimeType), {
      type: mimeType,
      lastModified: Date.now(),
    });

    const exceedsSize = output.size > maxSizeMB * 1024 * 1024;
    const exceedsEdge = Math.max(width, height) > maxWidthOrHeight;
    if (exceedsSize || exceedsEdge) {
      // 关闭 Worker，避免浏览器从外部 CDN 加载 worker 脚本，兼容受限网络环境。
      output = await imageCompression(output, {
        maxSizeMB,
        maxWidthOrHeight,
        fileType: mimeType,
        initialQuality: quality,
        useWebWorker: false,
      });
    }

    if (output.size > maxSizeMB * 1024 * 1024) {
      throw new Error(`裁剪后的图片仍超过 ${maxSizeMB} MiB，请缩小裁剪范围后重试`);
    }
    return output;
  } finally {
    decoded.close?.();
  }
}
