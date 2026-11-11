import { LXM_KEY_SIGNATURES } from "../constants";
import type { ILXMDocument, ILXMKeySignature } from "../types";

export const SCORE_TONALITY_NAMESPACE = "lxm:tonality";
export type SpelledTonic = string;
export type ScoreTonalityV1 =
  | { version: 1; tonic: SpelledTonic; mode: "major" }
  | { version: 1; tonic: SpelledTonic; mode: "minor"; minorTonicDegree: 1 | 6 };

const naturalPc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Spelling and pitch class are separate facts; retain the original spelling. */
export const parseSpelledTonic = (value: unknown): { tonicPc: number; tonicSpelling: string } | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll("♯", "#").replaceAll("♭", "b").replaceAll("𝄪", "##").replaceAll("𝄫", "bb");
  const match = /^([A-G])(#{1,2}|b{1,2})?$/.exec(normalized);
  if (!match) return null;
  const accidental = match[2] ?? "";
  const offset = accidental.startsWith("#") ? accidental.length : -accidental.length;
  return { tonicPc: (naturalPc[match[1]!]! + offset + 12) % 12, tonicSpelling: value };
};

/** JSON content equality: object order is immaterial, array order is meaningful. */
export const semanticJsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, i) => semanticJsonEqual(item, right[i]));
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every((key) => Object.hasOwn(right, key) && semanticJsonEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
};

export const validateScoreTonality = (raw: unknown): string | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "调性资料必须是对象。";
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) return "调性资料版本必须为 1。";
  if (!parseSpelledTonic(value.tonic)) return "主音拼写不合法，请使用 C、F#、Gb 或 Bbb 等拼写。";
  if (value.mode !== "major" && value.mode !== "minor") return "请选择大调或小调。";
  if (value.mode === "minor" && value.minorTonicDegree !== 1 && value.minorTonicDegree !== 6) return "小调必须明确主音记作 1 或 6。";
  const keys = value.mode === "minor" ? ["version", "tonic", "mode", "minorTonicDegree"] : ["version", "tonic", "mode"];
  if (Object.keys(value).some((key) => !keys.includes(key))) return "调性资料含有未知字段。";
  return null;
};

export const keySignatureForTonality = (tonality: ScoreTonalityV1): ILXMKeySignature => {
  const tonic = parseSpelledTonic(tonality.tonic);
  if (!tonic || validateScoreTonality(tonality)) throw new Error("无效的曲谱调性资料");
  return LXM_KEY_SIGNATURES[(tonic.tonicPc + (tonality.mode === "minor" && tonality.minorTonicDegree === 6 ? 3 : 0)) % 12]!;
};
export const tonalityMatchesKeySignature = (tonality: ScoreTonalityV1, key: ILXMKeySignature | null): boolean =>
  key !== null && parseSpelledTonic(key)?.tonicPc === parseSpelledTonic(keySignatureForTonality(tonality))?.tonicPc;

export type ScoreTonalityContext = { tonicPc: number; tonicSpelling: string; mode: "major" | "minor" };
export type ScoreTonalityReadResult =
  | ({ kind: "confirmed"; title: string; tonality: ScoreTonalityV1; key: ScoreTonalityContext } & ScoreTonalityContext)
  | { kind: "unconfirmed" | "unset"; title: string }
  | { kind: "invalid" | "unsupported" | "conflict"; title: string; reason: string };

/** Pure reader; malformed or future extensions never become inferred major keys. */
export const readScoreTonality = (document: ILXMDocument): ScoreTonalityReadResult => {
  const { meta, keySignature } = document.score;
  if (!Object.hasOwn(meta, SCORE_TONALITY_NAMESPACE)) return keySignature === null
    ? { kind: "unset", title: "曲谱调性未设置" }
    : { kind: "unconfirmed", title: `曲谱 1=${keySignature} · 大小调未确认` };
  const raw = meta[SCORE_TONALITY_NAMESPACE];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const version = (raw as Record<string, unknown>).version;
    if (typeof version === "number" && Number.isInteger(version) && version !== 1)
      return { kind: "unsupported", title: "曲谱调性版本暂不支持", reason: `暂不支持调性资料版本 ${version}。` };
  }
  const reason = validateScoreTonality(raw);
  if (reason) return { kind: "invalid", title: "曲谱调性资料无效", reason };
  const tonality = raw as ScoreTonalityV1;
  if (!tonalityMatchesKeySignature(tonality, keySignature)) return { kind: "conflict", title: "曲谱调性信息冲突", reason: `此调性要求 1=${keySignatureForTonality(tonality)}，请成组修复曲谱信息。` };
  const key = { ...parseSpelledTonic(tonality.tonic)!, mode: tonality.mode };
  return { kind: "confirmed", title: `曲谱 ${tonality.tonic}${tonality.mode === "major" ? "大调" : "小调"}`, tonality: structuredClone(tonality), key, ...key };
};
