import { describe, it, expect } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  applyScoreCommand,
  hitTestNumbered,
  layoutParagraphFocus,
} from "../../src";

/** 孤立一小节，避免歌词和指法图成为宽度主导，专门检查简谱几何。 */
const fixture = () => {
  const doc = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = doc.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.numberedMarks = [];
  const m = track.measures[0]!;
  m.lyrics = [];
  m.chordSymbols = [];
  return { doc, track, m };
};
describe("简谱编辑与成品排版", () => {
  it("密集三十二分空位受预算约束，不强制每槽扩成完整框", () => {
    const { doc, m } = fixture();
    m.numberedVoice.events = Array.from({ length: 16 }, (_, i) => ({
      id: `e${i}`,
      kind: "notes" as const,
      tick: i * 240,
      rhythm: { base: "thirtySecond" as const, dots: 0 },
      items: [{ id: `i${i}`, token: "1" }],
    }));
    const edit = buildLayout(doc, { purpose: "editing", density: "compact" })
      .systems[0]!;
    const finished = buildLayout(doc, {
      purpose: "presentation",
      density: "compact",
    }).systems[0]!;
    expect(edit.measures[0]!.numberedInputSlots).toHaveLength(16);
    expect(
      edit.measures[0]!.numberedInputSlots!.some((s) => s.width < 24),
    ).toBe(true);
    expect(edit.width).toBeLessThan(finished.width * 1.9);
  });
  it("嵌套连线与延长记号排列不依赖 marks 数组顺序", () => {
    const { doc, track, m } = fixture();
    const events = m.numberedVoice.events;
    track.numberedMarks = [
      {
        id: "outer",
        type: "slur",
        fromEventId: events[0]!.id,
        toEventId: events[3]!.id,
      },
      {
        id: "inner",
        type: "slur",
        fromEventId: events[0]!.id,
        toEventId: events[1]!.id,
      },
      { id: "hold", type: "fermata", eventId: events[0]!.id },
    ];
    const geometry = () =>
      buildLayout(doc, {
        density: "compact",
      }).systems[0]!.numberedMarks!.filter((m) =>
        ["outer", "inner", "hold"].includes(m.markId),
      );
    const before = geometry();
    track.numberedMarks.reverse();
    expect(geometry()).toEqual(before);
    const outer = before.find((m) => m.markId === "outer")!,
      inner = before.find((m) => m.markId === "inner")!;
    expect(outer.bounds.y + outer.bounds.height).toBeLessThan(inner.bounds.y);
  });
  it.each(["compact", "comfortable"] as const)(
    "%s 下成品收紧且双谱首音对齐，布局不修改文档",
    (density) => {
      const { doc, track, m } = fixture();
      const result = applyScoreCommand(doc, {
        type: "numbered.range.replace",
        trackId: track.id,
        measureId: m.id,
        startTick: 0,
        endTick: 960,
        items: ["1", "2", "3"].map((token) => ({
          kind: "set" as const,
          tokens: [token],
        })),
        rhythms: [
          { base: "eighth", dots: 0 },
          { base: "sixteenth", dots: 0 },
          { base: "sixteenth", dots: 0 },
        ],
        allowOverwrite: true,
      });
      if (!result.ok) throw Error(result.message);
      const before = structuredClone(result.document);
      const editing = buildLayout(result.document, {
        purpose: "editing",
        density,
      }).systems[0]!;
      const finished = buildLayout(result.document, {
        purpose: "presentation",
        density,
      }).systems[0]!;
      expect(finished.width).toBeLessThan(editing.width);
      for (const s of [editing, finished]) {
        const measure = s.measures[0]!;
        expect(measure.numberedNotation![0]!.labels[0]!.x).toBe(
          measure.beats[0]!.x,
        );
        expect(measure.numberedSlots.map((e) => e.tick)).toContain(720);
      }
      expect(result.document).toEqual(before);
    },
  );
  it("同一 TAB 拍内多事件共用焦点框，命中仍指向各自音符", () => {
    const { doc, track, m } = fixture();
    const result = applyScoreCommand(doc, {
      type: "numbered.range.replace",
      trackId: track.id,
      measureId: m.id,
      startTick: 0,
      endTick: 960,
      items: ["1", "1", "2"].map((token) => ({
        kind: "set" as const,
        tokens: [token],
      })),
      rhythms: [
        { base: "eighth", dots: 0 },
        { base: "sixteenth", dots: 0 },
        { base: "sixteenth", dots: 0 },
      ],
      allowOverwrite: true,
    });
    if (!result.ok) throw Error(result.message);
    const layout = buildLayout(result.document, { purpose: "editing" });
    const measure = layout.systems[0]!.measures[0]!;
    const events =
      result.document.score.tracks[0]!.measures[0]!.numberedVoice.events.filter(
        (event) => event.tick < 960,
      );
    const frames = events.map((event) =>
      layoutParagraphFocus(layout, {
        kind: "numbered",
        trackId: track.id,
        measureId: m.id,
        eventId: event.id,
        itemId: event.items[0]!.id,
      }),
    );
    expect(frames[0]).toEqual(frames[1]);
    expect(frames[1]).toEqual(frames[2]);
    expect(frames[0]!.x).toBeLessThan(
      measure.numberedNotation![0]!.labels[0]!.x,
    );
    for (let i = 0; i < events.length; i++) {
      const bounds = measure.numberedNotation![i]!.itemBounds![0]!.bounds;
      expect(
        hitTestNumbered(layout, {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        }),
      ).toMatchObject({
        eventId: events[i]!.id,
        itemId: events[i]!.items[0]!.id,
      });
    }
  });
  it("同时多音从首音对齐 TAB 起点", () => {
    const { doc, m } = fixture();
    m.numberedVoice.events[0]!.items = ["1", "3"].map((token, i) => ({
      id: `first-item-${i}`,
      token,
    }));
    const measure = buildLayout(doc).systems[0]!.measures[0]!;
    expect(measure.numberedNotation![0]!.labels[0]!.x).toBe(
      measure.beats[0]!.x,
    );
    expect(measure.numberedNotation![0]!.labels[1]!.x).toBeGreaterThan(
      measure.beats[0]!.x,
    );
  });
  it("连续八分 TAB 上的空简谱给每个起点独立窄占位", () => {
    const doc = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const source = doc.score.tracks[0]!.measures[6]!;
    const layout = buildLayout(doc, { purpose: "editing", density: "compact" });
    const measure = layout.systems
      .flatMap((system) => system.measures)
      .find((m) => m.id === source.id)!;
    const slots = measure.numberedInputSlots!;
    expect(slots).toHaveLength(8);
    expect(slots.slice(0, 2).map((s) => [s.startTick, s.endTick])).toEqual([
      [0, 480],
      [480, 960],
    ]);
    expect(slots[0]!.anchorX).toBe(measure.beats[0]!.x);
    expect(slots[1]!.anchorX).toBe(measure.beats[1]!.x);
    expect(slots.slice(0, 2).every((s) => s.width < 24)).toBe(true);
  });
  it("普通半拍空位可完整显示，成品没有编辑槽或纯编辑空行", () => {
    const { doc, track, m } = fixture();
    const result = applyScoreCommand(doc, {
      type: "numbered.event.setRhythm",
      trackId: track.id,
      measureId: m.id,
      eventId: m.numberedVoice.events[0]!.id,
      rhythm: { base: "eighth", dots: 0 },
    });
    if (!result.ok) throw Error(result.message);
    const edit = buildLayout(result.document, {
      purpose: "editing",
      density: "compact",
    });
    const slot = edit.systems[0]!.measures[0]!.numberedInputSlots!.find(
      (s) => s.startTick === 480,
    )!;
    expect(slot.width).toBe(24);
    expect(slot.endTick).toBe(960);
    const finished = buildLayout(result.document, { density: "compact" });
    expect(finished.systems[0]!.measures[0]!.numberedInputSlots).toEqual([]);
    m.numberedVoice.events = [];
    const formal = buildLayout(doc, {
      paragraphEditing: { measureId: m.id, kind: "numbered" },
    });
    const active = buildLayout(doc, {
      purpose: "editing",
      paragraphEditing: { measureId: m.id, kind: "numbered" },
    });
    expect(formal.systems[0]!.numberedRow).toBeUndefined();
    expect(active.systems[0]!.measures[0]!.numberedInputSlots).toHaveLength(4);
  });
  it("局部 Slur 不被范围外三高音点抬高，曲线 bounds 使用实际弧高", () => {
    const { doc, track, m } = fixture();
    track.numberedMarks = [
      {
        id: "s",
        type: "slur",
        fromEventId: m.numberedVoice.events[0]!.id,
        toEventId: m.numberedVoice.events[1]!.id,
      },
    ];
    const distance = () => {
      const s = buildLayout(doc, { density: "compact" }).systems[0]!;
      const mark = s.numberedMarks!.find((r) => r.markId === "s")!;
      expect(mark.bounds.height).toBeLessThanOrEqual(6);
      return (
        mark.bounds.y - s.measures[0]!.numberedNotation![0]!.labels[0]!.bounds.y
      );
    };
    const first = distance();
    m.numberedVoice.events[3]!.items[0]!.token = "5'''";
    expect(distance()).toBeCloseTo(first);
  });
  it("上方八度点按真实数字边缘紧贴且多点保持分离", () => {
    const { doc, m } = fixture();
    m.numberedVoice.events[0]!.items[0]!.token = "1'''";
    const n = buildLayout(doc).systems[0]!.measures[0]!.numberedNotation![0]!;
    const digit = n.labels[0]!,
      first = n.dots[0]!;
    expect(digit.bounds.y + 2 - (first.cy + first.r)).toBeCloseTo(1.3);
    expect(first.cy - n.dots[1]!.cy).toBeGreaterThan(first.r * 2);
  });
  it("纯 TAB 两种用途音乐几何相同，不因编辑模式拉散", () => {
    const { doc, m } = fixture();
    m.numberedVoice.events = [];
    expect(buildLayout(doc, { purpose: "editing" })).toEqual(
      buildLayout(doc, { purpose: "presentation" }),
    );
  });
});
