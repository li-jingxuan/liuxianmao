import { afterEach, expect, it, vi } from "vitest";
import { createImageDelivery } from "../src/lib/api";

vi.mock("../src/lib/paths", () => ({
  apiPath: (path: string) => `https://external-api.invalid${path}`,
}));

afterEach(() => vi.unstubAllGlobals());

it("rejects a cross-origin NAS delivery before sending any request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(createImageDelivery(new Blob(["png"]), { fnos: true })).rejects.toThrow("必须使用同源 API");
  expect(fetchMock).not.toHaveBeenCalled();
});
