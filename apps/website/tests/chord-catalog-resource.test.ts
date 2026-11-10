import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChordCatalogResource } from "../components/EditorShell/chord-catalog-resource";

const catalog = readFileSync(
  new URL("../public/assets/chords/catalog-2026.11.11.1.json", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(
    new URL("../public/assets/chords/manifest.json", import.meta.url),
    "utf8",
  ),
);
const json = (value: unknown) => new Response(JSON.stringify(value));
const mockFetch = (
  fn: (url: string, options?: RequestInit) => Response | Promise<Response>,
) =>
  vi.fn((input: string | URL | Request, options?: RequestInit) =>
    Promise.resolve(fn(String(input), options)),
  ) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
afterEach(() => vi.useRealTimers());

describe("shared HTTP chord catalog resource", () => {
  it("loads lazily, shares concurrent requests, publishes one immutable complete catalog and reuses it", async () => {
    const gate = defer<Response>();
    const fetcher = mockFetch((url) =>
      url.endsWith("manifest.json") ? gate.promise : new Response(catalog),
    );
    const resource = createChordCatalogResource({
      origin: "https://score.example",
      fetch: fetcher,
    });
    const notifications = vi.fn();
    const unsubscribe = resource.subscribe(notifications);
    expect(fetcher).not.toHaveBeenCalled();
    expect(resource.getSnapshot().status).toBe("idle");
    const a = resource.ensureLoaded();
    expect(resource.ensureLoaded()).toBe(a);
    expect(resource.retry()).toBe(a);
    expect(resource.getSnapshot().status).toBe("loading");
    gate.resolve(json(manifest));
    await a;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-cache",
      redirect: "error",
    });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      cache: "default",
      redirect: "error",
    });
    expect(resource.getSnapshot()).toMatchObject({
      status: "ready",
      error: null,
      catalog: { dataVersion: manifest.dataVersion, items: expect.any(Array) },
    });
    expect(resource.getSnapshot().catalog?.items).toHaveLength(192);
    expect(Object.isFrozen(resource.getSnapshot().catalog)).toBe(true);
    await resource.ensureLoaded();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(notifications).toHaveBeenCalledTimes(2);
    unsubscribe();
    fetcher.mockImplementation(() => Promise.reject(new Error("offline")));
    const snapshot = resource.getSnapshot().catalog;
    await resource.retry();
    expect(resource.getSnapshot()).toMatchObject({
      status: "error",
      catalog: snapshot,
      error: "更新失败，继续使用已加载的和弦库",
    });
    expect(resource.getSnapshot().catalog).toBe(snapshot);
    expect(notifications).toHaveBeenCalledTimes(2);
  });
  it("resolves catalog relative to the manifest response URL and supports a deployment basePath", async () => {
    const fetcher = mockFetch((url) =>
      url.endsWith("manifest.json") ? json(manifest) : new Response(catalog),
    );
    const resource = createChordCatalogResource({
      origin: "https://score.example",
      basePath: "/music",
      fetch: fetcher,
    });
    await resource.ensureLoaded();
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      "https://score.example/music/assets/chords/manifest.json",
      "https://score.example/music/assets/chords/catalog-2026.11.11.1.json",
    ]);
    expect(resource.getSnapshot().status).toBe("ready");
  });
  it.each([
    "https://external.example/assets/chords/catalog-2026.11.11.1.json",
    "../../catalog-2026.11.11.1.json",
    "./%2e%2e/elsewhere.json",
    "./catalog-2026.11.11.1.json?secret=1",
    "./catalog-2026.11.11.1.json#hash",
    "./catalog-2026.11.11.2.json",
    "https://user:password@score.example/assets/chords/catalog-2026.11.11.1.json",
    "./catalog-2026.11.11.1.txt",
  ])(
    "rejects unsafe/version-mismatched manifest URL %s before fetching data",
    async (catalogUrl) => {
      const fetcher = mockFetch(() => json({ ...manifest, catalogUrl }));
      const resource = createChordCatalogResource({
        origin: "https://score.example",
        fetch: fetcher,
      });
      await resource.ensureLoaded();
      expect(resource.getSnapshot()).toMatchObject({
        status: "error",
        catalog: null,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["manifest", "catalog"])(
    "rejects a redirected external %s response",
    async (phase) => {
      const fetcher = mockFetch((url) => {
        const isManifest = url.endsWith("manifest.json");
        const response = isManifest ? json(manifest) : new Response(catalog);
        if ((phase === "manifest") === isManifest)
          Object.defineProperty(response, "url", {
            value: "https://external.example/assets/chords/file.json",
          });
        return response;
      });
      const resource = createChordCatalogResource({
        origin: "https://score.example",
        fetch: fetcher,
      });
      await resource.ensureLoaded();
      expect(resource.getSnapshot()).toMatchObject({
        status: "error",
        catalog: null,
      });
    },
  );
  it.each([
    new Response("missing", { status: 404 }),
    new Response("not json"),
    json({ ...manifest, formatVersion: 2 }),
    json({ ...manifest, unexpected: true }),
  ])(
    "exposes HTTP/JSON/strict manifest failures and can retry",
    async (badResponse) => {
      let bad = true;
      const fetcher = mockFetch((url) =>
        bad
          ? badResponse
          : url.endsWith("manifest.json")
            ? json(manifest)
            : new Response(catalog),
      );
      const resource = createChordCatalogResource({
        origin: "https://score.example",
        fetch: fetcher,
      });
      await resource.ensureLoaded();
      expect(resource.getSnapshot()).toMatchObject({
        status: "error",
        catalog: null,
        error: expect.any(String),
      });
      bad = false;
      await resource.retry();
      expect(resource.getSnapshot().status).toBe("ready");
    },
  );
  it("never publishes a partial, invalid or mismatched catalog", async () => {
    for (const invalid of [
      { ...JSON.parse(catalog), dataVersion: "2026.11.11.2" },
      { ...JSON.parse(catalog), items: [] },
    ]) {
      const fetcher = mockFetch((url) =>
        json(url.endsWith("manifest.json") ? manifest : invalid),
      );
      const resource = createChordCatalogResource({
        origin: "https://score.example",
        fetch: fetcher,
      });
      await resource.ensureLoaded();
      expect(resource.getSnapshot()).toMatchObject({
        status: "error",
        catalog: null,
      });
    }
  });
  it.each([
    ["manifest", 16 * 1024],
    ["catalog", 2 * 1024 * 1024],
  ] as const)(
    "enforces %s byte cap while streaming with no Content-Length",
    async (phase, limit) => {
      const cancelled = vi.fn();
      let streamSignal: AbortSignal | null = null;
      const fetcher = mockFetch((url, options) => {
        const isManifest = url.endsWith("manifest.json");
        if ((phase === "manifest") !== isManifest) return json(manifest);
        streamSignal = options!.signal as AbortSignal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(limit));
              controller.enqueue(new Uint8Array(1));
            },
            cancel: cancelled,
          }),
        );
      });
      const resource = createChordCatalogResource({
        origin: "https://score.example",
        fetch: fetcher,
      });
      await resource.ensureLoaded();
      expect(resource.getSnapshot()).toMatchObject({
        status: "error",
        catalog: null,
        error: "和弦库资源超出大小限制",
      });
      expect(streamSignal!.aborted).toBe(true);
      expect(cancelled).toHaveBeenCalledOnce();
    },
  );
  it("applies one total timeout across both fetches, frees retry and ignores the old late response", async () => {
    vi.useFakeTimers();
    const late = defer<Response>();
    const fresh = defer<Response>();
    let count = 0;
    const fetcher = mockFetch(() => {
      count++;
      if (count === 1) return json(manifest);
      if (count === 2) return late.promise;
      if (count === 3) return fresh.promise;
      return new Response(catalog);
    });
    const resource = createChordCatalogResource({
      origin: "https://score.example",
      fetch: fetcher,
    });
    const first = resource.ensureLoaded();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(resource.getSnapshot().status).toBe("loading");
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(resource.getSnapshot()).toMatchObject({
      status: "error",
      catalog: null,
      error: expect.stringContaining("超时"),
    });
    expect(fetcher.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    const second = resource.retry();
    expect(fetcher.mock.calls[2]?.[1]?.signal).not.toBe(
      fetcher.mock.calls[0]?.[1]?.signal,
    );
    late.resolve(new Response(catalog));
    await vi.advanceTimersByTimeAsync(0);
    expect(resource.getSnapshot().status).toBe("loading");
    expect(resource.retry()).toBe(second);
    fresh.resolve(json(manifest));
    await second;
    expect(resource.getSnapshot().status).toBe("ready");
  });
  it("does not reset the ten-second budget between manifest and catalog", async () => {
    vi.useFakeTimers();
    const manifestGate = defer<Response>();
    const catalogGate = defer<Response>();
    const fetcher = mockFetch((url) =>
      url.endsWith("manifest.json")
        ? manifestGate.promise
        : catalogGate.promise,
    );
    const resource = createChordCatalogResource({
      origin: "https://score.example",
      fetch: fetcher,
    });
    const loading = resource.ensureLoaded();
    await vi.advanceTimersByTimeAsync(6_000);
    manifestGate.resolve(json(manifest));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(resource.getSnapshot().status).toBe("loading");
    await vi.advanceTimersByTimeAsync(1);
    await loading;
    expect(resource.getSnapshot().status).toBe("error");
    catalogGate.resolve(new Response(catalog));
    await vi.advanceTimersByTimeAsync(0);
    expect(resource.getSnapshot().catalog).toBeNull();
  });
  it("times out a stalled body stream and rejects oversize Content-Length before reading", async () => {
    vi.useFakeTimers();
    const stalled = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    const fetcher = mockFetch(() => new Response(stalled));
    const resource = createChordCatalogResource({
      origin: "https://score.example",
      fetch: fetcher,
    });
    const first = resource.ensureLoaded();
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(resource.getSnapshot()).toMatchObject({
      status: "error",
      catalog: null,
    });
    const reader = vi.fn();
    const response = new Response("{}", {
      headers: { "Content-Length": String(16 * 1024 + 1) },
    });
    Object.defineProperty(response.body!, "getReader", { value: reader });
    fetcher.mockImplementation(() => Promise.resolve(response));
    await resource.retry();
    expect(reader).not.toHaveBeenCalled();
    expect(resource.getSnapshot().error).toContain("大小限制");
  });
});
