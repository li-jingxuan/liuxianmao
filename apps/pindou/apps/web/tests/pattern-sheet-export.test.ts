import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateContainRect,
  calculatePatternSheetLayout,
  countOccupiedBeads,
  exportPatternSheet,
} from "../src/lib/pattern-sheet-export";
import type { BeadGrid } from "../src/lib/types";

const createGrid = (paletteSize = 7): BeadGrid => ({
  schema_version: "2",
  algorithm_version: "bead-grid-constrained-v1",
  width: 24,
  height: 24,
  palette: Array.from({ length: paletteSize }, (_, index) => ({
    id: index,
    brand: "MARD" as const,
    code: `A${index + 1}`,
    hex: `#${index.toString(16).padStart(6, "0")}` as `#${string}`,
    rgb: [index, index, index],
  })),
  rows: Array.from({ length: 24 }, (_, y) =>
    Array.from({ length: 24 }, (_, x) => (x === 0 && y === 0 ? -1 : (x + y) % paletteSize)),
  ),
  meta: {
    enhancer: "passthrough",
    background_mode: "keep",
    palette_brand: "MARD",
    color_set_size: 48,
    color_budget_mode: "auto",
    color_budget_policy_version: "grid-color-budget-v2",
    effective_max_colors: 30,
    color_chart_version: "1.0",
    actual_color_count: paletteSize,
  },
});

const createContext = () => ({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  drawImage: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 0,
  font: "",
  textAlign: "start",
  textBaseline: "alphabetic",
}) as unknown as CanvasRenderingContext2D;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("calculatePatternSheetLayout", () => {
  it("places the source panel left and the info panel right below the grid", () => {
    const layout = calculatePatternSheetLayout(createGrid(), 36);

    expect(layout.grid).toEqual({ x: 36, y: 36, width: 864, height: 864 });
    expect(layout.sourcePanel.y).toBeGreaterThan(layout.grid.y + layout.grid.height);
    expect(layout.sourcePanel.x).toBe(36);
    expect(layout.infoPanel.x).toBeGreaterThan(layout.sourcePanel.x + layout.sourcePanel.width);
    expect(layout.sourcePanel.height).toBe(layout.infoPanel.height);
    expect(layout.paletteColumns).toBe(3);
    expect(layout.paletteRows).toBe(3);
  });

  it("increases the footer height when palette rows exceed the minimum", () => {
    const shortLayout = calculatePatternSheetLayout(createGrid(3), 36);
    const longLayout = calculatePatternSheetLayout(createGrid(30), 36);

    expect(longLayout.footer.height).toBeGreaterThan(shortLayout.footer.height);
    expect(longLayout.canvasHeight).toBeGreaterThan(shortLayout.canvasHeight);
  });
});

describe("calculateContainRect", () => {
  const target = { x: 10, y: 20, width: 200, height: 100 };

  it("centers a landscape image without cropping", () => {
    expect(calculateContainRect(400, 100, target)).toEqual({
      x: 10,
      y: 45,
      width: 200,
      height: 50,
    });
  });

  it("centers a portrait image without cropping", () => {
    expect(calculateContainRect(100, 400, target)).toEqual({
      x: 97.5,
      y: 20,
      width: 25,
      height: 100,
    });
  });
});

describe("countOccupiedBeads", () => {
  it("does not count transparent cells", () => {
    expect(countOccupiedBeads(createGrid())).toBe(575);
  });
});

describe("exportPatternSheet", () => {
  it("draws source image, image info and palette codes, then releases the bitmap", async () => {
    const grid = createGrid();
    const context = createContext();
    const png = new Blob(["png"], { type: "image/png" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback, type?: string) => {
        expect(type).toBe("image/png");
        callback(png);
      }),
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockReturnValue(canvas);
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 400, height: 200, close })));

    await expect(exportPatternSheet({
      grid,
      sourceFile: new File(["image"], "source.png", { type: "image/png" }),
      sourceDetails: { width: 400, height: 200 },
    })).resolves.toBe(png);

    const layout = calculatePatternSheetLayout(grid);
    expect(canvas.width).toBe(layout.canvasWidth);
    expect(canvas.height).toBe(layout.canvasHeight);
    expect(context.translate).toHaveBeenCalledWith(layout.grid.x, layout.grid.y);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(context.fillText).toHaveBeenCalledWith("图像信息", expect.any(Number), expect.any(Number));
    expect(context.fillText).toHaveBeenCalledWith("使用色卡（7）", expect.any(Number), expect.any(Number));
    grid.palette.forEach((color) => {
      expect(context.fillText).toHaveBeenCalledWith(
        color.code,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("releases the bitmap when PNG encoding fails", async () => {
    const context = createContext();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) => callback(null)),
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockReturnValue(canvas);
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 100, height: 100, close })));

    await expect(exportPatternSheet({
      grid: createGrid(),
      sourceFile: new File(["image"], "source.png", { type: "image/png" }),
      sourceDetails: { width: 100, height: 100 },
    })).rejects.toThrow("图纸尺寸过大");
    expect(close).toHaveBeenCalledOnce();
  });
});
