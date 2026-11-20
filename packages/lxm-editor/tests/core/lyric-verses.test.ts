import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  EXAMPLE_MVP_7_2_DOCUMENT,
  getLyricVerseCount,
  getMusicTextRows,
  loadDocument,
  LXMScoreCommandEnum as C,
} from "../../src";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  for (const track of document.score.tracks)
    for (const measure of track.measures) measure.lyrics = [];
  delete document.score.meta.lyricVerseCount;
  return document;
};

describe("全谱歌词段落", () => {
  it("旧文档至少一段，并从所有轨道已有歌词与有效元数据取最大段号", () => {
    const document = fixture();
    expect(getLyricVerseCount(document)).toBe(1);
    document.score.meta.lyricVerseCount = 2;
    expect(getLyricVerseCount(document)).toBe(2);
    const other = structuredClone(document.score.tracks[0]!);
    document.score.tracks.push(other);
    other.measures[0]!.lyrics = [{
      id: "legacy-verse-3",
      eventId: other.measures[0]!.numberedVoice.events[0]!.id,
      verse: 3,
      text: "第三段",
    }];
    expect(getLyricVerseCount(document)).toBe(3);
    document.score.meta.lyricVerseCount = 4;
    expect(getLyricVerseCount(document)).toBe(4);
  });

  it.each([null, "4", 0, 5, 2.5, {}, []])("忽略旧文档无效元数据 %j", (value) => {
    const document = fixture();
    document.score.meta.lyricVerseCount = value;
    expect(getLyricVerseCount(document)).toBe(1);
  });

  it("新增空段形成独立不可变历史快照，持久化往返并在四段封顶", () => {
    const initial = fixture();
    initial.score.meta.custom = { preserve: true };
    const snapshots = [initial];
    let document = initial;
    for (const count of [2, 3, 4]) {
      const result = applyScoreCommand(document, {
        type: C.AddLyricVerse,
        expectedRevision: document.documentRevision,
      });
      if (!result.ok) throw new Error(result.message);
      expect(result.changed).toBe(true);
      expect(result.document.score.tracks).toEqual(initial.score.tracks);
      expect(result.document.score.meta.custom).toEqual({ preserve: true });
      expect(result.document.documentRevision).toBe(document.documentRevision + 1);
      const loaded = loadDocument(JSON.stringify(result.document));
      if (!loaded.ok) throw new Error("新增空段持久化失败");
      expect(getLyricVerseCount(loaded.document)).toBe(count);
      document = result.document;
      snapshots.push(document);
    }
    expect(snapshots.map(getLyricVerseCount)).toEqual([1, 2, 3, 4]);
    expect(initial.score.meta).not.toHaveProperty("lyricVerseCount");
    expect(applyScoreCommand(document, { type: C.AddLyricVerse })).toEqual({ ok: true, changed: false, document });
    expect(applyScoreCommand(document, { type: C.AddLyricVerse, expectedRevision: initial.documentRevision }).ok).toBe(false);
  });

  it("从旧歌词推断后继续新增，不覆盖已有歌词", () => {
    const document = fixture();
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.lyrics = [{ id: "existing-verse", eventId: measure.numberedVoice.events[0]!.id, verse: 3, text: "已有" }];
    const result = applyScoreCommand(document, { type: C.AddLyricVerse });
    if (!result.ok) throw new Error(result.message);
    expect(getLyricVerseCount(result.document)).toBe(4);
    expect(result.document.score.tracks).toEqual(document.score.tracks);
    expect(document.score.meta).not.toHaveProperty("lyricVerseCount");
  });

  it("删除旧谱中间段，保留后续段歌词身份并顺次补位", () => {
    const document = fixture();
    const [first, second] = document.score.tracks[0]!.measures;
    first!.lyrics = [{ id: "deleted-word", eventId: first!.numberedVoice.events[0]!.id, verse: 2, text: "删除" }];
    const remaining = { id: "shifted-word", eventId: second!.numberedVoice.events[0]!.id, verse: 3 as const, text: "保留" };
    second!.lyrics = [remaining];
    const result = applyScoreCommand(document, { type: C.RemoveLyricVerse, verse: 2 });
    if (!result.ok) throw new Error(result.message);
    expect(result.document.score.tracks[0]!.measures[0]!.lyrics).toEqual([]);
    expect(result.document.score.tracks[0]!.measures[1]!.lyrics).toEqual([{ ...remaining, verse: 2 }]);
    expect(second!.lyrics).toEqual([remaining]);
    expect(getMusicTextRows(result.document).lyricVerses).toBe(2);

    const shifted = applyScoreCommand(result.document, { type: C.RemoveLyricVerse, verse: 1 });
    if (!shifted.ok) throw new Error(shifted.message);
    const empty = applyScoreCommand(shifted.document, { type: C.RemoveLyricVerse, verse: 1 });
    if (!empty.ok) throw new Error(empty.message);
    expect(getMusicTextRows(empty.document).lyricVerses).toBe(0);
    expect(empty.document.score.meta).not.toHaveProperty("lyricVerseCount");
    expect(applyScoreCommand(empty.document, { type: C.RemoveLyricVerse, verse: 1 })).toEqual({ ok: true, changed: false, document: empty.document });
  });
});
