import { afterEach, describe, expect, it, vi } from "vitest";

import { cropImageToFile } from "../src/lib/image-crop";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cropImageToFile", () => {
  it("draws the selected pixel area and returns a cropped file", async () => {
    const bitmap = {
      width: 160,
      height: 120,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmapMock = vi
      .fn()
      .mockResolvedValue(bitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);

    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    const output = new Blob(["cropped"], { type: "image/png" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) => callback(output)),
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockReturnValue(canvas);

    const source = new File(["source"], "photo.png", { type: "image/png" });
    const result = await cropImageToFile(source, {
      x: 10.4,
      y: 20.6,
      width: 50.2,
      height: 40.8,
    });

    expect(createImageBitmapMock).toHaveBeenCalledWith(source, {
      imageOrientation: "from-image",
    });
    expect(canvas.width).toBe(50);
    expect(canvas.height).toBe(41);
    expect(context.drawImage).toHaveBeenCalledWith(
      bitmap,
      10,
      21,
      50,
      41,
      0,
      0,
      50,
      41,
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(result).toBeInstanceOf(File);
    expect(result.name).toBe("photo-cropped.png");
    expect(result.type).toBe("image/png");
    expect(result.size).toBe(output.size);
  });

  it("clamps an area that extends outside the decoded image", async () => {
    const bitmap = {
      width: 100,
      height: 80,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) =>
        callback(new Blob(["cropped"], { type: "image/jpeg" })),
      ),
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockReturnValue(canvas);

    await cropImageToFile(
      new File(["source"], "photo.jpg", { type: "image/jpeg" }),
      { x: -10, y: 70, width: 40, height: 30 },
    );

    expect(canvas.width).toBe(40);
    expect(canvas.height).toBe(10);
    expect(context.drawImage).toHaveBeenCalledWith(
      bitmap,
      0,
      70,
      40,
      10,
      0,
      0,
      40,
      10,
    );
  });
});
