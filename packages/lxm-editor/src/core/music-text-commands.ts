import { normalizeMusicText } from "./music-text";
import { cloneChordDiagram } from "./chord-diagram";
import { LXMChordSymbolSchema } from "./schema";
import type { ILXMIdFactory } from "./id-factory";
import type {
  ILXMMusicTextCommand,
  ILXMScoreCommandErrorCode,
} from "./commands";
import type { ILXMMeasure, ILXMLyric } from "./types";

type Result =
  | { ok: true; changed: boolean; measure: ILXMMeasure }
  | { ok: false; code: ILXMScoreCommandErrorCode; message: string };

/** 在候选小节内原子编辑；文档 revision 和历史仍由统一分发器负责。 */
export const editMeasureMusicText = (
  measure: ILXMMeasure,
  command: ILXMMusicTextCommand,
  factory: ILXMIdFactory,
): Result => {
  const fail = (code: ILXMScoreCommandErrorCode, message: string): Result => ({
    ok: false,
    code,
    message,
  });
  if (
    command.type === "lyric.remove" ||
    command.type === "chordSymbol.remove"
  ) {
    const lyric = command.type === "lyric.remove";
    const field = lyric ? "lyrics" : "chordSymbols";
    const id = lyric ? command.lyricId : command.chordSymbolId;
    if (!measure[field].some((item) => item.id === id))
      return fail(
        lyric ? "LYRIC_NOT_FOUND" : "CHORD_SYMBOL_NOT_FOUND",
        "目标音乐文本不存在",
      );
    return {
      ok: true,
      changed: true,
      measure: {
        ...measure,
        [field]: measure[field].filter((item) => item.id !== id),
      },
    };
  }
  if (!measure.beats.some((beat) => beat.id === command.beatId))
    return fail("MUSIC_TEXT_BEAT_NOT_FOUND", "文本目标 Beat 不存在于该小节");
  const byBeat = new Map(measure.beats.map((beat, index) => [beat.id, index]));
  if (command.type === "lyric.set") {
    if (![1, 2, 3, 4].includes(command.verse))
      return fail("INVALID_LYRIC_VERSE", "歌词段号应为 1–4");
    const text = normalizeMusicText(command.text, 64);
    if (text === null)
      return fail("INVALID_LYRIC_TEXT", "歌词须为单行非空文字，最多 64 个字符");
    const existing = measure.lyrics.find(
      (item) => item.beatId === command.beatId && item.verse === command.verse,
    );
    if (existing?.text === text) return { ok: true, changed: false, measure };
    const item: ILXMLyric = {
      id: existing?.id ?? factory.createLyricId(),
      beatId: command.beatId,
      verse: command.verse,
      text,
    };
    const lyrics = [
      ...measure.lyrics.filter((other) => other !== existing),
      item,
    ].sort(
      (a, b) =>
        byBeat.get(a.beatId)! - byBeat.get(b.beatId)! || a.verse - b.verse,
    );
    return { ok: true, changed: true, measure: { ...measure, lyrics } };
  }
  const name = normalizeMusicText(command.chord.name, 32);
  if (name === null)
    return fail("INVALID_CHORD_NAME", "和弦名须为单行非空文字，最多 32 个字符");
  const existing = measure.chordSymbols.find(
    (item) => item.beatId === command.beatId,
  );
  const draft = {
    id: existing?.id ?? "candidate",
    beatId: command.beatId,
    display: command.display,
    chord: { ...command.chord, name },
  };
  const parsed = LXMChordSymbolSchema.safeParse(draft);
  if (!parsed.success)
    return fail(
      "INVALID_CHORD_DIAGRAM",
      parsed.error.issues[0]?.message ?? "指法图无效",
    );
  if (
    existing &&
    JSON.stringify(existing.chord) === JSON.stringify(draft.chord) &&
    existing.display === draft.display
  )
    return { ok: true, changed: false, measure };
  const symbol = {
    ...draft,
    id: existing?.id ?? factory.createChordSymbolId(),
    chord: {
      name,
      diagram: draft.chord.diagram
        ? cloneChordDiagram(draft.chord.diagram)
        : null,
    },
  };
  const chordSymbols = [
    ...measure.chordSymbols.filter((other) => other !== existing),
    symbol,
  ].sort((a, b) => byBeat.get(a.beatId)! - byBeat.get(b.beatId)!);
  return { ok: true, changed: true, measure: { ...measure, chordSymbols } };
};
