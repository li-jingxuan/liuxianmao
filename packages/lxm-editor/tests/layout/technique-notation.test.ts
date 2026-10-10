import { describe, expect, it } from "vitest";
import source from "../../example/example-mvp2.json";
import type { ILXMTechnique } from "../../src/core/types";
import { buildLayout, hitTestTechnique } from "../../src/layout";
import {
  getFretTextBounds,
  getTextBounds,
} from "../../src/layout/technique-geometry";

/** 单小节、两位品位与密集列直接检验实际布局，避免只测试模板常数。 */
const fixture = (technique: ILXMTechnique, fret = 12) => {
  const document = structuredClone(source);
  const track = document.score.tracks[0]!;
  track.measures = track.measures.slice(0, 1);
  track.measures[0]!.beats.forEach((beat, index) => {
    beat.notes = [{ id: `note-${index}`, string: 3, fret }];
  });
  track.techniques = [technique];
  return document;
};
const points = (path: string) =>
  (path.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

describe("技巧记谱方向、净空和单次品位显示", () => {
  it.each([3, 12, 24])(
    "推弦从 %i 品位右缘起笔，箭头向上且 Full 与箭头分开",
    (fret) => {
      const layout = buildLayout(
        fixture(
          { id: "bend", type: "bend", fromNoteId: "note-0", semitones: 2 },
          fret,
        ),
      );
      const note = layout.systems[0]!.measures[0]!.notes[0]!;
      const segment = layout.systems[0]!.techniques[0]!;
      const p = points(segment.path!.d);
      const bounds = getFretTextBounds(note);
      expect(p[0]).toBeGreaterThan(bounds.x + bounds.width);
      expect(p[2]).toBe(p[4]);
      expect(p[5]).toBeLessThan(p[3]!);
      const label = getTextBounds(segment.texts[0]!);
      expect(label.y + label.height).toBeLessThan(p[5]! - 6);
    },
  );

  it("揉弦从完整品位右缘展开，不覆盖品位中心", () => {
    const layout = buildLayout(
      fixture({ id: "vibrato", type: "vibrato", fromNoteId: "note-0" }),
    );
    const note = layout.systems[0]!.measures[0]!.notes[0]!;
    const p = points(layout.systems[0]!.techniques[0]!.path!.d);
    const bounds = getFretTextBounds(note);
    expect(p[0]).toBeGreaterThan(bounds.x + bounds.width);
    expect(p.at(-2)).toBeGreaterThan(p[0]!);
  });

  it("推弦叠加揉弦时在 Full 右侧延续，并保持在推弦终点高度", () => {
    const document = fixture({
      id: "bend",
      type: "bend",
      fromNoteId: "note-0",
      semitones: 2,
    });
    document.score.tracks[0]!.techniques!.push({
      id: "vibrato",
      type: "vibrato",
      fromNoteId: "note-0",
    });
    const segments = buildLayout(document).systems[0]!.techniques;
    const bend = segments.find((s) => s.type === "bend")!;
    const vibrato = segments.find((s) => s.type === "vibrato")!;
    const bendPoints = points(bend.path!.d);
    const wave = points(vibrato.path!.d);
    const full = getTextBounds(bend.texts[0]!, 1);
    expect(wave[0]).toBeGreaterThan(full.x + full.width);
    expect(wave[1]).toBe(bendPoints[5]);
  });

  it.each(["tapping", "artificialHarmonic"] as const)(
    "%s 标签避开完整品位墨迹",
    (type) => {
      const layout = buildLayout(
        fixture({ id: "annotation", type, fromNoteId: "note-0" }),
      );
      const system = layout.systems[0]!;
      const note = getFretTextBounds(system.measures[0]!.notes[0]!);
      const label = getTextBounds(system.techniques[0]!.texts[0]!, 1);
      expect(label.y + label.height).toBeLessThanOrEqual(note.y);
    },
  );

  it("Trill 波浪线在完整辅助品位标签之后", () => {
    const segment = buildLayout(
      fixture({
        id: "trill",
        type: "trill",
        fromNoteId: "note-0",
        auxiliaryFret: 24,
      }),
    ).systems[0]!.techniques[0]!;
    const label = getTextBounds(segment.texts[0]!);
    expect(points(segment.path!.d)[0]).toBeGreaterThan(label.x + label.width);
  });

  it.each(["slideUp", "slideDown"] as const)(
    "%s 具有可辨识方向且避开两端数字",
    (type) => {
      const document = fixture({
        id: "slide",
        type,
        fromNoteId: "note-0",
        toNoteId: "note-1",
      });
      document.score.tracks[0]!.measures[0]!.beats[1]!.notes[0]!.fret =
        type === "slideUp" ? 17 : 7;
      const layout = buildLayout(document);
      const notes = layout.systems[0]!.measures[0]!.notes;
      const p = points(layout.systems[0]!.techniques[0]!.path!.d);
      const a = getFretTextBounds(notes[0]!);
      const z = getFretTextBounds(notes[1]!);
      expect(p[0]).toBeGreaterThan(a.x + a.width);
      expect(p[2]).toBeLessThan(z.x);
      expect(type === "slideUp" ? p[3]! < p[1]! : p[3]! > p[1]!).toBe(true);
    },
  );

  it("自然泛音只渲染一份完整品位且仍可命中技巧", () => {
    const document = fixture({
      id: "harmonic",
      type: "naturalHarmonic",
      fromNoteId: "note-0",
    });
    const before = structuredClone(document);
    const layout = buildLayout(document);
    expect(
      layout.systems[0]!.measures[0]!.notes.some((n) => n.id === "note-0"),
    ).toBe(false);
    const segment = layout.systems[0]!.techniques[0]!;
    expect(segment.texts.map((t) => t.text)).toEqual(["<12>"]);
    expect(
      hitTestTechnique(layout, {
        x: segment.bounds.x + segment.bounds.width / 2,
        y: segment.bounds.y + segment.bounds.height / 2,
      }),
    ).toBe("harmonic");
    expect(document).toEqual(before);
  });

  it("人工泛音保留原品位并只增加 A.H. 注释", () => {
    const layout = buildLayout(
      fixture({ id: "ah", type: "artificialHarmonic", fromNoteId: "note-0" }),
    );
    expect(layout.systems[0]!.measures[0]!.notes[0]!.fretText).toBe("12");
    expect(layout.systems[0]!.techniques[0]!.texts.map((t) => t.text)).toEqual([
      "A.H.",
    ]);
  });

  it.each(["down", "up"] as const)(
    "%s 拨片标记用几何图元而非字体字符",
    (stroke) => {
      const segment = buildLayout(
        fixture({
          id: "pick",
          type: "pickStroke",
          beatId: "mvp2-beat-1-1",
          stroke,
        }),
      ).systems[0]!.techniques[0]!;
      expect(segment.texts).toEqual([]);
      expect(segment.path).not.toBeNull();
    },
  );

  it.each(["bend", "vibrato", "trill"] as const)(
    "密集短音与行末 %s 预留完整右侧空间",
    (type) => {
      const technique: ILXMTechnique =
        type === "bend"
          ? { id: "last", type, fromNoteId: "last-note", semitones: 2 }
          : type === "trill"
            ? { id: "last", type, fromNoteId: "last-note", auxiliaryFret: 24 }
            : { id: "last", type, fromNoteId: "last-note" };
      const document = fixture(technique);
      const measure = document.score.tracks[0]!.measures[0]!;
      measure.beats = Array.from({ length: 32 }, (_, i) => ({
        id: `dense-${i}`,
        tick: i * 120,
        rhythm: { base: "thirtySecond", dots: 0 },
        kind: "notes",
        notes: [
          {
            id: i === 31 ? "last-note" : `dense-note-${i}`,
            string: 3,
            fret: 12,
          },
        ],
      }));
      for (const density of ["compact", "comfortable"] as const) {
        const layout = buildLayout(document, { density, systemWidth: 300 });
        const system = layout.systems[0]!;
        const segment = system.techniques[0]!;
        expect(
          segment.visualBounds.x + segment.visualBounds.width,
        ).toBeLessThanOrEqual(system.x + system.width);
        expect(JSON.stringify(layout)).not.toMatch(/NaN|Infinity/);
      }
    },
  );
});
