import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FnosKeyProvider, useFnosKey } from "../src/components/fnos-key-provider";
import { PindouConverter } from "../src/components/pindou-converter";
import { createConversion, createImageDelivery, getAccessKeyQuota, getColorSets } from "../src/lib/api";
import type { BeadGrid } from "../src/lib/types";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api")>()),
  createConversion: vi.fn(), createImageDelivery: vi.fn(), getAccessKeyQuota: vi.fn(), getColorSets: vi.fn(),
}));
vi.mock("../src/lib/canvas", () => ({ drawBeadGrid: vi.fn() }));
vi.mock("../src/lib/pattern-sheet-export", () => ({
  exportPatternSheet: vi.fn(async () => new Blob(["test-png"], { type: "image/png" })),
}));
vi.mock("../src/components/image-crop-modal", () => ({
  ImageCropModal: ({ onSkip }: { onSkip: () => void }) => <button onClick={onSkip}>跳过裁剪</button>,
}));

const quotaMock = vi.mocked(getAccessKeyQuota);
const grid: BeadGrid = {
  schema_version: "4", algorithm_version: "bead-grid-constrained-v3", width: 1, height: 1,
  foreground: { palette: [{ id: 0, brand: "MARD", code: "A1", hex: "#FFFFFF", rgb: [255, 255, 255] }], rows: [[0]] },
  background: { mode: "none" }, stats: { bead_count: 1, color_count: 1 },
  meta: {
    enhancer: "passthrough", conversion_style: "chibi", background_mode: "solid", applied_background_mode: "solid",
    background_processing: "none", degraded: false, palette_brand: "MARD", color_set_size: 221,
    color_budget_mode: "auto", color_budget_policy_version: "test", effective_max_colors: 1,
    color_chart_version: "test", actual_color_count: 1,
  },
};

beforeEach(() => {
  vi.mocked(getColorSets).mockResolvedValue({
    brand: "MARD", schema_version: "1", default_size: 221,
    sets: [{ size: 221, label: "MARD 221色套装", color_count: 221 }],
  });
  quotaMock.mockResolvedValue({ initial_uses: 10, remaining_uses: 8 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function renderNas(apiKey?: string) {
  return render(<FnosKeyProvider><PindouConverter apiKey={apiKey} isFnos /></FnosKeyProvider>);
}

describe("NAS converter keys", () => {
  it("automatically uses the trimmed input and clears it with the embedded icon", async () => {
    renderNas("url-key");
    expect(await screen.findByText("剩余转换次数：8 次")).toBeInTheDocument();
    expect(screen.getByLabelText("转换密钥")).toHaveValue("url-key");
    fireEvent.change(screen.getByLabelText("转换密钥"), { target: { value: "  new-key  " } });
    expect(quotaMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "应用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "显示" })).not.toBeInTheDocument();
    await waitFor(() => expect(quotaMock).toHaveBeenLastCalledWith("new-key", expect.any(AbortSignal)));
    expect(screen.getByLabelText("转换密钥")).toHaveValue("  new-key  ");
    expect(screen.getByLabelText("转换密钥")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "清空转换密钥" }));
    expect(await screen.findByText("请先输入转换密钥")).toBeInTheDocument();
    expect(screen.getByLabelText("转换密钥")).toHaveValue("");
    expect(screen.getByLabelText("转换密钥")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "清空转换密钥" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始转换" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "签发密钥" }));
    expect(navigation.push).toHaveBeenCalledWith("/gk/fnos");
    expect(quotaMock).not.toHaveBeenLastCalledWith("url-key", expect.anything());
  });

  it("discards a delayed quota response from the previous key", async () => {
    let resolveOld!: (value: { initial_uses: number; remaining_uses: number }) => void;
    quotaMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    renderNas("old-key");
    await waitFor(() => expect(quotaMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("转换密钥"), { target: { value: "new-key" } });
    expect(await screen.findByText("剩余转换次数：8 次")).toBeInTheDocument();
    await act(async () => resolveOld({ initial_uses: 99, remaining_uses: 99 }));
    expect(screen.queryByText("剩余转换次数：99 次")).not.toBeInTheDocument();
    expect(screen.getByText("剩余转换次数：8 次")).toBeInTheDocument();
    expect(quotaMock.mock.calls[0][1]?.aborted).toBe(true);
  });

  it("recovers from a temporary quota failure without editing the key", async () => {
    quotaMock.mockRejectedValueOnce(new Error("offline"));
    renderNas("retry-key");
    fireEvent.click(await screen.findByRole("button", { name: "重试查询" }));
    expect(await screen.findByText("剩余转换次数：8 次")).toBeInTheDocument();
    expect(quotaMock).toHaveBeenCalledTimes(2);
  });

  it("uses a newly issued key across navigation and loses memory after a full remount", async () => {
    function Pages() {
      const [showHome, setShowHome] = useState(true);
      const key = useFnosKey();
      return <>
        <button onClick={() => setShowHome(!showHome)}>切换测试页面</button>
        <button onClick={() => { key.selectIssuedKey("issued-key"); setShowHome(true); }}>使用签发结果</button>
        {showHome && <PindouConverter apiKey="old-url-key" isFnos />}
      </>;
    }
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const view = render(<StrictMode><FnosKeyProvider><Pages /></FnosKeyProvider></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "签发密钥" }));
    fireEvent.click(screen.getByRole("button", { name: "切换测试页面" }));
    fireEvent.click(screen.getByRole("button", { name: "使用签发结果" }));
    expect(screen.getByLabelText("转换密钥")).toHaveValue("issued-key");
    await waitFor(() => expect(quotaMock).toHaveBeenLastCalledWith("issued-key", expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole("button", { name: "清空转换密钥" }));
    fireEvent.click(screen.getByRole("button", { name: "切换测试页面" }));
    fireEvent.click(screen.getByRole("button", { name: "切换测试页面" }));
    expect(screen.getByLabelText("转换密钥")).toHaveValue("");
    expect(storageWrite).not.toHaveBeenCalled();
    storageWrite.mockRestore();
    view.unmount();
    renderNas();
    expect(screen.getByLabelText("转换密钥")).toHaveValue("");
  });

  it("converts with the applied key and uploads without a browser management key", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("Image", class {
      naturalWidth = 64; naturalHeight = 64;
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:source");
      static revokeObjectURL = vi.fn();
    });
    const scroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(createConversion).mockResolvedValue({ grid, quota: { initial_uses: 10, remaining_uses: 7 } });
    vi.mocked(createImageDelivery).mockResolvedValue({
      token: "delivered", image_url: "/image", download_url: "/download", expires_at: "2099-01-01T00:00:00Z",
      share_url: "https://share.fnnas.net/s/test-single-photo",
    });
    const view = renderNas("conversion-key");
    await screen.findByText("剩余转换次数：8 次");
    const fileInput = view.container.querySelector('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(["png"], "source.png", { type: "image/png" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "跳过裁剪" }));
    await screen.findByText(/64 × 64/);
    fireEvent.click(screen.getByRole("button", { name: "开始转换" }));
    fireEvent.click(await screen.findByRole("button", { name: "上传并生成链接" }));
    expect(await screen.findByText("交付链接已生成")).toBeInTheDocument();
    expect(createConversion).toHaveBeenCalledWith(expect.anything(), { apiKey: "conversion-key" });
    expect(createImageDelivery).toHaveBeenCalledWith(expect.any(Blob), { fnos: true });
    expect(screen.getByRole("link", { name: "https://share.fnnas.net/s/test-single-photo" })).toHaveAttribute("href", "https://share.fnnas.net/s/test-single-photo");
    vi.stubGlobal("navigator", { clipboard: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    fireEvent.click(screen.getByRole("button", { name: "复制完整交付链接" }));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("已复制")).toBeInTheDocument();
    Reflect.deleteProperty(document, "execCommand");
    HTMLElement.prototype.scrollIntoView = scroll;
  });
});
