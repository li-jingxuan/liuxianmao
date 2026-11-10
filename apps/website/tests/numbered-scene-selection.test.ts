import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  type ILXMNumberedEvent,
} from "@liuxianmao/lxm-editor";
import { buildScoreScene } from "../components/EditorShell/score-scene";
import { ScoreMusicLayer } from "../components/EditorShell/ScoreMusicLayer";

const fixture = (withTabBeams = false) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.techniques = [];
  track.numberedMarks = [];
  const measure = track.measures[0]!;
  measure.lyrics = [];
  measure.chordSymbols = [];
  measure.numberedVoice = {
    events: [
      {
        id: "selected",
        tick: 0,
        kind: "notes",
        rhythm: { base: "eighth", dots: 0 },
        items: [
          { id: "sharp", token: "#5." },
          { id: "flat", token: "b6" },
        ],
      },
      {
        id: "neighbor",
        tick: 480,
        kind: "notes",
        rhythm: { base: "eighth", dots: 0 },
        items: [{ id: "neighbor-note", token: "3" }],
      },
      {
        id: "sustain",
        tick: 960,
        kind: "notes",
        rhythm: { base: "half", dots: 0 },
        items: [{ id: "sustain-note", token: "2" }],
      },
      {
        id: "dotted",
        tick: 2880,
        kind: "notes",
        rhythm: { base: "eighth", dots: 1 },
        items: [{ id: "dotted-note", token: "1" }],
      },
    ] satisfies ILXMNumberedEvent[],
    tuplets: [],
  };
  if (withTabBeams) {
    const template = structuredClone(measure.beats[0]!);
    measure.tuplets = [];
    measure.beats = [0, 480].map((tick, i) => ({
      ...structuredClone(template),
      id: `scene-tab-${i}`,
      tick,
      kind: "notes",
      rhythm: { base: "eighth", dots: 0 },
      notes: [{ id: `scene-tab-note-${i}`, string: 3, fret: 2 }],
    }));
    measure.lyrics = [{ id: "scene-lyric", eventId: "selected", verse: 1, text: "歌词" }];
  }
  const layout = buildLayout(document);
  return { layout, scene: buildScoreScene(layout) };
};

describe("简谱数字事件选中态", () => {
  it("共享场景输出细 TAB 符干与连梁，八度点及节奏附点保持各自半径", () => {
    const { layout, scene } = fixture(true);
    const before = structuredClone(layout);
    const items = scene.systems.flatMap((system) => system.items);
    const measures = layout.systems.flatMap((system) => system.measures);
    const stems = measures.flatMap((measure) => measure.durationMarks.filter((mark) => mark.stemVisible));
    const beams = measures.flatMap((measure) => measure.beamSegments);
    expect(stems.length).toBeGreaterThan(0);
    expect(beams.length).toBeGreaterThan(0);
    for (const mark of stems) expect(items).toContainEqual({
      kind: "line", x1: mark.stemX, y1: mark.stemY1,
      x2: mark.stemX, y2: mark.stemY2, stroke: "#000", strokeWidth: 0.75,
    });
    for (const beam of beams) expect(items).toContainEqual({
      kind: "line", x1: beam.x1, y1: beam.y, x2: beam.x2, y2: beam.y,
      stroke: "#000", strokeWidth: 1.5,
    });
    for (const notation of measures.flatMap((measure) => measure.numberedNotation!)) {
      for (const dot of notation.dots) expect(items).toContainEqual({
        kind: "circle", cx: dot.cx, cy: dot.cy, r: 0.8, fill: "#1d2025",
      });
      for (const dot of notation.rhythmDots ?? []) expect(items).toContainEqual({
        kind: "circle", cx: dot.cx, cy: dot.cy, r: 1.3, fill: "#1d2025",
      });
    }
    const lyric = measures[0]!.lyrics![0]!.label;
    expect(items).toContainEqual({
      kind: "text", text: "歌词", x: lyric.x, y: lyric.y, fontSize: 11,
      fontFamily: lyric.fontFamily, fontWeight: 400, textAnchor: "middle", fill: "#1d2025",
    });
    expect(layout).toEqual(before);
  });

  it("只给数字及升降号标记事件，公共线、时值线、八度点与附点不带选择元数据", () => {
    const { layout, scene } = fixture();
    const notation = layout.systems[0]!.measures[0]!.numberedNotation!;
    expect(notation.flatMap((n) => n.lines ?? []).some((l) => l.shared)).toBe(
      true,
    );
    expect(
      notation.find((n) => n.eventId === "sustain")!.lines!.length,
    ).toBeGreaterThan(0);
    expect(notation.flatMap((n) => n.dots).length).toBeGreaterThan(0);
    expect(notation.flatMap((n) => n.rhythmDots ?? []).length).toBeGreaterThan(
      0,
    );

    const items = scene.systems.flatMap((s) => s.items);
    for (const n of notation) {
      const tagged = items.filter((p) => p.numberedEventId === n.eventId);
      expect(tagged).toHaveLength(n.labels.length);
      expect(tagged.map((p) => p.kind === "text" && p.text)).toEqual(
        n.labels.map((g) => g.text),
      );
    }
    for (const p of items.filter((p) => p.kind !== "text")) {
      expect(p.numberedEventId).toBeUndefined();
      expect(p.numberedItemId).toBeUndefined();
    }
  });

  it("只把当前事件的全部数字与升降号渲染为蓝色，默认渲染及共享场景保持原色", () => {
    const { scene } = fixture();
    const before = JSON.stringify(scene);
    const render = (selectedNumberedEventId?: string | null) =>
      renderToStaticMarkup(
        createElement(ScoreMusicLayer, { scene, selectedNumberedEventId }),
      );
    const selected = render("selected");
    const blue = selected.match(/<[^>]+(?:fill|stroke)="#2864e3"[^>]*>/g) ?? [];
    expect(blue).toHaveLength(4);
    for (const element of blue) {
      expect(element).toMatch(/^<text /);
      expect(element).toContain('data-numbered-event="selected"');
    }
    expect(selected).toMatch(/<line [^>]*stroke="#000"/);
    expect(selected).toMatch(/<circle [^>]*fill="#1d2025"/);
    expect(render()).not.toContain("#2864e3");
    expect(render(null)).toBe(render());
    expect(render("missing")).toBe(render());
    expect(JSON.stringify(scene)).toBe(before);
  });
});
