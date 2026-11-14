import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  parseLyricSequence,
  planLyricSequence,
  applyScoreCommand,
  LXMScoreCommandEnum as C,
  loadDocument,
  type ILXMScoreCommand,
  type LyricSequenceItem,
} from "../../src";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures.forEach((m) => {
    m.lyrics = [];
    m.numberedVoice = {
      events: m.beats.map((beat) => ({
        id: `event-${beat.id}`,
        tick: beat.tick,
        rhythm: { ...beat.rhythm },
        kind: "notes",
        items: [{ id: `item-${beat.id}`, token: "1" }],
      })),
      tuplets: m.tuplets.map((group) => ({
        id: `numbered-${group.id}`,
        ratio: { ...group.ratio },
        eventIds: group.beatIds.map((beatId) => `event-${beatId}`),
      })),
    };
  });
  track.numberedMarks = [];
  const m = track.measures[0]!;
  const target = {
    trackId: track.id,
    measureId: m.id,
    eventId: m.numberedVoice.events.at(-1)!.id,
    verse: 2 as const,
  };
  return { document, track, target };
};
const run = (
  document: ReturnType<typeof fixture>["document"],
  command: ILXMScoreCommand,
) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(result.message);
  return result;
};
const items = (raw: string) => {
  const result = parseLyricSequence(raw);
  if (!result.ok) throw new Error(result.message);
  return result.items;
};

describe("连续填词语法与原子领域命令", () => {
  it("半角/全角、重复、首尾空格合并；独立下划线清空，NFC 与码点规范化", () => {
    expect(items("  风　 _   e\u0301 a_b __ | ")).toEqual([
      { kind: "set", text: "风" },
      { kind: "clear" },
      { kind: "set", text: "é" },
      { kind: "set", text: "a_b" },
      { kind: "set", text: "__" },
      { kind: "set", text: "|" },
    ]);
    expect(items("Sing a song")).toHaveLength(3);
    expect(items("风吹  过山岗")).toEqual([
      { kind: "set", text: "风吹" },
      { kind: "set", text: "过山岗" },
    ]);
    expect(items("😀".repeat(64))).toHaveLength(1);
  });
  it.each([
    "风\n过",
    "风\t过",
    "\r风",
    "风\u00a0过",
    "风\u2028过",
    "风\u0000过",
    "x".repeat(65),
    "风 ".repeat(257),
    " ".repeat(16385),
  ])("拒绝无效或超限输入 %j", (raw) => {
    expect(parseLyricSequence(raw).ok).toBe(false);
  });
  it.each(["", " ", "　   ", "_"])("%j 只清空当前位置的当前段，保留其他位置和段落", (raw) => {
    const { document, track, target } = fixture();
    const first = track.measures[0]!;
    const next = track.measures[1]!;
    const current = { id: "current", eventId: target.eventId, verse: 2 as const, text: "旧词" };
    const otherVerse = { id: "verse-1", eventId: target.eventId, verse: 1 as const, text: "第一段" };
    const following = { id: "following", eventId: next.numberedVoice.events[0]!.id, verse: 2 as const, text: "后词" };
    first.lyrics = [otherVerse, current];
    next.lyrics = [following];
    const command = { type: C.SetLyricSequence as const, ...target, items: items(raw), allowOverwrite: true };
    expect(command.items).toEqual([{ kind: "clear" }]);
    const plan = planLyricSequence(document, target, command.items, true);
    expect(plan).toMatchObject({ changes: 1, overwrites: 1, issue: null });
    const result = run(document, command);
    expect(result.document.score.tracks[0]!.measures[0]!.lyrics).toEqual([otherVerse]);
    expect(result.document.score.tracks[0]!.measures[1]!.lyrics).toEqual([following]);
    expect(first.lyrics).toEqual([otherVerse, current]);
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
    expect(run(result.document, command).changed).toBe(false);
  });
  it("全下划线可清空；覆盖、版本及非法后项检查不允许部分删除", () => {
    const { document, track, target } = fixture();
    const first = track.measures[0]!;
    const next = track.measures[1]!;
    first.lyrics = [{ id: "clear-first", eventId: target.eventId, verse: 2, text: "风" }];
    next.lyrics = [{ id: "clear-next", eventId: next.numberedVoice.events[0]!.id, verse: 2, text: "过" }];
    const before = structuredClone(document);
    const command = { type: C.SetLyricSequence as const, ...target, items: items("_ _"), allowOverwrite: true };
    for (const patch of [
      { allowOverwrite: false },
      { expectedRevision: document.documentRevision + 1 },
      { items: [{ kind: "clear" }, { kind: "set", text: "\n非法" }] as LyricSequenceItem[] },
    ]) {
      expect(applyScoreCommand(document, { ...command, ...patch }).ok).toBe(false);
      expect(document).toEqual(before);
    }
    const result = run(document, command);
    expect(result.document.score.tracks[0]!.measures.flatMap((m) => m.lyrics)).toEqual([]);
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
  });
  it("跨小节混合清空，保持其他段与节奏，ID 唯一，一次 revision，规范 loader 往返", () => {
    const { document, track, target } = fixture();
    const m2 = track.measures[1]!;
    const skipEvent = m2.numberedVoice.events[0]!;
    m2.lyrics = [
      { id: "skip-existing", eventId: skipEvent.id, verse: 2, text: "保留" },
      {
        id: "other-verse",
        eventId: m2.numberedVoice.events[1]!.id,
        verse: 1,
        text: "另一段",
      },
    ];
    const before = JSON.stringify(document);
    const sequence = items("风 _ 过 山");
    const plan = planLyricSequence(document, target, sequence, true);
    expect(plan.issue).toBeNull();
    expect(plan.rows.map((r) => [r.measureNumber, r.beatNumber])).toEqual([
      [1, track.measures[0]!.beats.length],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    expect(plan.rows[1]).toMatchObject({
      rest: false,
      status: "clear",
      previous: "保留",
    });
    const result = run(document, {
      type: C.SetLyricSequence,
      ...target,
      items: sequence,
      allowOverwrite: true,
    });
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    expect(JSON.stringify(document)).toBe(before);
    expect(result.document.score.tracks[0]!.measures[1]!.beats).toBe(m2.beats);
    expect(result.document.score.tracks[0]!.measures[1]!.lyrics).toContainEqual(m2.lyrics[1]);
    expect(result.document.score.tracks[0]!.measures[1]!.lyrics.some((l) => l.id === "skip-existing")).toBe(false);
    const lyrics = result.document.score.tracks[0]!.measures.flatMap(
      (m) => m.lyrics,
    );
    expect(new Set(lyrics.map((l) => l.id)).size).toBe(lyrics.length);
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
    expect(
      run(result.document, {
        type: C.SetLyricSequence,
        ...target,
        items: sequence,
        allowOverwrite: false,
      }),
    ).toEqual({ ok: true, changed: false, document: result.document });
  });
  it("默认覆盖阻止全部新增，许可后保留原 ID；一个非法项或容量不足均原子失败", () => {
    const { document, track, target } = fixture();
    track.measures[1]!.lyrics = [
      {
        id: "existing-id",
        eventId: track.measures[1]!.numberedVoice.events[0]!.id,
        verse: 2,
        text: "旧词",
      },
    ];
    const before = JSON.stringify(document);
    const command = {
      type: C.SetLyricSequence as const,
      ...target,
      items: items("新 词"),
      allowOverwrite: false,
    };
    expect(planLyricSequence(document, target, command.items).overwrites).toBe(
      1,
    );
    expect(applyScoreCommand(document, command).ok).toBe(false);
    expect(JSON.stringify(document)).toBe(before);
    const result = run(document, { ...command, allowOverwrite: true });
    expect(
      result.document.score.tracks[0]!.measures[1]!.lyrics[0],
    ).toMatchObject({ id: "existing-id", text: "词" });
    for (const patch of [
      {
        items: [
          { kind: "set", text: "新增" },
          { kind: "set", text: "\n非法" },
        ] as LyricSequenceItem[],
        allowOverwrite: true,
      },
      {
        measureId: track.measures.at(-1)!.id,
        eventId: track.measures.at(-1)!.numberedVoice.events.at(-1)!.id,
      },
      { eventId: "missing" },
      { verse: 5 as 2 },
      { items: [] },
      {
        items: Array.from({ length: 257 }, () => ({
          kind: "set" as const,
          text: "词",
        })),
      },
    ]) {
      expect(applyScoreCommand(document, { ...command, ...patch }).ok).toBe(
        false,
      );
      expect(JSON.stringify(document)).toBe(before);
    }
  });
  it("谱尾预览保留越界项，显式清空不减少位置", () => {
    const { document, track, target } = fixture();
    const last = track.measures.at(-1)!;
    const plan = planLyricSequence(
      document,
      {
        ...target,
        measureId: last.id,
        eventId: last.numberedVoice.events.at(-1)!.id,
      },
      items("_ 词"),
    );
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]!.status).toBe("same");
    expect(plan.rows[1]).toMatchObject({ target: null, status: "error" });
    expect(plan.issue).toContain("还缺 1 个歌词位置");
  });
});
