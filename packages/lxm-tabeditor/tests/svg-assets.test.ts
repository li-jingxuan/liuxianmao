import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SVG_ASSETS_MANIFEST } from "../../../apps/website/assets/svg/svg-assets-manifest";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const OUTPUT_ROOT = path.resolve(
  PACKAGE_ROOT,
  "../../apps/website/assets/svg/music-controls",
);
const PUBLIC_OUTPUT_ROOT = path.resolve(
  PACKAGE_ROOT,
  "../../apps/website/public/assets/svg/music-controls",
);
const SCRIPT_PATH = path.join(
  PACKAGE_ROOT,
  "scripts/standardize-svg-assets.mjs",
);

describe("SVG 标准化流水线", () => {
  it("输出与 manifest 一致且重复执行结果不变", () => {
    execFileSync(process.execPath, [SCRIPT_PATH]);
    const firstOutput = new Map(
      readdirSync(OUTPUT_ROOT).map((fileName) => [
        fileName,
        readFileSync(path.join(OUTPUT_ROOT, fileName), "utf8"),
      ]),
    );
    execFileSync(process.execPath, [SCRIPT_PATH]);

    expect(firstOutput.size).toBe(SVG_ASSETS_MANIFEST.length);
    SVG_ASSETS_MANIFEST.forEach((asset) => {
      const fileName = path.basename(asset.runtimePath);
      const output = readFileSync(path.join(OUTPUT_ROOT, fileName), "utf8");
      const publicOutput = readFileSync(
        path.join(PUBLIC_OUTPUT_ROOT, fileName),
        "utf8",
      );
      expect(output).toBe(firstOutput.get(fileName));
      expect(publicOutput).toBe(output);
      expect(output).toContain("viewBox=");
      expect(output).toContain("currentColor");
      expect(output).not.toMatch(/<(?:script|image)\b/i);
      expect(output).not.toMatch(/<svg[^>]+\s(?:width|height)=/i);
      expect(asset.source).toBe("用户提供的参考素材");
      expect(asset.license).toContain("仅限本项目内部使用");
    });
  });
});
