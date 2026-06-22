import type { Beat, Measure, Score, TabNote, Track } from "../core/schema";
import { validateScoreSemantics } from "../core/validation";
import { createValidationIssue } from "../core/validation-types";
import type {
  CommandResult,
  NoteTargetPayload,
  ScoreCommand,
} from "./command-types";

/** reducer 在命中拍点后缓存的上下文，避免重复查找轨道/小节/拍点。 */
interface TargetContext {
  track: Track;
  trackIndex: number;
  measure: Measure;
  measureIndex: number;
  beat: Beat;
  beatIndex: number;
}

const commandFailure = (
  code: string,
  message: string,
  targetId?: string,
): CommandResult<never> => ({
  ok: false,
  issues: [createValidationIssue(code, message, "command.payload", targetId)],
});

/** 统一定位命令目标，避免每个 reducer 重复散落查找逻辑。 */
const findTargetContext = (
  score: Score,
  payload: NoteTargetPayload,
): CommandResult<TargetContext> => {
  const trackIndex = score.tracks.findIndex(
    (track) => track.id === payload.trackId,
  );
  if (trackIndex < 0)
    return commandFailure(
      "TRACK_NOT_FOUND",
      "命令目标轨道不存在",
      payload.trackId,
    );
  const track = score.tracks[trackIndex]!;
  const measureIndex = track.measures.findIndex(
    (measure) => measure.id === payload.measureId,
  );
  if (measureIndex < 0) {
    return commandFailure(
      "MEASURE_NOT_FOUND",
      "命令目标小节不存在",
      payload.measureId,
    );
  }
  const measure = track.measures[measureIndex]!;
  const beatIndex = measure.beats.findIndex(
    (beat) => beat.id === payload.beatId,
  );
  if (beatIndex < 0)
    return commandFailure(
      "BEAT_NOT_FOUND",
      "命令目标拍点不存在",
      payload.beatId,
    );

  return {
    ok: true,
    value: {
      track,
      trackIndex,
      measure,
      measureIndex,
      beat: measure.beats[beatIndex]!,
      beatIndex,
    },
  };
};

const replaceMeasure = (
  score: Score,
  context: Pick<TargetContext, "trackIndex" | "measureIndex">,
  measure: Measure,
): Score => ({
  ...score,
  tracks: score.tracks.map((track, trackIndex) =>
    trackIndex === context.trackIndex
      ? {
          ...track,
          measures: track.measures.map((item, measureIndex) =>
            measureIndex === context.measureIndex ? measure : item,
          ),
        }
      : track,
  ),
});

const replaceBeat = (score: Score, context: TargetContext, beat: Beat): Score =>
  replaceMeasure(score, context, {
    ...context.measure,
    beats: context.measure.beats.map((item, beatIndex) =>
      beatIndex === context.beatIndex ? beat : item,
    ),
  });

const updateNote = (
  beat: Beat,
  noteId: string,
  updater: (note: TabNote) => TabNote,
): CommandResult<Beat> => {
  if (beat.kind !== "notes") {
    return commandFailure("NOTE_BEAT_REQUIRED", "目标拍点不是音符拍", beat.id);
  }
  const noteIndex = beat.notes.findIndex((note) => note.id === noteId);
  if (noteIndex < 0)
    return commandFailure("NOTE_NOT_FOUND", "命令目标音符不存在", noteId);
  return {
    ok: true,
    value: {
      ...beat,
      notes: beat.notes.map((note, index) =>
        index === noteIndex ? updater(note) : note,
      ),
    },
  };
};

const findTrackContext = (
  score: Score,
  trackId: string,
): CommandResult<{ track: Track; trackIndex: number }> => {
  const trackIndex = score.tracks.findIndex((track) => track.id === trackId);
  if (trackIndex < 0) {
    return commandFailure("TRACK_NOT_FOUND", "命令目标轨道不存在", trackId);
  }
  return { ok: true, value: { track: score.tracks[trackIndex]!, trackIndex } };
};

/**
 * 小节级命令的公共寻址逻辑。
 *
 * reducer 中不直接相信页面传入的 index，而是每次通过稳定 id 寻址。
 * 这样撤销、重排或复制小节后，页面缓存的视觉位置不会误写到错误小节。
 */
const findMeasureContext = (
  score: Score,
  payload: { trackId: string; measureId: string },
): CommandResult<{
  track: Track;
  trackIndex: number;
  measure: Measure;
  measureIndex: number;
}> => {
  const trackResult = findTrackContext(score, payload.trackId);
  if (!trackResult.ok) return trackResult;
  const { track, trackIndex } = trackResult.value;
  const measureIndex = track.measures.findIndex(
    (measure) => measure.id === payload.measureId,
  );
  if (measureIndex < 0) {
    return commandFailure(
      "MEASURE_NOT_FOUND",
      "命令目标小节不存在",
      payload.measureId,
    );
  }
  return {
    ok: true,
    value: {
      track,
      trackIndex,
      measure: track.measures[measureIndex]!,
      measureIndex,
    },
  };
};

const applyNoteAdd = (
  score: Score,
  command: Extract<ScoreCommand, { type: "note.add" }>,
) => {
  const contextResult = findTargetContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const context = contextResult.value;
  const nextBeat: Beat =
    context.beat.kind === "rest"
      ? { ...context.beat, kind: "notes", notes: [command.payload.note] }
      : {
          ...context.beat,
          notes: [...context.beat.notes, command.payload.note],
        };
  return { ok: true as const, value: replaceBeat(score, context, nextBeat) };
};

const applyNoteUpdateFret = (
  score: Score,
  command: Extract<ScoreCommand, { type: "note.updateFret" }>,
) => {
  const contextResult = findTargetContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const beatResult = updateNote(
    contextResult.value.beat,
    command.payload.noteId,
    (note) => ({
      ...note,
      fret: command.payload.fret,
    }),
  );
  if (!beatResult.ok) return beatResult;
  return {
    ok: true as const,
    value: replaceBeat(score, contextResult.value, beatResult.value),
  };
};

const applyNoteDelete = (
  score: Score,
  command: Extract<ScoreCommand, { type: "note.delete" }>,
) => {
  const contextResult = findTargetContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const { beat } = contextResult.value;
  if (beat.kind !== "notes")
    return commandFailure("NOTE_BEAT_REQUIRED", "目标拍点不是音符拍");
  if (!beat.notes.some((note) => note.id === command.payload.noteId)) {
    return commandFailure(
      "NOTE_NOT_FOUND",
      "命令目标音符不存在",
      command.payload.noteId,
    );
  }
  const remainingNotes = beat.notes.filter(
    (note) => note.id !== command.payload.noteId,
  );
  const nextBeat: Beat =
    remainingNotes.length > 0
      ? { ...beat, notes: remainingNotes }
      : { id: beat.id, tick: beat.tick, rhythm: beat.rhythm, kind: "rest" };
  return {
    ok: true as const,
    value: replaceBeat(score, contextResult.value, nextBeat),
  };
};

const applyBeatSetRhythm = (
  score: Score,
  command: Extract<ScoreCommand, { type: "beat.setRhythm" }>,
) => {
  const contextResult = findTargetContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  return {
    ok: true as const,
    value: replaceBeat(score, contextResult.value, {
      ...contextResult.value.beat,
      rhythm: command.payload.rhythm,
    }),
  };
};

const applyBeatSetRest = (
  score: Score,
  command: Extract<ScoreCommand, { type: "beat.setRest" }>,
) => {
  const contextResult = findTargetContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const { beat } = contextResult.value;
  /*
   * 休止拍在 schema 中没有 notes 字段。
   * 因此设置休止符时要重建 beat 对象，而不是保留原 notes 再切 kind，
   * 否则 Zod strict object 会把残留字段视为非法数据。
   */
  return {
    ok: true as const,
    value: replaceBeat(score, contextResult.value, {
      id: beat.id,
      tick: beat.tick,
      rhythm: beat.rhythm,
      kind: "rest",
    }),
  };
};

const applyBeatClearRest = (
  score: Score,
  command: Extract<ScoreCommand, { type: "beat.clearRest" }>,
) => {
  const contextResult = findTargetContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const { beat } = contextResult.value;
  if (beat.kind === "notes") {
    return commandFailure(
      "REST_BEAT_REQUIRED",
      "目标拍点已经是音符拍",
      beat.id,
    );
  }
  return {
    ok: true as const,
    value: replaceBeat(score, contextResult.value, {
      ...beat,
      kind: "notes",
      notes: [command.payload.note],
    }),
  };
};

const applyMeasureAdd = (
  score: Score,
  command: Extract<ScoreCommand, { type: "measure.add" }>,
) => {
  const trackResult = findTrackContext(score, command.payload.trackId);
  if (!trackResult.ok) return trackResult;
  const { track, trackIndex } = trackResult.value;
  const afterIndex = command.payload.afterMeasureId
    ? track.measures.findIndex(
        (measure) => measure.id === command.payload.afterMeasureId,
      )
    : track.measures.length - 1;
  if (command.payload.afterMeasureId && afterIndex < 0) {
    return commandFailure("MEASURE_NOT_FOUND", "插入位置对应的小节不存在");
  }
  const insertionIndex = afterIndex + 1;
  const nextMeasures = [...track.measures];
  nextMeasures.splice(insertionIndex, 0, command.payload.measure);
  return {
    ok: true as const,
    value: {
      ...score,
      tracks: score.tracks.map((item, index) =>
        index === trackIndex ? { ...item, measures: nextMeasures } : item,
      ),
    },
  };
};

const applyMeasureDelete = (
  score: Score,
  command: Extract<ScoreCommand, { type: "measure.delete" }>,
) => {
  const contextResult = findMeasureContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const { track, trackIndex, measureIndex } = contextResult.value;
  const nextMeasures = track.measures.filter(
    (_, index) => index !== measureIndex,
  );
  if (nextMeasures.length === 0) {
    /*
     * 轨道不能变成空数组：后续排版、命中和播放都默认至少存在一个小节。
     * fallbackMeasure 由工厂函数创建，页面层只决定删除意图，不拼装空白结构。
     */
    if (!command.payload.fallbackMeasure) {
      return commandFailure(
        "LAST_MEASURE_DELETE_REQUIRES_FALLBACK",
        "删除最后一个小节时必须提供合法空白小节",
        command.payload.measureId,
      );
    }
    nextMeasures.push(command.payload.fallbackMeasure);
  }
  return {
    ok: true as const,
    value: {
      ...score,
      tracks: score.tracks.map((item, index) =>
        index === trackIndex ? { ...item, measures: nextMeasures } : item,
      ),
    },
  };
};

const applyMeasureDuplicate = (
  score: Score,
  command: Extract<ScoreCommand, { type: "measure.duplicate" }>,
) => {
  const contextResult = findMeasureContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const { track, trackIndex, measureIndex } = contextResult.value;
  const nextMeasures = [...track.measures];
  nextMeasures.splice(measureIndex + 1, 0, command.payload.measure);
  return {
    ok: true as const,
    value: {
      ...score,
      tracks: score.tracks.map((item, index) =>
        index === trackIndex ? { ...item, measures: nextMeasures } : item,
      ),
    },
  };
};

const applyTupletSet = (
  score: Score,
  command: Extract<ScoreCommand, { type: "tuplet.set" }>,
) => {
  const contextResult = findMeasureContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const { measure } = contextResult.value;
  /*
   * 连音组按 id 做 upsert，方便工具栏重复点击时更新同一组。
   * 真正的连续性、容量和重叠校验仍交给 validateScoreSemantics 统一处理。
   */
  const nextMeasure: Measure = {
    ...measure,
    tuplets: measure.tuplets.some(
      (tuplet) => tuplet.id === command.payload.tuplet.id,
    )
      ? measure.tuplets.map((tuplet) =>
          tuplet.id === command.payload.tuplet.id
            ? command.payload.tuplet
            : tuplet,
        )
      : [...measure.tuplets, command.payload.tuplet],
  };
  return {
    ok: true as const,
    value: replaceMeasure(score, contextResult.value, nextMeasure),
  };
};

const applyTupletClear = (
  score: Score,
  command: Extract<ScoreCommand, { type: "tuplet.clear" }>,
) => {
  const contextResult = findMeasureContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const { measure } = contextResult.value;
  if (!measure.tuplets.some((tuplet) => tuplet.id === command.payload.tupletId)) {
    return commandFailure(
      "TUPLET_NOT_FOUND",
      "命令目标连音组不存在",
      command.payload.tupletId,
    );
  }
  return {
    ok: true as const,
    value: replaceMeasure(score, contextResult.value, {
      ...measure,
      tuplets: measure.tuplets.filter(
        (tuplet) => tuplet.id !== command.payload.tupletId,
      ),
    }),
  };
};

const applyTechnique = (
  score: Score,
  command: Extract<ScoreCommand, { type: "technique.apply" }>,
) => {
  const contextResult = findTargetContext(score, command.payload);
  if (!contextResult.ok) return contextResult;
  const beatResult = updateNote(
    contextResult.value.beat,
    command.payload.noteId,
    (note) => ({
      ...note,
      techniques: [
        ...note.techniques.filter(
          (technique) => technique.type !== command.payload.technique.type,
        ),
        command.payload.technique,
      ],
    }),
  );
  if (!beatResult.ok) return beatResult;
  return {
    ok: true as const,
    value: replaceBeat(score, contextResult.value, beatResult.value),
  };
};

const applyChordUpsert = (
  score: Score,
  command: Extract<ScoreCommand, { type: "chord.upsert" }>,
) => {
  const trackIndex = score.tracks.findIndex(
    (track) => track.id === command.payload.trackId,
  );
  if (trackIndex < 0)
    return commandFailure("TRACK_NOT_FOUND", "命令目标轨道不存在");
  const track = score.tracks[trackIndex]!;
  const measureIndex = track.measures.findIndex(
    (measure) => measure.id === command.payload.measureId,
  );
  if (measureIndex < 0)
    return commandFailure("MEASURE_NOT_FOUND", "命令目标小节不存在");
  const measure = track.measures[measureIndex]!;
  const upsert = <T extends { id: string }>(items: T[], item: T): T[] =>
    items.some((current) => current.id === item.id)
      ? items.map((current) => (current.id === item.id ? item : current))
      : [...items, item];
  const nextScore: Score = {
    ...score,
    chordLibrary: upsert(score.chordLibrary, command.payload.definition),
    tracks: score.tracks.map((currentTrack, currentTrackIndex) =>
      currentTrackIndex === trackIndex
        ? {
            ...currentTrack,
            measures: currentTrack.measures.map(
              (currentMeasure, currentMeasureIndex) =>
                currentMeasureIndex === measureIndex
                  ? {
                      ...measure,
                      chordSymbols: upsert(
                        measure.chordSymbols,
                        command.payload.symbol,
                      ),
                    }
                  : currentMeasure,
            ),
          }
        : currentTrack,
    ),
  };
  return { ok: true as const, value: nextScore };
};

/**
 * 单条 Command 的不可变纯函数 reducer。
 *
 * 它先执行命令，再统一跑语义校验；只有通过校验的新 score 才会向外返回。
 */
export const reduceScoreCommand = (
  score: Score,
  command: ScoreCommand,
): CommandResult<Score> => {
  const result = (() => {
    switch (command.type) {
      case "note.add":
        return applyNoteAdd(score, command);
      case "note.updateFret":
        return applyNoteUpdateFret(score, command);
      case "note.delete":
        return applyNoteDelete(score, command);
      case "beat.setRhythm":
        return applyBeatSetRhythm(score, command);
      case "beat.setRest":
        return applyBeatSetRest(score, command);
      case "beat.clearRest":
        return applyBeatClearRest(score, command);
      case "measure.add":
        return applyMeasureAdd(score, command);
      case "measure.delete":
        return applyMeasureDelete(score, command);
      case "measure.duplicate":
        return applyMeasureDuplicate(score, command);
      case "tuplet.set":
        return applyTupletSet(score, command);
      case "tuplet.clear":
        return applyTupletClear(score, command);
      case "technique.apply":
        return applyTechnique(score, command);
      case "chord.upsert":
        return applyChordUpsert(score, command);
    }
  })();
  if (!result.ok) return result;
  const issues = validateScoreSemantics(result.value).filter(
    (issue) => issue.level === "error",
  );
  return issues.length > 0 ? { ok: false, issues } : result;
};

/**
 * 多条命令的事务入口。
 *
 * 调用方传入顺序即执行顺序；任一命令失败时立即停止，并丢弃此前的中间结果。
 */
export const reduceScoreTransaction = (
  score: Score,
  commands: ScoreCommand[],
): CommandResult<Score> => {
  let nextScore = score;
  for (const command of commands) {
    const result = reduceScoreCommand(nextScore, command);
    if (!result.ok) return result;
    nextScore = result.value;
  }
  return { ok: true, value: nextScore };
};
