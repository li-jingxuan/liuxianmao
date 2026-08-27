import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PindouConverter } from "../src/components/pindou-converter";
import {
  getAccessKeyQuota,
  getColorSets,
  PindouApiError,
} from "../src/lib/api";

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api")>()),
  createConversion: vi.fn(),
  createImageDelivery: vi.fn(),
  getAccessKeyQuota: vi.fn(),
  getColorSets: vi.fn(),
}));

const getAccessKeyQuotaMock = vi.mocked(getAccessKeyQuota);
const getColorSetsMock = vi.mocked(getColorSets);

beforeEach(() => {
  getColorSetsMock.mockResolvedValue({
    brand: "MARD",
    schema_version: "1",
    default_size: 221,
    sets: [{ size: 221, label: "MARD 221色套装", color_count: 221 }],
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("PindouConverter quota", () => {
  it("defaults to the chibi conversion style", async () => {
    getAccessKeyQuotaMock.mockResolvedValue({
      initial_uses: 20,
      remaining_uses: 12,
    });

    render(<PindouConverter apiKey="valid-key" />);

    expect(screen.getByRole("button", { name: "Q版" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("group", { name: "转换类型" })).toBeInTheDocument();
  });

  it("loads and displays the remaining conversion uses above an enabled button", async () => {
    getAccessKeyQuotaMock.mockResolvedValue({
      initial_uses: 20,
      remaining_uses: 12,
    });

    render(<PindouConverter apiKey="valid-key" />);

    expect(screen.getByText("正在查询剩余次数…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始转换" })).toBeDisabled();
    expect(await screen.findByText("剩余转换次数：12 次")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开始转换" })).toBeEnabled(),
    );
  });

  it("disables conversion when the key has no remaining uses", async () => {
    getAccessKeyQuotaMock.mockResolvedValue({
      initial_uses: 1,
      remaining_uses: 0,
    });

    render(<PindouConverter apiKey="exhausted-key" />);

    expect(await screen.findByText("转换次数已用完")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始转换" })).toBeDisabled();
  });

  it("distinguishes an invalid key from a temporary quota query failure", async () => {
    getAccessKeyQuotaMock.mockRejectedValue(
      new PindouApiError("当前访问链接无效", "API_KEY_INVALID"),
    );

    const { rerender } = render(<PindouConverter apiKey="invalid-key" />);

    expect(await screen.findByText("当前访问链接无效")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始转换" })).toBeDisabled();

    getAccessKeyQuotaMock.mockRejectedValue(new Error("network unavailable"));
    rerender(<PindouConverter apiKey="another-key" />);

    expect(await screen.findByText("剩余次数暂时无法获取")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开始转换" })).toBeEnabled(),
    );
  });
});
