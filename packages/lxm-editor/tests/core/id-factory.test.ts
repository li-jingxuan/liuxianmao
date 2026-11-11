import { describe, expect, it } from "vitest";
import example from "../../example/example-mvp2.json";
import { createDocumentIdFactory } from "../../src/core/id-factory";

describe("文档 ID 工厂", () => {
  it("跨实体碰撞时保留空缺、各类型独立递增且重复执行确定", () => {
    const document = structuredClone(example);
    const revision = document.documentRevision + 1;
    document.score.id = `note-${revision}-1`;
    document.score.tracks[0]!.id = `note-${revision}-3`;
    document.score.tracks[0]!.measures[0]!.id = `beat-${revision}-2`;
    const allocate = (): string[] => {
      const factory = createDocumentIdFactory(document);
      return [
        factory.createNoteId(),
        factory.createBeatId(),
        factory.createNoteId(),
        factory.createBeatId(),
        ...Array.from({ length: 1000 }, () => factory.createNoteId()),
      ];
    };
    const ids = allocate();
    expect(ids.slice(0, 4)).toEqual([
      `note-${revision}-2`,
      `beat-${revision}-1`,
      `note-${revision}-4`,
      `beat-${revision}-3`,
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allocate()).toEqual(ids);
    expect(document.score.id).toBe(`note-${revision}-1`);
  });
});
