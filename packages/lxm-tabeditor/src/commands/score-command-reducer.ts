import type { Beat, Measure, Score, TabNote, Track } from "../core/schema";
import { validateScoreSemantics } from "../core/validation";
import { createValidationIssue } from "../core/validation-types";
import type {
  CommandResult,
  NoteTargetPayload,
  ScoreCommand,
} from "./command-types";

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

const applyMeasureAdd = (
  score: Score,
  command: Extract<ScoreCommand, { type: "measure.add" }>,
) => {
  const trackIndex = score.tracks.findIndex(
    (track) => track.id === command.payload.trackId,
  );
  if (trackIndex < 0)
    return commandFailure("TRACK_NOT_FOUND", "命令目标轨道不存在");
  const track = score.tracks[trackIndex]!;
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

/** 单条 Command 的不可变纯函数 reducer。 */
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
      case "measure.add":
        return applyMeasureAdd(score, command);
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

/** 多条命令只返回最终 score；中途失败时不泄漏任何部分结果。 */
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
