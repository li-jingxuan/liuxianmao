import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const loadPaths = async (prefix: string, api = "") => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", prefix);
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", api);
  return import("../src/lib/paths");
};

describe("deployment paths", () => {
  it.each(["", "/app/pindou"])("keeps requests, image URLs and shares under %s", async (prefix) => {
    const paths = await loadPaths(prefix);
    expect(paths.apiPath("/api/v1/colors")).toBe(`${prefix}/api/v1/colors`);
    expect(paths.apiPath("/api/v1/image-deliveries/t/image")).toBe(
      `${prefix}/api/v1/image-deliveries/t/image`,
    );
    expect(paths.deliveryShareUrl("https://nice007.fnos.net", "t")).toBe(
      `https://nice007.fnos.net${prefix}/delivery/t/`,
    );
  });

  it("preserves an explicit API mount without changing the Web share prefix", async () => {
    const paths = await loadPaths("/app/pindou", "https://api.example.com/mount/");
    expect(paths.apiPath("/api/v1/colors")).toBe("https://api.example.com/mount/api/v1/colors");
    expect(paths.webPath("/colors/")).toBe("/app/pindou/colors/");
  });

  it.each(["https://other.test/image", "//other.test/image", "/app/pindou/api/v1/colors", "/api/v1/../secret", "/api/v1/%2e%2e/secret"])(
    "rejects file addresses outside the API contract: %s", async (path) => {
      const { apiPath } = await loadPaths("/app/pindou");
      expect(() => apiPath(path)).toThrow("API 路径无效");
    },
  );

  it("routes real API calls and file URLs through the NAS gateway", async () => {
    await loadPaths("/app/pindou");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ groups: [] })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { getColorCatalog, resolveApiUrl } = await import("../src/lib/api");
      await getColorCatalog();
      expect(fetchMock.mock.calls[0][0]).toBe("/app/pindou/api/v1/colors");
      expect(resolveApiUrl("/api/v1/image-deliveries/t/download")).toBe(
        "/app/pindou/api/v1/image-deliveries/t/download",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
