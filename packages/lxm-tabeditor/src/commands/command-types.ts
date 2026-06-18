import type {
  ChordDefinition,
  ChordSymbol,
  Measure,
  TabNote,
  Technique,
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

export interface AddMeasurePayload {
  trackId: string;
  afterMeasureId?: string;
  measure: Measure;
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
  | { type: "measure.add"; payload: AddMeasurePayload }
  | { type: "technique.apply"; payload: ApplyTechniquePayload }
  | { type: "chord.upsert"; payload: UpsertChordPayload };

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };
