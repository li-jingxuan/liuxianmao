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

export interface NoteTargetPayload {
  trackId: string;
  measureId: string;
  beatId: string;
}

export interface AddNotePayload extends NoteTargetPayload {
  note: TabNote;
}

export interface UpdateFretPayload extends NoteTargetPayload {
  noteId: string;
  fret: TabNote["fret"];
}

export interface DeleteNotePayload extends NoteTargetPayload {
  noteId: string;
}

export interface SetBeatRhythmPayload extends NoteTargetPayload {
  rhythm: RhythmValue;
}

export type SetBeatRestPayload = NoteTargetPayload;

export interface ClearBeatRestPayload extends NoteTargetPayload {
  note: TabNote;
}

export interface AddMeasurePayload {
  trackId: string;
  afterMeasureId?: string;
  measure: Measure;
}

export interface DeleteMeasurePayload {
  trackId: string;
  measureId: string;
  fallbackMeasure?: Measure;
}

export interface DuplicateMeasurePayload {
  trackId: string;
  measureId: string;
  measure: Measure;
}

export interface TupletPayload {
  trackId: string;
  measureId: string;
}

export interface SetTupletPayload extends TupletPayload {
  tuplet: TupletGroup;
}

export interface ClearTupletPayload extends TupletPayload {
  tupletId: string;
}

export interface ApplyTechniquePayload extends NoteTargetPayload {
  noteId: string;
  technique: Technique;
}

export interface UpsertChordPayload {
  trackId: string;
  measureId: string;
  definition: ChordDefinition;
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

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };
