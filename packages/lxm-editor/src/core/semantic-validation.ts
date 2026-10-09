/**
 * 乐谱语义校验。
 *
 * Zod schema 负责验证字段形状；本模块负责验证跨字段的音乐规则，保证 layout 和
 * 命令层面对的是一条连续、完整且无冲突的时间轴。
 */
import { getMeasureCapacityTicks } from "./rhythm";
import { createMeasureRhythmContext } from "./tuplet";
import { validateTechnique } from "./technique-rules";
import type { ILXMDocument, ILXMMeasure } from "./types";

export type ILXMSemanticValidationIssueCode =
  | "INVALID_RHYTHM"
  | "BEAT_TICK_NOT_CONTIGUOUS"
  | "MEASURE_CAPACITY_MISMATCH"
  | "REST_HAS_NOTES"
  | "DUPLICATE_NOTE_STRING"
  | "DUPLICATE_ENTITY_ID"
  | "INVALID_CHORD_TICK"
  | "MUSIC_TEXT_BEAT_NOT_FOUND"
  | "MUSIC_TEXT_ORDER_INVALID"
  | "DUPLICATE_MUSIC_TEXT_TARGET"
  | "INVALID_TECHNIQUE"
  | "TUPLET_BEAT_NOT_FOUND"
  | "TUPLET_MEMBER_COUNT_MISMATCH"
  | "TUPLET_BEATS_NOT_CONTIGUOUS"
  | "TUPLET_RHYTHM_MISMATCH"
  | "TUPLET_OVERLAP"
  | "TUPLET_ORDER_INVALID"
  | "NON_INTEGER_TUPLET_TICKS";

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
  const context = createMeasureRhythmContext(measure);
  const beatIndexById = new Map(
    measure.beats.map((beat, index) => [beat.id, index]),
  );
  const usedMembers = new Set<string>();
  let previousStart = -1;
  measure.tuplets.forEach((group, groupIndex) => {
    const groupPath = `${path}.tuplets.${groupIndex}`;
    registerId(group.id, `${groupPath}.id`);
    const add = (
      code: ILXMSemanticValidationIssueCode,
      field: string,
      message: string,
    ) => issues.push({ code, path: `${groupPath}.${field}`, message });
    if (group.beatIds.length !== group.ratio.actual)
      add(
        "TUPLET_MEMBER_COUNT_MISMATCH",
        "beatIds",
        "连音成员数必须等于 actual",
      );
    const start = beatIndexById.get(group.beatIds[0]!) ?? -1;
    if (start < previousStart)
      add("TUPLET_ORDER_INVALID", "beatIds", "连音组必须按时间顺序保存");
    previousStart = start;
    const first = measure.beats[start];
    group.beatIds.forEach((id, index) => {
      const position = beatIndexById.get(id);
      if (position === undefined)
        add("TUPLET_BEAT_NOT_FOUND", `beatIds.${index}`, "连音成员不存在");
      else {
        if (position !== start + index)
          add(
            "TUPLET_BEATS_NOT_CONTIGUOUS",
            `beatIds.${index}`,
            "连音成员必须有序连续",
          );
        const beat = measure.beats[position]!;
        if (
          first &&
          (beat.rhythm.base !== first.rhythm.base ||
            beat.rhythm.dots !== first.rhythm.dots)
        )
          add(
            "TUPLET_RHYTHM_MISMATCH",
            `beatIds.${index}`,
            "连音成员书写时值及附点必须相同",
          );
        const duration = context.getBeatDurationTicks(beat);
        if (!duration.ok && duration.code === "NON_INTEGER_TUPLET_TICKS")
          add(duration.code, `beatIds.${index}`, "连音时长必须为整数 tick");
      }
      if (usedMembers.has(id))
        add(
          "TUPLET_OVERLAP",
          `beatIds.${index}`,
          "连音成员不能重复或属于多个组",
        );
      usedMembers.add(id);
    });
  });
  measure.beats.forEach((beat, beatIndex) => {
    const beatPath = `${path}.beats.${beatIndex}`;
    registerId(beat.id, `${beatPath}.id`);
    const duration = context.getBeatDurationTicks(beat);
    if (!duration.ok) {
      issues.push({
        code: duration.code,
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
    expectedTick += duration.ticks;
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
  // 歌词按 Beat/段号、和弦按 Beat 排序，稳定引用不能跨小节。
  for (const kind of ["lyrics", "chordSymbols"] as const) {
    let previous = -1;
    const targets = new Set<string>();
    measure[kind].forEach((item, index) => {
      const itemPath = `${path}.${kind}.${index}`;
      registerId(item.id, `${itemPath}.id`);
      const position = beatIndexById.get(item.beatId);
      if (position === undefined)
        issues.push({
          code: "MUSIC_TEXT_BEAT_NOT_FOUND",
          path: `${itemPath}.beatId`,
          message: "文本目标 Beat 不存在于该小节",
        });
      const verse = "verse" in item ? item.verse : 0;
      const order = (position ?? -1) * 5 + verse;
      if (order < previous)
        issues.push({
          code: "MUSIC_TEXT_ORDER_INVALID",
          path: itemPath,
          message: "音乐文本必须按 Beat 和段号排序",
        });
      previous = order;
      const key = `${item.beatId}:${verse}`;
      if (targets.has(key))
        issues.push({
          code: "DUPLICATE_MUSIC_TEXT_TARGET",
          path: itemPath,
          message: "同拍同段歌词或和弦重复",
        });
      targets.add(key);
    });
  }
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
    track.techniques.forEach((technique, techniqueIndex) => {
      const techniquePath = `${trackPath}.techniques.${techniqueIndex}`;
      registerId(technique.id, `${techniquePath}.id`);
      // 排除自身后再校验冲突，否则任何已持久化技巧都会被自己的重复 key 命中。
      const result = validateTechnique(track, technique, technique.id);
      if (!result.ok)
        issues.push({
          code: "INVALID_TECHNIQUE",
          path: result.error.field
            ? `${techniquePath}.${result.error.field}`
            : techniquePath,
          message: result.error.message,
        });
    });
  });
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
};
