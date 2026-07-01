import { describe, expect, it } from "vitest";

import * as exampleMvp1Module from "../../example/example-mvp1.json";
import { loadDocument } from "../../src/core/loader";

const EXAMPLE_MVP_1 = exampleMvp1Module.default;

describe("loadDocument", () => {
  it("加载合法的 MVP 示例 JSON 并返回文档对象", () => {
    const result = loadDocument(JSON.stringify(EXAMPLE_MVP_1));

    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }

    expect(result.ok).toBe(true);
    expect(result.document.score.tracks[0]?.measures[0]?.beats[0]?.rhythm.base).toBe(
      "quarter",
    );
  });

  it("JSON 字符串格式错误时返回解析失败结果", () => {
    const result = loadDocument("{");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("非法 JSON 不应该解析成功");
    }

    expect(result.errors[0]).toContain("JSON");
  });

  it("文档字段不符合 schema 时返回字段路径和错误信息", () => {
    const invalidDocument = {
      ...EXAMPLE_MVP_1,
      schema: "legacy-tab-score",
    };

    const result = loadDocument(JSON.stringify(invalidDocument));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("非法 schema 不应该解析成功");
    }

    expect(result.errors[0]).toContain("schema");
  });
});
