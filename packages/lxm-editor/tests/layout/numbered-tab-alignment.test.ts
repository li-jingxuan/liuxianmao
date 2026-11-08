import { describe, expect, it } from "vitest";
import {
  buildLayout,
  hitTestMusicText,
  hitTestNumbered,
  planLyricPositions,
  type ILXMLyricVerse,
} from "../../src";
import { applyRhythmSync, rhythmSyncFixture } from "../helpers/rhythm-sync";

describe("同步细分后的输入几何与实际减时线", () => {
  it.each(["A", "B"] as const)(
    "%s 新 gap 与全部歌词段命中同一事件，成品不生成空音和线",
    (scenario) => {
      const { document, target, align } = rhythmSyncFixture(scenario);
      const result = applyRhythmSync(document, align);
      const gapId = result.nextNumberedFocus!.eventId!;
      const tick = scenario === "A" ? 480 : 240;
      const positions = planLyricPositions(
        result.document.score.tracks[0]!.measures[0]!,
      );
      expect(positions.find((p) => p.tick === tick)).toMatchObject({
        eventId: gapId,
      });
      for (const verse of [1, 2, 3, 4] as ILXMLyricVerse[]) {
        for (const systemWidth of [360, 1000]) {
          const layout = buildLayout(result.document, {
            purpose: "editing",
            systemWidth,
            paragraphEditing: { ...target, kind: "lyric", verse },
          });
          const system = layout.systems[0]!;
          const measure = system.measures[0]!;
          const slot = measure.numberedInputSlots!.find(
            (s) =>
              s.target.kind === "numberedEvent" && s.target.eventId === gapId,
          )!;
          expect(slot.startTick).toBe(tick);
          expect(
            hitTestNumbered(layout, {
              x: slot.anchorX,
              y: slot.y + slot.height / 2,
            }),
          ).toMatchObject({ eventId: gapId });
          const cell = system.musicTextCells!.find(
            (c) =>
              c.kind === "lyric" && c.eventId === gapId && c.verse === verse,
          )!;
          expect(cell.anchorX).toBeCloseTo(slot.anchorX);
          expect(
            hitTestMusicText(layout, {
              x: cell.anchorX!,
              y: cell.y + cell.height / 2,
            }),
          ).toMatchObject({ eventId: gapId, verse });
          expect(
            measure.numberedNotation!.find((n) => n.eventId === gapId),
          ).toBeUndefined();
        }
      }
      const finished = buildLayout(result.document, { purpose: "presentation" })
        .systems[0]!.measures[0]!;
      expect(finished.numberedInputSlots ?? []).toEqual([]);
      expect(finished.numberedNotation!.some((n) => n.eventId === gapId)).toBe(
        false,
      );
      expect(finished.numberedSlots.find((s) => s.id === gapId)?.tick).toBe(
        tick,
      );
    },
  );

  it.each(["editing", "presentation"] as const)(
    "%s B 补音后第一层跨三音、第二层仅跨两个十六分；实际五个十六分仍有双线",
    (purpose) => {
      const { document, align, target } = rhythmSyncFixture("B");
      const aligned = applyRhythmSync(document, align);
      const filled = applyRhythmSync(aligned.document, {
        type: "numbered.event.set",
        ...target,
        eventId: aligned.nextNumberedFocus!.eventId!,
        tokens: ["5"],
      });
      const rendered = buildLayout(filled.document, { purpose }).systems[0]!
        .measures[0]!;
      const frames = rendered.numberedNotation!.filter((n) =>
        ["event-0", aligned.nextNumberedFocus!.eventId!, "event-1"].includes(
          n.eventId,
        ),
      );
      expect(frames).toHaveLength(3);
      const lines = frames.flatMap((n) => n.lines!);
      expect(lines).toHaveLength(2);
      const [first, second] = [...lines].sort((a, b) => a.y - b.y);
      expect(first!.shared).toBe(true);
      expect(second!.shared).toBe(true);
      expect(first!.x1).toBeLessThanOrEqual(frames[0]!.labels[0]!.x);
      expect(first!.x2).toBeGreaterThan(frames[2]!.labels[0]!.x);
      expect(second!.x2).toBeGreaterThan(frames[1]!.labels[0]!.x);
      expect(second!.x2).toBeLessThan(frames[2]!.labels[0]!.x);
      const uniform = rhythmSyncFixture("combined");
      uniform.measure.lyrics = [];
      uniform.measure.numberedVoice.events = Array.from(
        { length: 5 },
        (_, i) => ({
          id: `u-${i}`,
          tick: i * 240,
          kind: "notes",
          rhythm: { base: "sixteenth", dots: 0 },
          items: [{ id: `ui-${i}`, token: "3" }],
        }),
      );
      const uniformFrames = buildLayout(uniform.document, { purpose })
        .systems[0]!.measures[0]!.numberedNotation!;
      const uniformLines = uniformFrames.flatMap((n) => n.lines!);
      expect(new Set(uniformLines.map((l) => l.y)).size).toBe(2);
      expect(uniformFrames.at(-1)!.lines).toHaveLength(2);
    },
  );

  it("TAB 普通拆分后真空窗两行入口同步派生且布局不写文档", () => {
    const fixture = rhythmSyncFixture("combined");
    fixture.measure.numberedVoice.events = [];
    fixture.measure.lyrics = [];
    const result = applyRhythmSync(fixture.document, fixture.split);
    const before = structuredClone(result.document);
    const layout = buildLayout(result.document, {
      purpose: "editing",
      paragraphEditing: { ...fixture.target, kind: "lyric", verse: 1 },
    });
    const system = layout.systems[0]!;
    const slot = system.measures[0]!.numberedInputSlots!.find(
      (s) => s.startTick === 480,
    )!;
    const cell = system.musicTextCells!.find(
      (c) => c.tick === 480 && c.verse === 1,
    )!;
    expect(slot.endTick).toBe(960);
    expect(
      hitTestNumbered(layout, { x: slot.anchorX, y: slot.y + slot.height / 2 }),
    ).toMatchObject({ tick: 480, endTick: 960 });
    expect(
      hitTestMusicText(layout, {
        x: cell.anchorX!,
        y: cell.y + cell.height / 2,
      }),
    ).toMatchObject({ tick: 480, endTick: 960 });
    expect(cell.anchorX).toBeCloseTo(slot.anchorX);
    expect(result.document).toEqual(before);
    expect(
      result.document.score.tracks[0]!.measures[0]!.numberedVoice.events,
    ).toEqual([]);
  });
});
