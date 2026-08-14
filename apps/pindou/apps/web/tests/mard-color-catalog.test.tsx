import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MardColorCatalog } from "../src/components/mard-color-catalog";
import { getColorCatalog } from "../src/lib/api";
import type { ColorCatalogResponse } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  getColorCatalog: vi.fn(),
}));

const catalog: ColorCatalogResponse = {
  brand: "MARD",
  schema_version: "1.0",
  total_count: 3,
  groups: [
    {
      series: "A",
      label: "A 系列",
      color_count: 2,
      colors: [
        { code: "A1", hex: "#F9F0CD", rgb: [249, 240, 205] },
        { code: "A2", hex: "#FBFBD4", rgb: [251, 251, 212] },
      ],
    },
    {
      series: "ZG",
      label: "ZG 系列",
      color_count: 1,
      colors: [{ code: "ZG8", hex: "#123456", rgb: [18, 52, 86] }],
    },
  ],
  sets: [
    {
      size: 24,
      label: "MARD 24色套装",
      color_count: 2,
      colors: [
        { code: "A1", hex: "#F9F0CD", rgb: [249, 240, 205] },
        { code: "ZG8", hex: "#123456", rgb: [18, 52, 86] },
      ],
    },
    {
      size: 221,
      label: "MARD 221色套装",
      color_count: 1,
      colors: [{ code: "A2", hex: "#FBFBD4", rgb: [251, 251, 212] }],
    },
    {
      size: 264,
      label: "MARD 264色套装",
      color_count: 3,
      colors: [
        { code: "A1", hex: "#F9F0CD", rgb: [249, 240, 205] },
        { code: "A2", hex: "#FBFBD4", rgb: [251, 251, 212] },
        { code: "ZG8", hex: "#123456", rgb: [18, 52, 86] },
      ],
    },
  ],
};

const getColorCatalogMock = vi.mocked(getColorCatalog);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("MardColorCatalog", () => {
  it("renders every group by default and filters to one series", async () => {
    getColorCatalogMock.mockResolvedValue(catalog);
    render(<MardColorCatalog />);

    expect(screen.getByText("正在加载 MARD 色卡…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "A 系列" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ZG 系列" })).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("ZG8")).toBeInTheDocument();
    expect(screen.getByLabelText("A1 色块，#F9F0CD")).toHaveStyle({
      backgroundColor: "#F9F0CD",
    });

    fireEvent.click(screen.getByRole("button", { name: "ZG 系列，共 1 色" }));

    expect(screen.queryByRole("heading", { name: "A 系列" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ZG 系列" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ZG 系列，共 1 色" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "全部系列，共 3 色" }));
    expect(screen.getByRole("heading", { name: "A 系列" })).toBeInTheDocument();
  });

  it("switches to color-set grouping and filters an individual set", async () => {
    getColorCatalogMock.mockResolvedValue(catalog);
    render(<MardColorCatalog />);

    await screen.findByRole("heading", { name: "A 系列" });
    fireEvent.click(screen.getByRole("button", { name: "按颜色套装" }));

    expect(screen.getByRole("heading", { name: "MARD 24色套装" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MARD 221色套装" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MARD 264色套装" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部套装，共 3 套" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "221色套装，共 1 色" }));

    expect(screen.queryByRole("heading", { name: "MARD 24色套装" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MARD 221色套装" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "MARD 264色套装" })).not.toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
  });

  it("shows an error and retries the request", async () => {
    getColorCatalogMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(catalog);
    render(<MardColorCatalog />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "色卡加载失败，请确认后端服务已启动",
    );
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("heading", { name: "A 系列" })).toBeInTheDocument();
    expect(getColorCatalogMock).toHaveBeenCalledTimes(2);
  });

  it("aborts the catalog request when unmounted", () => {
    getColorCatalogMock.mockImplementation(() => new Promise(() => undefined));
    const { unmount } = render(<MardColorCatalog />);
    const signal = getColorCatalogMock.mock.calls[0]?.[0];

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
