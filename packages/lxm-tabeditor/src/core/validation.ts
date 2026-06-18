import type {
  LxmScoreDocument,
  Measure,
  Score,
  TabNote,
  Technique,
  TimeSignature,
  Track,
  TupletGroup,
} from "./schema";
import { calculateRhythmTicks, getMeasureCapacityTicks } from "./rhythm";
import {
  createValidationIssue,
  type ValidationIssue,
} from "./validation-types";

interface NoteLocation {
  note: TabNote;
  trackIndex: number;
  measureIndex: number;
  beatIndex: number;
  tick: number;
  tuningMidi: number;
}

const RELATION_TECHNIQUES = new Set<Technique["type"]>([
  "hammerOn",
  "pullOff",
  "slideUp",
  "slideDown",
]);

const PITCH_REQUIRED_TECHNIQUES = new Set<Technique["type"]>([
  ...RELATION_TECHNIQUES,
  "bend",
]);

/** 将实体 ID 注册到全局表，并统一报告重复 ID。 */
const registerId = (
  idMap: Map<string, string>,
  id: string,
  path: string,
  issues: ValidationIssue[],
): void => {
  const existingPath = idMap.get(id);
  if (existingPath) {
    issues.push(
      createValidationIssue(
        "DUPLICATE_ID",
        `ID “${id}” 已在 ${existingPath} 使用`,
        path,
        id,
      ),
    );
    return;
  }
  idMap.set(id, path);
};

/** 比较两个音符在乐谱中的先后位置。 */
const isTargetAfterSource = (
  source: NoteLocation,
  target: NoteLocation,
): boolean => {
  if (source.trackIndex !== target.trackIndex) return false;
  if (source.measureIndex !== target.measureIndex)
    return target.measureIndex > source.measureIndex;
  if (source.tick !== target.tick) return target.tick > source.tick;
  return target.beatIndex > source.beatIndex;
};

const getActualPitch = (location: NoteLocation): number | null =>
  location.note.fret === "x" ? null : location.tuningMidi + location.note.fret;

/** 先建立索引，后续引用校验不需要反复遍历整份文档。 */
const buildIndexes = (score: Score, issues: ValidationIssue[]) => {
  const idMap = new Map<string, string>();
  const noteMap = new Map<string, NoteLocation>();
  const chordDefinitionIds = new Set<string>();

  registerId(idMap, score.id, "score.id", issues);
  score.chordLibrary.forEach((chord, chordIndex) => {
    const path = `score.chordLibrary[${chordIndex}]`;
    registerId(idMap, chord.id, `${path}.id`, issues);
    chordDefinitionIds.add(chord.id);
  });

  score.tracks.forEach((track, trackIndex) => {
    registerId(idMap, track.id, `score.tracks[${trackIndex}].id`, issues);
    track.measures.forEach((measure, measureIndex) => {
      const measurePath = `score.tracks[${trackIndex}].measures[${measureIndex}]`;
      registerId(idMap, measure.id, `${measurePath}.id`, issues);
      measure.tuplets.forEach((tuplet, tupletIndex) =>
        registerId(
          idMap,
          tuplet.id,
          `${measurePath}.tuplets[${tupletIndex}].id`,
          issues,
        ),
      );
      measure.chordSymbols.forEach((symbol, symbolIndex) =>
        registerId(
          idMap,
          symbol.id,
          `${measurePath}.chordSymbols[${symbolIndex}].id`,
          issues,
        ),
      );
      measure.lyrics.forEach((lyric, lyricIndex) =>
        registerId(
          idMap,
          lyric.id,
          `${measurePath}.lyrics[${lyricIndex}].id`,
          issues,
        ),
      );
      measure.beats.forEach((beat, beatIndex) => {
        const beatPath = `${measurePath}.beats[${beatIndex}]`;
        registerId(idMap, beat.id, `${beatPath}.id`, issues);
        if (beat.kind === "notes") {
          beat.notes.forEach((note, noteIndex) => {
            registerId(
              idMap,
              note.id,
              `${beatPath}.notes[${noteIndex}].id`,
              issues,
            );
            const tuning = track.tuning.strings.find(
              (item) => item.index === note.string,
            );
            if (tuning) {
              noteMap.set(note.id, {
                note,
                trackIndex,
                measureIndex,
                beatIndex,
                tick: beat.tick,
                tuningMidi: tuning.midi,
              });
            }
          });
        }
      });
    });
  });

  return { noteMap, chordDefinitionIds };
};

const validateTuning = (
  track: Track,
  trackPath: string,
  issues: ValidationIssue[],
): void => {
  const indexes = track.tuning.strings.map((item) => item.index);
  if (new Set(indexes).size !== indexes.length) {
    issues.push(
      createValidationIssue(
        "DUPLICATE_STRING_INDEX",
        "调弦中的弦序号不能重复",
        `${trackPath}.tuning.strings`,
        track.id,
      ),
    );
  }
};

const validateTuplets = (
  measure: Measure,
  measurePath: string,
  issues: ValidationIssue[],
): Map<string, TupletGroup> => {
  const beatIndexById = new Map(
    measure.beats.map((beat, index) => [beat.id, index]),
  );
  const groupByBeatId = new Map<string, TupletGroup>();

  measure.tuplets.forEach((group, groupIndex) => {
    const path = `${measurePath}.tuplets[${groupIndex}]`;
    if (group.beatIds.length !== group.actualNotes) {
      issues.push(
        createValidationIssue(
          "TUPLET_MEMBER_COUNT_MISMATCH",
          "连音组成员数量必须等于 actualNotes",
          `${path}.beatIds`,
          group.id,
        ),
      );
    }

    const indexes = group.beatIds.map((beatId, index) => {
      const beatIndex = beatIndexById.get(beatId);
      if (beatIndex === undefined) {
        issues.push(
          createValidationIssue(
            "INVALID_TUPLET_BEAT_REFERENCE",
            `连音组引用了不存在的拍点 “${beatId}”`,
            `${path}.beatIds[${index}]`,
            group.id,
          ),
        );
        return null;
      }
      if (groupByBeatId.has(beatId)) {
        issues.push(
          createValidationIssue(
            "OVERLAPPING_TUPLET_GROUP",
            `拍点 “${beatId}” 不能同时属于多个连音组`,
            `${path}.beatIds[${index}]`,
            beatId,
          ),
        );
      } else {
        groupByBeatId.set(beatId, group);
      }
      return beatIndex;
    });

    const validIndexes = indexes.filter(
      (index): index is number => index !== null,
    );
    const continuous = validIndexes.every(
      (beatIndex, index) =>
        index === 0 || beatIndex === validIndexes[index - 1]! + 1,
    );
    if (validIndexes.length === group.beatIds.length && !continuous) {
      issues.push(
        createValidationIssue(
          "NON_CONTIGUOUS_TUPLET_BEATS",
          "连音组拍点必须按时间顺序连续排列",
          `${path}.beatIds`,
          group.id,
        ),
      );
    }
  });

  return groupByBeatId;
};

const validateMeasureRhythm = (
  measure: Measure,
  timeSignature: TimeSignature,
  measurePath: string,
  issues: ValidationIssue[],
): void => {
  const groupByBeatId = validateTuplets(measure, measurePath, issues);
  const sortedBeats = measure.beats
    .map((beat, index) => ({ beat, index }))
    .sort((left, right) => left.beat.tick - right.beat.tick);
  let endTick = 0;

  sortedBeats.forEach(({ beat, index }) => {
    const tickResult = calculateRhythmTicks(
      beat.rhythm,
      groupByBeatId.get(beat.id),
    );
    const path = `${measurePath}.beats[${index}]`;
    if (!tickResult.ok) {
      issues.push(
        createValidationIssue(
          tickResult.code,
          "当前附点与连音比例不能得到整数 tick",
          `${path}.rhythm`,
          beat.id,
        ),
      );
      return;
    }
    if (beat.tick < endTick) {
      issues.push(
        createValidationIssue(
          "OVERLAPPING_BEATS",
          "拍点时值发生重叠",
          `${path}.tick`,
          beat.id,
        ),
      );
    }
    endTick = Math.max(endTick, beat.tick + tickResult.ticks);
  });

  const capacity = getMeasureCapacityTicks(timeSignature);
  const validCapacity = measure.pickup
    ? endTick > 0 && endTick <= capacity
    : endTick === capacity;
  if (!validCapacity) {
    issues.push(
      createValidationIssue(
        "INVALID_MEASURE_CAPACITY",
        measure.pickup
          ? `弱起小节容量必须大于 0 且不超过 ${capacity} tick，当前为 ${endTick}`
          : `普通小节容量必须等于 ${capacity} tick，当前为 ${endTick}`,
        `${measurePath}.beats`,
        measure.id,
      ),
    );
  }
};

const validateMeasureNotes = (
  measure: Measure,
  measurePath: string,
  issues: ValidationIssue[],
): void => {
  measure.beats.forEach((beat, beatIndex) => {
    if (beat.kind !== "notes") return;
    const strings = new Set<number>();
    beat.notes.forEach((note, noteIndex) => {
      const path = `${measurePath}.beats[${beatIndex}].notes[${noteIndex}]`;
      if (strings.has(note.string)) {
        issues.push(
          createValidationIssue(
            "DUPLICATE_STRING_IN_BEAT",
            `同一拍点的 ${note.string} 弦只能存在一个音符`,
            `${path}.string`,
            note.id,
          ),
        );
      }
      strings.add(note.string);

      if (note.fret === "x") {
        const hasPitchRelation = note.techniques.some((item) =>
          PITCH_REQUIRED_TECHNIQUES.has(item.type),
        );
        if (note.tie || hasPitchRelation) {
          issues.push(
            createValidationIssue(
              "DEAD_NOTE_PITCH_RELATION",
              "死音不能包含延音、关系技巧或推弦",
              path,
              note.id,
            ),
          );
        }
      }
    });
  });
};

const validateChordReferences = (
  measure: Measure,
  measurePath: string,
  capacity: number,
  chordDefinitionIds: Set<string>,
  issues: ValidationIssue[],
): void => {
  const visibleTicks = new Set<number>();
  measure.chordSymbols.forEach((symbol, index) => {
    const path = `${measurePath}.chordSymbols[${index}]`;
    if (!chordDefinitionIds.has(symbol.chordDefinitionId)) {
      issues.push(
        createValidationIssue(
          "INVALID_CHORD_REFERENCE",
          `和弦标记引用了不存在的按法 “${symbol.chordDefinitionId}”`,
          `${path}.chordDefinitionId`,
          symbol.id,
        ),
      );
    }
    if (symbol.tick >= capacity) {
      issues.push(
        createValidationIssue(
          "CHORD_TICK_OUT_OF_RANGE",
          "和弦标记 tick 必须位于当前小节范围内",
          `${path}.tick`,
          symbol.id,
        ),
      );
    }
    if (symbol.display !== "hidden") {
      if (visibleTicks.has(symbol.tick)) {
        issues.push(
          createValidationIssue(
            "DUPLICATE_VISIBLE_CHORD_AT_TICK",
            "同一小节同一 tick 只能有一个可见和弦标记",
            path,
            symbol.id,
          ),
        );
      }
      visibleTicks.add(symbol.tick);
    }
  });
};

const getTechniqueTargetId = (technique: Technique): string | undefined =>
  "targetNoteId" in technique ? technique.targetNoteId : undefined;

const validateNoteRelations = (
  noteMap: Map<string, NoteLocation>,
  issues: ValidationIssue[],
): void => {
  noteMap.forEach((source, noteId) => {
    const path = `score.noteIndex.${noteId}`;
    const relations: Array<{
      targetId: string;
      type: string;
      requiresPitchMatch?: boolean;
    }> = [];
    if (source.note.tie) {
      relations.push({
        targetId: source.note.tie.targetNoteId,
        type: "tie",
        requiresPitchMatch: true,
      });
    }
    source.note.techniques.forEach((technique) => {
      const targetId = getTechniqueTargetId(technique);
      if (targetId) relations.push({ targetId, type: technique.type });
    });

    relations.forEach((relation) => {
      const target = noteMap.get(relation.targetId);
      if (!target) {
        issues.push(
          createValidationIssue(
            "INVALID_NOTE_REFERENCE",
            `${relation.type} 引用了不存在的音符 “${relation.targetId}”`,
            path,
            noteId,
          ),
        );
        return;
      }
      if (!isTargetAfterSource(source, target)) {
        issues.push(
          createValidationIssue(
            "INVALID_RELATION_DIRECTION",
            `${relation.type} 的目标音符必须位于起始音符之后`,
            path,
            noteId,
          ),
        );
      }
      if (source.note.string !== target.note.string) {
        issues.push(
          createValidationIssue(
            "RELATION_STRING_MISMATCH",
            `${relation.type} 必须连接同一根弦上的音符`,
            path,
            noteId,
          ),
        );
      }
      if (
        relation.requiresPitchMatch &&
        getActualPitch(source) !== getActualPitch(target)
      ) {
        issues.push(
          createValidationIssue(
            "TIE_PITCH_MISMATCH",
            "延音线两端必须具有相同实际音高",
            path,
            noteId,
          ),
        );
      }
    });
  });
};

const validateChordDefinitions = (
  score: Score,
  issues: ValidationIssue[],
): void => {
  score.chordLibrary.forEach((chord, chordIndex) => {
    chord.barres?.forEach((barre, barreIndex) => {
      if (barre.fromString > barre.toString) {
        issues.push(
          createValidationIssue(
            "INVALID_BARRE_RANGE",
            "横按起始弦不能大于结束弦",
            `score.chordLibrary[${chordIndex}].barres[${barreIndex}]`,
            chord.id,
          ),
        );
      }
    });
  });
};

/** 对已经通过 Zod 的文档执行跨实体、跨字段语义校验。 */
export const validateScoreSemantics = (
  documentOrScore: LxmScoreDocument | Score,
): ValidationIssue[] => {
  const score =
    "score" in documentOrScore ? documentOrScore.score : documentOrScore;
  const issues: ValidationIssue[] = [];
  const { noteMap, chordDefinitionIds } = buildIndexes(score, issues);

  validateChordDefinitions(score, issues);
  score.tracks.forEach((track, trackIndex) => {
    const trackPath = `score.tracks[${trackIndex}]`;
    validateTuning(track, trackPath, issues);
    let activeTimeSignature = score.meta.timeSignature;
    track.measures.forEach((measure, measureIndex) => {
      const measurePath = `${trackPath}.measures[${measureIndex}]`;
      activeTimeSignature = measure.timeSignature ?? activeTimeSignature;
      validateMeasureRhythm(measure, activeTimeSignature, measurePath, issues);
      validateMeasureNotes(measure, measurePath, issues);
      validateChordReferences(
        measure,
        measurePath,
        getMeasureCapacityTicks(activeTimeSignature),
        chordDefinitionIds,
        issues,
      );
    });
  });
  validateNoteRelations(noteMap, issues);

  return issues;
};
