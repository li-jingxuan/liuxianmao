import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { validateDocumentSemantics } from "../../src/core/semantic-validation";

/** 测试总是深拷贝 fixture，避免校验边界用例污染规范输入。 */
const createDocument = () => structuredClone(EXAMPLE_MVP_2);

describe("validateDocumentSemantics", () => {
  it("接受连续且完整覆盖 4/4 容量的 MVP v2 文档", () => {
    expect(validateDocumentSemantics(createDocument())).toEqual({ ok: true });
  });

  it("拒绝存在时间空洞的小节", () => {
    const document = createDocument();
    document.score.tracks[0]!.measures[0]!.beats[1]!.tick += 1;
    expect(validateDocumentSemantics(document)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "BEAT_TICK_NOT_CONTIGUOUS" }),
      ]),
    });
  });

  it("拒绝带有音符的休止 beat 和同拍重复弦", () => {
    const document = createDocument();
    const beat = document.score.tracks[0]!.measures[0]!.beats[0]!;
    beat.kind = "rest";
    beat.notes.push({ ...beat.notes[0]!, id: "semantic-extra-note" });
    expect(validateDocumentSemantics(document)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "REST_HAS_NOTES" }),
        expect.objectContaining({ code: "DUPLICATE_NOTE_STRING" }),
      ]),
    });
  });

  it("拒绝同一 Beat 上方向不同的重复扫弦记号", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "semantic-strum-down",
        type: "strum",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down",
      },
      {
        id: "semantic-strum-up",
        type: "strum",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "up",
      },
    ];

    expect(validateDocumentSemantics(document)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_TECHNIQUE" }),
      ]),
    });
  });
});
