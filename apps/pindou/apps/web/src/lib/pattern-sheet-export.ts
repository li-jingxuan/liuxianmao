import { drawBeadGrid, PATTERN_EXPORT_CELL_SIZE } from "./canvas";
import type { BeadGrid } from "./types";

const SHEET_PADDING = 36;
const SECTION_GAP = 36;
const FOOTER_COLUMN_GAP = 36;
const FOOTER_MIN_HEIGHT = 360;
const PANEL_PADDING = 24;
const INFO_HEIGHT = 132;
const INFO_PALETTE_GAP = 24;
const PALETTE_TITLE_HEIGHT = 36;
const PALETTE_ROW_HEIGHT = 50;

export type SourceImageDetails = {
  width: number;
  height: number;
};

export type PatternSheetExportInput = {
  grid: BeadGrid;
  sourceFile: File;
  sourceDetails: SourceImageDetails;
  cellSize?: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type PatternSheetLayout = {
  canvasWidth: number;
  canvasHeight: number;
  grid: Rect;
  footer: Rect;
  sourcePanel: Rect;
  infoPanel: Rect;
  paletteColumns: number;
  paletteRows: number;
};

/** 统一计算施工图坐标，绘制和测试共同消费同一份布局结果。 */
export const calculatePatternSheetLayout = (
  grid: BeadGrid,
  cellSize = PATTERN_EXPORT_CELL_SIZE,
): PatternSheetLayout => {
  const gridWidth = grid.width * cellSize;
  const gridHeight = grid.height * cellSize;
  const footerColumnWidth = (gridWidth - FOOTER_COLUMN_GAP) / 2;
  const paletteColumns = footerColumnWidth >= 720 ? 6 : 3;
  const paletteRows = Math.ceil(grid.palette.length / paletteColumns);
  const footerHeight = Math.max(
    FOOTER_MIN_HEIGHT,
    PANEL_PADDING * 2 + INFO_HEIGHT + INFO_PALETTE_GAP + PALETTE_TITLE_HEIGHT + paletteRows * PALETTE_ROW_HEIGHT,
  );
  const footerY = SHEET_PADDING + gridHeight + SECTION_GAP;

  return {
    canvasWidth: gridWidth + SHEET_PADDING * 2,
    canvasHeight: footerY + footerHeight + SHEET_PADDING,
    grid: { x: SHEET_PADDING, y: SHEET_PADDING, width: gridWidth, height: gridHeight },
    footer: { x: SHEET_PADDING, y: footerY, width: gridWidth, height: footerHeight },
    sourcePanel: { x: SHEET_PADDING, y: footerY, width: footerColumnWidth, height: footerHeight },
    infoPanel: {
      x: SHEET_PADDING + footerColumnWidth + FOOTER_COLUMN_GAP,
      y: footerY,
      width: footerColumnWidth,
      height: footerHeight,
    },
    paletteColumns,
    paletteRows,
  };
};

/** 计算等比 contain 后的绘制矩形，保证原图完整且居中。 */
export const calculateContainRect = (
  sourceWidth: number,
  sourceHeight: number,
  target: Rect,
): Rect => {
  const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: target.x + (target.width - width) / 2,
    y: target.y + (target.height - height) / 2,
    width,
    height,
  };
};

export const countOccupiedBeads = (grid: BeadGrid) =>
  grid.rows.reduce(
    (total, row) => total + row.filter((paletteIndex) => paletteIndex !== -1).length,
    0,
  );

type DecodedSource = {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

const decodeWithImageElement = (file: File): Promise<DecodedSource> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取原图片，请重新选择图片后重试"));
    };
    image.src = url;
  });

/** 优先使用 ImageBitmap；不支持或解码失败时回退到 HTMLImageElement。 */
const decodeSourceImage = async (file: File): Promise<DecodedSource> => {
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // 某些浏览器声明了 createImageBitmap，却不支持当前图片格式，继续走兼容路径。
    }
  }
  return decodeWithImageElement(file);
};

const drawPanel = (context: CanvasRenderingContext2D, rect: Rect) => {
  context.fillStyle = "#F5F6FA";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeStyle = "rgba(15, 25, 54, 0.16)";
  context.lineWidth = 1;
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
};

const drawSourcePanel = (
  context: CanvasRenderingContext2D,
  source: DecodedSource,
  panel: Rect,
) => {
  drawPanel(context, panel);
  context.fillStyle = "#0F1936";
  context.font = "700 24px system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText("原图", panel.x + PANEL_PADDING, panel.y + PANEL_PADDING);

  const imageArea: Rect = {
    x: panel.x + PANEL_PADDING,
    y: panel.y + 64,
    width: panel.width - PANEL_PADDING * 2,
    height: panel.height - 64 - PANEL_PADDING,
  };
  context.fillStyle = "#FFFFFF";
  context.fillRect(imageArea.x, imageArea.y, imageArea.width, imageArea.height);
  const destination = calculateContainRect(source.width, source.height, imageArea);
  context.drawImage(source.image, destination.x, destination.y, destination.width, destination.height);
  context.strokeStyle = "rgba(15, 25, 54, 0.18)";
  context.strokeRect(imageArea.x, imageArea.y, imageArea.width, imageArea.height);
};

const drawInfoAndPalettePanel = (
  context: CanvasRenderingContext2D,
  grid: BeadGrid,
  sourceDetails: SourceImageDetails,
  layout: PatternSheetLayout,
) => {
  const panel = layout.infoPanel;
  drawPanel(context, panel);
  const contentX = panel.x + PANEL_PADDING;
  const contentWidth = panel.width - PANEL_PADDING * 2;

  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = "#0F1936";
  context.font = "700 24px system-ui, sans-serif";
  context.fillText("图像信息", contentX, panel.y + PANEL_PADDING);

  const info = [
    ["网格尺寸", `${grid.width} × ${grid.height}`],
    ["原图尺寸", `${sourceDetails.width} × ${sourceDetails.height}`],
    ["使用颜色", `${grid.palette.length}`],
    ["总豆数", countOccupiedBeads(grid).toLocaleString("zh-CN")],
    ["色卡品牌", grid.meta.palette_brand],
    ["色卡套装", `${grid.meta.color_set_size} 色`],
  ] as const;
  const infoColumnWidth = contentWidth / 2;
  info.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = contentX + column * infoColumnWidth;
    const y = panel.y + 68 + row * 30;
    context.fillStyle = "#667085";
    context.font = "500 17px system-ui, sans-serif";
    context.fillText(`${label}：`, x, y);
    context.fillStyle = "#0F1936";
    context.font = "600 17px system-ui, sans-serif";
    context.fillText(value, x + 88, y);
  });

  const paletteTitleY = panel.y + PANEL_PADDING + INFO_HEIGHT + INFO_PALETTE_GAP;
  context.fillStyle = "#0F1936";
  context.font = "700 24px system-ui, sans-serif";
  context.fillText(`使用色卡（${grid.palette.length}）`, contentX, paletteTitleY);

  const paletteStartY = paletteTitleY + PALETTE_TITLE_HEIGHT;
  const itemWidth = contentWidth / layout.paletteColumns;
  grid.palette.forEach((color, index) => {
    const column = index % layout.paletteColumns;
    const row = Math.floor(index / layout.paletteColumns);
    const x = contentX + column * itemWidth;
    const y = paletteStartY + row * PALETTE_ROW_HEIGHT;
    context.fillStyle = color.hex;
    context.fillRect(x, y, 28, 28);
    context.strokeStyle = "rgba(15, 25, 54, 0.18)";
    context.strokeRect(x, y, 28, 28);
    context.fillStyle = "#0F1936";
    context.font = "600 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textBaseline = "middle";
    context.fillText(color.code, x + 38, y + 14, Math.max(0, itemWidth - 44));
  });
};

const canvasToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图纸尺寸过大，请降低网格尺寸后重试"))),
      "image/png",
    );
  });

/** 生成包含网格、原图、图像信息和实际色卡的完整施工图。 */
export const exportPatternSheet = async ({
  grid,
  sourceFile,
  sourceDetails,
  cellSize = PATTERN_EXPORT_CELL_SIZE,
}: PatternSheetExportInput): Promise<Blob> => {
  if (sourceDetails.width <= 0 || sourceDetails.height <= 0) {
    throw new Error("原图片尺寸无效，请重新选择图片后重试");
  }

  const source = await decodeSourceImage(sourceFile);
  try {
    const layout = calculatePatternSheetLayout(grid, cellSize);
    const canvas = document.createElement("canvas");
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建图纸画布");

    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(layout.grid.x, layout.grid.y);
    drawBeadGrid(context, grid, {
      cellSize,
      gridLine: true,
      beadShape: "square",
      showColorCode: true,
      clear: false,
    });
    context.restore();

    drawSourcePanel(context, source, layout.sourcePanel);
    drawInfoAndPalettePanel(context, grid, sourceDetails, layout);
    return await canvasToPng(canvas);
  } finally {
    source.release();
  }
};
