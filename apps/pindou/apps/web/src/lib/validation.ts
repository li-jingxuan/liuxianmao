const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * 上传前的快速浏览器校验，用于尽早反馈类型和体积问题。
 * 这不是安全边界；后端仍会检查 MIME、文件魔数、解码结果和像素总量。
 */
export const validateImage = (file: File): string | null => {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return "请选择 JPG、PNG 或 WebP 图片";
  if (file.size > MAX_IMAGE_BYTES) return "图片大小不能超过 10 MiB";
  return null;
};
