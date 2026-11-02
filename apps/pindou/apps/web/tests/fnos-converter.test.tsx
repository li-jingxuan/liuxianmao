import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FnosKeyProvider, useFnosKey } from "../src/components/fnos-key-provider";
import { PindouConverter } from "../src/components/pindou-converter";
import { createConversion, createImageDelivery, getAccessKeyQuota, getColorSets } from "../src/lib/api";
import { exportPatternSheet } from "../src/lib/pattern-sheet-export";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function mockImageBrowser() {
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
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const scroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(exportPatternSheet).mockResolvedValue(new Blob(["test-png"], { type: "image/png" }));
  vi.mocked(createConversion).mockResolvedValue({ grid, quota: { initial_uses: 10, remaining_uses: 7 } });
  return () => { HTMLElement.prototype.scrollIntoView = scroll; };
}

async function selectImage(container: HTMLElement, file: File) {
  const fileInput = container.querySelector('input[type="file"]')!;
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "跳过裁剪" }));
  await screen.findByText(/64 × 64/);
}

async function convertImage() {
  fireEvent.click(screen.getByRole("button", { name: "开始转换" }));
  await screen.findByRole("button", { name: "上传并生成链接" });
}

function deliveryResponse(token: string): Awaited<ReturnType<typeof createImageDelivery>> {
  return {
    token, image_url: "/image", download_url: "/download", expires_at: "2099-01-01T00:00:00Z",
    share_url: `https://share.fnnas.net/s/${token}`,
  };
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
    const restoreBrowser = mockImageBrowser();
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
    expect(createImageDelivery).toHaveBeenCalledWith(expect.any(Blob), { fnos: true, signal: expect.any(AbortSignal) });
    expect(screen.getByRole("link", { name: "https://share.fnnas.net/s/test-single-photo" })).toHaveAttribute("href", "https://share.fnnas.net/s/test-single-photo");
    vi.stubGlobal("navigator", { clipboard: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    fireEvent.click(screen.getByRole("button", { name: "复制完整交付链接" }));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("已复制")).toBeInTheDocument();
    Reflect.deleteProperty(document, "execCommand");
    restoreBrowser();
  });

  it.each(["retry", "replace"] as const)("cancels a pending upload on %s and ignores its late share link", async (action) => {
    const restoreBrowser = mockImageBrowser();
    const oldUpload = deferred<Awaited<ReturnType<typeof createImageDelivery>>>();
    const newUpload = deferred<Awaited<ReturnType<typeof createImageDelivery>>>();
    vi.mocked(createImageDelivery)
      .mockReturnValueOnce(oldUpload.promise)
      .mockReturnValueOnce(newUpload.promise);
    const view = renderNas("conversion-key");
    await screen.findByText("剩余转换次数：8 次");
    await selectImage(view.container, new File(["old"], "old.png", { type: "image/png" }));
    await convertImage();
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    await waitFor(() => expect(createImageDelivery).toHaveBeenCalledTimes(1));
    const oldSignal = vi.mocked(createImageDelivery).mock.calls[0][1]?.signal;
    expect(oldSignal).toBeInstanceOf(AbortSignal);
    expect(oldSignal?.aborted).toBe(false);

    if (action === "retry") {
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
    } else {
      await selectImage(view.container, new File(["new"], "new.png", { type: "image/png" }));
    }
    expect(oldSignal?.aborted).toBe(true);
    await convertImage();
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    await waitFor(() => expect(createImageDelivery).toHaveBeenCalledTimes(2));
    const newSignal = vi.mocked(createImageDelivery).mock.calls[1][1]?.signal;
    expect(newSignal).toBeInstanceOf(AbortSignal);
    expect(newSignal?.aborted).toBe(false);

    // A server can finish an aborted request; keep the newer upload pending while it does.
    await act(async () => oldUpload.resolve(deliveryResponse("old-photo")));
    expect(screen.queryByRole("link", { name: "https://share.fnnas.net/s/old-photo" })).not.toBeInTheDocument();
    expect(screen.queryByText("交付链接已生成")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在上传…" })).toBeDisabled();
    expect(newSignal?.aborted).toBe(false);

    await act(async () => newUpload.resolve(deliveryResponse("new-photo")));
    expect(await screen.findByRole("link", { name: "https://share.fnnas.net/s/new-photo" }))
      .toHaveAttribute("href", "https://share.fnnas.net/s/new-photo");
    expect(screen.queryByRole("link", { name: "https://share.fnnas.net/s/old-photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传并生成链接" })).toBeEnabled();
    restoreBrowser();
  });

  it("does not upload or cache an old export that finishes after replacing the image", async () => {
    const restoreBrowser = mockImageBrowser();
    const oldExport = deferred<Blob>();
    const newBlob = new Blob(["new-pattern"], { type: "image/png" });
    vi.mocked(exportPatternSheet).mockReturnValueOnce(oldExport.promise).mockResolvedValueOnce(newBlob);
    vi.mocked(createImageDelivery).mockResolvedValue(deliveryResponse("new-photo"));
    const oldFile = new File(["old"], "old.png", { type: "image/png" });
    const newFile = new File(["new"], "new.png", { type: "image/png" });
    const view = renderNas("conversion-key");
    await screen.findByText("剩余转换次数：8 次");
    await selectImage(view.container, oldFile);
    await convertImage();
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    await waitFor(() => expect(exportPatternSheet).toHaveBeenCalledTimes(1));

    await selectImage(view.container, newFile);
    await convertImage();
    await act(async () => oldExport.resolve(new Blob(["old-pattern"], { type: "image/png" })));
    expect(createImageDelivery).not.toHaveBeenCalled();
    expect(screen.queryByText("交付链接已生成")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));

    expect(await screen.findByRole("link", { name: "https://share.fnnas.net/s/new-photo" })).toBeInTheDocument();
    expect(exportPatternSheet).toHaveBeenCalledTimes(2);
    expect(exportPatternSheet).toHaveBeenLastCalledWith(expect.objectContaining({ sourceFile: newFile }));
    expect(createImageDelivery).toHaveBeenCalledExactlyOnceWith(newBlob, { fnos: true, signal: expect.any(AbortSignal) });
    restoreBrowser();
  });
});
