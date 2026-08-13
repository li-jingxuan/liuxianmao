import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES, validateImage } from "../src/lib/validation";

describe("validateImage", () => {
  it("accepts supported image formats", () => {
    expect(validateImage(new File(["ok"], "photo.webp", { type: "image/webp" }))).toBeNull();
  });

  it("rejects unsupported formats", () => {
    expect(validateImage(new File(["no"], "photo.gif", { type: "image/gif" }))).toContain("JPG");
  });

  it("rejects files over 10 MiB", () => {
    const file = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "large.png", { type: "image/png" });
    expect(validateImage(file)).toContain("10 MiB");
  });
});
