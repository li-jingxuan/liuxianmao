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

const fixture = () => {
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
  const layout = buildLayout(document);
  return { layout, scene: buildScoreScene(layout) };
};

describe("简谱数字事件选中态", () => {
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
