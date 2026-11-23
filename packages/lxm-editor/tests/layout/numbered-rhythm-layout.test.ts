import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  buildLayout,
  buildScoreScene,
  EXAMPLE_MVP_7_2_DOCUMENT,
  hitTestNumbered,
  type ILXMNumberedEvent,
} from "../../src";
import {
  musicTextInkBounds,
  musicTextRequest,
} from "../../src/layout/music-text/music-text-metrics";
import { numberedLayoutProfile } from "../../src/layout/music-text/numbered-layout-profile";

const note = (
  tick: number,
  base: ILXMNumberedEvent["rhythm"]["base"] = "eighth",
): ILXMNumberedEvent => ({
  id: `e${tick}`,
  tick,
  kind: "notes",
  rhythm: { base, dots: 0 },
  items: [{ id: `i${tick}`, token: tick === 0 ? "5" : "6" }],
});

describe("BUG-071 简谱连音弧线", () => {
  it.each(["editing", "presentation"] as const)(
    "%s 使用两段对称弧线围住三连音数字，并避让已有连线",
    (purpose) => {
      const { document, measure } = fixture([note(0), note(480), note(960)]);
      const track = document.score.tracks[0]!;
      track.numberedMarks = [
        { id: "slur", type: "slur", fromEventId: "e0", toEventId: "e960" },
      ];
      const result = applyScoreCommand(document, {
        type: "numbered.tuplet.add",
        trackId: track.id,
        measureId: measure.id,
        eventIds: ["e0", "e480", "e960"],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const metric = { x: -3, y: -8, width: 6, height: 8 };
      const layout = buildLayout(result.document, {
        purpose,
        density: "compact",
        musicTextMetrics:
          purpose === "editing"
            ? { [musicTextRequest("3", 11).key]: metric }
            : undefined,
      });
      const system = layout.systems[0]!;
      const frames = system.measures[0]!.numberedNotation!;
      const slur = system.numberedMarks!.find((m) => m.type === "slur")!;
      const tuplet = system.numberedMarks!.find((m) => m.type === "tuplet")!;
      const path = tuplet.path!;
      const label = tuplet.labels[0]!;
      const ink = musicTextInkBounds(label);
      const tokens = path.d.split(" ");
      expect(tokens.filter((token) => /^[A-Z]$/.test(token))).toEqual([
        "M", "Q", "M", "Q",
      ]);
      const [x1, y1, leftControlX, leftControlY, leftGapX, leftGapY,
        rightGapX, rightGapY, rightControlX, rightControlY, x2, y2] =
        tokens.filter((token) => token !== "M" && token !== "Q").map(Number);

      expect(label.text).toBe("3");
      expect(label.measured).toBe(purpose === "editing");
      expect(label.x).toBeCloseTo(
        (frames[0]!.labels[0]!.x + frames[2]!.labels[0]!.x) / 2,
      );
      expect((x1! + x2!) / 2).toBeCloseTo(label.x);
      expect((leftGapX! + rightGapX!) / 2).toBeCloseTo(label.x);
      expect(leftGapX).toBeLessThan(ink.x);
      expect(rightGapX).toBeGreaterThan(ink.x + ink.width);
      expect(leftControlX).toBeGreaterThan(x1!);
      expect(leftControlX).toBeLessThan(leftGapX!);
      expect(rightControlX).toBeGreaterThan(rightGapX!);
      expect(rightControlX).toBeLessThan(x2!);
      expect(y1).toBeCloseTo(y2!);
      expect(leftGapY).toBeCloseTo(rightGapY!);
      expect(leftControlY).toBeCloseTo(rightControlY!);
      expect(leftGapY).toBeLessThan(leftControlY!);
      expect(leftControlY).toBeLessThan(y1!);
      expect(ink.y + ink.height / 2).toBeLessThan(leftGapY!);
      expect(
        Math.max(y1! + path.strokeWidth / 2, ink.y + ink.height),
      ).toBeLessThan(slur.bounds.y);
      const sceneItems = buildScoreScene(layout).systems[0]!.items.filter(
        (item) => item.numberedMarkId === tuplet.markId,
      );
      expect(sceneItems).toMatchObject([
        { kind: "path", d: path.d, fill: "none" },
        { kind: "text", text: "3", x: label.x, y: label.y, textAnchor: "middle" },
      ]);
    },
  );
});

const fixture = (events: ILXMNumberedEvent[]) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.techniques = [];
  track.numberedMarks = [];
  const measure = track.measures[0]!;
  measure.lyrics = [];
  measure.chordSymbols = [];
  measure.numberedVoice = { events, tuplets: [] };
  return { document, measure };
};

describe("简谱减时线合并", () => {
  it.each(["editing", "presentation"] as const)(
    "%s 低音点贴近数字或本音减时线，不受其它音符的三层连梁影响",
    (purpose) => {
      for (const base of ["quarter", "eighth", "sixteenth", "thirtySecond"] as const) {
        const low = note(0, base);
        low.items = [{ id: "bass", token: "6.." }];
        const { document } = fixture([low, note(960, "thirtySecond")]);
        const layout = buildLayout(document, { purpose });
        const frame = layout.systems[0]!.measures[0]!.numberedNotation![0]!;
        const ink = musicTextInkBounds(frame.labels[0]!);
        const bottom = Math.max(
          ink.y + ink.height,
          ...frame.lines!.map((line) => line.y + line.thickness / 2),
        );
        const profile = numberedLayoutProfile(purpose);
        expect(frame.dots).toHaveLength(2);
        expect(frame.dots[0]!.cy - frame.dots[0]!.r - bottom).toBeCloseTo(profile.octaveGap);
        expect(frame.dots.every((dot) => dot.r === 0.8)).toBe(true);
        expect(frame.dots[1]!.cy - frame.dots[0]!.cy).toBeCloseTo(1.6 + profile.octaveStackGap);
        expect(frame.bounds.y + frame.bounds.height + 0.000001).toBeGreaterThanOrEqual(frame.dots[1]!.cy + frame.dots[1]!.r);
        expect(hitTestNumbered(layout, { x: frame.dots[1]!.cx, y: frame.dots[1]!.cy })).toMatchObject({ itemId: "bass" });
      }
    },
  );

  it.each(["editing", "presentation"] as const)(
    "%s 的同拍八分音符只绘制一条公共线，命中范围仍属于各自音符",
    (purpose) => {
      const { document } = fixture([note(0), note(480)]);
      const layout = buildLayout(document, { purpose });
      const frames = layout.systems[0]!.measures[0]!.numberedNotation!;
      const lines = frames.flatMap((frame) => frame.lines!);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.shared).toBe(true);
      expect(lines[0]!.x1).toBeCloseTo(musicTextInkBounds(frames[0]!.labels[0]!).x - 1);
      expect(lines[0]!.x2).toBeGreaterThan(frames[1]!.labels[0]!.x);
      for (const frame of frames) {
        expect(frame.bounds.width).toBeLessThan(lines[0]!.x2 - lines[0]!.x1);
        expect(
          hitTestNumbered(layout, {
            x: frame.labels[0]!.x,
            y: lines[0]!.y,
          }),
        ).toMatchObject({ eventId: frame.eventId });
      }
    },
  );

  it("混合八分与十六分按层合并，保留孤立的第二层短线", () => {
    const { document } = fixture([
      note(0),
      note(480, "sixteenth"),
      note(720, "thirtySecond"),
      note(840, "thirtySecond"),
    ]);
    const frames =
      buildLayout(document).systems[0]!.measures[0]!.numberedNotation!;
    const lines = frames.flatMap((frame) => frame.lines!);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.shared)).toBe(true);
    expect(new Set(lines.map((line) => line.y)).size).toBe(3);

    const isolated = fixture([note(0), note(480, "sixteenth")]);
    const isolatedFrames = buildLayout(isolated.document).systems[0]!
      .measures[0]!.numberedNotation!;
    expect(isolatedFrames[0]!.lines).toHaveLength(1);
    expect(isolatedFrames[0]!.lines![0]!.shared).toBe(true);
    expect(isolatedFrames[1]!.lines).toHaveLength(1);
    expect(isolatedFrames[1]!.lines![0]!.shared).not.toBe(true);
    expect(isolatedFrames[1]!.lines![0]!.y).toBeCloseTo(
      isolatedFrames[0]!.lines![0]!.y + 3,
    );
  });

  it("相邻拍组各自只有一条公共线", () => {
    const { document } = fixture([0, 480, 960, 1440].map((tick) => note(tick)));
    const frames =
      buildLayout(document).systems[0]!.measures[0]!.numberedNotation!;
    expect(frames.map((frame) => frame.lines!.length)).toEqual([1, 0, 1, 0]);
    expect(
      frames.flatMap((frame) => frame.lines!).every((line) => line.shared),
    ).toBe(true);
    expect(frames[0]!.lines![0]!.x2).toBeLessThan(frames[2]!.lines![0]!.x1);
  });

  it.each(["gap", "continuation", "empty"] as const)(
    "%s 中断公共线，保留孤立音符的减时线",
    (kind) => {
      const events = [note(0, "sixteenth"), note(480, "sixteenth")];
      if (kind === "gap")
        events.splice(1, 0, { ...note(240, "sixteenth"), kind, items: [] });
      if (kind === "continuation")
        events.splice(1, 0, {
          ...note(240, "sixteenth"), kind,
          items: [{ id: "continuation", token: "-" }],
        });
      const { document } = fixture(events);
      const frames =
        buildLayout(document).systems[0]!.measures[0]!.numberedNotation!;
      const lines = frames.flatMap((frame) => frame.lines!);
      expect(lines.some((line) => line.shared)).toBe(false);
      for (const id of ["e0", "e480"])
        expect(
          frames.find((frame) => frame.eventId === id)!.lines,
        ).toHaveLength(2);
    },
  );

  it("三连音只保留组内公共线，不吞掉组外音符的短线", () => {
    const { document, measure } = fixture([
      note(0),
      note(320),
      note(640),
      note(960),
    ]);
    measure.numberedVoice.tuplets = [
      {
        id: "triplet",
        ratio: { actual: 3, normal: 2 },
        eventIds: ["e0", "e320", "e640"],
      },
    ];
    const frames =
      buildLayout(document).systems[0]!.measures[0]!.numberedNotation!;
    expect(frames.map((frame) => frame.lines!.length)).toEqual([1, 0, 0, 1]);
    expect(frames[0]!.lines![0]!.shared).toBe(true);
    expect(frames[3]!.lines![0]!.shared).not.toBe(true);
  });
});
