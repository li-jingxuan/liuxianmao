import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { albumAuthx, uploadAndShareAlbum } from "../src/lib/fnos-album";

const SECRET = "c2Vzc2lvbi1zZWNyZXQtZml4dHVyZQ==";
const NOW = 1793400000000;
const SHARE_URL = "https://share.fnnas.net/s/test-single-photo";
const png = new Blob(["fixture-png"], { type: "image/png" });

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  window.localStorage.setItem("fnos-Secret", SECRET);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function data(value: object) {
  return new Response(JSON.stringify({ code: 0, data: value }));
}

function install(options: { fail?: string; status?: number; ready?: boolean; repeat?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe(window.location.origin);
    expect(init.credentials).toBe("same-origin");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).has("X-Fnos-Secret")).toBe(false);
    const path = url.pathname;
    if (options.fail && path.endsWith(options.fail)) return new Response("", { status: options.status || 401 });
    if (path.endsWith("upload/path")) return data({ upload: { path: "/vol2/相册 A/.@#local", hasAccess: true } });
    if (path === "/upload") return new Response(null, { status: 200 });
    if (path.endsWith("upload/notice")) return data({ list: [{ id: 48820, errorCode: 0, error: "", repeat: !!options.repeat }], successCount: options.repeat ? 0 : 1 });
    if (path.endsWith("share_link/new")) return data({ id: 5, url: SHARE_URL, validTo: NOW / 1000 + 604800, photoCount: options.ready === false ? 0 : 1 });
    if (path.endsWith("share_link/detail")) return data({ id: 5, photoCount: 1 });
    throw new Error(`Unexpected path ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("browser NAS album delivery", () => {
  it.each([
    ["/p/api/v2/photo/upload/path", "", "6459f73291fd4bc1a6704879e570223f"],
    ["/p/api/v1/share_link/detail", "id=5&name=%E6%8B%BC%E8%B1%86%20%2B", "b8253f492bbe3e0587dc7f9328f84c05"],
    ["/p/api/v1/share_link/new", '{"photoIds":[48820],"name":"拼豆图纸","validTo":1794004800}', "393481a5d15a3c020a8e1450256621aa"],
  ])("matches the backend authx fixture for %s", (path, text, expected) => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 23456;
      return array;
    });
    vi.mocked(Date.now).mockReturnValue(NOW + 123);
    expect(albumAuthx(path, text)).toBe(`nonce=123456&timestamp=${NOW + 123}&sign=${expected}`);
  });

  it.each([false, true])("uploads and shares with HttpOnly cookie handled by browser, repeat=%s", async (repeat) => {
    const fetchMock = install({ ready: false, repeat });
    // document.cookie 不含 ost；真实 Cookie 由浏览器负责，应用不需要读取它。
    expect(document.cookie).not.toContain("ost=");
    const result = await uploadAndShareAlbum(png, 25);
    expect(result).toEqual({ url: SHARE_URL, expiresAt: new Date((NOW / 1000 + 604800) * 1000).toISOString() });
    const calls = fetchMock.mock.calls;
    expect(calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/p/api/v2/photo/upload/path", "/upload", "/p/api/v1/photo/upload/notice",
      "/p/api/v1/share_link/new", "/p/api/v1/share_link/detail",
    ]);
    const headers = new Headers(calls[1][1].headers);
    const encodedPath = headers.get("Trim-Path")!;
    expect(encodedPath).toMatch(/^\/vol2\/%E7%9B%B8%E5%86%8C%20A\/.@#local\/[a-f0-9]+\.png$/);
    expect(headers.get("Trim-Sign")).toBe(createHmac("sha256", Buffer.from(SECRET, "base64")).update(encodedPath).digest("base64"));
    expect(headers.get("Trim-Overwrite")).toBe("false");
    expect((calls[1][1].body as FormData).get("trim-upload-file")).toBeInstanceOf(Blob);
    for (const [input, init] of calls.filter(([input]) => new URL(input).pathname !== "/upload")) {
      const url = new URL(input);
      const fields = Object.fromEntries(new URLSearchParams(new Headers(init.headers).get("authx")!));
      const text = String(init.body || url.search.slice(1));
      const digest = createHash("md5").update(decodeURIComponent(text)).digest("hex");
      const sign = createHash("md5").update([
        "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh", url.pathname, fields.nonce, fields.timestamp,
        digest, "EAECCF25-80A6-4666-A7C2-A76904A74AB6",
      ].join("_")).digest("hex");
      expect(fields.sign).toBe(sign);
    }
  });

  it("explains a missing host secret without claiming the user logged out", async () => {
    window.localStorage.clear();
    const fetchMock = install();
    await expect(uploadAndShareAlbum(png, 25)).rejects.toThrow("宿主未提供");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads from the App with native credentials and creates a seven-day share", async () => {
    window.localStorage.clear();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android FNAppVer/1.0.0");
    const callHandler = vi.fn().mockResolvedValue(JSON.stringify({
      result: JSON.stringify({ secret: SECRET, token: "native-upload-token" }),
    }));
    vi.stubGlobal("flutter_inappwebview", { _platformReady: true, callHandler });
    const fetchMock = install();
    await expect(uploadAndShareAlbum(png, 31)).resolves.toEqual({
      url: SHARE_URL, expiresAt: new Date((NOW / 1000 + 604800) * 1000).toISOString(),
    });
    expect(callHandler).toHaveBeenCalledExactlyOnceWith("getUserMessage");
    const headers = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(headers.get("Trim-Token")).toBe("native-upload-token");
    expect(headers.get("Trim-Sign")).toBe(createHmac("sha256", Buffer.from(SECRET, "base64"))
      .update(headers.get("Trim-Path")!).digest("base64"));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body)).album_id).toBe(31);
    for (const [url, request] of fetchMock.mock.calls) {
      if (new URL(url).pathname !== "/upload") {
        expect(new Headers(request.headers).has("Trim-Token")).toBe(false);
      }
    }
    expect(window.localStorage.length).toBe(0);
  });

  it("does not start an upload when native credentials are unavailable", async () => {
    window.localStorage.clear();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone FNAppVer/1.0.0");
    vi.stubGlobal("flutter_inappwebview", { callHandler: vi.fn().mockResolvedValue(null) });
    const fetchMock = install();
    await expect(uploadAndShareAlbum(png, 31)).rejects.toThrow("无法获取飞牛 App");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not replay uploads after a failure", async () => {
    const fetchMock = install({ fail: "/upload", status: 500 });
    await expect(uploadAndShareAlbum(png, 25)).rejects.toThrow("已保存在本地");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports upstream session expiry", async () => {
    install({ fail: "upload/path", status: 401 });
    await expect(uploadAndShareAlbum(png, 25)).rejects.toThrow("登录已失效");
  });

  it("distinguishes missing album permissions from an expired session", async () => {
    install({ fail: "upload/notice", status: 403 });
    await expect(uploadAndShareAlbum(png, 25)).rejects.toThrow("相册操作权限");
  });

  it("supports cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      init.signal.throwIfAborted();
    }));
    const controller = new AbortController();
    controller.abort();
    await expect(uploadAndShareAlbum(png, 25, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
