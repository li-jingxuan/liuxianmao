import { describe, expect, it } from "vitest";

import * as exampleMvp1Module from "../../example/example-mvp1.json";
import EXAMPLE_MVP_5 from "../../example/example-mvp5.json";
import { loadDocument } from "../../src/core/loader";

const EXAMPLE_MVP_1 = exampleMvp1Module.default;

describe("loadDocument", () => {
  it("加载合法的 MVP 示例 JSON 并返回文档对象", () => {
    const result = loadDocument(JSON.stringify(EXAMPLE_MVP_1));

    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }

    expect(result.ok).toBe(true);
    expect(
      result.document.score.tracks[0]?.measures[0]?.beats[0]?.rhythm.base,
    ).toBe("quarter");
  });

  it("JSON 字符串格式错误时返回解析失败结果", () => {
    const result = loadDocument("{");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("非法 JSON 不应该解析成功");
    }

    expect(result.errors[0]).toContain("JSON");
  });

  it("MVP v5 示例中的 16 类技巧均可通过正式加载流程", () => {
    const result = loadDocument(JSON.stringify(EXAMPLE_MVP_5));

    if (!result.ok) throw new Error(result.errors.join("\n"));

    const techniques = result.document.score.tracks[0]?.techniques ?? [];
    expect(techniques).toHaveLength(16);
    expect(new Set(techniques.map((technique) => technique.type)).size).toBe(
      16,
    );
  });

  it("加载旧扫弦数据时从目标 Beat Note 推导兼容弦范围", () => {
    const legacyDocument = structuredClone(EXAMPLE_MVP_5);
    const strum = legacyDocument.score.tracks[0]!.techniques.find(
      (technique) => technique.type === "strum",
    );
    if (!strum || strum.type !== "strum") throw new Error("缺少扫弦 fixture");
    const legacyStrum = strum as Partial<typeof strum>;
    delete legacyStrum.minString;
    delete legacyStrum.maxString;

    const result = loadDocument(JSON.stringify(legacyDocument));
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(
      result.document.score.tracks[0]!.techniques.find(
        (technique) => technique.type === "strum",
      ),
    ).toMatchObject({ minString: 2, maxString: 3 });
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
