import { afterEach, describe, expect, it, vi } from "vitest";

import { createConversion, PindouApiError } from "../src/lib/api";
import type { ConversionInput } from "../src/lib/types";

afterEach(() => vi.unstubAllGlobals());

const input: ConversionInput = {
  image: new File(["image"], "source.png", { type: "image/png" }),
  gridSize: 48,
  maxColors: 18,
  colorSetSize: 48,
  backgroundMode: "solid",
  backgroundColor: "#FFFFFF",
};

describe("createConversion", () => {
  it("submits all API contract fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ width: 48 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createConversion(input);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = request.body as FormData;
    expect(url).toBe("/api/v1/conversions");
    expect(request.method).toBe("POST");
    expect(form.get("grid_size")).toBe("48");
    expect(form.get("max_colors")).toBe("18");
    expect(form.get("color_set_size")).toBe("48");
    expect(form.get("background_mode")).toBe("solid");
    expect(form.get("background_color")).toBe("#FFFFFF");
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
