/**
 * 乐谱编辑器的纯领域命令。
 *
 * 所有命令只返回新的文档；页面层不拥有 tick 重排、容量修复或实体 ID 分配逻辑，
 * 从而让未来撤销、保存和协作使用同一份确定性的编辑规则。
 */
import { GUITAR_STRING_COUNT, MAX_FRET } from "./constants";
import {
  resolveBeatRange,
  resolveTabCellSelection,
  type ILXMBeatRange,
  type ILXMTabCellReference,
} from "../editing/tab-cell-selection";
import { createDocumentIdFactory } from "./id-factory";
import { createMeasureRestBeats } from "./rest-beats";
import { changeMeasureBeatRhythm } from "./rhythm-change";
import { isEditableTimeSignature, isSameTimeSignature } from "./rhythm";
import { LXMDocumentSchema } from "./schema";
import { validateDocumentSemantics } from "./semantic-validation";
import { changeMeasureTimeSignature } from "./time-signature-change";
import {
  pruneInvalidTechniques,
  validateTechnique,
} from "./technique-rules";
import type {
  ILXMBarlineType,
  ILXMBeat,
  ILXMDocument,
  ILXMMeasure,
  ILXMNote,
  ILXMRhythm,
  ILXMTimeSignature,
  ILXMTimeSignatureChangeScope,
  ILXMTechniqueDraft,
  ILXMTrack,
  ILXMTrackStartBarlineType,
} from "./types";

export enum LXMScoreCommandEnum {
  SetNote = "note.set",
  RemoveNote = "note.remove",
  SetNotesInRect = "note.setRect",
  RemoveNotesInRect = "note.removeRect",
  SetBeatRhythm = "beat.setRhythm",
  SetBeatKind = "beat.setKind",
  SetBeatKindRange = "beat.setKindRange",
  InsertMeasure = "measure.insert",
  CopyMeasure = "measure.copy",
  RemoveMeasure = "measure.remove",
  SetTimeSignature = "measure.setTimeSignature",
  SetBarlineBoundary = "barline.setBoundary",
  AddTechnique = "technique.add",
  UpdateTechnique = "technique.update",
  RemoveTechnique = "technique.remove",
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
export interface ILXMSetBeatKindRangeCommand {
  type: LXMScoreCommandEnum.SetBeatKindRange;
  range: ILXMBeatRange;
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
export interface ILXMSetTimeSignatureCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.SetTimeSignature;
  measureId: string;
  timeSignature: ILXMTimeSignature;
  scope: ILXMTimeSignatureChangeScope;
}

/** 小节边界使用稳定业务引用；命令内部负责映射到 track 或 measure 字段。 */
export type ILXMBarlineBoundaryReference =
  | { kind: "trackStart" }
  | { kind: "afterMeasure"; measureId: string };

export interface ILXMSetBarlineBoundaryCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.SetBarlineBoundary;
  boundary: ILXMBarlineBoundaryReference;
  barline: ILXMTrackStartBarlineType | ILXMBarlineType;
}

/** 技巧新增/修改只接收领域草稿；持久化 ID 统一由核心工厂创建或保留。 */
export interface ILXMAddTechniqueCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.AddTechnique;
  technique: ILXMTechniqueDraft;
}
export interface ILXMUpdateTechniqueCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.UpdateTechnique;
  techniqueId: string;
  technique: ILXMTechniqueDraft;
}
export interface ILXMRemoveTechniqueCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.RemoveTechnique;
  techniqueId: string;
}

export type ILXMScoreCommand =
  | ILXMSetNoteCommand
  | ILXMRemoveNoteCommand
  | ILXMSetNotesInRectCommand
  | ILXMRemoveNotesInRectCommand
  | ILXMSetBeatRhythmCommand
  | ILXMSetBeatKindCommand
  | ILXMSetBeatKindRangeCommand
  | ILXMInsertMeasureCommand
  | ILXMCopyMeasureCommand
  | ILXMRemoveMeasureCommand
  | ILXMSetTimeSignatureCommand
  | ILXMSetBarlineBoundaryCommand
  | ILXMAddTechniqueCommand
  | ILXMUpdateTechniqueCommand
  | ILXMRemoveTechniqueCommand;

export type ILXMScoreCommandErrorCode =
  | "TRACK_NOT_FOUND"
  | "MEASURE_NOT_FOUND"
  | "BEAT_NOT_FOUND"
  | "INVALID_STRING"
  | "INVALID_FRET"
  | "INVALID_TAB_CELL_RANGE"
  | "TAB_CELL_RANGE_TOO_LARGE"
  | "INVALID_BEAT_RANGE"
  | "BEAT_RANGE_TOO_LARGE"
  | "INVALID_RHYTHM"
  | "MEASURE_OVERFLOW"
  | "FOLLOWING_BEATS_CANNOT_COMPRESS"
  | "RHYTHM_NOT_REPRESENTABLE"
  | "UNSUPPORTED_TIME_SIGNATURE"
  | "INVALID_TIME_SIGNATURE_SCOPE"
  | "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE"
  | "CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE"
  | "CANNOT_REMOVE_LAST_MEASURE"
  | "BARLINE_BOUNDARY_NOT_FOUND"
  | "INVALID_BARLINE_FOR_BOUNDARY"
  | "TECHNIQUE_NOT_FOUND"
  | "TECHNIQUE_NOTE_NOT_FOUND"
  | "TECHNIQUE_BEAT_NOT_FOUND"
  | "TECHNIQUE_TARGET_INVALID"
  | "TECHNIQUE_NOTES_NOT_ORDERED"
  | "TECHNIQUE_REQUIRES_SAME_STRING"
  | "TECHNIQUE_REQUIRES_SAME_PITCH"
  | "TECHNIQUE_DIRECTION_MISMATCH"
  | "TECHNIQUE_CONFLICT"
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

const TRACK_START_BARLINES = new Set<ILXMTrackStartBarlineType>([
  "none",
  "repeatStart",
]);
const MEASURE_BARLINES = new Set<ILXMBarlineType>([
  "single",
  "double",
  "final",
  "repeatStart",
  "repeatEnd",
  "repeatBoth",
]);

/** no-op 必须保留原引用与 revision，store 据此跳过历史快照。 */
const unchanged = (document: ILXMDocument): ILXMApplyScoreCommandResult => ({
  ok: true,
  changed: false,
  document,
});

/**
 * 用户在带扫弦/琶音的 Beat 上重新输入单个品位时，显式输入优先于整拍技巧。
 * 该清理与 Note 修改放在同一个候选 track 中提交，因此只产生一次 revision 和
 * 一个历史项；其他 Beat 技巧以及 Note 级技巧均不受影响。
 */
const removeChordTraversalTechniquesAtCell = (
  track: ILXMTrack,
  beatId: string | undefined,
  string: number | undefined,
): ILXMTrack => {
  if (beatId === undefined || string === undefined) return track;
  const techniques = track.techniques.filter(
    (technique) =>
      !(
        (technique.type === "strum" || technique.type === "arpeggio") &&
        technique.beatId === beatId &&
        string >= technique.minString &&
        string <= technique.maxString
      ),
  );
  return techniques.length === track.techniques.length
    ? track
    : { ...track, techniques };
};

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
        : pruneInvalidTechniques({
            ...track,
            measures: track.measures.map((measure) =>
              measure.id === measureId ? nextMeasure : measure,
            ),
          }),
    ),
  },
});

/**
 * 原子修改一个拍号段落。
 *
 * 命令先在旧文档上解析完整目标范围，再用同一个局部 ID factory 规划每个小节。
 * 规划阶段不会写入 document；只有所有小节都成功协调容量后，才一次性复制 track
 * 分支、递增一次 revision 并执行最终校验。这样 untilNextChange 中间任一小节无法
 * 缩容时，前面已经规划成功的小节也不会泄漏成部分提交。
 */
const setTimeSignature = (
  document: ILXMDocument,
  command: ILXMSetTimeSignatureCommand,
): ILXMApplyScoreCommandResult => {
  const track = document.score.tracks.find(
    (candidate) => candidate.id === command.trackId,
  );
  if (!track) return fail("TRACK_NOT_FOUND", "目标轨道不存在");

  const targetIndex = track.measures.findIndex(
    (measure) => measure.id === command.measureId,
  );
  if (targetIndex < 0) return fail("MEASURE_NOT_FOUND", "目标小节不存在");
  if (!isEditableTimeSignature(command.timeSignature))
    return fail(
      "UNSUPPORTED_TIME_SIGNATURE",
      "当前只支持编辑 2/4、3/4、4/4 和 6/8 拍号",
    );
  if (command.scope !== "measure" && command.scope !== "untilNextChange")
    return fail("INVALID_TIME_SIGNATURE_SCOPE", "拍号修改范围无效");

  const targetMeasure = track.measures[targetIndex]!;
  if (isSameTimeSignature(targetMeasure.timeSignature, command.timeSignature))
    return unchanged(document);

  /*
   * untilNextChange 的边界必须以“命令执行前目标小节的拍号”为准。若第 3、4 小节
   * 是 4/4、第 5 小节已是 3/4，从第 3 小节改成 6/8 时只能收集第 3、4 小节，
   * 不能在规划过程中因为候选值变化而继续越过第 5 小节。
   */
  const targetIndexes = [targetIndex];
  if (command.scope === "untilNextChange") {
    for (
      let index = targetIndex + 1;
      index < track.measures.length;
      index += 1
    ) {
      const measure = track.measures[index]!;
      if (
        !isSameTimeSignature(measure.timeSignature, targetMeasure.timeSignature)
      )
        break;
      targetIndexes.push(index);
    }
  }

  const factory = createDocumentIdFactory(document);
  const plannedByIndex = new Map<number, ILXMMeasure>();
  for (const index of targetIndexes) {
    const result = changeMeasureTimeSignature(
      track.measures[index]!,
      command.timeSignature,
      factory.createBeatId,
    );
    if (!result.ok) {
      if (result.code === "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE")
        return fail(
          result.code,
          `第 ${index + 1} 小节的真实内容超出新拍号容量，未修改任何小节`,
        );
      if (result.code === "CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE")
        return fail(
          result.code,
          `第 ${index + 1} 小节存在落在新拍号容量之外的和弦标记，未修改任何小节`,
        );
      return fail(
        "RHYTHM_NOT_REPRESENTABLE",
        `第 ${index + 1} 小节的剩余休止无法精确表示，未修改任何小节`,
      );
    }
    plannedByIndex.set(index, result.measure);
  }

  return finalize({
    ...document,
    documentRevision: document.documentRevision + 1,
    score: {
      ...document.score,
      tracks: document.score.tracks.map((candidate) =>
        candidate.id === track.id
          ? {
              ...track,
              measures: track.measures.map(
                (measure, index) => plannedByIndex.get(index) ?? measure,
              ),
            }
          : candidate,
      ),
    },
  });
};

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
  const singleInputBeatId =
    command.type === LXMScoreCommandEnum.SetNotesInRect &&
    resolved.range.cellCount === 1
      ? resolved.range.beats[0]?.beatId
      : undefined;
  const singleInputString =
    command.type === LXMScoreCommandEnum.SetNotesInRect &&
    resolved.range.cellCount === 1
      ? resolved.range.startString
      : undefined;
  const trackAfterTechniqueCancellation = removeChordTraversalTechniquesAtCell(
    track,
    singleInputBeatId,
    singleInputString,
  );
  let changed = trackAfterTechniqueCancellation !== track;

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
          ? pruneInvalidTechniques({
              ...trackAfterTechniqueCancellation,
              measures: nextMeasures,
            })
          : candidate,
      ),
    },
  });
};

/** 原子设置连续 Beat 的内容类型；范围中的弦维度不参与休止语义。 */
const setBeatKindInRange = (
  document: ILXMDocument,
  command: ILXMSetBeatKindRangeCommand,
): ILXMApplyScoreCommandResult => {
  const resolved = resolveBeatRange(document, command.range);
  if (!resolved.ok) return fail(resolved.code, resolved.message);

  const track = document.score.tracks.find(
    (candidate) => candidate.id === resolved.range.trackId,
  );
  if (!track) return fail("INVALID_BEAT_RANGE", "Beat 选区的目标轨道不存在");

  const targetBeatIds = new Set(
    resolved.range.beats.map((beat) => beat.beatId),
  );
  const targetMeasureIds = new Set(
    resolved.range.beats.map((beat) => beat.measureId),
  );
  let changed = false;
  const measures = track.measures.map((measure) => {
    if (!targetMeasureIds.has(measure.id)) return measure;
    let measureChanged = false;
    const beats = measure.beats.map((beat) => {
      if (!targetBeatIds.has(beat.id)) return beat;
      if (command.kind === "rest") {
        if (beat.kind === "rest" && beat.notes.length === 0) return beat;
        changed = true;
        measureChanged = true;
        return { ...beat, kind: "rest" as const, notes: [] };
      }
      if (beat.kind === "notes") return beat;
      changed = true;
      measureChanged = true;
      return { ...beat, kind: "notes" as const };
    });
    return measureChanged ? { ...measure, beats } : measure;
  });

  if (!changed) return unchanged(document);
  return finalize({
    ...document,
    documentRevision: document.documentRevision + 1,
    score: {
      ...document.score,
      tracks: document.score.tracks.map((candidate) =>
        candidate.id === track.id
          ? pruneInvalidTechniques({ ...track, measures })
          : candidate,
      ),
    },
  });
};

/** 原子修改谱首或小节后的结构边界，并隐藏两种持久化位置的差异。 */
const setBarlineBoundary = (
  document: ILXMDocument,
  command: ILXMSetBarlineBoundaryCommand,
): ILXMApplyScoreCommandResult => {
  const track = document.score.tracks.find(
    (candidate) => candidate.id === command.trackId,
  );
  if (!track) return fail("TRACK_NOT_FOUND", "目标轨道不存在");

  if (command.boundary.kind === "trackStart") {
    if (!TRACK_START_BARLINES.has(command.barline as ILXMTrackStartBarlineType))
      return fail(
        "INVALID_BARLINE_FOR_BOUNDARY",
        "谱首边界只支持无小节线或开始反复线",
      );
    const barline = command.barline as ILXMTrackStartBarlineType;
    if (track.startBarline === barline) return unchanged(document);
    return finalize({
      ...document,
      documentRevision: document.documentRevision + 1,
      score: {
        ...document.score,
        tracks: document.score.tracks.map((candidate) =>
          candidate.id === track.id
            ? { ...track, startBarline: barline }
            : candidate,
        ),
      },
    });
  }

  // 判别联合已经排除 trackStart；把稳定 ID 提取到局部变量，避免闭包回调丢失
  // TypeScript 对 command.boundary 的收窄结果，也让后续错误路径只依赖一个值。
  const targetMeasureId = command.boundary.measureId;
  const measureIndex = track.measures.findIndex(
    (measure) => measure.id === targetMeasureId,
  );
  if (measureIndex < 0)
    return fail("BARLINE_BOUNDARY_NOT_FOUND", "目标小节边界不存在");
  if (!MEASURE_BARLINES.has(command.barline as ILXMBarlineType))
    return fail("INVALID_BARLINE_FOR_BOUNDARY", "小节右边界不支持该小节线类型");
  const barline = command.barline as ILXMBarlineType;
  if (
    measureIndex === track.measures.length - 1 &&
    (barline === "repeatStart" || barline === "repeatBoth")
  )
    return fail(
      "INVALID_BARLINE_FOR_BOUNDARY",
      "乐谱末尾没有可开始反复的后续小节",
    );
  const measure = track.measures[measureIndex]!;
  if (measure.barline === barline) return unchanged(document);
  return finalize(
    replaceMeasure(document, track.id, measure.id, { ...measure, barline }),
  );
};

/**
 * 新增、修改与删除技巧共享一个深 Module interface。
 *
 * 页面不需要知道目标解析、互斥矩阵或 ID 分配；所有候选先通过领域规则，再只复制
 * 目标 track 并进行最终两层校验。update 排除自身后校验，避免把原技巧误判为重复。
 */
const editTechnique = (
  document: ILXMDocument,
  command:
    | ILXMAddTechniqueCommand
    | ILXMUpdateTechniqueCommand
    | ILXMRemoveTechniqueCommand,
): ILXMApplyScoreCommandResult => {
  const track = document.score.tracks.find(
    (candidate) => candidate.id === command.trackId,
  );
  if (!track) return fail("TRACK_NOT_FOUND", "目标轨道不存在");

  if (command.type === LXMScoreCommandEnum.RemoveTechnique) {
    if (!track.techniques.some((item) => item.id === command.techniqueId))
      return fail("TECHNIQUE_NOT_FOUND", "目标技巧不存在");
    return finalize({
      ...document,
      documentRevision: document.documentRevision + 1,
      score: {
        ...document.score,
        tracks: document.score.tracks.map((candidate) =>
          candidate.id === track.id
            ? {
                ...track,
                techniques: track.techniques.filter(
                  (item) => item.id !== command.techniqueId,
                ),
              }
            : candidate,
        ),
      },
    });
  }

  const existing =
    command.type === LXMScoreCommandEnum.UpdateTechnique
      ? track.techniques.find((item) => item.id === command.techniqueId)
      : undefined;
  if (
    command.type === LXMScoreCommandEnum.UpdateTechnique &&
    existing === undefined
  )
    return fail("TECHNIQUE_NOT_FOUND", "目标技巧不存在");

  const toTechniqueDraftJson = (value: (typeof track.techniques)[number]) => {
    const { id: _id, ...draft } = value;
    return JSON.stringify(draft);
  };
  const commandDraftJson = JSON.stringify(command.technique);
  // 完全重复新增是成功 no-op；它与“同一目标但参数冲突”是不同语义，必须在
  // validateTechnique 的冲突矩阵之前识别。
  if (
    command.type === LXMScoreCommandEnum.AddTechnique &&
    track.techniques.some(
      (candidate) => toTechniqueDraftJson(candidate) === commandDraftJson,
    )
  )
    return unchanged(document);

  const validation = validateTechnique(
    track,
    command.technique,
    command.type === LXMScoreCommandEnum.UpdateTechnique
      ? command.techniqueId
      : undefined,
  );
  if (!validation.ok)
    return fail(validation.error.code, validation.error.message);

  if (
    existing &&
    toTechniqueDraftJson(existing) === commandDraftJson
  )
    return unchanged(document);

  const technique = {
    ...command.technique,
    id:
      command.type === LXMScoreCommandEnum.UpdateTechnique
        ? command.techniqueId
        : createDocumentIdFactory(document).createTechniqueId(),
  } as (typeof track.techniques)[number];
  const techniques =
    command.type === LXMScoreCommandEnum.UpdateTechnique
      ? track.techniques.map((item) =>
          item.id === command.techniqueId ? technique : item,
        )
      : [...track.techniques, technique];

  return finalize({
    ...document,
    documentRevision: document.documentRevision + 1,
    score: {
      ...document.score,
      tracks: document.score.tracks.map((candidate) =>
        candidate.id === track.id ? { ...track, techniques } : candidate,
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
    command.type === LXMScoreCommandEnum.AddTechnique ||
    command.type === LXMScoreCommandEnum.UpdateTechnique ||
    command.type === LXMScoreCommandEnum.RemoveTechnique
  )
    return editTechnique(document, command);
  if (command.type === LXMScoreCommandEnum.SetTimeSignature)
    return setTimeSignature(document, command);
  if (command.type === LXMScoreCommandEnum.SetBarlineBoundary)
    return setBarlineBoundary(document, command);
  if (command.type === LXMScoreCommandEnum.SetBeatKindRange)
    return setBeatKindInRange(document, command);
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
      const hasChordTraversalAtCell = document.score.tracks.some(
        (track) =>
          track.id === command.trackId &&
          track.techniques.some(
            (technique) =>
              (technique.type === "strum" ||
                technique.type === "arpeggio") &&
              technique.beatId === target.beat.id &&
              command.string >= technique.minString &&
              command.string <= technique.maxString,
          ),
      );
      if (
        target.beat.kind === "notes" &&
        existing?.fret === command.fret &&
        !hasChordTraversalAtCell
      )
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
    const trackWithEditedMeasure = replaceMeasure(
      document,
      command.trackId,
      command.measureId,
      {
        ...target.measure,
        beats: target.measure.beats.map((beat) =>
          beat.id === target.beat.id ? nextBeat : beat,
        ),
      },
    );
    const nextDocument =
      command.type === LXMScoreCommandEnum.SetNote
        ? {
            ...trackWithEditedMeasure,
            score: {
              ...trackWithEditedMeasure.score,
              tracks: trackWithEditedMeasure.score.tracks.map((track) =>
                track.id === command.trackId
                  ? removeChordTraversalTechniquesAtCell(
                      track,
                      target.beat.id,
                      command.string,
                    )
                  : track,
              ),
            },
          }
        : trackWithEditedMeasure;
    return finalize(nextDocument);
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
          item.id === track.id
            ? pruneInvalidTechniques({ ...track, measures: next })
            : item,
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
        item.id === track.id
          ? pruneInvalidTechniques({ ...track, measures: nextMeasures })
          : item,
      ),
    },
  });
};
