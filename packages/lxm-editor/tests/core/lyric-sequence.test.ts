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
  });
  const m = track.measures[0]!;
  const target = {
    trackId: track.id,
    measureId: m.id,
    beatId: m.beats.at(-1)!.id,
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
  it("半角/全角、重复、首尾空格合并；独立下划线才跳拍，NFC 与码点规范化", () => {
    expect(items("  风　 _   e\u0301 a_b __ | ")).toEqual([
      { kind: "set", text: "风" },
      { kind: "skip" },
      { kind: "set", text: "é" },
      { kind: "set", text: "a_b" },
      { kind: "set", text: "__" },
      { kind: "set", text: "|" },
    ]);
    expect(items("Sing a song")).toHaveLength(3);
    expect(items("😀".repeat(64))).toHaveLength(1);
  });
  it.each([
    "",
    " 　 ",
    "_ _",
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
  it("跨小节含休止和跳拍，保持其他段与节奏，ID 唯一，一次 revision，规范 loader 往返", () => {
    const { document, track, target } = fixture();
    const m2 = track.measures[1]!;
    const skipBeat = m2.beats[0]!;
    m2.lyrics = [
      { id: "skip-existing", beatId: skipBeat.id, verse: 2, text: "保留" },
      { id: "other-verse", beatId: m2.beats[1]!.id, verse: 1, text: "另一段" },
    ];
    const before = JSON.stringify(document);
    const sequence = items("风 _ 过 山");
    const plan = planLyricSequence(document, target, sequence);
    expect(plan.issue).toBeNull();
    expect(plan.rows.map((r) => [r.measureNumber, r.beatNumber])).toEqual([
      [1, track.measures[0]!.beats.length],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    expect(plan.rows[1]).toMatchObject({
      rest: skipBeat.kind === "rest",
      status: "skip",
      previous: "保留",
    });
    const result = run(document, {
      type: C.SetLyricSequence,
      ...target,
      items: sequence,
      allowOverwrite: false,
    });
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    expect(JSON.stringify(document)).toBe(before);
    expect(result.document.score.tracks[0]!.measures[1]!.beats).toBe(m2.beats);
    expect(result.document.score.tracks[0]!.measures[1]!.lyrics).toEqual(
      expect.arrayContaining(m2.lyrics),
    );
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
        beatId: track.measures[1]!.beats[0]!.id,
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
        beatId: track.measures.at(-1)!.beats.at(-1)!.id,
      },
      { beatId: "missing" },
      { verse: 5 as 2 },
      { items: [{ kind: "skip" }] as LyricSequenceItem[] },
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
  it("谱尾预览保留越界项，显式 skip 不过滤位置", () => {
    const { document, track, target } = fixture();
    const last = track.measures.at(-1)!;
    const plan = planLyricSequence(
      document,
      { ...target, measureId: last.id, beatId: last.beats.at(-1)!.id },
      items("_ 词"),
    );
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]!.status).toBe("skip");
    expect(plan.rows[1]).toMatchObject({ target: null, status: "error" });
    expect(plan.issue).toContain("还缺 1 拍");
  });
});
