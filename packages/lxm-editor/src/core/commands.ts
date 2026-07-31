/**
 * 乐谱编辑器的纯领域命令。
 *
 * 所有命令只返回新的文档；页面层不拥有 tick 重排、容量修复或实体 ID 分配逻辑，
 * 从而让未来撤销、保存和协作使用同一份确定性的编辑规则。
 */
import { GUITAR_STRING_COUNT, MAX_FRET } from "./constants";
import {
  resolveTabCellSelection,
  type ILXMTabCellReference,
} from "../editing/tab-cell-selection";
import { createDocumentIdFactory } from "./id-factory";
import { createMeasureRestBeats } from "./rest-beats";
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
  SetNotesInRect = "note.setRect",
  RemoveNotesInRect = "note.removeRect",
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
/**
 * 批量 Note 命令只接收两个稳定端点。
 *
 * 页面不能提前展开单元格数组，否则范围上限、文档顺序和原子性会泄漏到 UI 层。
 */
export interface ILXMTabCellRange {
  trackId: string;
  anchor: Omit<ILXMTabCellReference, "trackId">;
  focus: Omit<ILXMTabCellReference, "trackId">;
}
export interface ILXMSetNotesInRectCommand {
  type: LXMScoreCommandEnum.SetNotesInRect;
  range: ILXMTabCellRange;
  fret: number;
}
export interface ILXMRemoveNotesInRectCommand {
  type: LXMScoreCommandEnum.RemoveNotesInRect;
  range: ILXMTabCellRange;
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
  | ILXMSetNotesInRectCommand
  | ILXMRemoveNotesInRectCommand
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
  | "INVALID_TAB_CELL_RANGE"
  | "TAB_CELL_RANGE_TOO_LARGE"
  | "INVALID_RHYTHM"
  | "MEASURE_OVERFLOW"
  | "FOLLOWING_BEATS_CANNOT_COMPRESS"
  | "RHYTHM_NOT_REPRESENTABLE"
  | "CANNOT_REMOVE_LAST_MEASURE"
  | "DOCUMENT_INVALID"
  | "SEMANTIC_VALIDATION_FAILED";
export type ILXMApplyScoreCommandResult =
  | { ok: true; changed: boolean; document: ILXMDocument }
  | { ok: false; code: ILXMScoreCommandErrorCode; message: string };

const fail = (
  code: ILXMScoreCommandErrorCode,
  message: string,
): Extract<ILXMApplyScoreCommandResult, { ok: false }> => ({
  ok: false,
  code,
  message,
});
const isValidString = (string: number) =>
  Number.isInteger(string) && string >= 1 && string <= GUITAR_STRING_COUNT;
const isValidFret = (fret: number) =>
  Number.isInteger(fret) && fret >= 0 && fret <= MAX_FRET;

/** no-op 必须保留原引用与 revision，store 据此跳过历史快照。 */
const unchanged = (document: ILXMDocument): ILXMApplyScoreCommandResult => ({
  ok: true,
  changed: false,
  document,
});

/** 对候选文档执行两层守卫，保证命令无法写入结构或音乐语义非法的数据。 */
const finalize = (document: ILXMDocument): ILXMApplyScoreCommandResult => {
  const parsed = LXMDocumentSchema.safeParse(document);
  if (!parsed.success)
    return fail("DOCUMENT_INVALID", "命令结果不符合乐谱文档格式");
  const semantic = validateDocumentSemantics(document);
  return semantic.ok
    ? { ok: true, changed: true, document }
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
  if (
    target.beat.rhythm.base === command.rhythm.base &&
    target.beat.rhythm.dots === command.rhythm.dots
  )
    return unchanged(document);
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

/** 把命令端点补全为 selection 引用，并委托统一范围解析模块校验。 */
const resolveCommandRange = (
  document: ILXMDocument,
  range: ILXMTabCellRange,
) => {
  const result = resolveTabCellSelection(document, {
    anchor: { trackId: range.trackId, ...range.anchor },
    focus: { trackId: range.trackId, ...range.focus },
  });
  return result.ok ? result : fail(result.code, result.message);
};

/**
 * 原子地设置或删除矩形中的 Note。
 *
 * 函数先完成全部范围/品位校验，再遍历候选分支。整个批次只创建一个 document、
 * 增加一次 revision 并调用一次 finalize；任何失败都不会暴露部分结果。
 */
const editNotesInRect = (
  document: ILXMDocument,
  command: ILXMSetNotesInRectCommand | ILXMRemoveNotesInRectCommand,
): ILXMApplyScoreCommandResult => {
  if (
    command.type === LXMScoreCommandEnum.SetNotesInRect &&
    !isValidFret(command.fret)
  )
    return fail("INVALID_FRET", `品位必须在 0 到 ${MAX_FRET} 之间`);

  const resolved = resolveCommandRange(document, command.range);
  if (!resolved.ok) return resolved;
  const track = document.score.tracks.find(
    (candidate) => candidate.id === resolved.range.trackId,
  );
  // resolve 已验证 track 存在；该守卫让函数在未来解析器契约变化时仍原子失败。
  if (!track) return fail("INVALID_TAB_CELL_RANGE", "目标轨道不存在");

  const targetBeatIds = new Set(
    resolved.range.beats.map((beat) => beat.beatId),
  );
  const targetMeasureIds = new Set(
    resolved.range.beats.map((beat) => beat.measureId),
  );
  const targetStrings = Array.from(
    { length: resolved.range.endString - resolved.range.startString + 1 },
    (_, index) => resolved.range.startString + index,
  );
  const factory = createDocumentIdFactory(document);
  let changed = false;

  const nextMeasures = track.measures.map((measure) => {
    if (!targetMeasureIds.has(measure.id)) return measure;
    let measureChanged = false;
    const nextBeats = measure.beats.map((beat) => {
      if (!targetBeatIds.has(beat.id)) return beat;

      if (command.type === LXMScoreCommandEnum.RemoveNotesInRect) {
        const nextNotes = beat.notes.filter(
          (note) => !targetStrings.includes(note.string),
        );
        if (nextNotes.length === beat.notes.length) return beat;
        changed = true;
        measureChanged = true;
        // 删除最后一个 Note 后仍保持 notes；rest 转换只能由 beat.setKind 明确触发。
        return { ...beat, notes: nextNotes };
      }

      let beatChanged = beat.kind === "rest";
      const notesByString = new Map(
        beat.notes.map((note) => [note.string, note]),
      );
      for (const string of targetStrings) {
        const existing = notesByString.get(string);
        if (!existing) {
          beatChanged = true;
          notesByString.set(string, {
            id: factory.createNoteId(),
            string,
            fret: command.fret,
          });
        } else if (existing.fret !== command.fret) {
          beatChanged = true;
          notesByString.set(string, { ...existing, fret: command.fret });
        }
      }
      if (!beatChanged) return beat;

      changed = true;
      measureChanged = true;
      // Map 保留已有 Note 顺序，新建 Note 按目标弦从 1 到 6 稳定追加。
      return {
        ...beat,
        kind: "notes" as const,
        notes: [...notesByString.values()],
      };
    });
    return measureChanged ? { ...measure, beats: nextBeats } : measure;
  });

  if (!changed) return unchanged(document);

  return finalize({
    ...document,
    documentRevision: document.documentRevision + 1,
    score: {
      ...document.score,
      tracks: document.score.tracks.map((candidate) =>
        candidate.id === track.id
          ? { ...track, measures: nextMeasures }
          : candidate,
      ),
    },
  });
};

/** 应用所有领域命令；分发器本身不包含页面状态或历史逻辑。 */
export const applyScoreCommand = (
  document: ILXMDocument,
  command: ILXMScoreCommand,
): ILXMApplyScoreCommandResult => {
  if (
    command.type === LXMScoreCommandEnum.SetNotesInRect ||
    command.type === LXMScoreCommandEnum.RemoveNotesInRect
  )
    return editNotesInRect(document, command);
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
    const factory = createDocumentIdFactory(document);
    let nextBeat: ILXMBeat;
    if (command.type === LXMScoreCommandEnum.SetBeatKind) {
      if (target.beat.kind === command.kind) return unchanged(document);
      nextBeat =
        command.kind === "rest"
          ? { ...target.beat, kind: "rest", notes: [] }
          : { ...target.beat, kind: "notes" };
    } else if (command.type === LXMScoreCommandEnum.RemoveNote) {
      if (!target.beat.notes.some((note) => note.string === command.string))
        return unchanged(document);
      nextBeat = {
        ...target.beat,
        notes: target.beat.notes.filter(
          (note) => note.string !== command.string,
        ),
      };
    } else {
      const existing = target.beat.notes.find(
        (note) => note.string === command.string,
      );
      if (target.beat.kind === "notes" && existing?.fret === command.fret)
        return unchanged(document);
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
      nextBeat = { ...target.beat, kind: "notes", notes };
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
    const rests = createMeasureRestBeats(
      source.timeSignature,
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
