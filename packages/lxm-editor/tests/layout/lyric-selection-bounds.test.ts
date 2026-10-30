import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  hitTestMusicText,
  layoutLyricPlaceholder,
  layoutParagraphFocus,
  type ILXMNumberedEvent,
} from "../../src";

const fixture = (events: ILXMNumberedEvent[]) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  track.measures = [measure];
  track.techniques = [];
  track.numberedMarks = [];
  measure.chordSymbols = [];
  measure.lyrics = [];
  measure.numberedVoice = { events, tuplets: [] };
  const target = {
    kind: "lyric" as const,
    trackId: track.id,
    measureId: measure.id,
    eventId: events.find((event) => event.kind === "notes")!.id,
    verse: 1 as const,
  };
  const layout = buildLayout(document, {
    purpose: "editing",
    paragraphEditing: target,
    systemWidth: 720,
  });
  return {
    document,
    target,
    layout,
    measure: layout.systems[0]!.measures[0]!,
    cells: layout.systems[0]!.musicTextCells!,
  };
};

const event = (
  index: number,
  kind: ILXMNumberedEvent["kind"],
  base: "quarter" | "eighth" | "whole" = "quarter",
): ILXMNumberedEvent => {
  const timing = {
    id: `event-${index}`,
    tick: index * (base === "eighth" ? 480 : 960),
    rhythm: { base, dots: 0 },
  };
  if (kind === "gap") return { ...timing, kind, items: [] };
  return {
    ...timing,
    kind,
    items: [
      {
        id: `item-${index}`,
        token: kind === "rest" ? "0" : kind === "continuation" ? "-" : "5",
      },
    ],
  };
};

describe("歌词选区边界与紧凑显示", () => {
  it.each(["continuation", "gap"] as const)(
    "单音符前的 %s 和前后休止参与分隔，但不能填词",
    (kind) => {
      const { layout, target, measure, cells } = fixture(
        [
          event(0, "rest"),
          event(1, kind),
          event(2, "notes"),
          event(3, "rest"),
        ].reverse(),
      );
      expect(cells).toHaveLength(kind === "gap" ? 2 : 1);
      const cell = cells.find((cell) => cell.eventId === "event-2")!;
      const note = measure.numberedSlots.find((slot) => slot.id === "event-2")!;
      const before = measure.numberedSlots.find(
        (slot) => slot.id === "event-1",
      )!;
      const after = measure.numberedSlots.find(
        (slot) => slot.id === "event-3",
      )!;
      expect(cell.x).toBeGreaterThan(before.x);
      expect(cell.x).toBeLessThan(note.x);
      expect(cell.x + cell.width).toBeGreaterThan(note.x);
      expect(cell.x + cell.width).toBeLessThan(after.x);
      const y = cell.y + cell.height / 2;
      expect(hitTestMusicText(layout, { x: note.x, y })).toMatchObject({
        eventId: note.id,
        kind: "lyric",
      });
      for (const slot of measure.numberedSlots.filter(
        (slot) => slot.kind !== "notes" && slot.kind !== "gap",
      )) {
        expect(hitTestMusicText(layout, { x: slot.x, y })).toBeNull();
        expect(
          layoutParagraphFocus(layout, { ...target, eventId: slot.id }),
        ).toBeNull();
      }
      const focus = layoutParagraphFocus(layout, target)!;
      const placeholder = layoutLyricPlaceholder(cell, note.x);
      expect(focus.width).toBe(24);
      expect(focus.x + focus.width / 2).toBe(note.x);
      expect(placeholder.x + placeholder.width / 2).toBe(note.x);
      expect(placeholder.width).toBeLessThanOrEqual(24);
    },
  );

  it("全音符保留整小节可点击范围，显示框和焦点只围绕起音", () => {
    const { layout, target, measure, cells } = fixture([
      event(0, "notes", "whole"),
    ]);
    expect(cells).toHaveLength(1);
    const cell = cells[0]!;
    const anchor = measure.numberedSlots[0]!.x;
    const focus = layoutParagraphFocus(layout, target)!;
    const placeholder = layoutLyricPlaceholder(cell, anchor);
    expect(cell.width).toBe(measure.width);
    expect(focus.width).toBe(24);
    expect(placeholder.width).toBe(24);
    expect(focus.x + focus.width / 2).toBe(anchor);
    expect(placeholder.x).toBe(focus.x);
    expect(focus.width).toBeLessThan(cell.width / 2);
    expect(
      hitTestMusicText(layout, {
        x: cell.x + cell.width - 1,
        y: cell.y + cell.height / 2,
      }),
    ).toMatchObject({ eventId: target.eventId });
  });

  it("八个八分音符各有独立选区，点击和前后边界互不串位", () => {
    const { layout, target, measure, cells } = fixture(
      Array.from({ length: 8 }, (_, index) => event(index, "notes", "eighth")),
    );
    expect(cells).toHaveLength(8);
    cells.forEach((cell, index) => {
      const slot = measure.numberedSlots.find(
        (slot) => slot.id === cell.eventId,
      )!;
      const focus = layoutParagraphFocus(layout, {
        ...target,
        eventId: slot.id,
      })!;
      expect(focus.width).toBe(24);
      expect(focus.x + focus.width / 2).toBe(slot.x);
      for (const x of [cell.x + 0.1, slot.x, cell.x + cell.width - 0.1])
        expect(
          hitTestMusicText(layout, { x, y: cell.y + cell.height / 2 }),
        ).toMatchObject({ eventId: slot.id });
      const next = cells[index + 1];
      if (next) expect(cell.x + cell.width).toBeCloseTo(next.x);
    });
  });

  it("已有歌词仍对齐原音符，并按文字宽度显示编辑焦点", () => {
    const { document, target } = fixture([event(0, "notes", "whole")]);
    document.score.tracks[0]!.measures[0]!.lyrics = [
      { id: "lyric", eventId: target.eventId, verse: 1, text: "随风轻轻唱起" },
    ];
    const layout = buildLayout(document, {
      purpose: "editing",
      paragraphEditing: target,
    });
    const measure = layout.systems[0]!.measures[0]!;
    const lyric = measure.lyrics![0]!;
    const focus = layoutParagraphFocus(layout, target)!;
    expect(lyric.label.x).toBe(measure.numberedSlots[0]!.x);
    expect(focus.width).toBeGreaterThan(24);
    expect(
      hitTestMusicText(layout, {
        x: lyric.label.x,
        y: lyric.bounds.y + lyric.bounds.height / 2,
      }),
    ).toMatchObject({ id: "lyric", eventId: target.eventId });
  });
});
