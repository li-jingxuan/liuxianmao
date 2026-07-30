/**
 * MVP v3 的纯领域命令。
 *
 * 所有命令只返回新的文档；页面层不拥有 tick 重排、容量修复或实体 ID 分配逻辑，
 * 从而让未来撤销、保存和协作使用同一份确定性的编辑规则。
 */
import { GUITAR_STRING_COUNT, MAX_FRET } from "./constants";
import { createDocumentIdFactory } from "./id-factory";
import { createRestBeats } from "./rest-beats";
import { getMeasureCapacityTicks } from "./rhythm";
import { changeMeasureBeatRhythm } from "./rhythm-change";
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
  | "FOLLOWING_BEATS_CANNOT_COMPRESS"
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

/**
 * 设置目标 beat 时值，并把所有容量处理委托给单小节节奏模块。
 *
 * commands.ts 只负责文档级定位、ID 依赖、错误文案和最终校验。后续 beat 如何选择
 * 压缩方案属于统一领域规则，不能散落到页面或命令分发逻辑中。
 */
const setBeatRhythm = (
  document: ILXMDocument,
  command: ILXMSetBeatRhythmCommand,
): ILXMApplyScoreCommandResult => {
  const target = findTarget(document, command);
  if ("ok" in target) return target;
  const factory = createDocumentIdFactory(document);
  const rhythmChange = changeMeasureBeatRhythm(
    target.measure,
    target.beat.id,
    command.rhythm,
    factory.createBeatId,
  );

  if (!rhythmChange.ok) {
    if (rhythmChange.code === "BEAT_NOT_FOUND")
      return fail("BEAT_NOT_FOUND", "目标节拍不存在");
    if (rhythmChange.code === "INVALID_RHYTHM")
      return fail("INVALID_RHYTHM", "不支持该时值或附点数");
    if (rhythmChange.code === "FOLLOWING_BEATS_CANNOT_COMPRESS")
      return fail(
        "FOLLOWING_BEATS_CANNOT_COMPRESS",
        "后续节拍已达到最短可用时值，无法容纳当前修改，请先将后续节拍调整为休止符。",
      );
    return fail(
      "RHYTHM_NOT_REPRESENTABLE",
      "剩余休止时长无法由当前节奏类型表示",
    );
  }

  return finalize(
    replaceMeasure(
      document,
      command.trackId,
      command.measureId,
      rhythmChange.measure,
    ),
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
