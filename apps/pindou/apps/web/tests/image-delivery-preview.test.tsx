import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ getImageDelivery: vi.fn() }));

vi.mock("@/lib/api", () => {
  class MockPindouApiError extends Error {
    constructor(
      message: string,
      readonly code = "UNKNOWN_ERROR",
      readonly requestId?: string,
    ) {
      super(message);
    }
  }
  return {
    getImageDelivery: apiMocks.getImageDelivery,
    PindouApiError: MockPindouApiError,
    resolveApiUrl: (path: string) => `https://api.test${path}`,
  };
});

import { ImageDeliveryPreview } from "../src/components/image-delivery-preview";

const delivery = {
  token: "delivery-token",
  image_url: "/api/v1/image-deliveries/delivery-token/image",
  download_url: "/api/v1/image-deliveries/delivery-token/download",
  expires_at: "2099-09-01T10:00:00Z",
};

describe("ImageDeliveryPreview", () => {
  beforeEach(() => apiMocks.getImageDelivery.mockReset());
  afterEach(() => cleanup());

  it("shows zoom controls, expiry, download and save instructions", async () => {
    apiMocks.getImageDelivery.mockResolvedValue(delivery);
    render(<ImageDeliveryPreview token="delivery-token" />);

    const image = await screen.findByAltText("可缩放查看并长按保存的拼豆施工图");
    expect(image.getAttribute("src")).toBe(
      "https://api.test/api/v1/image-deliveries/delivery-token/image",
    );
    expect((image as HTMLImageElement).style.width).toBe("100%");
    expect(screen.getByText(/链接有效期至/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "保存步骤" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "注意事项" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /下载原图/ }).getAttribute("href")).toBe(
      "https://api.test/api/v1/image-deliveries/delivery-token/download",
    );

    fireEvent.click(screen.getByRole("button", { name: "放大图纸" }));
    expect((image as HTMLImageElement).style.width).toBe("125%");
    fireEvent.click(screen.getByRole("button", { name: "还原图纸缩放" }));
    expect((image as HTMLImageElement).style.width).toBe("100%");
  });
});
