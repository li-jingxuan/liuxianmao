import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  buildLayout,
  loadDocument,
  upgradeDocumentToCurrent,
  createNumberedRhythmContext,
  STANDARD_GUITAR_TUNING,
  LXMScoreCommandEnum,
  createNumberedClipboard,
  createBeatClipboard,
  planBeatPaste,
  hitTestNumbered,
  hitTestNumberedMark,
  paginateLayout,
  parseNumberedSequence,
} from "../../src";
import type { ILXMDocument, ILXMNumberedVoiceCommand } from "../../src";
/** 最小真实文档同时走命令、加载、联合布局，不用模拟另一套音乐时间。 */
const fixture = (): ILXMDocument => ({
  schema: "lxm-tab-score",
  schemaVersion: 8,
  documentRevision: 1,
  score: {
    id: "score",
    title: "独立简谱",
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
            beats: Array.from({ length: 4 }, (_, i) => ({
              id: `b${i}`,
              tick: i * 960,
              rhythm: { base: "quarter", dots: 0 },
              kind: "notes",
              notes: [{ id: `n${i}`, string: 1, fret: 5 }],
            })),
          },
        ],
      },
    ],
  },
});
const rhythm = (base: "eighth" | "sixteenth" | "quarter") => ({
  base,
  dots: 0,
});
const fill: ILXMNumberedVoiceCommand = {
  type: "numbered.range.replace",
  trackId: "track",
  measureId: "measure",
  startTick: 0,
  endTick: 960,
  items: ["1", "2", "3"].map((token) => ({ kind: "set", tokens: [token] })),
  rhythms: [rhythm("eighth"), rhythm("sixteenth"), rhythm("sixteenth")],
  allowOverwrite: false,
};
const execute = (
  d: ILXMDocument,
  c: Parameters<typeof applyScoreCommand>[1],
) => {
  const result = applyScoreCommand(d, c);
  if (!result.ok) throw new Error(result.message);
  return result.document;
};
describe("独立简谱声部", () => {
  it("前八后十六与 TAB 首音对齐，TAB 完整跨度不被细分列截短", () => {
    const before = fixture(),
      tab = structuredClone(before.score.tracks[0]!.measures[0]!.beats);
    const next = execute(before, fill),
      m = next.score.tracks[0]!.measures[0]!;
    expect(m.beats).toEqual(tab);
    expect(m.numberedVoice.events.map((e) => e.tick)).toEqual([0, 480, 720]);
    const layout = buildLayout(next),
      row = layout.systems[0]!.measures[0]!;
    expect(row.numberedSlots[0]!.x).toBe(row.beats[0]!.x);
    expect(row.beats[0]!.width).toBeCloseTo(row.beats[1]!.x - row.beats[0]!.x);
    expect(row.numberedSlots[1]!.x).toBeGreaterThan(row.numberedSlots[0]!.x);
    expect(row.numberedSlots[2]!.x).toBeGreaterThan(row.numberedSlots[1]!.x);
    expect(row.numberedNotation!.at(-1)!.lines).toHaveLength(2);
    expect(loadDocument(JSON.stringify(next)).ok).toBe(true);
  });
  it("修改与拆分 TAB 保留独立简谱事件与标记", () => {
    const d = execute(fixture(), fill),
      voice = structuredClone(d.score.tracks[0]!.measures[0]!.numberedVoice);
    const next = execute(d, {
      type: LXMScoreCommandEnum.SplitBeat,
      trackId: "track",
      measureId: "measure",
      beatId: "b0",
    });
    expect(next.score.tracks[0]!.measures[0]!.numberedVoice).toEqual(voice);
    expect(next.documentRevision).toBe(d.documentRevision + 1);
  });
  it("同音 Tie 影响必须确认；no-op 和 stale 不写文档", () => {
    const d = execute(fixture(), {
      ...fill,
      items: ["1", "1", "3"].map((token) => ({ kind: "set", tokens: [token] })),
    });
    const events = d.score.tracks[0]!.measures[0]!.numberedVoice.events;
    const tied = execute(d, {
      type: "numbered.mark.add",
      trackId: "track",
      mark: {
        type: "tie",
        fromItemId: events[0]!.items[0]!.id,
        toItemId: events[1]!.items[0]!.id,
      },
    });
    const edit: ILXMNumberedVoiceCommand = {
      type: "numbered.event.set",
      trackId: "track",
      measureId: "measure",
      eventId: events[1]!.id,
      itemId: events[1]!.items[0]!.id,
      tokens: ["2"],
    };
    const blocked = applyScoreCommand(tied, edit);
    expect(blocked).toMatchObject({
      ok: false,
      code: "NUMBERED_IMPACT_REQUIRED",
    });
    const confirmed = execute(tied, {
      ...edit,
      expectedRevision: tied.documentRevision,
      confirmedRemovedMarkIds: tied.score.tracks[0]!.numberedMarks.map(
        (m) => m.id,
      ),
    });
    expect(confirmed.score.tracks[0]!.numberedMarks).toEqual([]);
    expect(confirmed.score.tracks[0]!.measures[0]!.beats).toEqual(
      tied.score.tracks[0]!.measures[0]!.beats,
    );
    expect(
      applyScoreCommand(confirmed, {
        ...edit,
        expectedRevision: tied.documentRevision,
      }),
    ).toMatchObject({ ok: false, code: "STALE_NUMBERED_PLAN" });
    const noop = applyScoreCommand(confirmed, edit);
    expect(noop).toMatchObject({
      ok: true,
      changed: false,
      document: confirmed,
    });
  });
  it("旧三连音缺项升级为 gap，实际时长保持且与 TAB 断开绑定", () => {
    const old = JSON.parse(JSON.stringify(fixture()));
    old.schemaVersion = 7;
    delete old.score.tracks[0].numberedMarks;
    const m = old.score.tracks[0].measures[0];
    delete m.numberedVoice;
    m.beats = [
      ...[0, 320, 640].map((tick, i) => ({
        id: `trip-${i}`,
        tick,
        rhythm: rhythm("eighth"),
        kind: "rest",
        notes: [],
        ...(i === 1 ? {} : { numberedNotation: { tokens: ["1"] } }),
      })),
      {
        id: "tail",
        tick: 960,
        rhythm: { base: "half", dots: 1 },
        kind: "rest",
        notes: [],
      },
    ];
    m.tuplets = [
      {
        id: "triplet",
        beatIds: ["trip-0", "trip-1", "trip-2"],
        ratio: { actual: 3, normal: 2 },
      },
    ];
    const upgraded = upgradeDocumentToCurrent(old);
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    const voice = upgraded.document.score.tracks[0]!.measures[0]!.numberedVoice;
    expect(voice.events.map((e) => e.kind)).toEqual(["notes", "gap", "notes"]);
    const context = createNumberedRhythmContext(voice);
    expect(voice.events.map((e) => context.getEventDurationTicks(e))).toEqual(
      Array(3).fill({ ok: true, ticks: 320 }),
    );
    expect(upgradeDocumentToCurrent(old)).toEqual(upgraded);
    expect(loadDocument(JSON.stringify(old)).ok).toBe(false);
  });
  it("简谱单音时值扩展覆盖完整后续音，保持目标身份和 TAB", () => {
    const d = execute(fixture(), fill),
      event = d.score.tracks[0]!.measures[0]!.numberedVoice.events[0]!;
    const result = applyScoreCommand(d, {
      type: "numbered.event.setRhythm", trackId: "track", measureId: "measure",
      eventId: event.id, rhythm: rhythm("quarter"),
    });
    expect(result).toMatchObject({ok: true, changed: true});
    if (result.ok) {
      const next = result.document.score.tracks[0]!.measures[0]!;
      expect(next.numberedVoice.events).toEqual([{...event, rhythm: rhythm("quarter")}]);
      expect(next.beats).toEqual(d.score.tracks[0]!.measures[0]!.beats);
      expect(result.effects?.filter((e) => e.kind === "numbered.event.overwritten")).toHaveLength(2);
    }
  });
});

describe("独立简谱复制、结构与图元", () => {
  it("仅简谱覆盖/插入重建 ID 和内部关系，TAB 不变", () => {
    let d = execute(fixture(), fill);
    const events = d.score.tracks[0]!.measures[0]!.numberedVoice.events;
    d = execute(d, {
      type: "numbered.mark.add",
      trackId: "track",
      mark: {
        type: "slur",
        fromEventId: events[0]!.id,
        toEventId: events[2]!.id,
      },
    });
    const copied = createNumberedClipboard(d, {
      trackId: "track",
      measureId: "measure",
      startTick: 0,
      endTick: 960,
    });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const tab = structuredClone(d.score.tracks[0]!.measures[0]!.beats);
    for (const mode of ["overwrite", "insert"] as const) {
      const next = execute(d, {
        type: "numbered.range.paste",
        trackId: "track",
        measureId: "measure",
        startTick: 1920,
        mode,
        clipboard: copied.clipboard,
      });
      const t = next.score.tracks[0]!;
      expect(t.measures[0]!.beats).toEqual(tab);
      expect(t.measures[0]!.numberedVoice.events.map((e) => e.tick)).toEqual([
        0, 480, 720, 1920, 2400, 2640,
      ]);
      expect(t.numberedMarks).toHaveLength(2);
      expect(t.measures[0]!.numberedVoice.events[3]!.id).not.toBe(
        events[0]!.id,
      );
      expect(loadDocument(JSON.stringify(next)).ok).toBe(true);
    }
    expect(
      createNumberedClipboard(d, {
        trackId: "track",
        measureId: "measure",
        startTick: 240,
        endTick: 960,
      }),
    ).toMatchObject({ ok: false });
  });
  it("拍范围双谱复制携带简谱，仅 TAB 复制不携带另一层", () => {
    const d = execute(fixture(), fill);
    const range = {
      trackId: "track",
      measureId: "measure",
      startBeatId: "b0",
      endBeatId: "b0",
    };
    const both = createBeatClipboard(d, range),
      tab = createBeatClipboard(d, { ...range, layers: "tab" });
    if (!both.ok || !tab.ok) throw Error("复制失败");
    expect(both.clipboard.version).toBe(2);
    expect(both.clipboard.numberedVoice!.events).toHaveLength(3);
    expect(tab.clipboard.numberedVoice).toBeNull();
    for (const clipboard of [both.clipboard, tab.clipboard]) {
      const target = {
        trackId: "track",
        measureId: "measure",
        beatId: "b2",
        mode: "overwrite" as const,
      };
      const plan = planBeatPaste(d, target, clipboard);
      if (!plan.ok) throw Error(plan.message);
      const next = execute(d, {
        type: LXMScoreCommandEnum.PasteBeats,
        ...target,
        clipboard,
        expectedConfirmationKey: plan.confirmationKey,
        allowOverwrite: true,
      });
      expect(
        next.score.tracks[0]!.measures[0]!.numberedVoice.events,
      ).toHaveLength(clipboard.layers === "both" ? 6 : 3);
      expect(loadDocument(JSON.stringify(next)).ok).toBe(true);
    }
  });
  it("删除带跨小节 Tie 的公共小节先确认，再原子清理端点", () => {
    let d = execute(fixture(), {
      ...fill,
      startTick: 2880,
      endTick: 3840,
      items: [{ kind: "set", tokens: ["1"] }],
      rhythms: [rhythm("quarter")],
    });
    d = execute(d, {
      type: LXMScoreCommandEnum.InsertMeasure,
      trackId: "track",
      afterMeasureId: "measure",
    });
    const second = d.score.tracks[0]!.measures[1]!;
    d = execute(d, {
      ...fill,
      measureId: second.id,
      items: [{ kind: "set", tokens: ["1"] }],
      rhythms: [rhythm("quarter")],
    });
    const events = d.score.tracks[0]!.measures.flatMap(
      (m) => m.numberedVoice.events,
    );
    d = execute(d, {
      type: "numbered.mark.add",
      trackId: "track",
      mark: {
        type: "tie",
        fromItemId: events[0]!.items[0]!.id,
        toItemId: events[1]!.items[0]!.id,
      },
    });
    const command = {
      type: LXMScoreCommandEnum.RemoveMeasure as const,
      trackId: "track",
      measureId: "measure",
    };
    const denied = applyScoreCommand(d, command);
    expect(denied).toMatchObject({
      ok: false,
      code: "NUMBERED_IMPACT_REQUIRED",
    });
    const next = execute(d, {
      ...command,
      expectedRevision: d.documentRevision,
      confirmedRemovedMarkIds: d.score.tracks[0]!.numberedMarks.map(
        (m) => m.id,
      ),
    });
    expect(next.score.tracks[0]!.numberedMarks).toEqual([]);
    expect(next.score.tracks[0]!.measures).toHaveLength(1);
    expect(loadDocument(JSON.stringify(next)).ok).toBe(true);
  });
  it("独立三连音及其缺项不复制 TAB 节奏，移除导致碰撞时拒绝", () => {
    const command = {
      ...fill,
      items: [
        { kind: "set" as const, tokens: ["1"] },
        { kind: "skip" as const },
        { kind: "set" as const, tokens: ["3"] },
      ],
      rhythms: Array(3).fill(rhythm("eighth")),
      ratio: { actual: 3 as const, normal: 2 as const },
    };
    let d = execute(fixture(), command);
    const voice = d.score.tracks[0]!.measures[0]!.numberedVoice;
    expect(voice.events.map((e) => e.tick)).toEqual([0, 320, 640]);
    expect(voice.events[1]!.kind).toBe("gap");
    expect(d.score.tracks[0]!.measures[0]!.tuplets).toEqual([]);
    const next = execute(d, {
      type: "numbered.tuplet.remove",
      trackId: "track",
      measureId: "measure",
      tupletId: voice.tuplets[0]!.id,
    });
    expect(
      next.score.tracks[0]!.measures[0]!.numberedVoice.events.map(
        (e) => e.tick,
      ),
    ).toEqual([0, 960]);
    d = execute(d, {
      ...fill,
      startTick: 960,
      endTick: 1920,
      items: [{ kind: "set", tokens: ["5"] }],
      rhythms: [rhythm("quarter")],
    });
    expect(
      applyScoreCommand(d, {
        type: "numbered.tuplet.remove",
        trackId: "track",
        measureId: "measure",
        tupletId: voice.tuplets[0]!.id,
      }),
    ).toMatchObject({ ok: false });
  });
  it("多音 item 命中稳定，曲线和小节结构进入完整分页边界", () => {
    let d = execute(fixture(), {
      ...fill,
      items: [{ kind: "set", tokens: ["#1'", "3", "5."] }],
      rhythms: [rhythm("quarter")],
    });
    const first = d.score.tracks[0]!.measures[0]!.numberedVoice.events[0]!;
    d = execute(d, {
      type: "numbered.mark.add",
      trackId: "track",
      mark: { type: "fermata", eventId: first.id },
    });
    const layout = buildLayout(d),
      system = layout.systems[0]!,
      frame = system.measures[0]!.numberedNotation![0]!;
    const body = frame.labels.filter((g) => g.fontFamily !== "Bravura")[1]!;
    expect(
      hitTestNumbered(layout, {
        x: body.x,
        y: body.bounds.y + body.bounds.height / 2,
      }),
    ).toMatchObject({
      kind: "numberedEvent",
      eventId: first.id,
      itemId: first.items[1]!.id,
    });
    const mark = system.numberedMarks!.find((m) => m.type === "fermata")!;
    const accidental = frame.labels.find((g) => g.fontFamily === "Bravura")!;
    expect(
      hitTestNumbered(layout, {
        x: accidental.x,
        y: accidental.bounds.y + accidental.bounds.height / 2,
      }),
    ).toMatchObject({ itemId: first.items[0]!.id });
    const lowOctaveDot = frame.dots.find(
      (d) =>
        d.cx === frame.labels.filter((g) => g.fontFamily !== "Bravura")[2]!.x,
    )!;
    expect(
      hitTestNumbered(layout, { x: lowOctaveDot.cx, y: lowOctaveDot.cy }),
    ).toMatchObject({ itemId: first.items[2]!.id });
    const dot = mark.dots[0]!;
    expect(
      hitTestNumberedMark(layout, { x: dot.cx, y: dot.cy - 4 }),
    ).toMatchObject({ markId: mark.markId });
    expect(system.numberedMarks!.some((m) => m.type === "structure")).toBe(
      true,
    );
    expect(mark.bounds.y).toBeGreaterThanOrEqual(system.y);
    expect(paginateLayout(layout).ok).toBe(true);
  });
  it("新格式字段不能伪装为旧版本，升降符号输入规范化", () => {
    expect(parseNumberedSequence("♯1 ♭2 ♮3")).toMatchObject({
      ok: true,
      items: [
        { kind: "set", tokens: ["#1"] },
        { kind: "set", tokens: ["b2"] },
        { kind: "set", tokens: ["n3"] },
      ],
    });
    expect(
      upgradeDocumentToCurrent({ ...fixture(), schemaVersion: 7 }),
    ).toMatchObject({ ok: false });
  });
  it("长音、长休止和附点分别生成延时线、重复零与附点", () => {
    let d = execute(fixture(), {
      ...fill,
      endTick: 2880,
      items: [{ kind: "set", tokens: ["1."] }],
      rhythms: [{ base: "half", dots: 1 }],
    });
    let n = buildLayout(d).systems[0]!.measures[0]!.numberedNotation![0]!;
    expect(n.lines!.filter((l) => l.thickness > 0)).toHaveLength(2);
    expect(n.dots).toHaveLength(1);
    d = execute(fixture(), {
      ...fill,
      endTick: 2880,
      items: [{ kind: "set", tokens: ["0"] }],
      rhythms: [{ base: "half", dots: 1 }],
    });
    n = buildLayout(d).systems[0]!.measures[0]!.numberedNotation![0]!;
    expect(n.labels.map((g) => g.text)).toEqual(["0", "0", "0"]);
    expect(n.lines!.filter((l) => l.thickness > 0)).toHaveLength(0);
    d = execute(fixture(), {
      ...fill,
      endTick: 1680,
      items: [{ kind: "set", tokens: ["3"] }],
      rhythms: [{ base: "quarter", dots: 2 }],
    });
    expect(
      buildLayout(d).systems[0]!.measures[0]!.numberedNotation![0]!.rhythmDots,
    ).toHaveLength(2);
  });
  it("跨三行 Slur 穿过无简谱事件的小节，断行曲线保留身份及分页边界", () => {
    const d = fixture(),
      track = d.score.tracks[0]!,
      template = track.measures[0]!;
    track.measures = Array.from({ length: 3 }, (_, i) => ({
      ...structuredClone(template),
      id: `row-${i}`,
      beats: template.beats.map((b, j) => ({
        ...structuredClone(b),
        id: `row-${i}-beat-${j}`,
        notes: b.notes.map((n) => ({ ...n, id: `row-${i}-note-${j}` })),
      })),
      numberedVoice: {
        events:
          i === 1
            ? []
            : [
                {
                  id: `event-${i}`,
                  kind: "notes",
                  tick: 0,
                  rhythm: rhythm("quarter"),
                  items: [{ id: `item-${i}`, token: "1" }],
                },
              ],
        tuplets: [],
      },
    }));
    track.numberedMarks = [
      {
        id: "cross-row",
        type: "slur",
        fromEventId: "event-0",
        toEventId: "event-2",
      },
    ];
    expect(loadDocument(JSON.stringify(d)).ok).toBe(true);
    const layout = buildLayout(d, { systemWidth: 220 });
    expect(layout.systems).toHaveLength(3);
    const fragments = layout.systems.flatMap((s) =>
      s.numberedMarks!.filter((m) => m.markId === "cross-row"),
    );
    expect(fragments).toHaveLength(3);
    layout.systems.forEach((s) => {
      const mark = s.numberedMarks!.find((m) => m.markId === "cross-row")!;
      expect(mark.bounds.y).toBeGreaterThanOrEqual(s.y);
      expect(mark.bounds.y + mark.bounds.height).toBeLessThanOrEqual(
        s.y + s.height,
      );
      expect(s.numberedMarks!.some((m) => m.type === "structure")).toBe(true);
    });
    expect(paginateLayout(layout).ok).toBe(true);
  });
  it("原子修改返回简谱关系影响，失败不产生效果或改写输入", () => {
    let d = execute(fixture(), {
      ...fill,
      items: [{ kind: "set", tokens: ["1"] }],
      rhythms: [rhythm("quarter")],
    });
    const event = d.score.tracks[0]!.measures[0]!.numberedVoice.events[0]!;
    d = execute(d, {
      type: "numbered.mark.add",
      trackId: "track",
      mark: { type: "fermata", eventId: event.id },
    });
    const markId = d.score.tracks[0]!.numberedMarks[0]!.id,
      snapshot = JSON.stringify(d);
    const command = {
      type: "numbered.event.remove" as const,
      trackId: "track",
      measureId: "measure",
      eventId: event.id,
    };
    expect(applyScoreCommand(d, command)).toMatchObject({
      ok: false,
      code: "NUMBERED_IMPACT_REQUIRED",
    });
    expect(JSON.stringify(d)).toBe(snapshot);
    const result = applyScoreCommand(d, {
      ...command,
      confirmedRemovedMarkIds: [markId],
    });
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      effects: [
        {
          kind: "numbered.mark.removed",
          markId,
          markType: "fermata",
          measureNumber: 1,
        },
      ],
    });
    if (result.ok)
      expect(result.document.documentRevision).toBe(d.documentRevision + 1);
  });
});
