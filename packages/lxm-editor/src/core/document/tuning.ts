import { STANDARD_GUITAR_TUNING } from "../constants";
import type { ILXMTuning } from "../types";
/** 将音名转换为 MIDI，供调弦命令校验 pitch/midi 一致性。 */
export const parsePitchMidi = (pitch: string): number | null => {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(pitch.trim());
  if (!match) return null;
  const semitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const base = semitones[match[1]!.toUpperCase()];
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const octave = Number(match[3]);
  const midi = (octave + 1) * 12 + base + accidental;
  return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : null;
};

/** 六弦形状与音高使用一个校验入口，加载和编辑遵循同一规则。 */
export const validateTuning = (tuning: ILXMTuning): boolean =>
  tuning.strings.length === 6 &&
  tuning.strings.every(
    (s, i) =>
      s.index === i + 1 &&
      parsePitchMidi(s.pitch) !== null &&
      parsePitchMidi(s.pitch) === s.midi,
  );
/** 非标准调弦也按 1 弦到 6 弦排列。 */
const alternativeTunings = {
  dropD: ["E4", "B3", "G3", "D3", "A2", "D2"],
  halfStepDown: ["Eb4", "Bb3", "Gb3", "Db3", "Ab2", "Eb2"],
  openG: ["D4", "B3", "G3", "D3", "G2", "D2"],
  dadgad: ["D4", "A3", "G3", "D3", "A2", "D2"],
} as const;

export type GuitarTuningPreset = "standard" | keyof typeof alternativeTunings;

/** 预设返回独立值，调用方不能污染公共常量。 */
export const createTuningPreset = (preset: GuitarTuningPreset): ILXMTuning => ({
  strings: preset === "standard"
    ? STANDARD_GUITAR_TUNING.map((string) => ({ ...string }))
    : alternativeTunings[preset].map((pitch, index) => ({
        index: index + 1,
        pitch,
        midi: parsePitchMidi(pitch)!,
      })),
});
