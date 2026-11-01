import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { AccessKeyIssuer } from "../src/components/access-key-issuer";
import { FnosKeyProvider, useFnosKey } from "../src/components/fnos-key-provider";
import { createAccessKey } from "../src/lib/api";
import type { AccessKeyCreateResponse } from "../src/lib/types";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

vi.mock("../src/lib/api", () => ({
  createAccessKey: vi.fn(),
}));

const createAccessKeyMock = vi.mocked(createAccessKey);
const push = vi.fn();
const issuedResult: AccessKeyCreateResponse = {
  key: "custom_new_key",
  prefix: "custom",
  allowed_uses: 12,
  remaining_uses: 12,
  created_at: "2026-08-14T10:00:00Z",
};

function KeyState() {
  const { draft, appliedKey, remember } = useFnosKey("existing_key");
  return (
    <>
      <output aria-label="密钥草稿">{draft}</output>
      <output aria-label="已应用密钥">{appliedKey}</output>
      <button onClick={remember}>保留现有密钥</button>
    </>
  );
}

const renderFnos = () => render(
  <FnosKeyProvider>
    <AccessKeyIssuer prefix="custom" isFnos />
    <KeyState />
  </FnosKeyProvider>,
);

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
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
    expect(useRouter).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "返回生成界面" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用此密钥生成图纸" })).not.toBeInTheDocument();
  });

  it("validates the admin key before requesting", () => {
    render(<AccessKeyIssuer prefix="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请输入 X-Admin-API-Key");
    expect(createAccessKeyMock).not.toHaveBeenCalled();
  });
});

describe("AccessKeyIssuer in NAS", () => {
  it("uses proxy authorization and applies only the explicitly selected result in memory", async () => {
    createAccessKeyMock.mockResolvedValue(issuedResult);
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    const { container } = renderFnos();

    expect(screen.getByText("管理密钥：已自动配置")).toBeInTheDocument();
    expect(screen.queryByLabelText("X-Admin-API-Key")).not.toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(createAccessKeyMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "使用此密钥生成图纸" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("allowed_uses"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));

    expect(await screen.findByText(issuedResult.key)).toBeInTheDocument();
    expect(createAccessKeyMock).toHaveBeenCalledWith(
      { prefix: "custom", allowedUses: 12 },
      { signal: expect.any(AbortSignal) },
    );
    expect(screen.getByLabelText("已应用密钥")).toHaveTextContent("existing_key");
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "使用此密钥生成图纸" }));

    expect(screen.getByLabelText("密钥草稿")).toHaveTextContent(issuedResult.key);
    expect(screen.getByLabelText("已应用密钥")).toHaveTextContent(issuedResult.key);
    // Next App Router adds the configured basePath to this route itself.
    expect(push).toHaveBeenCalledExactlyOnceWith("/");
    expect(localWrite).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("returns without replacing the existing key even after successful issuance", async () => {
    createAccessKeyMock.mockResolvedValue(issuedResult);
    renderFnos();
    fireEvent.click(screen.getByRole("button", { name: "保留现有密钥" }));
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));
    await screen.findByText(issuedResult.key);

    fireEvent.click(screen.getByRole("button", { name: "返回生成界面" }));

    expect(push).toHaveBeenCalledExactlyOnceWith("/");
    expect(screen.getByLabelText("密钥草稿")).toHaveTextContent("existing_key");
    expect(screen.getByLabelText("已应用密钥")).toHaveTextContent("existing_key");
    expect(createAccessKeyMock).toHaveBeenCalledTimes(1);
  });

  it("disables return navigation while issuing and clears stale results on a failed retry", async () => {
    createAccessKeyMock.mockResolvedValueOnce(issuedResult);
    renderFnos();
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));
    await screen.findByText(issuedResult.key);

    let rejectRequest!: (reason: Error) => void;
    createAccessKeyMock.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectRequest = reject;
    }));
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));

    expect(screen.getByRole("button", { name: "返回生成界面" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "使用此密钥生成图纸" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回生成界面" }));
    expect(push).not.toHaveBeenCalled();

    await act(async () => rejectRequest(new Error("来源已禁用")));

    expect(screen.getByRole("alert")).toHaveTextContent("来源已禁用");
    expect(screen.getByRole("button", { name: "返回生成界面" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "使用此密钥生成图纸" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("已应用密钥")).toHaveTextContent("existing_key");
  });

  it("always selects the newest successful result", async () => {
    createAccessKeyMock.mockResolvedValueOnce(issuedResult).mockResolvedValueOnce({
      ...issuedResult,
      key: "latest_key",
    });
    renderFnos();
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));
    await screen.findByText(issuedResult.key);
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));
    await screen.findByText("latest_key");
    fireEvent.click(screen.getByRole("button", { name: "使用此密钥生成图纸" }));

    expect(screen.getByLabelText("密钥草稿")).toHaveTextContent("latest_key");
    expect(screen.getByLabelText("已应用密钥")).toHaveTextContent("latest_key");
    expect(push).toHaveBeenCalledExactlyOnceWith("/");
  });

  it.each(["0", "1.5", "1000001", ""])("rejects invalid uses %j without requiring an admin key", (uses) => {
    renderFnos();
    fireEvent.change(screen.getByLabelText("allowed_uses"), { target: { value: uses } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Key" }));

    expect(screen.getByRole("alert")).toHaveTextContent("可用次数必须是 1 到 1,000,000 之间的整数");
    expect(createAccessKeyMock).not.toHaveBeenCalled();
  });
});
