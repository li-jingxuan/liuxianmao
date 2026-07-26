/**
 * 乐谱语义校验。
 *
 * Zod schema 负责验证字段形状；本模块负责验证跨字段的音乐规则，保证 layout 和
 * 命令层面对的是一条连续、完整且无冲突的时间轴。
 */
import { calculateRhythmTicks, getMeasureCapacityTicks } from "./rhythm";
import type { ILXMDocument, ILXMMeasure } from "./types";

export type ILXMSemanticValidationIssueCode =
  | "INVALID_RHYTHM"
  | "BEAT_TICK_NOT_CONTIGUOUS"
  | "MEASURE_CAPACITY_MISMATCH"
  | "REST_HAS_NOTES"
  | "DUPLICATE_NOTE_STRING"
  | "DUPLICATE_ENTITY_ID"
  | "INVALID_CHORD_TICK";

export interface ILXMSemanticValidationIssue {
  code: ILXMSemanticValidationIssueCode;
  path: string;
  message: string;
}

export type ILXMSemanticValidationResult =
  | { ok: true }
  | { ok: false; issues: ILXMSemanticValidationIssue[] };

/** 校验一个小节内的时间连续性和内容约束。 */
const validateMeasure = (
  measure: ILXMMeasure,
  path: string,
  entityIds: Set<string>,
  issues: ILXMSemanticValidationIssue[],
) => {
  let expectedTick = 0;
  const capacity = getMeasureCapacityTicks(measure.timeSignature);
  const registerId = (id: string, entityPath: string) => {
    if (entityIds.has(id)) {
      issues.push({
        code: "DUPLICATE_ENTITY_ID",
        path: entityPath,
        message: `实体 ID 重复：${id}`,
      });
    } else entityIds.add(id);
  };

  registerId(measure.id, `${path}.id`);
  measure.beats.forEach((beat, beatIndex) => {
    const beatPath = `${path}.beats.${beatIndex}`;
    registerId(beat.id, `${beatPath}.id`);
    const duration = calculateRhythmTicks(beat.rhythm);
    if (!duration.ok) {
      issues.push({
        code: "INVALID_RHYTHM",
        path: `${beatPath}.rhythm`,
        message: "节奏时值无法转换为整数 tick",
      });
      return;
    }
    if (beat.tick !== expectedTick) {
      issues.push({
        code: "BEAT_TICK_NOT_CONTIGUOUS",
        path: `${beatPath}.tick`,
        message: `期望 tick 为 ${expectedTick}，实际为 ${beat.tick}`,
      });
    }
    expectedTick = beat.tick + duration.ticks;
    if (beat.kind === "rest" && beat.notes.length > 0) {
      issues.push({
        code: "REST_HAS_NOTES",
        path: `${beatPath}.notes`,
        message: "休止 beat 不能包含音符",
      });
    }
    const strings = new Set<number>();
    beat.notes.forEach((note, noteIndex) => {
      registerId(note.id, `${beatPath}.notes.${noteIndex}.id`);
      if (strings.has(note.string)) {
        issues.push({
          code: "DUPLICATE_NOTE_STRING",
          path: `${beatPath}.notes.${noteIndex}.string`,
          message: `同一 beat 的第 ${note.string} 弦重复`,
        });
      }
      strings.add(note.string);
    });
  });

  if (expectedTick !== capacity) {
    issues.push({
      code: "MEASURE_CAPACITY_MISMATCH",
      path: `${path}.beats`,
      message: `小节结束 tick 为 ${expectedTick}，拍号容量应为 ${capacity}`,
    });
  }
  measure.chordSymbols.forEach((symbol, index) => {
    registerId(symbol.id, `${path}.chordSymbols.${index}.id`);
    if (symbol.tick < 0 || symbol.tick >= capacity) {
      issues.push({
        code: "INVALID_CHORD_TICK",
        path: `${path}.chordSymbols.${index}.tick`,
        message: "和弦标记 tick 必须位于小节容量内",
      });
    }
  });
};

/** 验证整个文档的 ID 唯一性以及每个小节的音乐语义。 */
export const validateDocumentSemantics = (
  document: ILXMDocument,
): ILXMSemanticValidationResult => {
  const issues: ILXMSemanticValidationIssue[] = [];
  const entityIds = new Set<string>();
  const registerId = (id: string, path: string) => {
    if (entityIds.has(id))
      issues.push({
        code: "DUPLICATE_ENTITY_ID",
        path,
        message: `实体 ID 重复：${id}`,
      });
    else entityIds.add(id);
  };
  registerId(document.score.id, "score.id");
  document.score.tracks.forEach((track, trackIndex) => {
    const trackPath = `score.tracks.${trackIndex}`;
    registerId(track.id, `${trackPath}.id`);
    track.measures.forEach((measure, measureIndex) =>
      validateMeasure(
        measure,
        `${trackPath}.measures.${measureIndex}`,
        entityIds,
        issues,
      ),
    );
  });
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
};
