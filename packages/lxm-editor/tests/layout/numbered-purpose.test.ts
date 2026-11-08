import { describe, it, expect } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  applyScoreCommand,
  hitTestNumbered,
  layoutNumberedBeatContext,
  layoutParagraphFocus,
  type MusicTextRect,
} from "../../src";

/** 孤立一小节，避免歌词和指法图成为宽度主导，专门检查简谱几何。 */
const fixture = () => {
  const doc = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = doc.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.numberedMarks = [];
  // 默认编辑谱例现在包含跨小节技巧；单小节简谱几何回归需隔离这些技巧引用。
  track.techniques = [];
  const m = track.measures[0]!;
  m.lyrics = [];
  m.chordSymbols = [];
  return { doc, track, m };
};

const expectContains = (outer: MusicTextRect, inner: MusicTextRect) => {
  const epsilon = 1e-6;
  expect(outer.x).toBeLessThanOrEqual(inner.x + epsilon);
  expect(outer.y).toBeLessThanOrEqual(inner.y + epsilon);
  expect(outer.x + outer.width + epsilon).toBeGreaterThanOrEqual(
    inner.x + inner.width,
  );
  expect(outer.y + outer.height + epsilon).toBeGreaterThanOrEqual(
    inner.y + inner.height,
  );
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
    "%s 下编辑与成品行宽一致且双谱首音对齐，布局不修改文档",
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
        systemWidth: 600,
      }).systems[0]!;
      const finished = buildLayout(result.document, {
        purpose: "presentation",
        density,
        systemWidth: 600,
      }).systems[0]!;
      expect(editing.width).toBe(600);
      expect(finished.width).toBe(600);
      // 成品仍收紧简谱与 TAB 的纵向净空，用途差异不再通过缩短整行表达。
      const numberedStaffGap = (system: typeof editing) =>
        system.numberedRow!.y - system.measures[0]!.strings.at(-1)!.y1;
      expect(numberedStaffGap(finished)).toBeLessThan(numberedStaffGap(editing));
      for (const s of [editing, finished]) {
        const measure = s.measures[0]!;
        expect(measure.x + measure.width).toBeCloseTo(s.x + 600);
        expect(measure.numberedNotation![0]!.labels[0]!.x).toBe(
          measure.beats[0]!.x,
        );
        expect(measure.numberedSlots.map((e) => e.tick)).toContain(720);
      }
      expect(result.document).toEqual(before);
    },
  );
  it.each([
    {
      name: "两个八分 5/3",
      tokens: ["5", "3"],
      bases: ["eighth", "eighth"] as const,
    },
    {
      name: "八分与两个十六分混合",
      tokens: ["1", "1", "2"],
      bases: ["eighth", "sixteenth", "sixteenth"] as const,
    },
  ])(
    "$name 在同一 TAB 拍内焦点独立、拍背景一致且导航按 tick 排序",
    ({ tokens, bases }) => {
      const { doc, track, m } = fixture();
      const result = applyScoreCommand(doc, {
        type: "numbered.range.replace",
        trackId: track.id,
        measureId: m.id,
        startTick: 0,
        endTick: 960,
        items: tokens.map((token) => ({
          kind: "set" as const,
          tokens: [token],
        })),
        rhythms: bases.map((base) => ({ base, dots: 0 })),
        allowOverwrite: true,
      });
      if (!result.ok) throw Error(result.message);
      const events =
        result.document.score.tracks[0]!.measures[0]!.numberedVoice.events.filter(
          (event) => event.tick < 960,
        );
      for (const options of [
        { purpose: "editing", density: "compact", systemWidth: 360 },
        { purpose: "editing", density: "comfortable", systemWidth: 1000 },
        { purpose: "presentation", density: "compact", systemWidth: 600 },
      ] as const) {
        const layout = buildLayout(result.document, options);
        const measure = layout.systems[0]!.measures[0]!;
        const targets = events.map((event) => ({
          kind: "numbered" as const,
          trackId: track.id,
          measureId: m.id,
          eventId: event.id,
        }));
        const frames = targets.map(
          (target) => layoutParagraphFocus(layout, target)!,
        );
        const context = layoutNumberedBeatContext(layout, targets[0]!)!;
        expect(context.eventIds).toEqual(events.map((event) => event.id));
        const notations = events.map(
          (event) =>
            measure.numberedNotation!.find((n) => n.eventId === event.id)!,
        );
        const left = Math.min(...notations.map((n) => n.bounds.x));
        const top = Math.min(...notations.map((n) => n.bounds.y));
        expect(context.bounds).toEqual({
          x: left - 4,
          y: top - 2,
          width:
            Math.max(...notations.map((n) => n.bounds.x + n.bounds.width)) -
            left +
            8,
          height:
            Math.max(...notations.map((n) => n.bounds.y + n.bounds.height)) -
            top +
            4,
        });
        for (let i = 0; i < events.length; i++) {
          const n = notations[i]!;
          const frame = frames[i]!;
          expect(frame).toEqual({
            x: n.bounds.x - 4,
            y: n.bounds.y - 2,
            width: n.bounds.width + 8,
            height: n.bounds.height + 4,
          });
          expectContains(frame, n.labels[0]!.bounds);
          expectContains(context.bounds, frame);
          if (i > 0) {
            expect(frame).not.toEqual(frames[i - 1]);
            expect(frame.x).toBeGreaterThan(frames[i - 1]!.x);
          }
          const item = n.itemBounds![0]!;
          expectContains(
            layoutParagraphFocus(layout, {
              ...targets[i]!,
              itemId: item.itemId,
            })!,
            item.bounds,
          );
          expect(
            hitTestNumbered(layout, {
              x: item.bounds.x + item.bounds.width / 2,
              y: item.bounds.y + item.bounds.height / 2,
            }),
          ).toMatchObject({ eventId: events[i]!.id, itemId: item.itemId });
          expect(layoutNumberedBeatContext(layout, targets[i]!)).toEqual(
            context,
          );
        }
        // 导航不依赖渲染数组的偶然顺序，也不能原地排序调用方的 slots。
        measure.numberedNotation!.reverse();
        measure.numberedSlots.reverse();
        const slotOrder = measure.numberedSlots.map((slot) => slot.id);
        expect(layoutNumberedBeatContext(layout, targets[0]!)).toEqual(context);
        expect(measure.numberedSlots.map((slot) => slot.id)).toEqual(slotOrder);
      }
    },
  );
  it("单事件或同时多音只返回局部焦点，没有拍背景；明确 itemId 选择单音", () => {
    const { doc, track, m } = fixture();
    const event = m.numberedVoice.events[0]!;
    const target = {
      kind: "numbered" as const,
      trackId: track.id,
      measureId: m.id,
      eventId: event.id,
    };
    expect(layoutNumberedBeatContext(buildLayout(doc), target)).toBeNull();
    event.items = ["5", "3"].map((token, i) => ({ id: `chord-${i}`, token }));
    const layout = buildLayout(doc, { purpose: "editing" });
    const notation = layout.systems[0]!.measures[0]!.numberedNotation![0]!;
    expect(layoutNumberedBeatContext(layout, target)).toBeNull();
    const eventFocus = layoutParagraphFocus(layout, target)!;
    for (const item of notation.itemBounds!) {
      const focus = layoutParagraphFocus(layout, {
        ...target,
        itemId: item.itemId,
      })!;
      expect(focus).toEqual({
        x: item.bounds.x - 4,
        y: item.bounds.y - 2,
        width: item.bounds.width + 8,
        height: item.bounds.height + 4,
      });
      expect(focus.width).toBeLessThan(eventFocus.width);
      expectContains(eventFocus, focus);
    }
    expect(
      layoutParagraphFocus(layout, { ...target, itemId: "missing" }),
    ).toEqual(eventFocus);
  });
  it("不存在的目标、空输入槽和歌词不产生拍背景", () => {
    const { doc, track, m } = fixture();
    m.numberedVoice.events = [m.numberedVoice.events[0]!];
    const layout = buildLayout(doc, { purpose: "editing" });
    const target = { trackId: track.id, measureId: m.id };
    for (const invalid of [
      { ...target, eventId: "missing" },
      { ...target, trackId: "missing", eventId: m.numberedVoice.events[0]!.id },
      {
        ...target,
        measureId: "missing",
        eventId: m.numberedVoice.events[0]!.id,
      },
      { ...target, tick: 960, endTick: 1920 },
      {
        ...target,
        kind: "lyric" as const,
        eventId: m.numberedVoice.events[0]!.id,
      },
    ])
      expect(layoutNumberedBeatContext(layout, invalid)).toBeNull();
    const slot = layout.systems[0]!.measures[0]!.numberedInputSlots![0]!;
    expect(
      layoutParagraphFocus(layout, { ...slot.target, kind: "numbered" }),
    ).toEqual({
      x: slot.anchorX - Math.max(24, slot.width) / 2,
      y: slot.y,
      width: Math.max(24, slot.width),
      height: slot.height,
    });
  });
  it("换行重排后拍背景使用最终坐标且保留同拍事件顺序", () => {
    const doc = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = doc.score.tracks[0]!;
    track.numberedMarks = [];
    track.techniques = [];
    const m = track.measures[3]!;
    m.numberedVoice = {
      events: [0, 480].map((tick, i) => ({
        id: `reflow-${i}`,
        kind: "notes",
        tick,
        rhythm: { base: "eighth", dots: 0 },
        items: [{ id: `reflow-item-${i}`, token: i ? "3" : "5" }],
      })),
      tuplets: [],
    };
    const target = { trackId: track.id, measureId: m.id, eventId: "reflow-0" };
    const layouts = [400, 1800].map((systemWidth) =>
      buildLayout(doc, {
        purpose: "editing",
        systemWidth,
      }),
    );
    const contexts = layouts.map((layout) => {
      const measure = layout.systems
        .flatMap((s) => s.measures)
        .find((item) => item.id === m.id)!;
      const context = layoutNumberedBeatContext(layout, target)!;
      expect(context.eventIds).toEqual(["reflow-0", "reflow-1"]);
      for (const n of measure.numberedNotation!)
        expectContains(context.bounds, n.bounds);
      expect(
        layoutNumberedBeatContext(layout, { ...target, eventId: "reflow-1" }),
      ).toEqual(context);
      return { context, systemIndex: measure.systemIndex };
    });
    expect(contexts[0]!.systemIndex).not.toBe(contexts[1]!.systemIndex);
    expect(contexts[0]!.context.bounds).not.toEqual(
      contexts[1]!.context.bounds,
    );
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
