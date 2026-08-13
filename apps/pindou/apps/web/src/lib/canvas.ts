import type { BeadGrid } from "./types";

export type DrawOptions = {
  /** 单个豆格占用的画布像素数。预览允许小数，导出通常使用整数。 */
  cellSize: number;
  /** 是否绘制格线；格线最后统一绘制，避免被后续色块覆盖。 */
  gridLine?: boolean;
  /** 预留圆珠和方格两种外观，当前页面默认使用方格。 */
  beadShape?: "circle" | "square";
  /** 是否在绘制前清空目标区域，便于调用方组合其他画布内容。 */
  clear?: boolean;
};

/**
 * 将后端 BeadGrid 绘制到任意 2D Canvas 上的纯渲染函数。
 *
 * 函数不读取 DOM、DPR 或页面缩放；调用方只需传入 context、网格和
 * cellSize。因此屏幕预览和 PNG 导出可以共享完全相同的颜色与坐标逻辑。
 */
export const drawBeadGrid = (
  context: CanvasRenderingContext2D,
  grid: BeadGrid,
  { cellSize, gridLine = true, beadShape = "square", clear = true }: DrawOptions,
) => {
  const width = grid.width * cellSize;
  const height = grid.height * cellSize;
  if (clear) context.clearRect(0, 0, width, height);

  grid.rows.forEach((row, y) => {
    row.forEach((paletteIndex, x) => {
      // -1 是后端契约规定的透明格，不填色但仍保留所在网格的位置。
      if (paletteIndex === -1) return;
      const color = grid.palette[paletteIndex];
      // 对意外的越界索引做容错，避免单个坏数据中断整张图的渲染。
      if (!color) return;
      context.fillStyle = color.hex;
      if (beadShape === "circle") {
        context.beginPath();
        context.arc((x + 0.5) * cellSize, (y + 0.5) * cellSize, cellSize * 0.43, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    });
  });

  // 单格过小时格线会遮住色块，因此缩略预览小于 3px 时自动省略。
  if (!gridLine || cellSize < 3) return;
  context.save();
  context.strokeStyle = "rgba(15, 25, 54, 0.38)";
  context.lineWidth = Math.max(0.5, cellSize * 0.045);
  context.beginPath();
  for (let x = 0; x <= grid.width; x += 1) {
    const offset = x * cellSize;
    context.moveTo(offset, 0);
    context.lineTo(offset, height);
  }
  for (let y = 0; y <= grid.height; y += 1) {
    const offset = y * cellSize;
    context.moveTo(0, offset);
    context.lineTo(width, offset);
  }
  context.stroke();
  context.restore();
};

/**
 * 在独立离屏 canvas 上生成固定像素密度的 PNG Blob。
 * 与预览不同，这里不乘 devicePixelRatio，保证相同网格和 cellSize 在任何
 * 设备上都得到完全一致的导出尺寸：width×cellSize × height×cellSize。
 */
export const exportBeadGrid = (grid: BeadGrid, cellSize = 20): Promise<Blob> => {
  const canvas = document.createElement("canvas");
  canvas.width = grid.width * cellSize;
  canvas.height = grid.height * cellSize;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("当前浏览器无法创建画布"));
  drawBeadGrid(context, grid, { cellSize, gridLine: true });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 生成失败"))), "image/png");
  });
};
