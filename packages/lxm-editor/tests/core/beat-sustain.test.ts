import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  LXMScoreCommandEnum as C,
} from "../../src/core/commands";
import { STANDARD_GUITAR_TUNING } from "../../src/core/constants";
import { validateDocumentSemantics } from "../../src/core/semantic-validation";
import type { ILXMBeat, ILXMDocument } from "../../src/core/types";

const rest = (
  id: string,
  tick: number,
  base: ILXMBeat["rhythm"]["base"] = "quarter",
  dots = 0,
): ILXMBeat => ({ id, tick, rhythm: { base, dots }, kind: "rest", notes: [] });
const fixture = (): ILXMDocument => ({
  schema: "lxm-tab-score",
  schemaVersion: 8,
  documentRevision: 1,
  score: {
    id: "score",
    title: "延续一拍",
    arranger: "",
    keySignature: "C",
    meta: {},
    tracks: [
      {
        id: "track",
        name: "吉他",
        instrument: "guitar",
        tuning: { strings: STANDARD_GUITAR_TUNING.map((s) => ({ ...s })) },
        capo: 0,
        startBarline: "none",
        techniques: [],
        numberedMarks: [],
        measures: [
          {
            id: "measure",
            timeSignature: { numerator: 4, denominator: 4 },
            barline: "single",
            lyrics: [],
            chordSymbols: [],
            tuplets: [],
            numberedVoice: { events: [], tuplets: [] },
            beats: [
              {
                ...rest("source", 0),
                kind: "notes",
                notes: [
                  { id: "n1", string: 1, fret: 0 },
                  { id: "n2", string: 3, fret: 7 },
                ],
              },
              rest("target", 960),
              rest("later", 1920),
              rest("last", 2880),
            ],
          },
        ],
      },
    ],
  },
});
const command = {
  type: C.ExtendBeat,
  trackId: "track",
  measureId: "measure",
  beatId: "source",
} as const;
const measureOf = (d: ILXMDocument) => d.score.tracks[0]!.measures[0]!;
const execute = (d: ILXMDocument) => {
  const result = applyScoreCommand(d, command);
  if (!result.ok) throw new Error(result.message);
  expect(validateDocumentSemantics(result.document)).toEqual({ ok: true });
  return result;
};

describe("beat.sustain 原子延续一拍", () => {
  it("复制同弦同品位、分配新音符和逐弦 Tie，保留源拍与后续引用，只递增一次 revision", () => {
    const d = fixture(),
      before = structuredClone(d),
      m = measureOf(d);
    const result = execute(d),
      next = measureOf(result.document);
    expect(C.ExtendBeat).toBe("beat.sustain");
    expect(result.document.documentRevision).toBe(2);
    expect(result.nextFocus).toEqual({
      trackId: "track",
      measureId: "measure",
      beatId: "target",
    });
    expect(next.beats[0]).toBe(m.beats[0]);
    expect(next.beats[1]).toMatchObject({
      id: "target",
      tick: 960,
      kind: "notes",
      rhythm: { base: "quarter", dots: 0 },
    });
    expect(
      next.beats[1]!.notes.map(({ string, fret }) => ({ string, fret })),
    ).toEqual([
      { string: 1, fret: 0 },
      { string: 3, fret: 7 },
    ]);
    expect(next.beats[2]).toBe(m.beats[2]);
    expect(next.beats[3]).toBe(m.beats[3]);
    const ties = result.document.score.tracks[0]!.techniques;
    expect(ties).toHaveLength(2);
    next.beats[1]!.notes.forEach((n, i) => {
      expect(n.id).not.toBe(m.beats[0]!.notes[i]!.id);
      expect(ties[i]).toMatchObject({
        type: "tie",
        fromNoteId: m.beats[0]!.notes[i]!.id,
        toNoteId: n.id,
      });
    });
    expect(d).toEqual(before);
    const repeat = execute(result.document);
    expect(repeat.changed).toBe(false);
    expect(repeat.document).toBe(result.document);
  });

  it("长目标拆出 quarter 续音与按拍休止，后续音符 tick 不变", () => {
    const d = fixture(),
      m = measureOf(d);
    m.beats.splice(1, 2, rest("target", 960, "half"));
    m.beats[2] = {
      ...m.beats[2]!,
      kind: "notes",
      notes: [{ id: "later-note", string: 1, fret: 9 }],
    };
    const later = m.beats[2];
    const result = execute(d);
    expect(
      result.effects?.some((effect) => effect.kind === "beat.compressed"),
    ).not.toBe(true);
    const next = measureOf(result.document);
    expect(next.beats.map((b) => [b.tick, b.rhythm.base, b.kind])).toEqual([
      [0, "quarter", "notes"],
      [960, "quarter", "notes"],
      [1920, "quarter", "rest"],
      [2880, "quarter", "notes"],
    ]);
    expect(next.beats[3]).toBe(later);
  });

  it("连续两个 eighth 休止合成一拍续音，保留首目标 identity", () => {
    const d = fixture(),
      m = measureOf(d);
    m.beats.splice(
      1,
      1,
      rest("target", 960, "eighth"),
      rest("short", 1440, "eighth"),
    );
    const next = measureOf(execute(d).document);
    expect(next.beats.map((b) => [b.id, b.tick])).toEqual([
      ["source", 0],
      ["target", 960],
      ["later", 1920],
      ["last", 2880],
    ]);
  });

  it("短休止加较长休止允许部分覆盖，精确保留剩余时长", () => {
    const d = fixture(),
      m = measureOf(d);
    m.beats.splice(
      1,
      2,
      rest("target", 960, "eighth"),
      rest("short", 1440, "quarter", 1),
    );
    const next = measureOf(execute(d).document);
    expect(next.beats.map((b) => [b.tick, b.kind])).toEqual([
      [0, "notes"],
      [960, "notes"],
      [1920, "rest"],
      [2880, "rest"],
    ]);
  });

  it("6/8 中的一拍仍为 quarter", () => {
    const d = fixture(),
      m = measureOf(d);
    m.timeSignature = { numerator: 6, denominator: 8 };
    m.beats = [m.beats[0]!, rest("target", 960, "half")];
    const next = measureOf(execute(d).document);
    expect(next.beats.map((b) => [b.tick, b.rhythm.base, b.kind])).toEqual([
      [0, "quarter", "notes"],
      [960, "quarter", "notes"],
      [1920, "quarter", "rest"],
    ]);
  });

  it("TAB 续音不修改独立简谱事件、连音组或记号", () => {
    const d = fixture(),
      m = measureOf(d),
      track = d.score.tracks[0]!;
    m.numberedVoice.events = [
      {
        id: "event",
        tick: 960,
        kind: "notes",
        rhythm: { base: "quarter", dots: 0 },
        items: [{ id: "item", token: "5" }],
      },
    ];
    m.lyrics = [{ id: "lyric", eventId: "event", verse: 1, text: "保留" }];
    track.numberedMarks = [
      { id: "fermata", type: "fermata", eventId: "event" },
    ];
    const result = execute(d);
    expect(measureOf(result.document).numberedVoice).toBe(m.numberedVoice);
    expect(measureOf(result.document).lyrics).toBe(m.lyrics);
    expect(result.document.score.tracks[0]!.numberedMarks).toBe(
      track.numberedMarks,
    );
  });

  it("保留源拍和弦与技巧，不把源技巧复制到续音", () => {
    const d = fixture(),
      m = measureOf(d),
      track = d.score.tracks[0]!;
    m.chordSymbols = [
      {
        id: "chord",
        beatId: "source",
        display: "name",
        chord: { name: "C", diagram: null },
      },
    ];
    track.techniques = [
      { id: "harmonic", type: "naturalHarmonic", fromNoteId: "n2" },
    ];
    const result = execute(d),
      next = measureOf(result.document);
    expect(next.lyrics).toBe(m.lyrics);
    expect(next.chordSymbols).toBe(m.chordSymbols);
    expect(
      result.document.score.tracks[0]!.techniques.filter(
        (t) => t.type !== "tie",
      ),
    ).toEqual(track.techniques);
  });

  it.each(["rest", "empty", "muted"])("拒绝源拍 %s 且原文档不变", (kind) => {
    const d = fixture(),
      source = measureOf(d).beats[0]!;
    if (kind === "rest") {
      source.kind = "rest";
      source.notes = [];
    }
    if (kind === "empty") source.notes = [];
    if (kind === "muted") source.notes[0]!.fret = "x";
    const before = structuredClone(d);
    expect(applyScoreCommand(d, command)).toMatchObject({
      ok: false,
      code: "INVALID_BEAT_OPERATION",
    });
    expect(d).toEqual(before);
  });

  it.each(["same", "different", "emptyNotes", "partialTie"])(
    "不覆盖已有目标 %s",
    (kind) => {
      const d = fixture(),
        target = measureOf(d).beats[1]!;
      target.kind = "notes";
      target.notes =
        kind === "emptyNotes"
          ? []
          : [
              { id: "to1", string: 1, fret: kind === "different" ? 2 : 0 },
              { id: "to2", string: 3, fret: 7 },
            ];
      if (kind === "partialTie")
        d.score.tracks[0]!.techniques = [
          {
            id: "partial",
            type: "tie",
            fromNoteId: "n1",
            toNoteId: "to1",
          },
        ];
      const before = structuredClone(d);
      expect(applyScoreCommand(d, command)).toMatchObject({
        ok: false,
        code: "INVALID_BEAT_OPERATION",
      });
      expect(d).toEqual(before);
    },
  );

  it.each(["chord", "technique"])("保护续音目标的 %s", (kind) => {
    const d = fixture(),
      m = measureOf(d);
    if (kind === "chord")
      m.chordSymbols = [
        {
          id: "chord",
          beatId: "target",
          display: "name",
          chord: { name: "C", diagram: null },
        },
      ];
    if (kind === "technique")
      d.score.tracks[0]!.techniques = [
        {
          id: "strum",
          type: "strum",
          beatId: "target",
          minString: 1,
          maxString: 3,
          stroke: "down",
        },
      ];
    const before = structuredClone(d);
    expect(applyScoreCommand(d, command)).toMatchObject({
      ok: false,
      code: "INVALID_BEAT_OPERATION",
    });
    expect(d).toEqual(before);
  });

  it("保护合并范围内后续短休止上的和弦锚点", () => {
    const d = fixture(),
      m = measureOf(d);
    m.beats.splice(
      1,
      1,
      rest("target", 960, "eighth"),
      rest("short", 1440, "eighth"),
    );
    m.chordSymbols = [
      {
        id: "chord",
        beatId: "short",
        display: "name",
        chord: { name: "C", diagram: null },
      },
    ];
    expect(applyScoreCommand(d, command)).toMatchObject({ ok: false });
  });

  it.each(["source", "target"])("拒绝 %s 连音组成员", (member) => {
    const d = fixture(),
      m = measureOf(d);
    const index = member === "source" ? 0 : 1,
      original = m.beats[index]!;
    m.beats.splice(
      index,
      1,
      ...Array.from({ length: 3 }, (_, i) => ({
        ...(i === 0 ? original : rest(`triplet${i}`, original.tick)),
        tick: original.tick + i * 320,
        rhythm: { base: "eighth" as const, dots: 0 },
      })),
    );
    m.tuplets = [
      {
        id: "tuplet",
        beatIds: m.beats.slice(index, index + 3).map((b) => b.id),
        ratio: { actual: 3, normal: 2 },
      },
    ];
    expect(validateDocumentSemantics(d)).toEqual({ ok: true });
    expect(applyScoreCommand(d, command)).toMatchObject({
      ok: false,
      code: "BEAT_IN_TUPLET",
    });
  });

  it("连续休止不足 quarter 时拒绝，不压缩后续音符", () => {
    const d = fixture(),
      m = measureOf(d);
    m.beats.splice(1, 1, rest("target", 960, "eighth"), {
      ...rest("attack", 1440, "eighth"),
      kind: "notes",
      notes: [{ id: "attack-note", string: 2, fret: 3 }],
    });
    const before = structuredClone(d);
    expect(applyScoreCommand(d, command)).toMatchObject({ ok: false });
    expect(d).toEqual(before);
  });

  it("拒绝跨小节延续并明确提示", () => {
    const d = fixture(),
      m = measureOf(d);
    m.beats[3] = {
      ...m.beats[0]!,
      id: "end",
      tick: 2880,
      notes: [{ id: "end-note", string: 1, fret: 5 }],
    };
    expect(applyScoreCommand(d, { ...command, beatId: "end" })).toMatchObject({
      ok: false,
      code: "INVALID_BEAT_OPERATION",
      message: expect.stringContaining("跨小节"),
    });
  });

  it.each([
    [{ trackId: "missing" }, "TRACK_NOT_FOUND"],
    [{ measureId: "missing" }, "MEASURE_NOT_FOUND"],
    [{ beatId: "missing" }, "BEAT_NOT_FOUND"],
  ])("目标不存在时返回定位错误 %s", (target, code) => {
    expect(
      applyScoreCommand(fixture(), { ...command, ...target }),
    ).toMatchObject({ ok: false, code });
  });
});
