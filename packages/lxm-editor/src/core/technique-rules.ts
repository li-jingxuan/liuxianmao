/**
 * MVP v5 吉他技巧领域规则 Module。
 *
 * 该 Module 把 Note/Beat 引用解析、时间顺序、类型特定约束与互斥关系收敛在一个
 * interface 后面。命令、loader 语义校验和页面只消费这里的结果，不各自实现一套
 * “看起来合法”的近似规则，否则删除、加载与交互很容易产生不同结论。
 */
import { MAX_FRET } from "./constants";
import type {
  ILXMBeat,
  ILXMNote,
  ILXMTechnique,
  ILXMTechniqueDraft,
  ILXMTrack,
} from "./types";

export type ILXMTechniqueRuleErrorCode =
  | "TECHNIQUE_NOTE_NOT_FOUND"
  | "TECHNIQUE_BEAT_NOT_FOUND"
  | "TECHNIQUE_TARGET_INVALID"
  | "TECHNIQUE_NOTES_NOT_ORDERED"
  | "TECHNIQUE_REQUIRES_SAME_STRING"
  | "TECHNIQUE_REQUIRES_SAME_PITCH"
  | "TECHNIQUE_DIRECTION_MISMATCH"
  | "TECHNIQUE_CONFLICT";

export interface ILXMTechniqueRuleError {
  code: ILXMTechniqueRuleErrorCode;
  message: string;
  /** 相对 technique 对象的字段，语义校验据此生成精确文档 path。 */
  field?: string;
}

export type ILXMTechniqueRuleResult =
  | { ok: true }
  | { ok: false; error: ILXMTechniqueRuleError };

export interface ILXMIndexedBeat {
  beat: ILXMBeat;
  measureId: string;
  measureIndex: number;
  beatIndex: number;
  order: number;
}

export interface ILXMIndexedNote {
  note: ILXMNote;
  beat: ILXMIndexedBeat;
}

export interface ILXMTechniqueIndex {
  beats: ILXMIndexedBeat[];
  beatsById: Map<string, ILXMIndexedBeat>;
  notesById: Map<string, ILXMIndexedNote>;
}

/**
 * 用文档顺序而非像素坐标建立稳定索引。
 *
 * system 会随 systemWidth 改变，不能参与技巧先后关系；measure 数组顺序与 beat
 * 数组顺序才是领域时间轴。semantic validation 已保证 beat tick 连续，因此这里
 * 保留数组顺序即可，并同时记录 order 供 O(1) 比较。
 */
export const buildTechniqueIndex = (track: ILXMTrack): ILXMTechniqueIndex => {
  const beats: ILXMIndexedBeat[] = [];
  const beatsById = new Map<string, ILXMIndexedBeat>();
  const notesById = new Map<string, ILXMIndexedNote>();

  track.measures.forEach((measure, measureIndex) => {
    measure.beats.forEach((beat, beatIndex) => {
      const indexedBeat: ILXMIndexedBeat = {
        beat,
        measureId: measure.id,
        measureIndex,
        beatIndex,
        order: beats.length,
      };
      beats.push(indexedBeat);
      beatsById.set(beat.id, indexedBeat);
      beat.notes.forEach((note) =>
        notesById.set(note.id, { note, beat: indexedBeat }),
      );
    });
  });
  return { beats, beatsById, notesById };
};

const fail = (
  code: ILXMTechniqueRuleErrorCode,
  message: string,
  field?: string,
): ILXMTechniqueRuleResult => ({
  ok: false,
  error: { code, message, ...(field ? { field } : {}) },
});

const isConnection = (
  technique: ILXMTechnique | ILXMTechniqueDraft,
): technique is Extract<
  ILXMTechnique | ILXMTechniqueDraft,
  { toNoteId: string }
> => "toNoteId" in technique;

const isSingleNote = (
  technique: ILXMTechnique | ILXMTechniqueDraft,
): technique is Extract<
  ILXMTechnique | ILXMTechniqueDraft,
  { fromNoteId: string }
> => "fromNoteId" in technique && !isConnection(technique);

const isBeatTechnique = (
  technique: ILXMTechnique | ILXMTechniqueDraft,
): technique is Extract<
  ILXMTechnique | ILXMTechniqueDraft,
  { beatId: string }
> => "beatId" in technique;

const isBeatRange = (
  technique: ILXMTechnique | ILXMTechniqueDraft,
): technique is Extract<
  ILXMTechnique | ILXMTechniqueDraft,
  { fromBeatId: string; toBeatId: string }
> => "fromBeatId" in technique;

/**
 * 返回同弦下一颗可连接 Note。
 *
 * 普通 Beat 没有该弦音符时继续向后扫描；rest 是明确的乐句中断，遇到后立即停止。
 * 这个查询既服务快捷按钮，也用于 H/P/slide 的最终领域校验。
 */
export const findNextNoteOnSameStringInTrack = (
  track: ILXMTrack,
  fromNoteId: string,
): ILXMIndexedNote | null => {
  const index = buildTechniqueIndex(track);
  const from = index.notesById.get(fromNoteId);
  if (!from) return null;
  for (const beat of index.beats.slice(from.beat.order + 1)) {
    if (beat.beat.kind === "rest") return null;
    const note = beat.beat.notes.find(
      (candidate) => candidate.string === from.note.string,
    );
    if (note) return { note, beat };
  }
  return null;
};

const getTechniqueKey = (
  technique: ILXMTechnique | ILXMTechniqueDraft,
): string => {
  // 每个成员都是字段少且顺序由源码固定的普通对象；显式拼 key 比 JSON stringify
  // 更清楚，也不会把持久化 id 误当成领域重复条件。
  if (isConnection(technique))
    return `${technique.type}:${technique.fromNoteId}:${technique.toNoteId}`;
  if (isSingleNote(technique)) {
    const extra =
      technique.type === "bend"
        ? technique.semitones
        : technique.type === "trill"
          ? technique.auxiliaryFret
          : "";
    return `${technique.type}:${technique.fromNoteId}:${extra}`;
  }
  if (isBeatTechnique(technique)) {
    const direction =
      technique.type === "arpeggio" ? technique.direction : technique.stroke;
    return `${technique.type}:${technique.beatId}:${direction}`;
  }
  return `${technique.type}:${technique.fromBeatId}:${technique.toBeatId}`;
};

const intervalsOverlap = (
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
) => leftStart <= rightEnd && rightStart <= leftEnd;

/** 校验一个候选技巧；excludeTechniqueId 用于 update 时排除自身。 */
export const validateTechnique = (
  track: ILXMTrack,
  technique: ILXMTechnique | ILXMTechniqueDraft,
  excludeTechniqueId?: string,
): ILXMTechniqueRuleResult => {
  const index = buildTechniqueIndex(track);

  if (isConnection(technique)) {
    const from = index.notesById.get(technique.fromNoteId);
    const to = index.notesById.get(technique.toNoteId);
    if (!from)
      return fail(
        "TECHNIQUE_NOTE_NOT_FOUND",
        "技巧起始音符不存在",
        "fromNoteId",
      );
    if (!to)
      return fail(
        "TECHNIQUE_NOTE_NOT_FOUND",
        "技巧目标音符不存在",
        "toNoteId",
      );
    if (from.beat.order >= to.beat.order)
      return fail(
        "TECHNIQUE_NOTES_NOT_ORDERED",
        "技巧目标音符必须严格晚于起始音符",
        "toNoteId",
      );
    if (from.note.string !== to.note.string)
      return fail(
        "TECHNIQUE_REQUIRES_SAME_STRING",
        "该技巧要求起始音与目标音位于同一根弦",
        "toNoteId",
      );

    if (technique.type === "tie") {
      if (from.note.fret !== to.note.fret)
        return fail(
          "TECHNIQUE_REQUIRES_SAME_PITCH",
          "延音线两端必须是同弦同品位",
          "toNoteId",
        );
      if (to.beat.order !== from.beat.order + 1)
        return fail(
          "TECHNIQUE_TARGET_INVALID",
          "延音线只能连接时间轴上相邻的两个 Beat",
          "toNoteId",
        );
    } else {
      const next = findNextNoteOnSameStringInTrack(track, from.note.id);
      if (next?.note.id !== to.note.id)
        return fail(
          "TECHNIQUE_TARGET_INVALID",
          "击弦、勾弦和滑音只能连接无休止间隔的同弦下一音",
          "toNoteId",
        );
      const goesUp = to.note.fret > from.note.fret;
      const expectsUp =
        technique.type === "hammerOn" || technique.type === "slideUp";
      if (goesUp !== expectsUp || to.note.fret === from.note.fret)
        return fail(
          "TECHNIQUE_DIRECTION_MISMATCH",
          "技巧方向与两端品位高低不一致",
          "toNoteId",
        );
    }
  } else if (isSingleNote(technique)) {
    const target = index.notesById.get(technique.fromNoteId);
    if (!target)
      return fail(
        "TECHNIQUE_NOTE_NOT_FOUND",
        "技巧目标音符不存在",
        "fromNoteId",
      );
    if (
      technique.type === "trill" &&
      (technique.auxiliaryFret < 0 ||
        technique.auxiliaryFret > MAX_FRET ||
        technique.auxiliaryFret === target.note.fret)
    )
      return fail(
        "TECHNIQUE_TARGET_INVALID",
        `颤音奏辅助品位必须在 0 到 ${MAX_FRET} 之间且不同于主品位`,
        "auxiliaryFret",
      );
  } else if (isBeatTechnique(technique)) {
    const target = index.beatsById.get(technique.beatId);
    if (!target)
      return fail(
        "TECHNIQUE_BEAT_NOT_FOUND",
        "技巧目标 Beat 不存在",
        "beatId",
      );
    const noteCount = target.beat.kind === "notes" ? target.beat.notes.length : 0;
    if (
      (technique.type === "strum" || technique.type === "arpeggio") &&
      noteCount < 2
    )
      return fail(
        "TECHNIQUE_TARGET_INVALID",
        "扫弦和琶音要求目标 Beat 至少包含两颗音符",
        "beatId",
      );
    if (technique.type === "pickStroke" && noteCount !== 1)
      return fail(
        "TECHNIQUE_TARGET_INVALID",
        "拨片方向首版只作用于恰好一颗音符的 Beat",
        "beatId",
      );
  } else if (isBeatRange(technique)) {
    const from = index.beatsById.get(technique.fromBeatId);
    const to = index.beatsById.get(technique.toBeatId);
    if (!from)
      return fail(
        "TECHNIQUE_BEAT_NOT_FOUND",
        "区间技巧起始 Beat 不存在",
        "fromBeatId",
      );
    if (!to)
      return fail(
        "TECHNIQUE_BEAT_NOT_FOUND",
        "区间技巧结束 Beat 不存在",
        "toBeatId",
      );
    if (from.order > to.order)
      return fail(
        "TECHNIQUE_NOTES_NOT_ORDERED",
        "区间技巧结束 Beat 不能早于起始 Beat",
        "toBeatId",
      );
    const range = index.beats.slice(from.order, to.order + 1);
    if (range.some((item) => item.beat.kind === "rest"))
      return fail(
        "TECHNIQUE_TARGET_INVALID",
        "P.M. 与 Let Ring 区间不能经过休止 Beat",
        "toBeatId",
      );
  }

  const others = track.techniques.filter(
    (candidate) => candidate.id !== excludeTechniqueId,
  );
  if (others.some((candidate) => getTechniqueKey(candidate) === getTechniqueKey(technique)))
    return fail("TECHNIQUE_CONFLICT", "相同目标和参数的技巧已经存在");

  for (const existing of others) {
    if (
      (technique.type === "naturalHarmonic" ||
        technique.type === "artificialHarmonic") &&
      (existing.type === "naturalHarmonic" ||
        existing.type === "artificialHarmonic") &&
      existing.fromNoteId === technique.fromNoteId
    )
      return fail("TECHNIQUE_CONFLICT", "同一音符只能使用一种泛音类型");

    if (
      isSingleNote(technique) &&
      isSingleNote(existing) &&
      technique.fromNoteId === existing.fromNoteId &&
      technique.type === existing.type
    )
      return fail("TECHNIQUE_CONFLICT", "同一音符不能重复添加该技巧");

    const techniqueIsLegato =
      isConnection(technique) &&
      (technique.type === "hammerOn" || technique.type === "pullOff");
    const existingIsLegato =
      isConnection(existing) &&
      (existing.type === "hammerOn" || existing.type === "pullOff");
    if (
      ((technique.type === "trill" && existingIsLegato) ||
        (existing.type === "trill" && techniqueIsLegato)) &&
      "fromNoteId" in technique &&
      "fromNoteId" in existing &&
      technique.fromNoteId === existing.fromNoteId
    )
      return fail("TECHNIQUE_CONFLICT", "颤音奏与同起点 H/P 不能重复表达");

    if (
      isBeatTechnique(technique) &&
      isBeatTechnique(existing) &&
      technique.beatId === existing.beatId &&
      ((technique.type === "strum" && existing.type === "arpeggio") ||
        (technique.type === "arpeggio" && existing.type === "strum"))
    )
      return fail("TECHNIQUE_CONFLICT", "同一和弦不能同时标记扫弦和琶音");

    if (
      isBeatRange(technique) &&
      isBeatRange(existing) &&
      technique.type !== existing.type
    ) {
      const leftStart = index.beatsById.get(technique.fromBeatId)?.order;
      const leftEnd = index.beatsById.get(technique.toBeatId)?.order;
      const rightStart = index.beatsById.get(existing.fromBeatId)?.order;
      const rightEnd = index.beatsById.get(existing.toBeatId)?.order;
      if (
        leftStart !== undefined &&
        leftEnd !== undefined &&
        rightStart !== undefined &&
        rightEnd !== undefined &&
        intervalsOverlap(leftStart, leftEnd, rightStart, rightEnd)
      )
        return fail(
          "TECHNIQUE_CONFLICT",
          "P.M. 与 Let Ring 的时间区间不能相交",
        );
    }
  }
  return { ok: true };
};

/**
 * 内容删除命令的引用清理 adapter。
 *
 * 它只移除因候选 track 内容变化而失效的既有技巧；add/update 绝不能调用它来
 * “修复”非法输入，而应把 validateTechnique 的错误原样返回给用户。
 */
export const pruneInvalidTechniques = (track: ILXMTrack): ILXMTrack => {
  const techniques: ILXMTechnique[] = [];
  for (const technique of track.techniques) {
    const candidateTrack = { ...track, techniques };
    if (validateTechnique(candidateTrack, technique).ok) techniques.push(technique);
  }
  return techniques.length === track.techniques.length
    ? track
    : { ...track, techniques };
};
