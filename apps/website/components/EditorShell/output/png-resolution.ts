/** PNG chunk 校验与 300 DPI 密度写入；像素压缩数据保持原样。 */
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let n = 0; n < 8; n++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export const pngCrc32 = (data: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of data) value = table[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
export interface PngChunk {
  type: string;
  data: Uint8Array;
  raw: Uint8Array;
}
/** 校验所有 chunk 边界和 CRC，拒绝损坏数据，避免生成不可读取图片。 */
export const readPngChunks = (bytes: Uint8Array): PngChunk[] => {
  if (!SIGNATURE.every((v, i) => bytes[i] === v))
    throw new Error("无效 PNG 文件");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG 数据块截断");
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("PNG 数据块越界");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (
      pngCrc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)
    )
      throw new Error("PNG 校验失败");
    chunks.push({
      type,
      data: bytes.subarray(offset + 8, end - 4),
      raw: bytes.subarray(offset, end),
    });
    offset = end;
    if (type === "IEND") break;
  }
  if (
    offset !== bytes.length ||
    chunks[0]?.type !== "IHDR" ||
    chunks[0].data.length !== 13 ||
    chunks.at(-1)?.type !== "IEND" ||
    !chunks.some((c) => c.type === "IDAT")
  )
    throw new Error("PNG 结构不完整");
  return chunks;
};
/** 替换浏览器默认密度，pHYs 必须位于第一个 IDAT 之前。 */
export const setPngResolution = (bytes: Uint8Array, dpi = 300): Uint8Array => {
  if (!Number.isFinite(dpi) || dpi <= 0 || dpi / 0.0254 > 0xffffffff)
    throw new RangeError("图片 DPI 无效");
  const chunks = readPngChunks(bytes).filter((c) => c.type !== "pHYs");
  const physical = new Uint8Array(21);
  const view = new DataView(physical.buffer);
  view.setUint32(0, 9);
  physical.set([112, 72, 89, 115], 4);
  const density = Math.round(dpi / 0.0254);
  view.setUint32(8, density);
  view.setUint32(12, density);
  physical[16] = 1;
  view.setUint32(17, pngCrc32(physical.subarray(4, 17)));
  const pieces: Uint8Array[] = [Uint8Array.from(SIGNATURE)];
  let added = false;
  for (const c of chunks) {
    if (c.type === "IDAT" && !added) {
      pieces.push(physical);
      added = true;
    }
    pieces.push(c.raw);
  }
  const result = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of pieces) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
};
