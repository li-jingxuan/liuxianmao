import {
  CURRENT_SCHEMA_VERSION, LXM_EDITABLE_TIME_SIGNATURES, SCORE_DOCUMENT_SCHEMA,
  SCORE_TONALITY_NAMESPACE, TICKS_PER_QUARTER,
  createTuningPreset, keySignatureForTonality, type GuitarTuningPreset,
  type ILXMDocument, type ILXMTimeSignature, type ScoreTonalityV1,
} from "@liuxianmao/lxm-editor";

export const newScoreTonics = {
  major: ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"],
  minor: ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"],
};

export const newScoreSignatures = LXM_EDITABLE_TIME_SIGNATURES.filter(({ numerator }) => numerator !== 2);
export const displaySignature = ({ numerator, denominator }: ILXMTimeSignature) => `${numerator}/${denominator}`;

export function createBlankScore({ title, arranger, tonality, timeSignature, tuning = "standard" }: {
  title: string;
  arranger: string;
  tonality: ScoreTonalityV1;
  timeSignature: ILXMTimeSignature;
  tuning?: GuitarTuningPreset;
}): ILXMDocument {
  const { numerator, denominator } = timeSignature;
  const unitTicks = TICKS_PER_QUARTER * 4 / denominator;
  return {
    schema: SCORE_DOCUMENT_SCHEMA,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentRevision: 1,
    score: {
      id: `score-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      title: title.trim(),
      arranger: arranger.trim(),
      keySignature: keySignatureForTonality(tonality),
      meta: { [SCORE_TONALITY_NAMESPACE]: tonality },
      tracks: [{
        id: "guitar", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
        tuning: createTuningPreset(tuning),
        techniques: [], numberedMarks: [],
        measures: Array.from({ length: 4 }, (_, index) => ({
          id: `measure-${index + 1}`,
          timeSignature: { ...timeSignature },
          barline: "single",
          chordSymbols: [], lyrics: [], tuplets: [], numberedVoice: { events: [], tuplets: [] },
          // TAB uses empty note slots for hit testing and entry, with no written rests.
          beats: Array.from({ length: numerator }, (_, beat) => ({
            id: `beat-${index + 1}-${beat + 1}`,
            tick: beat * unitTicks,
            rhythm: { base: denominator === 8 ? "eighth" : "quarter", dots: 0 },
            kind: "notes",
            notes: [],
          })),
        })),
      }],
    },
  };
}
