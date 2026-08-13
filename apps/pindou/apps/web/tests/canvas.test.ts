import { describe, expect, it, vi } from "vitest";

import { drawBeadGrid } from "../src/lib/canvas";
import type { BeadGrid } from "../src/lib/types";

const grid: BeadGrid = {
  schema_version: "1",
  algorithm_version: "bead-grid-v1",
  width: 2,
  height: 2,
  palette: [{ id: 0, brand: "MARD", code: "A1", hex: "#FF0000", rgb: [255, 0, 0] }],
  rows: [[0, -1], [-1, 0]],
  meta: {
    enhancer: "passthrough",
    palette_brand: "MARD",
    color_set_size: 24,
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
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 0,
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
});
