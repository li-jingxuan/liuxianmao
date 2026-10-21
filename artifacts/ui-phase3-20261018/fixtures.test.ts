import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { loadDocument } from "../../packages/lxm-editor/src/index";

it.each(["fixture", "empty-voice", "nonstandard", "four-verses", "impact"])(
  "阶段3固定谱例 %s 经正式 loader 验证",
  (name) => {
    const result = loadDocument(
      readFileSync(`artifacts/ui-phase3-20261018/${name}.lxm.json`, "utf8"),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  },
);
