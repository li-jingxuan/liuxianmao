/** 集中式实体 ID 工厂，确保复制或插入不会与文档现有实体冲突。 */
import type { ILXMDocument } from "./types";

export interface ILXMIdFactory {
  createMeasureId(): string;
  createBeatId(): string;
  createNoteId(): string;
  createChordSymbolId(): string;
  createTechniqueId(): string;
}

/** 收集所有可持久化实体 ID；不同实体类型同样禁止重名，便于后续引用。 */
const collectEntityIds = (document: ILXMDocument): Set<string> =>
  new Set([
    document.score.id,
    ...document.score.tracks.flatMap((track) => [
      track.id,
      ...track.techniques.map((technique) => technique.id),
      ...track.measures.flatMap((measure) => [
        measure.id,
        ...measure.chordSymbols.map((symbol) => symbol.id),
        ...measure.beats.flatMap((beat) => [
          beat.id,
          ...beat.notes.map((note) => note.id),
        ]),
      ]),
    ]),
  ]);

/**
 * 基于当前 documentRevision 生成可预测 ID。
 *
 * 即使同一 revision 内连续创建多个实体，也会通过已分配集合递增后缀，避免 UI
 * 自行拼接 ID 或依赖随机数导致测试不可复现。
 */
export const createDocumentIdFactory = (document: ILXMDocument): ILXMIdFactory => {
  const used = collectEntityIds(document);
  const create = (kind: string) => {
    const prefix = `${kind}-${document.documentRevision + 1}`;
    let suffix = 1;
    while (used.has(`${prefix}-${suffix}`)) suffix += 1;
    const id = `${prefix}-${suffix}`;
    used.add(id);
    return id;
  };
  return {
    createMeasureId: () => create("measure"),
    createBeatId: () => create("beat"),
    createNoteId: () => create("note"),
    createChordSymbolId: () => create("chord"),
    createTechniqueId: () => create("technique"),
  };
};
