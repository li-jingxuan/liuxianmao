import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessKeyIssuer } from "../src/components/access-key-issuer";
import { createAccessKey } from "../src/lib/api";

vi.mock("../src/lib/api", () => ({
  createAccessKey: vi.fn(),
}));

const createAccessKeyMock = vi.mocked(createAccessKey);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("AccessKeyIssuer", () => {
  it("uses the route prefix, displays the issued key and copies it", async () => {
    createAccessKeyMock.mockResolvedValue({
      key: "demo_generated_key",
      prefix: "demo",
      allowed_uses: 25,
      remaining_uses: 25,
      created_at: "2026-08-14T10:00:00Z",
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<AccessKeyIssuer prefix="demo" />);
    fireEvent.change(screen.getByLabelText("X-Admin-API-Key"), {
      target: { value: "admin-key" },
    });
    fireEvent.change(screen.getByLabelText("allowed_uses"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));

    expect(await screen.findByText("demo_generated_key")).toBeInTheDocument();
    expect(createAccessKeyMock).toHaveBeenCalledWith(
      { prefix: "demo", allowedUses: 25 },
      expect.objectContaining({ adminApiKey: "admin-key" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "复制访问密钥" }));
    expect(await screen.findByText("已复制")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("demo_generated_key");
  });

  it("validates the admin key before requesting", () => {
    render(<AccessKeyIssuer prefix="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请输入 X-Admin-API-Key");
    expect(createAccessKeyMock).not.toHaveBeenCalled();
  });
});
