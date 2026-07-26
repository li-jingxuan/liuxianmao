/**
 * MVP v3 的纯领域命令。
 *
 * 所有命令只返回新的文档；页面层不拥有 tick 重排、容量修复或实体 ID 分配逻辑，
 * 从而让未来撤销、保存和协作使用同一份确定性的编辑规则。
 */
import { GUITAR_STRING_COUNT, MAX_FRET } from "./constants";
import { createDocumentIdFactory } from "./id-factory";
import {
  createRestRhythmsForTicks,
  calculateRhythmTicks,
  getMeasureCapacityTicks,
} from "./rhythm";
import { LXMDocumentSchema } from "./schema";
import { validateDocumentSemantics } from "./semantic-validation";
import type {
  ILXMBeat,
  ILXMDocument,
  ILXMMeasure,
  ILXMNote,
  ILXMRhythm,
} from "./types";

export enum LXMScoreCommandEnum {
  SetNote = "note.set",
  RemoveNote = "note.remove",
  SetBeatRhythm = "beat.setRhythm",
  SetBeatKind = "beat.setKind",
  InsertMeasure = "measure.insert",
  CopyMeasure = "measure.copy",
  RemoveMeasure = "measure.remove",
}

export interface ILXMScoreCommandBase {
  type: LXMScoreCommandEnum;
  trackId: string;
}
export interface ILXMBeatCommandBase extends ILXMScoreCommandBase {
  measureId: string;
  beatId: string;
}
export interface ILXMSetNoteCommand extends ILXMBeatCommandBase {
  type: LXMScoreCommandEnum.SetNote;
  string: number;
  fret: number;
}
export interface ILXMRemoveNoteCommand extends ILXMBeatCommandBase {
  type: LXMScoreCommandEnum.RemoveNote;
  string: number;
}
export interface ILXMSetBeatRhythmCommand extends ILXMBeatCommandBase {
  type: LXMScoreCommandEnum.SetBeatRhythm;
  rhythm: ILXMRhythm;
}
export interface ILXMSetBeatKindCommand extends ILXMBeatCommandBase {
  type: LXMScoreCommandEnum.SetBeatKind;
  kind: ILXMBeat["kind"];
}
export interface ILXMInsertMeasureCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.InsertMeasure;
  afterMeasureId?: string;
}
export interface ILXMCopyMeasureCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.CopyMeasure;
  measureId: string;
}
export interface ILXMRemoveMeasureCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.RemoveMeasure;
  measureId: string;
}

export type ILXMScoreCommand =
  | ILXMSetNoteCommand
  | ILXMRemoveNoteCommand
  | ILXMSetBeatRhythmCommand
  | ILXMSetBeatKindCommand
  | ILXMInsertMeasureCommand
  | ILXMCopyMeasureCommand
  | ILXMRemoveMeasureCommand;

export type ILXMScoreCommandErrorCode =
  | "TRACK_NOT_FOUND"
  | "MEASURE_NOT_FOUND"
  | "BEAT_NOT_FOUND"
  | "INVALID_STRING"
  | "INVALID_FRET"
  | "INVALID_RHYTHM"
  | "REST_BEAT_NOT_EDITABLE"
  | "MEASURE_OVERFLOW"
  | "RHYTHM_NOT_REPRESENTABLE"
  | "CANNOT_REMOVE_LAST_MEASURE"
  | "DOCUMENT_INVALID"
  | "SEMANTIC_VALIDATION_FAILED";
export type ILXMApplyScoreCommandResult =
  | { ok: true; document: ILXMDocument }
  | { ok: false; code: ILXMScoreCommandErrorCode; message: string };

const fail = (
  code: ILXMScoreCommandErrorCode,
  message: string,
): ILXMApplyScoreCommandResult => ({ ok: false, code, message });
const isValidString = (string: number) =>
  Number.isInteger(string) && string >= 1 && string <= GUITAR_STRING_COUNT;
const isValidFret = (fret: number) =>
  Number.isInteger(fret) && fret >= 0 && fret <= MAX_FRET;

/** 对候选文档执行两层守卫，保证命令无法写入结构或音乐语义非法的数据。 */
const finalize = (document: ILXMDocument): ILXMApplyScoreCommandResult => {
  const parsed = LXMDocumentSchema.safeParse(document);
  if (!parsed.success)
    return fail("DOCUMENT_INVALID", "命令结果不符合乐谱文档格式");
  const semantic = validateDocumentSemantics(parsed.data);
  return semantic.ok
    ? { ok: true, document: parsed.data }
    : fail(
        "SEMANTIC_VALIDATION_FAILED",
        semantic.issues[0]?.message ?? "命令结果不符合乐谱语义",
      );
};

/** 仅复制受影响 track/measure 分支；其他分支引用保持不变。 */
const replaceMeasure = (
  document: ILXMDocument,
  trackId: string,
  measureId: string,
  nextMeasure: ILXMMeasure,
): ILXMDocument => ({
  ...document,
  documentRevision: document.documentRevision + 1,
  score: {
    ...document.score,
    tracks: document.score.tracks.map((track) =>
      track.id !== trackId
        ? track
        : {
            ...track,
            measures: track.measures.map((measure) =>
              measure.id === measureId ? nextMeasure : measure,
            ),
          },
    ),
  },
});

/** 查找命令目标；统一错误语义，避免各命令遗漏轨道或小节判断。 */
const findTarget = (document: ILXMDocument, command: ILXMBeatCommandBase) => {
  const track = document.score.tracks.find(
    (item) => item.id === command.trackId,
  );
  if (!track) return fail("TRACK_NOT_FOUND", "目标轨道不存在");
  const measure = track.measures.find((item) => item.id === command.measureId);
  if (!measure) return fail("MEASURE_NOT_FOUND", "目标小节不存在");
  const beat = measure.beats.find((item) => item.id === command.beatId);
  if (!beat) return fail("BEAT_NOT_FOUND", "目标节拍不存在");
  return { track, measure, beat };
};

/** 由 rhythm 序列创建连续的 rest beats，所有 ID 由集中工厂分配。 */
const createRestBeats = (
  startTick: number,
  ticks: number,
  createBeatId: () => string,
): ILXMBeat[] | null => {
  const result = createRestRhythmsForTicks(ticks);
  if (!result.ok) return null;
  let tick = startTick;
  return result.rhythms.map((rhythm) => {
    const duration = calculateRhythmTicks(rhythm);
    // createRestRhythmsForTicks 只输出可计算 rhythm；此处保留守卫便于未来扩展。
    if (!duration.ok) throw new Error("休止节奏分解产生了无效 rhythm");
    const beat: ILXMBeat = {
      id: createBeatId(),
      tick,
      rhythm,
      kind: "rest",
      notes: [],
    };
    tick += duration.ticks;
    return beat;
  });
};

/**
 * 设置时值后重建目标小节尾部。
 *
 * 真正的音符 beat 仅随 delta 平移，绝不被自动改变时值；尾部 rest 是唯一允许
 * 自动伸缩的静音缓冲区。这样既保证容量完整，也让用户能预期 ripple 的结果。
 */
const setBeatRhythm = (
  document: ILXMDocument,
  command: ILXMSetBeatRhythmCommand,
): ILXMApplyScoreCommandResult => {
  const target = findTarget(document, command);
  if ("ok" in target) return target;
  const nextDuration = calculateRhythmTicks(command.rhythm);
  if (!nextDuration.ok) return fail("INVALID_RHYTHM", "不支持该时值或附点数");
  const previousDuration = calculateRhythmTicks(target.beat.rhythm);
  if (!previousDuration.ok) return fail("INVALID_RHYTHM", "当前 beat 时值无效");
  const delta = nextDuration.ticks - previousDuration.ticks;
  const capacity = getMeasureCapacityTicks(target.measure.timeSignature);
  const factory = createDocumentIdFactory(document);
  const targetIndex = target.measure.beats.findIndex(
    (beat) => beat.id === target.beat.id,
  );
  const beforeAndTarget = target.measure.beats
    .slice(0, targetIndex + 1)
    .map((beat) =>
      beat.id === target.beat.id ? { ...beat, rhythm: command.rhythm } : beat,
    );
  const after = target.measure.beats
    .slice(targetIndex + 1)
    .map((beat) => ({ ...beat, tick: beat.tick + delta }));

  // 连续末尾休止是可调整的缓冲区；先从时间轴中取走，之后按最终剩余容量重建。
  const combined = [...beforeAndTarget, ...after];
  let firstTrailingRest = combined.length;
  while (
    firstTrailingRest > 0 &&
    combined[firstTrailingRest - 1]?.kind === "rest"
  )
    firstTrailingRest -= 1;
  const fixed = combined.slice(0, firstTrailingRest);
  const fixedEnd =
    fixed.length === 0
      ? 0
      : (() => {
          const last = fixed[fixed.length - 1]!;
          const duration = calculateRhythmTicks(last.rhythm);
          return duration.ok ? last.tick + duration.ticks : Number.NaN;
        })();
  if (!Number.isFinite(fixedEnd) || fixedEnd > capacity)
    return fail("MEASURE_OVERFLOW", "修改时值后超出小节容量");
  const rests = createRestBeats(
    fixedEnd,
    capacity - fixedEnd,
    factory.createBeatId,
  );
  if (!rests)
    return fail(
      "RHYTHM_NOT_REPRESENTABLE",
      "剩余休止时长无法由当前节奏类型表示",
    );
  return finalize(
    replaceMeasure(document, command.trackId, command.measureId, {
      ...target.measure,
      beats: [...fixed, ...rests],
    }),
  );
};

/** 应用所有 MVP v3 命令。 */
export const applyScoreCommand = (
  document: ILXMDocument,
  command: ILXMScoreCommand,
): ILXMApplyScoreCommandResult => {
  if (command.type === LXMScoreCommandEnum.SetBeatRhythm)
    return setBeatRhythm(document, command);
  if (
    command.type === LXMScoreCommandEnum.SetNote ||
    command.type === LXMScoreCommandEnum.RemoveNote ||
    command.type === LXMScoreCommandEnum.SetBeatKind
  ) {
    const target = findTarget(document, command);
    if ("ok" in target) return target;
    if (
      (command.type === LXMScoreCommandEnum.SetNote ||
        command.type === LXMScoreCommandEnum.RemoveNote) &&
      !isValidString(command.string)
    )
      return fail("INVALID_STRING", "弦号必须在 1 到 6 之间");
    if (
      command.type === LXMScoreCommandEnum.SetNote &&
      !isValidFret(command.fret)
    )
      return fail("INVALID_FRET", `品位必须在 0 到 ${MAX_FRET} 之间`);
    if (
      command.type === LXMScoreCommandEnum.SetNote &&
      target.beat.kind === "rest"
    )
      return fail("REST_BEAT_NOT_EDITABLE", "请先取消休止，再输入音符");
    const factory = createDocumentIdFactory(document);
    let nextBeat: ILXMBeat;
    if (command.type === LXMScoreCommandEnum.SetBeatKind)
      nextBeat =
        command.kind === "rest"
          ? { ...target.beat, kind: "rest", notes: [] }
          : { ...target.beat, kind: "notes" };
    else if (command.type === LXMScoreCommandEnum.RemoveNote)
      nextBeat = {
        ...target.beat,
        notes: target.beat.notes.filter(
          (note) => note.string !== command.string,
        ),
      };
    else {
      const existing = target.beat.notes.find(
        (note) => note.string === command.string,
      );
      const notes: ILXMNote[] = existing
        ? target.beat.notes.map((note) =>
            note.string === command.string
              ? { ...note, fret: command.fret }
              : note,
          )
        : [
            ...target.beat.notes,
            {
              id: factory.createNoteId(),
              string: command.string,
              fret: command.fret,
            },
          ];
      nextBeat = { ...target.beat, notes };
    }
    return finalize(
      replaceMeasure(document, command.trackId, command.measureId, {
        ...target.measure,
        beats: target.measure.beats.map((beat) =>
          beat.id === target.beat.id ? nextBeat : beat,
        ),
      }),
    );
  }

  const track = document.score.tracks.find(
    (item) => item.id === command.trackId,
  );
  if (!track) return fail("TRACK_NOT_FOUND", "目标轨道不存在");
  const factory = createDocumentIdFactory(document);
  if (command.type === LXMScoreCommandEnum.RemoveMeasure) {
    if (!track.measures.some((measure) => measure.id === command.measureId))
      return fail("MEASURE_NOT_FOUND", "目标小节不存在");
    if (track.measures.length <= 1)
      return fail("CANNOT_REMOVE_LAST_MEASURE", "至少需要保留一个小节");
    const next = track.measures.filter(
      (measure) => measure.id !== command.measureId,
    );
    return finalize({
      ...document,
      documentRevision: document.documentRevision + 1,
      score: {
        ...document.score,
        tracks: document.score.tracks.map((item) =>
          item.id === track.id ? { ...track, measures: next } : item,
        ),
      },
    });
  }
  const sourceIndex =
    command.type === LXMScoreCommandEnum.CopyMeasure
      ? track.measures.findIndex((measure) => measure.id === command.measureId)
      : command.afterMeasureId === undefined
        ? -1
        : track.measures.findIndex(
            (measure) => measure.id === command.afterMeasureId,
          );
  if (command.type === LXMScoreCommandEnum.CopyMeasure && sourceIndex < 0)
    return fail("MEASURE_NOT_FOUND", "目标小节不存在");
  if (
    command.type === LXMScoreCommandEnum.InsertMeasure &&
    command.afterMeasureId !== undefined &&
    sourceIndex < 0
  )
    return fail("MEASURE_NOT_FOUND", "目标小节不存在");
  const source = track.measures[Math.max(sourceIndex, 0)];
  if (!source) return fail("MEASURE_NOT_FOUND", "轨道没有可继承拍号的小节");
  let inserted: ILXMMeasure;
  if (command.type === LXMScoreCommandEnum.CopyMeasure) {
    const copySource = track.measures[sourceIndex]!;
    inserted = {
      ...copySource,
      id: factory.createMeasureId(),
      barline: "single",
      chordSymbols: copySource.chordSymbols.map((symbol) => ({
        ...symbol,
        id: factory.createChordSymbolId(),
      })),
      beats: copySource.beats.map((beat) => ({
        ...beat,
        id: factory.createBeatId(),
        notes: beat.notes.map((note) => ({
          ...note,
          id: factory.createNoteId(),
        })),
      })),
    };
  } else {
    const rests = createRestBeats(
      0,
      getMeasureCapacityTicks(source.timeSignature),
      factory.createBeatId,
    );
    if (!rests)
      return fail("RHYTHM_NOT_REPRESENTABLE", "该拍号容量无法创建默认休止小节");
    inserted = {
      id: factory.createMeasureId(),
      timeSignature: { ...source.timeSignature },
      barline: "single",
      chordSymbols: [],
      beats: rests,
    };
  }
  const nextMeasures = [...track.measures];
  nextMeasures.splice(sourceIndex + 1, 0, inserted);
  return finalize({
    ...document,
    documentRevision: document.documentRevision + 1,
    score: {
      ...document.score,
      tracks: document.score.tracks.map((item) =>
        item.id === track.id ? { ...track, measures: nextMeasures } : item,
      ),
    },
  });
};
