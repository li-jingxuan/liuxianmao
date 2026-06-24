import type {
  ChordDefinition,
  ChordSymbol,
  Measure,
  RhythmValue,
  TabNote,
  Technique,
  TupletGroup,
} from "../core/schema";
import type { ValidationIssue } from "../core/validation-types";

/** 时间线命令共享的定位信息：可指向真实 beat 起点，也可指向 beat 内部 slot。 */
export interface TimelineTargetPayload {
  /** 目标轨道 id。 */
  trackId: string;
  /** 目标小节 id。 */
  measureId: string;
  /** 覆盖当前 tick 的真实拍点 id；slot 写入时它不是目标 tick，只是 materialize 的来源。 */
  beatId?: string;
  /** 小节内目标 tick。旧调用方不传时默认使用 beat.tick。 */
  tick?: number;
}

/** 音符级命令共享的定位信息：唯一锁定到某条轨道的小节拍点。 */
export interface NoteTargetPayload extends TimelineTargetPayload {
  /** 目标拍点 id。 */
  beatId: string;
}

/** 在目标拍点追加一个完整音符对象。 */
export interface AddNotePayload extends TimelineTargetPayload {
  /** 待写入的音符快照，由页面或工厂函数提前构造完成。 */
  note: TabNote;
  /** slot 写入时用于 materialize 真实 beat 的目标时值。 */
  rhythm?: RhythmValue;
}

/** 更新指定音符的品位，不改动弦号与技巧信息。 */
export interface UpdateFretPayload extends NoteTargetPayload {
  /** 目标音符 id。 */
  noteId: string;
  /** 新品位，支持数字品位或闷音 x。 */
  fret: TabNote["fret"];
}

/** 从目标拍点删除一个音符。 */
export interface DeleteNotePayload extends NoteTargetPayload {
  /** 待删除音符 id。 */
  noteId: string;
}

/** 修改拍点时值，保持拍点是音符拍还是休止拍的种类不变。 */
export interface SetBeatRhythmPayload extends TimelineTargetPayload {
  /** 新的时值定义。 */
  rhythm: RhythmValue;
}

/** 将目标拍点改写为休止拍，只需要定位信息即可。 */
export type SetBeatRestPayload = TimelineTargetPayload & {
  rhythm?: RhythmValue;
};

/** 把休止拍恢复成音符拍，并写入第一个音符。 */
export interface ClearBeatRestPayload extends NoteTargetPayload {
  /** 清除休止后落入拍点的首个音符。 */
  note: TabNote;
}

/** 在轨道中插入一个小节。 */
export interface AddMeasurePayload {
  /** 目标轨道 id。 */
  trackId: string;
  /** 插入位置之后的小节 id；为空时默认追加到末尾。 */
  afterMeasureId?: string;
  /** 预先构造好的完整小节快照。 */
  measure: Measure;
}

/** 删除轨道中的一个小节。 */
export interface DeleteMeasurePayload {
  /** 目标轨道 id。 */
  trackId: string;
  /** 待删除小节 id。 */
  measureId: string;
  /** 删除最后一个小节时使用的兜底空白小节。 */
  fallbackMeasure?: Measure;
}

/** 复制一个小节时携带的新小节快照。 */
export interface DuplicateMeasurePayload {
  /** 目标轨道 id。 */
  trackId: string;
  /** 被复制来源小节 id。 */
  measureId: string;
  /** 新生成的小节快照，通常由页面层预先分配新 id。 */
  measure: Measure;
}

/** 小节级连音命令共享的寻址信息。 */
export interface TupletPayload {
  /** 目标轨道 id。 */
  trackId: string;
  /** 目标小节 id。 */
  measureId: string;
}

/** 在目标小节写入或更新一个连音组。 */
export interface SetTupletPayload extends TupletPayload {
  /** 完整连音组数据。 */
  tuplet: TupletGroup;
}

/** 从目标小节清除一个连音组。 */
export interface ClearTupletPayload extends TupletPayload {
  /** 待清除连音组 id。 */
  tupletId: string;
}

/** 给某个音符应用或替换一种技巧。 */
export interface ApplyTechniquePayload extends NoteTargetPayload {
  /** 目标音符 id。 */
  noteId: string;
  /** 技巧快照；同 type 的旧技巧会被替换。 */
  technique: Technique;
}

/** 在小节中写入和弦符号，并同步更新和弦库定义。 */
export interface UpsertChordPayload {
  /** 目标轨道 id。 */
  trackId: string;
  /** 目标小节 id。 */
  measureId: string;
  /** 和弦图库定义，供图示与复用使用。 */
  definition: ChordDefinition;
  /** 小节时间线上显示的和弦符号。 */
  symbol: ChordSymbol;
}

/** Iteration 1 固化的领域命令集合。 */
export type ScoreCommand =
  | { type: "note.add"; payload: AddNotePayload }
  | { type: "note.updateFret"; payload: UpdateFretPayload }
  | { type: "note.delete"; payload: DeleteNotePayload }
  | { type: "beat.setRhythm"; payload: SetBeatRhythmPayload }
  | { type: "beat.setRest"; payload: SetBeatRestPayload }
  | { type: "beat.clearRest"; payload: ClearBeatRestPayload }
  | { type: "measure.add"; payload: AddMeasurePayload }
  | { type: "measure.delete"; payload: DeleteMeasurePayload }
  | { type: "measure.duplicate"; payload: DuplicateMeasurePayload }
  | { type: "tuplet.set"; payload: SetTupletPayload }
  | { type: "tuplet.clear"; payload: ClearTupletPayload }
  | { type: "technique.apply"; payload: ApplyTechniquePayload }
  | { type: "chord.upsert"; payload: UpsertChordPayload };

/** 命令执行统一返回：成功时给出下一份 score，失败时返回可展示的问题列表。 */
export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };
