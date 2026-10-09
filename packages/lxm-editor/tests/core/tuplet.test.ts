import { describe, it, expect } from "vitest";
import {
  LXM_TUPLET_RATIOS,
  CURRENT_SCHEMA_VERSION,
} from "../../src/core/constants";
import {
  LXMMeasureSchema,
  LXMTupletSchema,
  LXMDocumentSchema,
} from "../../src/core/schema";
import {
  getBeatDurationTicks,
  createMeasureRhythmContext,
} from "../../src/core/tuplet";
import { reconcileMeasureTimeline } from "../../src/core/measure-timeline";
import {
  applyScoreCommand,
  LXMScoreCommandEnum as Command,
} from "../../src/core/commands";
import { validateDocumentSemantics } from "../../src/core/semantic-validation";
import { loadDocument } from "../../src/core/loader";
import type {
  ILXMDocument,
  ILXMMeasure,
  ILXMRhythm,
  ILXMTupletRatio,
} from "../../src/core/types";
import example from "../../example/example-mvp5.1.json";
import v5 from "../../example/example-mvp5.json";

/** 独立构造书写时长，期望值在用例中直接列出。 */
const create = (
  count: number,
  rhythm: ILXMRhythm = { base: "sixteenth", dots: 0 },
): ILXMDocument => {
  const written =
    rhythm.base === "quarter"
      ? 960
      : rhythm.base === "eighth"
        ? 480
        : rhythm.base === "thirtySecond"
          ? 120
          : 240;
  const ticks =
    written * (rhythm.dots === 1 ? 1.5 : rhythm.dots === 2 ? 1.75 : 1);
  const beats = Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    tick: i * ticks,
    rhythm,
    kind: "notes" as const,
    notes: [{ id: `n${i}`, string: 1, fret: 3 }],
  }));
  // 初始文档填充整数容量，测试不可表达场景只直接调用纯换算。
  const tail = 3840 - count * ticks;
  const restBases = [
    { base: "half" as const, ticks: 1920 },
    { base: "quarter" as const, ticks: 960 },
    { base: "eighth" as const, ticks: 480 },
    { base: "sixteenth" as const, ticks: 240 },
    { base: "thirtySecond" as const, ticks: 120 },
  ];
  let tick = count * ticks,
    remaining = tail;
  const rests = restBases.flatMap((option) => {
    const result = [];
    while (remaining >= option.ticks) {
      result.push({
        id: `r${tick}`,
        tick,
        rhythm: { base: option.base, dots: 0 },
        kind: "rest" as const,
        notes: [],
      });
      remaining -= option.ticks;
      tick += option.ticks;
    }
    return result;
  });
  return {
    ...v5,
    score: {
      ...v5.score,
      tracks: [
        {
          ...v5.score.tracks[0]!,
          techniques: [],
          measures: [
            {
              id: "m",
              timeSignature: { numerator: 4, denominator: 4 },
              barline: "single",
              chordSymbols: [],
              tuplets: [],
              beats: [...beats, ...rests],
            },
          ],
        },
      ],
    },
  };
};
const measureOf = (doc: ILXMDocument) => doc.score.tracks[0]!.measures[0]!;
const set = (doc: ILXMDocument, ratio: ILXMTupletRatio) =>
  applyScoreCommand(doc, {
    type: Command.SetTuplet,
    trackId: doc.score.tracks[0]!.id,
    measureId: "m",
    startBeatId: "b0",
    endBeatId: `b${ratio.actual - 1}`,
    ratio,
  });
const success = (result: ReturnType<typeof applyScoreCommand>) => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.message);
  return result.document;
};
const issueCodes = (measure: ILXMMeasure) => {
  const doc = create(6);
  doc.score.tracks[0]!.measures = [measure];
  const result = validateDocumentSemantics(doc);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
};

describe("tuplet 时间与严格模型", () => {
  it.each(LXM_TUPLET_RATIOS)("严格 schema 支持 $actual:$normal", (ratio) => {
    expect(
      LXMTupletSchema.safeParse({ id: "t", beatIds: ["b"], ratio }).success,
    ).toBe(true);
    expect(
      LXMTupletSchema.safeParse({
        id: "t",
        beatIds: ["b"],
        ratio: { ...ratio, extra: 1 },
      }).success,
    ).toBe(false);
  });
  it("旧版本或缺必填字段明确拒绝", () => {
    const doc = create(3);
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    expect(
      LXMDocumentSchema.safeParse({ ...doc, schemaVersion: 1 }).success,
    ).toBe(false);
    const { tuplets: _tuplets, ...old } = measureOf(doc);
    expect(LXMMeasureSchema.safeParse(old).success).toBe(false);
    expect(
      LXMTupletSchema.safeParse({
        id: "t",
        beatIds: ["b"],
        ratio: { actual: 7, normal: 4 },
      }).success,
    ).toBe(false);
  });
  it.each([
    [{ actual: 2, normal: 3 }, 360],
    [{ actual: 3, normal: 2 }, 160],
    [{ actual: 4, normal: 3 }, 180],
    [{ actual: 5, normal: 4 }, 192],
    [{ actual: 5, normal: 3 }, 144],
    [{ actual: 6, normal: 4 }, 160],
  ] as const)("十六分实际 ticks %j", (ratio, ticks) => {
    const m = measureOf(create(ratio.actual));
    m.tuplets = [
      {
        id: "t",
        beatIds: m.beats.slice(0, ratio.actual).map((b) => b.id),
        ratio,
      },
    ];
    expect(getBeatDurationTicks(m, m.beats[0]!)).toEqual({ ok: true, ticks });
    expect(getBeatDurationTicks(m, m.beats.at(-1)!)).toEqual({
      ok: true,
      ticks:
        m.beats.at(-1)!.rhythm.base === "half"
          ? 1920
          : m.beats.at(-1)!.rhythm.base === "quarter"
            ? 960
            : m.beats.at(-1)!.rhythm.base === "eighth"
              ? 480
              : 240,
    });
  });
  it("附点先计算；不能整除的双附点四连音不舍入", () => {
    const m = measureOf(create(3, { base: "eighth", dots: 1 }));
    m.tuplets = [
      { id: "t", beatIds: ["b0", "b1", "b2"], ratio: { actual: 3, normal: 2 } },
    ];
    expect(getBeatDurationTicks(m, m.beats[0]!)).toEqual({
      ok: true,
      ticks: 480,
    });
    const n = measureOf(create(5, { base: "thirtySecond", dots: 2 }));
    n.tuplets = [
      {
        id: "t",
        beatIds: ["b0", "b1", "b2", "b3", "b4"],
        ratio: { actual: 5, normal: 4 },
      },
    ];
    expect(getBeatDurationTicks(n, n.beats[0]!)).toEqual({
      ok: true,
      ticks: 168,
    });
    n.tuplets[0]!.ratio = { actual: 5, normal: 3 };
    expect(getBeatDurationTicks(n, n.beats[0]!)).toEqual({
      ok: true,
      ticks: 126,
    });
    n.beats[0]!.rhythm = { base: "thirtySecond", dots: 1 };
    expect(getBeatDurationTicks(n, n.beats[0]!)).toEqual({
      ok: true,
      ticks: 108,
    });
    n.tuplets[0]!.ratio = { actual: 4, normal: 3 };
    n.beats[0]!.rhythm = { base: "thirtySecond", dots: 2 };
    expect(getBeatDurationTicks(n, n.beats[0]!)).toEqual({
      ok: false,
      code: "NON_INTEGER_TUPLET_TICKS",
    });
  });
  it("八小节规范谱例 loader 与实际起点通过", () => {
    const loaded = loadDocument(JSON.stringify(example));
    if (!loaded.ok) throw Error(JSON.stringify(loaded.errors));
    expect(loaded.ok).toBe(true);
    const expected = [
      [0, 320, 640],
      [0, 720],
      [0, 180, 360, 540],
      [0, 192, 384, 576, 768],
      [0, 144, 288, 432, 576],
      [0, 160, 320, 480, 640, 800],
      [0, 480, 960],
      [0, 320, 640],
    ];
    example.score.tracks[0]!.measures.forEach((m, i) =>
      expect(
        m.beats.slice(0, m.tuplets[0]!.ratio.actual).map((b) => b.tick),
      ).toEqual(expected[i]),
    );
  });
  it("索引可以重复查询，不重新扫描分组", () => {
    const m = example.score.tracks[0]!.measures[0]!;
    const context = createMeasureRhythmContext(m);
    expect(context.tupletById.size).toBe(1);
    expect(context.tupletByBeatId.size).toBe(3);
    for (let i = 0; i < 1000; i++)
      expect(context.getBeatDurationTicks(m.beats[0]!)).toEqual({
        ok: true,
        ticks: 320,
      });
  });
});

describe("tuplet 原子命令与既有编辑协调", () => {
  it.each(LXM_TUPLET_RATIOS)(
    "新增/移除 $actual:$normal 成员与历史引用保留",
    (ratio) => {
      const doc = create(ratio.actual);
      const original = structuredClone(doc);
      const next = success(set(doc, ratio));
      expect(doc).toEqual(original);
      expect(next.documentRevision).toBe(doc.documentRevision + 1);
      expect(validateDocumentSemantics(next).ok).toBe(true);
      const m = measureOf(next);
      const same = set(next, { ...ratio });
      expect(same.ok && !same.changed && same.document === next).toBe(true);
      const removed = success(
        applyScoreCommand(next, {
          type: Command.RemoveTuplet,
          trackId: next.score.tracks[0]!.id,
          measureId: "m",
          tupletId: m.tuplets[0]!.id,
        }),
      );
      expect(measureOf(removed).tuplets).toEqual([]);
      expect(
        measureOf(removed)
          .beats.slice(0, ratio.actual)
          .map((b) => b.id),
      ).toEqual(Array.from({ length: ratio.actual }, (_, i) => `b${i}`));
    },
  );
  it("五连音改比例保留 ID", () => {
    const a = success(set(create(5), { actual: 5, normal: 4 }));
    const b = success(set(a, { actual: 5, normal: 3 }));
    const c = success(set(b, { actual: 5, normal: 4 }));
    expect(measureOf(b).tuplets[0]!.id).toBe(measureOf(a).tuplets[0]!.id);
    expect(
      measureOf(c)
        .beats.slice(0, 5)
        .map((b) => b.tick),
    ).toEqual([0, 192, 384, 576, 768]);
  });
  it("混合时值/附点、逆序、重叠和成员数不符明确失败", () => {
    const doc = create(6),
      trackId = doc.score.tracks[0]!.id;
    expect(set(doc, { actual: 5, normal: 4 }).ok).toBe(true);
    measureOf(doc).beats[1]!.rhythm = { base: "sixteenth", dots: 1 };
    expect(set(doc, { actual: 3, normal: 2 })).toMatchObject({
      ok: false,
      code: "TUPLET_RHYTHM_MISMATCH",
    });
    measureOf(doc).beats[1]!.rhythm = { base: "eighth", dots: 0 };
    expect(set(doc, { actual: 3, normal: 2 })).toMatchObject({
      ok: false,
      code: "TUPLET_RHYTHM_MISMATCH",
    });
    const next = success(set(create(6), { actual: 3, normal: 2 }));
    expect(
      applyScoreCommand(next, {
        type: Command.SetTuplet,
        trackId,
        measureId: "m",
        startBeatId: "b2",
        endBeatId: "b4",
        ratio: { actual: 3, normal: 2 },
      }),
    ).toMatchObject({ ok: false, code: "TUPLET_OVERLAP" });
    expect(
      applyScoreCommand(next, {
        type: Command.SetTuplet,
        trackId,
        measureId: "m",
        startBeatId: "b2",
        endBeatId: "b0",
        ratio: { actual: 3, normal: 2 },
      }),
    ).toMatchObject({ ok: false, code: "TUPLET_RANGE_INVALID" });
    expect(
      applyScoreCommand(next, {
        type: Command.SetTuplet,
        trackId,
        measureId: "m",
        startBeatId: "b0",
        endBeatId: "b1",
        ratio: { actual: 3, normal: 2 },
      }),
    ).toMatchObject({ ok: false, code: "TUPLET_MEMBER_COUNT_MISMATCH" });
  });
  it("拉长和删除容量不足原子失败", () => {
    const doc = create(4, { base: "quarter", dots: 0 });
    const before = structuredClone(doc);
    expect(set(doc, { actual: 2, normal: 3 })).toMatchObject({
      ok: false,
      code: "MEASURE_OVERFLOW",
    });
    expect(doc).toEqual(before);
    const shorter = success(set(doc, { actual: 3, normal: 2 }));
    const full = success(
      applyScoreCommand(shorter, {
        type: Command.SetBeatKind,
        trackId: doc.score.tracks[0]!.id,
        measureId: "m",
        beatId: measureOf(shorter).beats.at(-1)!.id,
        kind: "notes",
      }),
    );
    expect(
      applyScoreCommand(full, {
        type: Command.RemoveTuplet,
        trackId: doc.score.tracks[0]!.id,
        measureId: "m",
        tupletId: measureOf(full).tuplets[0]!.id,
      }),
    ).toMatchObject({ ok: false, code: "MEASURE_OVERFLOW" });
  });
  it("目标在组内的单拍时值修改拒绝，kind 和 Note 不破坏关系", () => {
    const doc = success(set(create(3), { actual: 3, normal: 2 }));
    const trackId = doc.score.tracks[0]!.id;
    expect(
      applyScoreCommand(doc, {
        type: Command.SetBeatRhythm,
        trackId,
        measureId: "m",
        beatId: "b0",
        rhythm: { base: "sixteenth", dots: 0 },
      }),
    ).toMatchObject({ ok: false, code: "BEAT_IN_TUPLET" });
    const rest = success(
      applyScoreCommand(doc, {
        type: Command.SetBeatKind,
        trackId,
        measureId: "m",
        beatId: "b1",
        kind: "rest",
      }),
    );
    const note = success(
      applyScoreCommand(rest, {
        type: Command.SetNote,
        trackId,
        measureId: "m",
        beatId: "b1",
        string: 1,
        fret: 5,
      }),
    );
    expect(measureOf(note).tuplets).toBe(measureOf(doc).tuplets);
    expect(validateDocumentSemantics(note).ok).toBe(true);
  });
  it("复制重建所有组引用；插入空组；删小节无悬挂技巧", () => {
    const doc = success(set(create(5), { actual: 5, normal: 4 }));
    const trackId = doc.score.tracks[0]!.id;
    const copy = success(
      applyScoreCommand(doc, {
        type: Command.CopyMeasure,
        trackId,
        measureId: "m",
      }),
    );
    const [source, clone] = copy.score.tracks[0]!.measures;
    expect(clone!.tuplets[0]!.id).not.toBe(source!.tuplets[0]!.id);
    expect(clone!.tuplets[0]!.beatIds).toEqual(
      clone!.beats.slice(0, 5).map((b) => b.id),
    );
    expect(validateDocumentSemantics(copy).ok).toBe(true);
    const insert = success(
      applyScoreCommand(copy, {
        type: Command.InsertMeasure,
        trackId,
        afterMeasureId: "m",
      }),
    );
    expect(insert.score.tracks[0]!.measures[1]!.tuplets).toEqual([]);
    const remove = success(
      applyScoreCommand(insert, {
        type: Command.RemoveMeasure,
        trackId,
        measureId: "m",
      }),
    );
    expect(validateDocumentSemantics(remove).ok).toBe(true);
  });
  it("同容量/扩容拍号保持组；group 阻挡缩容", () => {
    const doc = success(
      set(create(3, { base: "quarter", dots: 0 }), { actual: 3, normal: 2 }),
    );
    const trackId = doc.score.tracks[0]!.id;
    const change = (
      value: ILXMDocument,
      numerator: number,
      denominator: number,
    ) =>
      applyScoreCommand(value, {
        type: Command.SetTimeSignature,
        trackId,
        measureId: "m",
        timeSignature: { numerator, denominator },
        scope: "measure",
      });
    const three = success(change(doc, 3, 4));
    const six = success(change(three, 6, 8));
    expect(measureOf(six).tuplets).toBe(measureOf(doc).tuplets);
    expect(validateDocumentSemantics(six).ok).toBe(true);
    expect(change(doc, 2, 4).ok).toBe(true); // 组实际两拍，可以精确缩容。
    const long = success(
      set(create(2, { base: "quarter", dots: 0 }), { actual: 2, normal: 3 }),
    );
    expect(change(long, 2, 4)).toMatchObject({
      ok: false,
      code: "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE",
    });
  });
  it("移除尾部全休止组保留成员 ID", () => {
    const doc = create(3);
    measureOf(doc).beats.forEach((b) => {
      b.kind = "rest";
      b.notes = [];
    });
    const grouped = success(set(doc, { actual: 3, normal: 2 }));
    const removed = success(
      applyScoreCommand(grouped, {
        type: Command.RemoveTuplet,
        trackId: doc.score.tracks[0]!.id,
        measureId: "m",
        tupletId: measureOf(grouped).tuplets[0]!.id,
      }),
    );
    expect(
      measureOf(removed)
        .beats.slice(0, 3)
        .map((b) => b.id),
    ).toEqual(["b0", "b1", "b2"]);
  });
  it("组外时值修改移动整组且保护组成员", () => {
    const doc = create(6);
    const trackId = doc.score.tracks[0]!.id;
    const grouped = success(
      applyScoreCommand(doc, {
        type: Command.SetTuplet,
        trackId,
        measureId: "m",
        startBeatId: "b1",
        endBeatId: "b3",
        ratio: { actual: 3, normal: 2 },
      }),
    );
    const edited = success(
      applyScoreCommand(grouped, {
        type: Command.SetBeatRhythm,
        trackId,
        measureId: "m",
        beatId: "b0",
        rhythm: { base: "quarter", dots: 0 },
      }),
    );
    expect(
      measureOf(edited)
        .beats.slice(1, 4)
        .map((b) => b.tick),
    ).toEqual([960, 1120, 1280]);
    expect(measureOf(edited).tuplets).toBe(measureOf(grouped).tuplets);
  });
});

describe("语义守卫与容量协调", () => {
  const grouped = () =>
    measureOf(success(set(create(6), { actual: 3, normal: 2 })));
  it.each([
    [
      "TUPLET_BEAT_NOT_FOUND",
      (m: ILXMMeasure) => {
        m.tuplets[0]!.beatIds[1] = "missing";
      },
    ],
    [
      "TUPLET_MEMBER_COUNT_MISMATCH",
      (m: ILXMMeasure) => {
        m.tuplets[0]!.beatIds.pop();
      },
    ],
    [
      "TUPLET_BEATS_NOT_CONTIGUOUS",
      (m: ILXMMeasure) => {
        m.tuplets[0]!.beatIds.reverse();
      },
    ],
    [
      "TUPLET_RHYTHM_MISMATCH",
      (m: ILXMMeasure) => {
        m.beats[1]!.rhythm = { base: "eighth", dots: 0 };
      },
    ],
    [
      "TUPLET_OVERLAP",
      (m: ILXMMeasure) => {
        m.tuplets.push({ ...m.tuplets[0]!, id: "other" });
      },
    ],
    [
      "DUPLICATE_ENTITY_ID",
      (m: ILXMMeasure) => {
        m.tuplets[0]!.id = m.id;
      },
    ],
    [
      "BEAT_TICK_NOT_CONTIGUOUS",
      (m: ILXMMeasure) => {
        m.beats[1]!.tick = 240;
      },
    ],
  ] as const)("错误持久化数据命中 %s", (code, mutate) => {
    const m = structuredClone(grouped());
    mutate(m);
    expect(issueCodes(m)).toContain(code);
  });
  it("不能表示的剩余容量失败且不修改输入", () => {
    const m = measureOf(create(3));
    m.beats[0]!.rhythm = { base: "thirtySecond", dots: 2 };
    const before = structuredClone(m);
    const result = reconcileMeasureTimeline(m, {
      createBeatId: () => "rest",
      protectedBeatIds: new Set(["b0"]),
    });
    expect(result).toEqual({ ok: false, code: "RHYTHM_NOT_REPRESENTABLE" });
    expect(m).toEqual(before);
  });
  it("已匹配尾部不创建 ID；固定对象复用", () => {
    const m = grouped();
    let ids = 0;
    const result = reconcileMeasureTimeline(m, {
      createBeatId: () => `generated${++ids}`,
    });
    expect(result.ok).toBe(true);
    expect(ids).toBe(0);
    if (result.ok) expect(result.measure.beats[0]).toBe(m.beats[0]);
  });
});

describe("连音组边界回归", () => {
  it("合法双附点四连音产生非整数 tick，命令与持久化守卫均拒绝", () => {
    const doc = create(4, { base: "thirtySecond", dots: 2 });
    expect(set(doc, { actual: 4, normal: 3 })).toMatchObject({
      ok: false,
      code: "NON_INTEGER_TUPLET_TICKS",
    });
    const m = measureOf(doc);
    m.tuplets = [
      {
        id: "t",
        beatIds: ["b0", "b1", "b2", "b3"],
        ratio: { actual: 4, normal: 3 },
      },
    ];
    expect(issueCodes(m)).toContain("NON_INTEGER_TUPLET_TICKS");
  });
  it("group 数组乱序和重复成员分别报告", () => {
    const m = measureOf(success(set(create(6), { actual: 3, normal: 2 })));
    m.tuplets.unshift({
      id: "later",
      beatIds: ["b3", "b4", "b5"],
      ratio: { actual: 3, normal: 2 },
    });
    expect(issueCodes(m)).toContain("TUPLET_ORDER_INVALID");
    m.tuplets[1]!.beatIds = ["b0", "b0", "b2"];
    expect(issueCodes(m)).toContain("TUPLET_OVERLAP");
  });
  it("压缩 DP 跳过整个组，精确压缩组后的普通长音", () => {
    const doc = create(3),
      m = measureOf(doc),
      trackId = doc.score.tracks[0]!.id;
    m.beats = [
      { ...m.beats[0]!, rhythm: { base: "quarter", dots: 0 } },
      ...[960, 1280, 1600].map((tick, i) => ({
        id: `g${i}`,
        tick,
        rhythm: { base: "eighth" as const, dots: 0 },
        kind: "notes" as const,
        notes: [{ id: `gn${i}`, string: 1, fret: 5 }],
      })),
      {
        id: "last",
        tick: 1920,
        rhythm: { base: "half", dots: 0 },
        kind: "notes",
        notes: [{ id: "lastnote", string: 1, fret: 8 }],
      },
    ];
    m.tuplets = [
      {
        id: "group",
        beatIds: ["g0", "g1", "g2"],
        ratio: { actual: 3, normal: 2 },
      },
    ];
    expect(validateDocumentSemantics(doc).ok).toBe(true);
    const next = success(
      applyScoreCommand(doc, {
        type: Command.SetBeatRhythm,
        trackId,
        measureId: "m",
        beatId: "b0",
        rhythm: { base: "half", dots: 0 },
      }),
    );
    expect(
      measureOf(next)
        .beats.slice(1, 4)
        .map((b) => b.rhythm.base),
    ).toEqual(["eighth", "eighth", "eighth"]);
    expect(measureOf(next).beats[4]!.rhythm.base).toBe("quarter");
    expect(measureOf(next).tuplets).toBe(m.tuplets);
    expect(
      applyScoreCommand(doc, {
        type: Command.SetBeatRhythm,
        trackId,
        measureId: "m",
        beatId: "b0",
        rhythm: { base: "whole", dots: 0 },
      }),
    ).toMatchObject({ ok: false, code: "FOLLOWING_BEATS_CANNOT_COMPRESS" });
  });
  it("多小节拍号失败保持整篇文档；全休止组仍按明确内容保护", () => {
    const doc = success(
      set(create(2, { base: "quarter", dots: 0 }), { actual: 2, normal: 3 }),
    );
    const track = doc.score.tracks[0]!;
    measureOf(doc).beats.forEach((b) => {
      b.kind = "rest";
      b.notes = [];
    });
    const earlier = measureOf(create(1));
    earlier.id = "earlier";
    earlier.beats = earlier.beats.map((b) => ({
      ...b,
      id: `earlier-${b.id}`,
      notes: [],
    }));
    track.measures.unshift(earlier);
    const before = structuredClone(doc);
    expect(
      applyScoreCommand(doc, {
        type: Command.SetTimeSignature,
        trackId: track.id,
        measureId: "earlier",
        timeSignature: { numerator: 2, denominator: 4 },
        scope: "untilNextChange",
      }),
    ).toMatchObject({
      ok: false,
      code: "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE",
    });
    expect(doc).toEqual(before);
    const sameCapacity = success(
      applyScoreCommand(doc, {
        type: Command.SetTimeSignature,
        trackId: track.id,
        measureId: "m",
        timeSignature: { numerator: 3, denominator: 4 },
        scope: "measure",
      }),
    );
    expect(
      sameCapacity.score.tracks[0]!.measures[1]!.tuplets[0]!.beatIds,
    ).toEqual(["b0", "b1"]);
  });
  it("时间重排后 v5 技巧引用保留，保存 JSON 后重新加载等价", () => {
    const doc = create(3);
    doc.score.tracks[0]!.techniques = [
      { id: "tie", type: "tie", fromNoteId: "n0", toNoteId: "n1" },
    ];
    const next = success(set(doc, { actual: 3, normal: 2 }));
    expect(next.score.tracks[0]!.techniques).toEqual(
      doc.score.tracks[0]!.techniques,
    );
    const loaded = loadDocument(JSON.stringify(next));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.document).toEqual(next);
  });
  it("不存在的目标给出确定错误码", () => {
    const doc = create(3),
      trackId = doc.score.tracks[0]!.id;
    expect(
      applyScoreCommand(doc, {
        type: Command.RemoveTuplet,
        trackId,
        measureId: "m",
        tupletId: "missing",
      }),
    ).toMatchObject({ ok: false, code: "TUPLET_NOT_FOUND" });
    expect(
      applyScoreCommand(doc, {
        type: Command.RemoveTuplet,
        trackId: "missing",
        measureId: "m",
        tupletId: "missing",
      }),
    ).toMatchObject({ ok: false, code: "TRACK_NOT_FOUND" });
    expect(
      applyScoreCommand(doc, {
        type: Command.RemoveTuplet,
        trackId,
        measureId: "missing",
        tupletId: "missing",
      }),
    ).toMatchObject({ ok: false, code: "MEASURE_NOT_FOUND" });
  });
});
