import { z } from "zod";
import {
  CURRENT_SCHEMA_VERSION,
  GUITAR_STRING_COUNT,
  MAX_FRET,
  SCORE_DOCUMENT_SCHEMA,
} from "./constants";

/** 基础时值枚举，实际 tick 由 rhythm 工具派生。 */
export const baseDurationSchema = z.enum([
  "whole",
  "half",
  "quarter",
  "eighth",
  "sixteenth",
  "thirtySecond",
]);

export const rhythmValueSchema = z
  .object({
    base: baseDurationSchema,
    dots: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  })
  .strict();

export const timeSignatureSchema = z
  .object({
    numerator: z.number().int().positive().max(32),
    denominator: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(4),
      z.literal(8),
      z.literal(16),
      z.literal(32),
    ]),
  })
  .strict();

export const tieLinkSchema = z
  .object({ targetNoteId: z.string().min(1) })
  .strict();

const relationTechniqueSchemas = [
  "hammerOn",
  "pullOff",
  "slideUp",
  "slideDown",
].map((type) =>
  z
    .object({
      type: z.literal(type as "hammerOn" | "pullOff" | "slideUp" | "slideDown"),
      targetNoteId: z.string().min(1),
    })
    .strict(),
);

/** 技巧必须使用 type 判别字段，禁止保存无法校验的松散对象。 */
export const techniqueSchema = z.discriminatedUnion("type", [
  relationTechniqueSchemas[0]!,
  relationTechniqueSchemas[1]!,
  relationTechniqueSchemas[2]!,
  relationTechniqueSchemas[3]!,
  z
    .object({
      type: z.literal("bend"),
      semitones: z.number().int().positive().max(24),
      release: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("vibrato"),
      width: z.enum(["small", "medium", "wide"]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("harmonic"),
      harmonicType: z.enum(["natural", "artificial"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("palmMute"),
      targetNoteId: z.string().min(1).optional(),
    })
    .strict(),
]);

export const tabNoteSchema = z
  .object({
    id: z.string().min(1),
    string: z.number().int().min(1).max(GUITAR_STRING_COUNT),
    fret: z.union([z.number().int().min(0).max(MAX_FRET), z.literal("x")]),
    techniques: z.array(techniqueSchema),
    tie: tieLinkSchema.optional(),
    ghost: z.boolean().optional(),
  })
  .strict();

const beatBaseShape = {
  id: z.string().min(1),
  tick: z.number().int().nonnegative(),
  rhythm: rhythmValueSchema,
};

export const noteBeatSchema = z
  .object({
    ...beatBaseShape,
    kind: z.literal("notes"),
    notes: z.array(tabNoteSchema).min(1),
  })
  .strict();

export const restBeatSchema = z
  .object({ ...beatBaseShape, kind: z.literal("rest") })
  .strict();
export const beatSchema = z.discriminatedUnion("kind", [
  noteBeatSchema,
  restBeatSchema,
]);

export const tupletGroupSchema = z
  .object({
    id: z.string().min(1),
    actualNotes: z.union([
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    normalNotes: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    beatIds: z.array(z.string().min(1)).min(2).max(6),
    bracket: z.enum(["auto", "show", "hide"]),
  })
  .strict();

export const lyricSegmentSchema = z
  .object({
    id: z.string().min(1),
    tick: z.number().int().nonnegative(),
    text: z.string(),
    syllable: z.enum(["single", "begin", "middle", "end"]).optional(),
  })
  .strict();

export const chordSymbolSchema = z
  .object({
    id: z.string().min(1),
    tick: z.number().int().nonnegative(),
    chordDefinitionId: z.string().min(1),
    label: z.string().min(1).optional(),
    display: z.enum(["nameAndDiagram", "nameOnly", "hidden"]),
  })
  .strict();

export const chordBarreSchema = z
  .object({
    fret: z.number().int().min(1).max(MAX_FRET),
    fromString: z.number().int().min(1).max(GUITAR_STRING_COUNT),
    toString: z.number().int().min(1).max(GUITAR_STRING_COUNT),
    finger: z.number().int().min(1).max(4).optional(),
  })
  .strict();

const chordFretSchema = z.union([
  z.number().int().min(0).max(MAX_FRET),
  z.literal("x"),
]);
const chordFingerSchema = z.union([z.number().int().min(1).max(4), z.null()]);

export const chordDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    frets: z.array(chordFretSchema).length(GUITAR_STRING_COUNT),
    fingers: z.array(chordFingerSchema).length(GUITAR_STRING_COUNT).optional(),
    baseFret: z.number().int().min(1).max(MAX_FRET).optional(),
    barres: z.array(chordBarreSchema).optional(),
  })
  .strict();

export const measureSchema = z
  .object({
    id: z.string().min(1),
    timeSignature: timeSignatureSchema.optional(),
    beats: z.array(beatSchema),
    tuplets: z.array(tupletGroupSchema),
    barline: z
      .enum(["single", "double", "final", "repeatStart", "repeatEnd"])
      .optional(),
    chordSymbols: z.array(chordSymbolSchema),
    lyrics: z.array(lyricSegmentSchema),
    pickup: z.boolean().optional(),
  })
  .strict();

export const guitarStringSchema = z
  .object({
    index: z.number().int().min(1).max(GUITAR_STRING_COUNT),
    pitch: z.string().regex(/^[A-G](?:#|b)?-?\d+$/),
    midi: z.number().int().min(0).max(127),
  })
  .strict();

export const trackSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    instrument: z.literal("guitar"),
    tuning: z
      .object({
        strings: z.array(guitarStringSchema).length(GUITAR_STRING_COUNT),
      })
      .strict(),
    measures: z.array(measureSchema),
  })
  .strict();

export const scoreSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    meta: z
      .object({
        tempo: z.number().int().min(20).max(400),
        timeSignature: timeSignatureSchema,
        keySignature: z.string().optional(),
        capo: z.number().int().min(0).max(MAX_FRET).optional(),
      })
      .strict(),
    tracks: z.array(trackSchema).min(1),
    chordLibrary: z.array(chordDefinitionSchema),
  })
  .strict();

export const lxmScoreDocumentSchema = z
  .object({
    schema: z.literal(SCORE_DOCUMENT_SCHEMA),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    documentRevision: z.number().int().nonnegative(),
    score: scoreSchema,
  })
  .strict();

export type BaseDuration = z.infer<typeof baseDurationSchema>;
export type RhythmValue = z.infer<typeof rhythmValueSchema>;
export type TimeSignature = z.infer<typeof timeSignatureSchema>;
export type TieLink = z.infer<typeof tieLinkSchema>;
export type Technique = z.infer<typeof techniqueSchema>;
export type TabNote = z.infer<typeof tabNoteSchema>;
export type NoteBeat = z.infer<typeof noteBeatSchema>;
export type RestBeat = z.infer<typeof restBeatSchema>;
export type Beat = z.infer<typeof beatSchema>;
export type TupletGroup = z.infer<typeof tupletGroupSchema>;
export type LyricSegment = z.infer<typeof lyricSegmentSchema>;
export type ChordSymbol = z.infer<typeof chordSymbolSchema>;
export type ChordBarre = z.infer<typeof chordBarreSchema>;
export type ChordDefinition = z.infer<typeof chordDefinitionSchema>;
export type Measure = z.infer<typeof measureSchema>;
export type GuitarString = z.infer<typeof guitarStringSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Score = z.infer<typeof scoreSchema>;
export type LxmScoreDocument = z.infer<typeof lxmScoreDocumentSchema>;
export type EditorMode = "select" | "note" | "technique" | "lyrics" | "chord";
