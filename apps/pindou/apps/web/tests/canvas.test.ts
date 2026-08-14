import { describe, expect, it, vi } from "vitest";

import { drawBeadGrid, exportBeadGrid, PATTERN_EXPORT_CELL_SIZE } from "../src/lib/canvas";
import type { BeadGrid } from "../src/lib/types";

const grid: BeadGrid = {
  schema_version: "2",
  algorithm_version: "bead-grid-constrained-v1",
  width: 2,
  height: 2,
  palette: [{ id: 0, brand: "MARD", code: "A1", hex: "#FF0000", rgb: [255, 0, 0] }],
  rows: [[0, -1], [-1, 0]],
  meta: {
    enhancer: "passthrough",
    background_mode: "keep",
    palette_brand: "MARD",
    color_set_size: 24,
    color_budget_mode: "auto",
    color_budget_policy_version: "grid-color-budget-v2",
    effective_max_colors: 8,
    color_chart_version: "1.0",
    actual_color_count: 1,
  },
};

const createContext = () => ({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
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

describe("drawBeadGrid", () => {
  it("uses rows[y][x] and skips transparent cells", () => {
    const context = createContext();
    drawBeadGrid(context, grid, { cellSize: 10, gridLine: false });
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 20, 20);
    expect(context.fillRect).toHaveBeenNthCalledWith(1, 0, 0, 10, 10);
    expect(context.fillRect).toHaveBeenNthCalledWith(2, 10, 10, 10, 10);
    expect(context.fillRect).toHaveBeenCalledTimes(2);
  });

  it("draws all grid boundaries", () => {
    const context = createContext();
    drawBeadGrid(context, grid, { cellSize: 10, gridLine: true });
    expect(context.moveTo).toHaveBeenCalledTimes(6);
    expect(context.lineTo).toHaveBeenCalledTimes(6);
    expect(context.stroke).toHaveBeenCalledOnce();
  });

  it("does not draw color codes by default", () => {
    const context = createContext();
    drawBeadGrid(context, grid, { cellSize: 36, gridLine: false });
    expect(context.fillText).not.toHaveBeenCalled();
  });

  it("draws palette codes only for occupied cells before grid lines", () => {
    const context = createContext();
    drawBeadGrid(context, grid, { cellSize: 36, gridLine: true, showColorCode: true });

    expect(context.fillText).toHaveBeenNthCalledWith(1, "A1", 18, 18, 29.52);
    expect(context.fillText).toHaveBeenNthCalledWith(2, "A1", 54, 54, 29.52);
    expect(context.fillText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(context.fillText).mock.invocationCallOrder.at(-1))
      .toBeLessThan(vi.mocked(context.stroke).mock.invocationCallOrder[0]);
  });

  it("uses dark text on light colors and white text on dark colors", () => {
    const lightContext = createContext();
    const darkContext = createContext();
    const lightGrid: BeadGrid = {
      ...grid,
      width: 1,
      height: 1,
      palette: [{ ...grid.palette[0], hex: "#FFFFFF", rgb: [255, 255, 255] }],
      rows: [[0]],
    };
    const darkGrid: BeadGrid = {
      ...lightGrid,
      palette: [{ ...grid.palette[0], hex: "#000000", rgb: [0, 0, 0] }],
    };

    drawBeadGrid(lightContext, lightGrid, { cellSize: 36, gridLine: false, showColorCode: true });
    drawBeadGrid(darkContext, darkGrid, { cellSize: 36, gridLine: false, showColorCode: true });

    expect(lightContext.fillStyle).toBe("rgba(15, 25, 54, 0.9)");
    expect(darkContext.fillStyle).toBe("rgba(255, 255, 255, 0.96)");
  });
});

describe("exportBeadGrid", () => {
  it("creates a 36px-per-cell PNG and draws color codes", async () => {
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
    const createElement = vi.spyOn(document, "createElement").mockReturnValue(canvas);

    await expect(exportBeadGrid(grid)).resolves.toBe(png);
    expect(canvas.width).toBe(grid.width * PATTERN_EXPORT_CELL_SIZE);
    expect(canvas.height).toBe(grid.height * PATTERN_EXPORT_CELL_SIZE);
    expect(context.fillText).toHaveBeenCalledTimes(2);

    createElement.mockRestore();
  });
});
