import { describe, expect, it } from "vitest";
import { loadScoreDocument } from "../src/core/document-loader";
import { validateScoreSemantics } from "../src/core/validation";
import { createExampleDocument } from "../src/testing/example-document";

describe("文档加载管线", () => {
  it("能够将合法示例加载为强类型文档", () => {
    const document = createExampleDocument();
    const result = loadScoreDocument(JSON.stringify(document));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toEqual(document);
  });

  it("非法 JSON 返回根路径错误", () => {
    const result = loadScoreDocument("{invalid");
    expect(result).toMatchObject({ ok: false, code: "INVALID_JSON" });
    if (!result.ok) expect(result.issues[0]?.path).toBe("$");
  });

  it("未知版本在 Zod 前被明确拒绝", () => {
    const document = createExampleDocument();
    const result = loadScoreDocument(
      JSON.stringify({ ...document, schemaVersion: 99 }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
    });
    if (!result.ok) expect(result.issues[0]?.path).toBe("$.schemaVersion");
  });

  it("结构字段错误包含精确数组路径", () => {
    const document = createExampleDocument();
    document.score.tracks[0]!.measures[0]!.beats[0]!.tick = -1;
    const result = loadScoreDocument(JSON.stringify(document));
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT_STRUCTURE",
    });
    if (!result.ok) {
      expect(
        result.issues.some((issue) => issue.path.endsWith("beats[0].tick")),
      ).toBe(true);
    }
  });
});

describe("乐谱语义校验", () => {
  it("规范夹具没有语义错误", () => {
    expect(validateScoreSemantics(createExampleDocument())).toEqual([]);
  });

  it("检测重复 ID、失效和弦引用和同拍同弦冲突", () => {
    const document = createExampleDocument();
    const firstMeasure = document.score.tracks[0]!.measures[0]!;
    const firstBeat = firstMeasure.beats[0]!;
    if (firstBeat.kind !== "notes") throw new Error("测试夹具预期为音符拍");
    firstBeat.notes.push({
      ...firstBeat.notes[0]!,
      id: "note-duplicate-string",
    });
    firstMeasure.chordSymbols[0]!.chordDefinitionId = "missing-chord";
    firstMeasure.lyrics[0]!.id = firstMeasure.id;

    const codes = validateScoreSemantics(document).map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ID",
        "DUPLICATE_STRING_IN_BEAT",
        "INVALID_CHORD_REFERENCE",
      ]),
    );
  });

  it("检测失效音符引用、非法方向和延音音高不一致", () => {
    const document = createExampleDocument();
    const track = document.score.tracks[0]!;
    const measure = track.measures[2]!;
    const beat = measure.beats[2]!;
    if (beat.kind !== "notes") throw new Error("测试夹具预期为音符拍");
    beat.notes[0]!.tie = { targetNoteId: "missing-note" };
    const codes = validateScoreSemantics(document).map((issue) => issue.code);
    expect(codes).toContain("INVALID_NOTE_REFERENCE");
  });
});
