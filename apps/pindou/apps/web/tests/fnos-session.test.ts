import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let getFnosUploadSession: typeof import("../src/lib/fnos-session").getFnosUploadSession;
let diagnoseFnosUploadSession: typeof import("../src/lib/fnos-session").diagnoseFnosUploadSession;

const SECRET = "c2Vzc2lvbi1zZWNyZXQtZml4dHVyZQ==";
const READY = "flutterInAppWebViewPlatformReady";

function mobile(platform = "Android") {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(`${platform} FNAppVer/1.0.0`);
}

function bridge(raw: unknown, ready = true) {
  const callHandler = vi.fn().mockResolvedValue(raw);
  vi.stubGlobal("flutter_inappwebview", { _platformReady: ready, callHandler });
  return callHandler;
}

function envelope(data: unknown) {
  return JSON.stringify({ result: JSON.stringify(data) });
}

beforeEach(async () => {
  vi.resetModules();
  ({ getFnosUploadSession, diagnoseFnosUploadSession } = await import("../src/lib/fnos-session"));
});

afterEach(() => {
  // 消耗当前模块只监听一次的就绪事件，下个测试重新载入模块。
  window.dispatchEvent(new Event(READY));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.cookie = "fnos-token=; Max-Age=0; path=/";
});

describe("fnOS upload session", () => {
  it("keeps ordinary browser credentials and decodes the optional cookie", async () => {
    localStorage.setItem("fnos-Secret", SECRET);
    document.cookie = "fnos-token=web%2Btoken; path=/";
    await expect(getFnosUploadSession()).resolves.toEqual({ secret: SECRET, token: "web+token" });
  });

  it.each([
    { secret: SECRET, token: "app-token" },
    { code: 0, data: { secret: SECRET, token: "app-token" } },
  ])("reads the native envelope without browser storage", async (payload) => {
    mobile();
    const call = bridge(envelope(payload));
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    await expect(getFnosUploadSession()).resolves.toEqual({ secret: SECRET, token: "app-token" });
    expect(call).toHaveBeenCalledExactlyOnceWith("getUserMessage");
    expect(storage).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("prefers the current App account over an old browser session", async () => {
    mobile();
    localStorage.setItem("fnos-Secret", "b2xk");
    document.cookie = "fnos-token=old; path=/";
    bridge(envelope({ secret: SECRET }));
    await expect(getFnosUploadSession()).resolves.toEqual({ secret: SECRET, token: "" });
  });

  it("waits for Android readiness before calling the handler", async () => {
    vi.useFakeTimers();
    mobile();
    const call = bridge(envelope({ secret: SECRET }), false);
    const promise = getFnosUploadSession();
    await vi.advanceTimersByTimeAsync(100);
    expect(call).not.toHaveBeenCalled();
    window.dispatchEvent(new Event(READY));
    await expect(promise).resolves.toEqual({ secret: SECRET, token: "" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a bridge injected after page load", async () => {
    vi.useFakeTimers();
    mobile();
    const promise = getFnosUploadSession();
    const call = bridge(envelope({ secret: SECRET }));
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toEqual({ secret: SECRET, token: "" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("remembers readiness before upload and reads fresh credentials on consecutive uploads", async () => {
    mobile();
    const call = bridge(envelope({ secret: SECRET }), false);
    window.dispatchEvent(new Event(READY));
    await expect(getFnosUploadSession()).resolves.toEqual({ secret: SECRET, token: "" });
    call.mockResolvedValue(envelope({ secret: SECRET, token: "new-token" }));
    await expect(getFnosUploadSession()).resolves.toEqual({ secret: SECRET, token: "new-token" });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("accepts an existing iOS bridge without the Android readiness flag", async () => {
    mobile("iPhone");
    bridge(envelope({ secret: SECRET }), false);
    await expect(getFnosUploadSession()).resolves.toEqual({ secret: SECRET, token: "" });
  });

  it.each([null, "invalid JSON", envelope({}), envelope({ code: 401, data: { secret: SECRET } }),
    JSON.stringify({ code: 403, result: JSON.stringify({ secret: SECRET }) }),
    envelope({ secret: "invalid base64!" }), envelope({ secret: SECRET, token: "bad\nheader" })])(
    "rejects malformed or denied credentials without exposing the response", async (raw) => {
      mobile();
      bridge(raw);
      await expect(getFnosUploadSession()).rejects.toThrow("无法获取飞牛 App");
    },
  );

  it.each([false, true])("bounds missing or unresponsive bridges, present=%s", async (present) => {
    vi.useFakeTimers();
    mobile();
    if (present) vi.stubGlobal("flutter_inappwebview", { _platformReady: true, callHandler: () => new Promise(() => {}) });
    const promise = getFnosUploadSession();
    const result = expect(promise).rejects.toThrow("无法获取飞牛 App");
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
    const call = bridge(envelope({ secret: SECRET }));
    window.dispatchEvent(new Event(READY));
    expect(call).not.toHaveBeenCalled();
  });

  it.each([false, true])("cancels bridge initialization or a pending call, called=%s", async (called) => {
    vi.useFakeTimers();
    mobile();
    if (called) vi.stubGlobal("flutter_inappwebview", { _platformReady: true, callHandler: () => new Promise(() => {}) });
    const controller = new AbortController();
    const promise = getFnosUploadSession(controller.signal);
    const result = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
    const call = bridge(envelope({ secret: SECRET }));
    window.dispatchEvent(new Event(READY));
    expect(call).not.toHaveBeenCalled();
  });

  it("sanitizes native errors", async () => {
    mobile();
    const call = bridge(null);
    call.mockRejectedValue(new Error(`private ${SECRET}`));
    await expect(getFnosUploadSession()).rejects.toThrow("无法获取飞牛 App");
  });

  it("reports only field names and types for an unknown mobile payload", async () => {
    mobile();
    bridge(envelope({ userInfo: { uploadSecret: SECRET, accessToken: "private-token" }, uid: 12345 }));
    const error = await getFnosUploadSession().catch((cause: Error) => cause);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error & { diagnostic: string }).diagnostic;
    expect(message).toContain("userInfo:{uploadSecret:string,accessToken:string}");
    expect(message).toContain("uid:number");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("private-token");
    expect(message).not.toContain("12345");
  });

  it("does not invoke a queued native call after cancellation", async () => {
    mobile();
    const call = bridge(envelope({ secret: SECRET }));
    const controller = new AbortController();
    const promise = getFnosUploadSession(controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(call).not.toHaveBeenCalled();
  });

  it("reports separate stages for a missing bridge, unready bridge and unresponsive handler", async () => {
    vi.useFakeTimers();
    mobile();
    const missing = diagnoseFnosUploadSession();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await missing).toContain('"stage": "FNS_NO_BRIDGE"');

    const call = bridge(envelope({ secret: SECRET }), false);
    const unready = diagnoseFnosUploadSession();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await unready).toContain('"stage": "FNS_NOT_READY"');
    expect(call).not.toHaveBeenCalled();

    vi.stubGlobal("flutter_inappwebview", { _platformReady: true, callHandler: () => new Promise(() => {}) });
    const unresponsive = diagnoseFnosUploadSession();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await unresponsive).toContain('"stage": "FNS_HANDLER_TIMEOUT"');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never exposes credentials or arbitrary error content in successful and rejected diagnostics", async () => {
    mobile();
    const call = bridge(envelope({ secret: SECRET, token: "private-token" }));
    const success = await diagnoseFnosUploadSession();
    expect(success).toContain('"stage": "FNS_READY"');
    expect(success).toContain('"appVersion": "1.0.0"');
    expect(success).not.toContain(SECRET);
    expect(success).not.toContain("private-token");
    call.mockRejectedValue(new Error("private-error-detail"));
    const failed = await diagnoseFnosUploadSession();
    expect(failed).toContain('"stage": "FNS_HANDLER_REJECTED"');
    expect(failed).not.toContain("private-error-detail");
  });

  it("returns failure diagnostics without making NAS requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = await diagnoseFnosUploadSession();
    expect(report).toContain("FNS_WEB_SECRET_MISSING");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a native bridge in a strictly same-origin parent frame", async () => {
    mobile();
    const callHandler = vi.fn().mockResolvedValue(envelope({ secret: SECRET, token: "parent-token" }));
    const parent = Object.assign(new EventTarget(), {
      location: { origin: window.location.origin },
      flutter_inappwebview: { _platformReady: true, callHandler },
    });
    vi.stubGlobal("parent", parent);
    await expect(getFnosUploadSession()).resolves.toEqual({ secret: SECRET, token: "parent-token" });
    const diagnostic = await diagnoseFnosUploadSession();
    expect(diagnostic).toContain('"bridge": "same-origin-parent"');
    expect(diagnostic).toContain('"frame": "same-origin-frame"');
    expect(diagnostic).not.toContain("parent-token");
    expect(callHandler).toHaveBeenCalledTimes(2);
  });

  it("waits for the same-origin parent's one-time readiness event", async () => {
    vi.useFakeTimers();
    mobile();
    const callHandler = vi.fn().mockResolvedValue(envelope({ secret: SECRET }));
    const parent = Object.assign(new EventTarget(), {
      location: { origin: window.location.origin },
      flutter_inappwebview: { callHandler },
    });
    vi.stubGlobal("parent", parent);
    const promise = getFnosUploadSession();
    expect(callHandler).not.toHaveBeenCalled();
    parent.dispatchEvent(new Event(READY));
    await expect(promise).resolves.toEqual({ secret: SECRET, token: "" });
    await expect(getFnosUploadSession()).resolves.toEqual({ secret: SECRET, token: "" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not call a cross-origin parent's bridge", async () => {
    vi.useFakeTimers();
    mobile();
    const callHandler = vi.fn().mockResolvedValue(envelope({ secret: SECRET }));
    vi.stubGlobal("parent", { location: { origin: "https://untrusted.example" }, flutter_inappwebview: { _platformReady: true, callHandler } });
    const promise = diagnoseFnosUploadSession();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await promise).toContain('"frame": "cross-origin-frame"');
    expect(callHandler).not.toHaveBeenCalled();
  });

  it("does not apply child readiness to an unready parent bridge", async () => {
    vi.useFakeTimers();
    mobile();
    const callHandler = vi.fn().mockResolvedValue(envelope({ secret: SECRET }));
    vi.stubGlobal("parent", Object.assign(new EventTarget(), {
      location: { origin: window.location.origin }, flutter_inappwebview: { callHandler },
    }));
    window.dispatchEvent(new Event(READY));
    const promise = diagnoseFnosUploadSession();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await promise).toContain("FNS_NOT_READY");
    expect(callHandler).not.toHaveBeenCalled();
  });

  it("selects a ready parent bridge when the child's bridge is not ready", async () => {
    mobile();
    const childCall = bridge(envelope({ secret: SECRET }), false);
    const parentCall = vi.fn().mockResolvedValue(envelope({ secret: SECRET }));
    const parent = Object.assign(new EventTarget(), {
      location: { origin: window.location.origin }, flutter_inappwebview: { callHandler: parentCall },
    });
    vi.stubGlobal("parent", parent);
    const promise = getFnosUploadSession();
    parent.dispatchEvent(new Event(READY));
    await expect(promise).resolves.toEqual({ secret: SECRET, token: "" });
    expect(childCall).not.toHaveBeenCalled();
    expect(parentCall).toHaveBeenCalledTimes(1);
  });

  it("redacts unrecognized object keys even when they look like identifiers", async () => {
    mobile();
    bridge(envelope({ privateCredentialAsKey: { anotherPrivateKey: "private value" }, token: "private-token" }));
    const report = await diagnoseFnosUploadSession();
    expect(report).toContain("unknown:{unknown:string}");
    expect(report).not.toContain("privateCredentialAsKey");
    expect(report).not.toContain("anotherPrivateKey");
    expect(report).not.toContain("private value");
    expect(report).not.toContain("private-token");
  });
});
