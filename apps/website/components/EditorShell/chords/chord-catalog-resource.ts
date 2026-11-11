import { parseChordCatalog, type ChordCatalog } from "@liuxianmao/lxm-editor";

export interface ChordCatalogResourceSnapshot {
  status: "idle" | "loading" | "ready" | "error";
  catalog: ChordCatalog | null;
  error: string | null;
}
export interface ChordCatalogResourceOptions {
  fetch?: typeof fetch;
  /** Test/server seam. Browser instances use the current website origin. */
  origin?: string;
  basePath?: string;
  timeoutMs?: number;
}
export interface ChordCatalogResource {
  ensureLoaded(): Promise<void>;
  retry(): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChordCatalogResourceSnapshot;
}

const readJson = async (
  response: Response,
  limit: number,
  abort: AbortController,
): Promise<unknown> => {
  if (!response.ok)
    throw new Error(`和弦库请求失败（HTTP ${response.status}）`);
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > limit) {
    abort.abort();
    throw new Error("和弦库资源超出大小限制");
  }
  if (!response.body) throw new Error("和弦库响应为空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        abort.abort();
        void reader.cancel().catch(() => undefined);
        throw new Error("和弦库资源超出大小限制");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("和弦库响应不是有效 JSON");
  }
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const createChordCatalogResource = (
  options: ChordCatalogResourceOptions = {},
): ChordCatalogResource => {
  let snapshot: ChordCatalogResourceSnapshot = Object.freeze({
    status: "idle",
    catalog: null,
    error: null,
  });
  let inFlight: Promise<void> | null = null;
  let sequence = 0;
  const listeners = new Set<() => void>();
  const publish = (next: ChordCatalogResourceSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const load = (): Promise<void> => {
    if (inFlight) return inFlight;
    const request = ++sequence;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error("和弦库加载超时，请重试"));
      }, options.timeoutMs ?? 10_000);
    });
    const perform = async (): Promise<ChordCatalog> => {
      const origin =
        options.origin ??
        (typeof location !== "undefined" ? location.origin : undefined);
      if (!origin) throw new Error("和弦库只能从网站同源资源载入");
      const basePath =
        options.basePath ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      if (
        basePath &&
        (!basePath.startsWith("/") ||
          basePath.endsWith("/") ||
          /[?#\\]|\.\./.test(basePath))
      )
        throw new Error("和弦库资源目录无效");
      const directory = new URL(`${basePath}/assets/chords/`, origin);
      const guard = (url: URL) => {
        if (
          url.origin !== directory.origin ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !url.pathname.startsWith(directory.pathname) ||
          /%|\\/.test(url.pathname) ||
          !url.pathname.endsWith(".json")
        )
          throw new Error("和弦库资源必须位于网站同源 chords 目录");
        return url;
      };
      const fetcher = options.fetch ?? globalThis.fetch;
      const manifestUrl = guard(new URL("manifest.json", directory));
      const response = await fetcher(manifestUrl.href, {
        signal: abort.signal,
        cache: "no-cache",
        redirect: "error",
      });
      abort.signal.throwIfAborted();
      const actualManifest = guard(new URL(response.url || manifestUrl.href));
      const manifest = await readJson(response, 16 * 1024, abort);
      abort.signal.throwIfAborted();
      if (
        !record(manifest) ||
        Object.keys(manifest).sort().join(",") !==
          "catalogUrl,dataVersion,format,formatVersion" ||
        manifest.format !== "lxm-chord-catalog-manifest" ||
        manifest.formatVersion !== 1 ||
        typeof manifest.dataVersion !== "string" ||
        !/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(manifest.dataVersion) ||
        typeof manifest.catalogUrl !== "string"
      )
        throw new Error("和弦库清单格式或版本无效");
      const catalogUrl = guard(new URL(manifest.catalogUrl, actualManifest));
      if (
        catalogUrl.pathname !==
        `${directory.pathname}catalog-${manifest.dataVersion}.json`
      )
        throw new Error("和弦库版本文件地址无效");
      const dataResponse = await fetcher(catalogUrl.href, {
        signal: abort.signal,
        cache: "default",
        redirect: "error",
      });
      abort.signal.throwIfAborted();
      const actualData = guard(new URL(dataResponse.url || catalogUrl.href));
      if (actualData.href !== catalogUrl.href)
        throw new Error("和弦库版本文件来源不一致");
      const data = await readJson(dataResponse, 2 * 1024 * 1024, abort);
      abort.signal.throwIfAborted();
      const result = parseChordCatalog(data, manifest.dataVersion);
      if (!result.ok) throw new Error(result.error);
      return result.catalog;
    };
    inFlight = Promise.race([perform(), timeout])
      .then((catalog) => {
        if (sequence === request)
          publish({ status: "ready", catalog, error: null });
      })
      .catch((error: unknown) => {
        if (sequence === request)
          publish({
            status: "error",
            catalog: snapshot.catalog,
            error: snapshot.catalog
              ? "更新失败，继续使用已加载的和弦库"
              : error instanceof Error
                ? error.message
                : "和弦库暂不可用",
          });
      })
      .finally(() => {
        clearTimeout(timer!);
        if (sequence === request) inFlight = null;
      });
    publish({ status: "loading", catalog: snapshot.catalog, error: null });
    return inFlight;
  };
  return {
    ensureLoaded: () =>
      inFlight ?? (snapshot.catalog ? Promise.resolve() : load()),
    retry: load,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
};

/** Lazy session cache: module import and SSR render perform no HTTP requests. */
export const chordCatalogResource = createChordCatalogResource();
