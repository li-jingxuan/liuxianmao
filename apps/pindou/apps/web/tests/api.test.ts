import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAccessKey,
  createConversion,
  getColorCatalog,
  PindouApiError,
} from "../src/lib/api";
import type {
  AccessKeyCreateResponse,
  ColorCatalogResponse,
  ConversionInput,
} from "../src/lib/types";

afterEach(() => vi.unstubAllGlobals());

const input: ConversionInput = {
  image: new File(["image"], "source.png", { type: "image/png" }),
  gridSize: 48,
  colorSetSize: 48,
  backgroundMode: "solid",
  backgroundColor: "#FFFFFF",
};

describe("createConversion", () => {
  it("submits all API contract fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ width: 48 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createConversion(input, { apiKey: "test-route-key" });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = request.body as FormData;
    expect(url).toMatch(/\/api\/v1\/conversions$/);
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ "X-API-Key": "test-route-key" });
    expect(form.get("grid_size")).toBe("48");
    expect(form.has("max_colors")).toBe(false);
    expect(form.get("color_set_size")).toBe("48");
    expect(form.get("background_mode")).toBe("solid");
    expect(form.get("background_color")).toBe("#FFFFFF");
  });

  it("omits the API key header when the route has no key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ width: 48 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createConversion(input);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toBeUndefined();
  });

  it("parses the stable API error shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "IMAGE_TOO_LARGE", message: "图片过大", request_id: "req_1" } }), { status: 413 })));
    await expect(createConversion(input)).rejects.toMatchObject({
      code: "IMAGE_TOO_LARGE",
      message: "图片过大",
      requestId: "req_1",
    } satisfies Partial<PindouApiError>);
  });

  it("uses a dedicated Chinese message for Seedream timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "AI_TIMEOUT", message: "upstream", request_id: "req_ai" } }), { status: 504 })));
    await expect(createConversion(input)).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      message: "AI 处理超时，本次未确认成功，请稍后手动重试",
      requestId: "req_ai",
    } satisfies Partial<PindouApiError>);
  });
});

describe("getColorCatalog", () => {
  it("loads the complete color catalog and forwards the abort signal", async () => {
    const payload: ColorCatalogResponse = {
      brand: "MARD",
      schema_version: "1.0",
      total_count: 1,
      groups: [
        {
          series: "A",
          label: "A 系列",
          color_count: 1,
          colors: [{ code: "A1", hex: "#F9F0CD", rgb: [249, 240, 205] }],
        },
      ],
      sets: [
        {
          size: 24,
          label: "MARD 24色套装",
          color_count: 1,
          colors: [{ code: "A1", hex: "#F9F0CD", rgb: [249, 240, 205] }],
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getColorCatalog(controller.signal)).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/colors$/),
      { signal: controller.signal },
    );
  });

  it("uses the shared API error parser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "CATALOG_UNAVAILABLE",
              message: "色卡不可用",
              request_id: "req_colors",
            },
          }),
          { status: 503 },
        ),
      ),
    );

    await expect(getColorCatalog()).rejects.toMatchObject({
      code: "CATALOG_UNAVAILABLE",
      message: "色卡不可用",
      requestId: "req_colors",
    } satisfies Partial<PindouApiError>);
  });
});

describe("createAccessKey", () => {
  it("submits the route prefix, allowed uses and admin API key", async () => {
    const payload: AccessKeyCreateResponse = {
      key: "gk_demo_secret",
      prefix: "demo",
      allowed_uses: 12,
      remaining_uses: 12,
      created_at: "2026-08-14T10:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createAccessKey(
        { prefix: "demo", allowedUses: 12 },
        { adminApiKey: "admin-secret" },
      ),
    ).resolves.toEqual(payload);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/access-keys$/);
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-API-Key": "admin-secret",
      },
      body: JSON.stringify({ prefix: "demo", allowed_uses: 12 }),
    });
  });
});
