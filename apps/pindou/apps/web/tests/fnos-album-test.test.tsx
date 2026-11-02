import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "../src/app/page";
import { FnosAlbumTest } from "../src/components/fnos-album-test";
import { createAccessKey, createConversion, createImageDelivery, getAccessKeyQuota } from "../src/lib/api";
import { diagnoseFnosUploadSession } from "../src/lib/fnos-session";

const platform = vi.hoisted(() => ({ isFnos: true }));
vi.mock("../src/lib/paths", () => ({ get IS_FNOS() { return platform.isFnos; } }));
vi.mock("../src/lib/api", () => ({
  createImageDelivery: vi.fn(), createConversion: vi.fn(), createAccessKey: vi.fn(), getAccessKeyQuota: vi.fn(),
}));
vi.mock("../src/lib/fnos-session", () => ({ diagnoseFnosUploadSession: vi.fn() }));
vi.mock("../src/components/pindou-converter", () => ({
  PindouConverter: ({ apiKey, deliveryAdminKey }: { apiKey?: string; deliveryAdminKey?: string }) => (
    <div data-testid="normal-converter">{apiKey}|{deliveryAdminKey}</div>
  ),
}));

const diagnosis = "platform: fnOS\nstage: get-session\nfields: token(string), uid(number)";
const response = {
  token: "test", image_url: "/image", download_url: "/download",
  share_url: "https://share.fnnas.net/s/test-photo", expires_at: "2099-01-08T00:00:00Z",
};
let png: Blob;
let canvasContext: { fillStyle: string; fillRect: ReturnType<typeof vi.fn> };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function generate() {
  fireEvent.click(screen.getByRole("button", { name: "生成测试图" }));
  return screen.findByRole("img", { name: "本地生成的彩色 PNG 测试图" });
}

beforeEach(() => {
  vi.resetAllMocks();
  platform.isFnos = true;
  png = new Blob(["local-png"], { type: "image/png" });
  canvasContext = { fillStyle: "", fillRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) { callback(png); });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:local-test");
    static revokeObjectURL = vi.fn();
  });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.mocked(createImageDelivery).mockResolvedValue(response);
  vi.mocked(diagnoseFnosUploadSession).mockResolvedValue(diagnosis);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
});

describe("fnOS album test UI", () => {
  it("generates a small colored PNG locally and uploads the exact preview Blob without AI or quota calls", async () => {
    render(<FnosAlbumTest />);
    expect(screen.getByRole("heading", { level: 1, name: "拼豆相册测试" })).toBeInTheDocument();
    expect(screen.getByText("不调用 AI，不消耗转换次数")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传并生成链接" })).toBeDisabled();
    expect(diagnoseFnosUploadSession).not.toHaveBeenCalled();
    const preview = await generate();
    expect(preview).toHaveAttribute("src", "blob:local-test");
    expect(URL.createObjectURL).toHaveBeenCalledWith(png);
    expect(canvasContext.fillRect).toHaveBeenCalledTimes(16);
    const canvas = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.instances[0] as HTMLCanvasElement;
    expect(canvas.width).toBe(128);
    expect(canvas.height).toBe(128);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    expect(await screen.findByText("相册分享链接已生成")).toBeInTheDocument();
    expect(createImageDelivery).toHaveBeenCalledExactlyOnceWith(png, { fnos: true, signal: expect.any(AbortSignal) });
    expect(vi.mocked(createImageDelivery).mock.calls[0][0]).toBe(png);
    expect(screen.getByLabelText("相册分享链接")).toHaveValue(response.share_url);
    expect(screen.getByText(/有效期 7 天/)).toHaveTextContent(response.expires_at);
    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
    expect(await screen.findByText("链接已复制")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(response.share_url);
    expect(createConversion).not.toHaveBeenCalled();
    expect(createAccessKey).not.toHaveBeenCalled();
    expect(getAccessKeyQuota).not.toHaveBeenCalled();
    expect(diagnoseFnosUploadSession).not.toHaveBeenCalled();
  });

  it("reads diagnostics manually and copies the complete selectable text", async () => {
    render(<FnosAlbumTest />);
    expect(screen.getByRole("button", { name: "复制诊断" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "检查 App 会话" }));
    await waitFor(() => expect(screen.getByLabelText("完整诊断")).toHaveValue(diagnosis));
    expect(screen.getByLabelText("完整诊断")).toHaveAttribute("readonly");
    expect(diagnoseFnosUploadSession).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: "复制诊断" }));
    expect(await screen.findByText("诊断已复制")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(diagnosis);
    expect(screen.getByLabelText("完整诊断")).toHaveValue(diagnosis);
    expect(createImageDelivery).not.toHaveBeenCalled();
  });

  it("previews a selected PNG and uploads the identical original File without canvas or AI", async () => {
    const file = new File(["chosen-png"], "existing-pattern.PNG", { type: "image/png" });
    render(<FnosAlbumTest />);
    fireEvent.change(screen.getByLabelText(/选择 PNG/), { target: { files: [file] } });
    const preview = screen.getByRole("img", { name: "所选 PNG：existing-pattern.PNG" });
    expect(preview).toHaveAttribute("src", "blob:local-test");
    expect(preview).not.toHaveAttribute("width");
    expect(screen.getByText("所选 PNG：existing-pattern.PNG · 上传原文件")).toBeInTheDocument();
    expect(screen.queryByText(/128 × 128/)).not.toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    await screen.findByText("相册分享链接已生成");
    expect(vi.mocked(createImageDelivery).mock.calls[0][0]).toBe(file);
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    expect(createConversion).not.toHaveBeenCalled();
    expect(createAccessKey).not.toHaveBeenCalled();
    expect(getAccessKeyQuota).not.toHaveBeenCalled();
  });

  it.each([
    { name: "image.jpg", type: "image/png", size: 1, message: "请选择 PNG 文件（.png）" },
    { name: "image.png", type: "image/jpeg", size: 1, message: "请选择 PNG 文件（.png）" },
    { name: "large.png", type: "image/png", size: 15 * 1024 * 1024 + 1, message: "PNG 文件不能超过 15 MiB" },
  ])("rejects an invalid PNG selection: $name / $type / $size", ({ name, type, size, message }) => {
    render(<FnosAlbumTest />);
    const file = new File(["png"], name, { type });
    Object.defineProperty(file, "size", { value: size });
    fireEvent.change(screen.getByLabelText(/选择 PNG/), { target: { files: [file] } });
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "上传并生成链接" })).toBeDisabled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(createImageDelivery).not.toHaveBeenCalled();
  });

  it("accepts a .png file without MIME metadata at the 15 MiB limit", () => {
    render(<FnosAlbumTest />);
    const file = new File(["png"], "image.png");
    Object.defineProperty(file, "size", { value: 15 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText(/选择 PNG/), { target: { files: [file] } });
    expect(screen.getByRole("img", { name: "所选 PNG：image.png" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["upload", "diagnose"])("clears old diagnostics when a new %s starts, even if it later fails without diagnostics", async (operation) => {
    render(<FnosAlbumTest />);
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "检查 App 会话" }));
    await screen.findByText("App 会话检查完成");
    expect(screen.getByLabelText("完整诊断")).toHaveValue(diagnosis);
    const pending = deferred<never>();
    if (operation === "upload") vi.mocked(createImageDelivery).mockReturnValueOnce(pending.promise);
    else vi.mocked(diagnoseFnosUploadSession).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: operation === "upload" ? "上传并生成链接" : "检查 App 会话" }));
    expect(screen.getByLabelText("完整诊断")).toHaveValue("");
    await act(async () => pending.reject(new Error("网络失败")));
    expect(screen.getByRole("alert")).toHaveTextContent("网络失败");
    expect(screen.getByLabelText("完整诊断")).toHaveValue("");
    expect(screen.getByRole("button", { name: "复制诊断" })).toBeDisabled();
  });

  it.each(["unavailable", "rejected"])("copies diagnostics with an HTTP-compatible fallback when clipboard is %s", async (mode) => {
    if (mode === "unavailable") Reflect.deleteProperty(navigator, "clipboard");
    else vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("denied"));
    const command = vi.fn(() => {
      expect((document.activeElement as HTMLTextAreaElement).value).toBe(diagnosis);
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: command });
    render(<FnosAlbumTest />);
    fireEvent.click(screen.getByRole("button", { name: "检查 App 会话" }));
    await screen.findByText("App 会话检查完成");
    const copyButton = screen.getByRole("button", { name: "复制诊断" });
    copyButton.focus();
    fireEvent.click(copyButton);
    expect(await screen.findByText("诊断已复制")).toBeInTheDocument();
    expect(command).toHaveBeenCalledWith("copy");
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("shows an upload session error and its safe diagnosis without replaying any calls", async () => {
    vi.mocked(createImageDelivery).mockRejectedValue(Object.assign(new Error("App 会话失败"), { diagnostic: diagnosis }));
    render(<FnosAlbumTest />);
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("App 会话失败");
    expect(screen.getByLabelText("完整诊断")).toHaveValue(diagnosis);
    expect(createImageDelivery).toHaveBeenCalledTimes(1);
    expect(diagnoseFnosUploadSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "复制诊断" }));
    expect(await screen.findByText("诊断已复制")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(diagnosis);
  });

  it("shows safe diagnostics when the manual session check itself fails", async () => {
    vi.mocked(diagnoseFnosUploadSession).mockRejectedValue(Object.assign(new Error("检查失败"), { diagnostic: diagnosis }));
    render(<FnosAlbumTest />);
    fireEvent.click(screen.getByRole("button", { name: "检查 App 会话" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("检查失败");
    expect(screen.getByLabelText("完整诊断")).toHaveValue(diagnosis);
  });

  it("cancels uploads and ignores an old success after a newer failure", async () => {
    const old = deferred<typeof response>();
    vi.mocked(createImageDelivery).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error("新的上传失败"));
    render(<FnosAlbumTest />);
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    const signal = vi.mocked(createImageDelivery).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    await screen.findByText("新的上传失败");
    await act(async () => old.resolve(response));
    expect(screen.queryByLabelText("相册分享链接")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("新的上传失败");
    expect(createImageDelivery).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"])("ignores a late diagnostic %s after cancel", async (outcome) => {
    const pending = deferred<string>();
    vi.mocked(diagnoseFnosUploadSession).mockReturnValue(pending.promise);
    render(<FnosAlbumTest />);
    fireEvent.click(screen.getByRole("button", { name: "检查 App 会话" }));
    const signal = vi.mocked(diagnoseFnosUploadSession).mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => {
      if (outcome === "resolve") pending.resolve(diagnosis);
      else pending.reject(Object.assign(new Error("过时错误"), { diagnostic: diagnosis }));
    });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByLabelText("完整诊断")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("已取消")).toBeInTheDocument();
  });

  it("ignores a late canvas Blob after cancel without creating a preview URL", async () => {
    let finish!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => { finish = callback; });
    render(<FnosAlbumTest />);
    fireEvent.click(screen.getByRole("button", { name: "生成测试图" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => finish(png));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("aborts uploads and revokes previews on unmount, ignoring a late success", async () => {
    const pending = deferred<typeof response>();
    vi.mocked(createImageDelivery).mockReturnValue(pending.promise);
    const view = render(<FnosAlbumTest />);
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "上传并生成链接" }));
    const signal = vi.mocked(createImageDelivery).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-test");
    await act(async () => pending.resolve(response));
    render(<FnosAlbumTest />);
    expect(screen.queryByLabelText("相册分享链接")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("revokes the previous preview when generating another PNG", async () => {
    vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    render(<FnosAlbumTest />);
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "生成测试图" }));
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:second"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");
  });

  it("keeps diagnostics readable when copying is unavailable", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    render(<FnosAlbumTest />);
    fireEvent.click(screen.getByRole("button", { name: "检查 App 会话" }));
    await screen.findByText("App 会话检查完成");
    fireEvent.click(screen.getByRole("button", { name: "复制诊断" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请长按文本，手动复制");
    expect(screen.getByLabelText("完整诊断")).toHaveValue(diagnosis);
  });
});

describe("temporary Home switch", () => {
  it("renders only the album test when fnOS test mode is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_FNOS_ALBUM_TEST_MODE", "true");
    render(await Home({ searchParams: Promise.resolve({ k: "ignored" }) }));
    expect(screen.getByRole("heading", { name: "拼豆相册测试" })).toBeInTheDocument();
    expect(screen.queryByTestId("normal-converter")).not.toBeInTheDocument();
    expect(createConversion).not.toHaveBeenCalled();
    expect(getAccessKeyQuota).not.toHaveBeenCalled();
  });

  it.each([undefined, "false"])("preserves the normal fnOS home with flag %s", async (flag) => {
    vi.stubEnv("NEXT_PUBLIC_FNOS_ALBUM_TEST_MODE", flag);
    render(await Home({ searchParams: Promise.resolve({ k: ["existing-key"], user: "admin" }) }));
    expect(screen.getByTestId("normal-converter")).toHaveTextContent("existing-key|");
    expect(screen.queryByRole("heading", { name: "拼豆相册测试" })).not.toBeInTheDocument();
  });

  it("preserves the web home and its admin key even when the test flag is true", async () => {
    platform.isFnos = false;
    vi.stubEnv("NEXT_PUBLIC_FNOS_ALBUM_TEST_MODE", "true");
    render(await Home({ searchParams: Promise.resolve({ k: "existing-key", user: "admin" }) }));
    expect(screen.getByTestId("normal-converter")).toHaveTextContent("existing-key|admin");
    expect(screen.queryByRole("heading", { name: "拼豆相册测试" })).not.toBeInTheDocument();
  });
});
