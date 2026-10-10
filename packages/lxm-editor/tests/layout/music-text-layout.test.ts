import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_6_DOCUMENT,
  musicTextRequest,
  musicTextGlyph,
  collectMusicTextMeasureRequests,
  hitTestMusicText,
  layoutChordDiagram,
  copyChordPreset,
  type ILXMMusicTextMetrics,
} from "../../src";
import { getMeasureContentBottom } from "../../src/layout/rhythm-bounds";
import { getFretTextBounds } from "../../src/layout/technique-geometry";
import { scaleChordDiagram } from "../../src/layout/chord-diagram-layout";
/** 单次快照固定度量，测试不依赖浏览器字体或机器环境。 */
const metrics = (): ILXMMusicTextMetrics =>
  Object.fromEntries(
    collectMusicTextMeasureRequests(EXAMPLE_MVP_6_DOCUMENT).map((r) => [
      r.key,
      {
        x:
          r.textAnchor === "middle"
            ? -r.text.length * 6
            : r.textAnchor === "end"
              ? -r.text.length * 12
              : 0,
        y: -r.fontSize,
        width: r.text.length * 12,
        height: r.fontSize + 2,
      },
    ]),
  );
describe("MVP6 文本联合排版", () => {
  it("固定快照确定性，输入文档与快照不被修改", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const snapshot = metrics();
    const before = JSON.stringify([document, snapshot]);
    expect(
      buildLayout(document, { systemWidth: 733, musicTextMetrics: snapshot }),
    ).toEqual(
      buildLayout(document, { systemWidth: 733, musicTextMetrics: snapshot }),
    );
    expect(JSON.stringify([document, snapshot])).toBe(before);
  });
  it("度量不以字符数代替实际宽度，非法快照安全 fallback", () => {
    const request = musicTextRequest("i");
    expect(
      musicTextGlyph(request, 0, 0, {
        [request.key]: { x: -50, y: -12, width: 100, height: 14 },
      }).bounds.width,
    ).toBe(104);
    expect(
      musicTextGlyph(request, 0, 0, {
        [request.key]: { x: NaN, y: 0, width: 100, height: 14 },
      }).measured,
    ).toBe(false);
  });
  it.each([733, 420, 180])(
    "宽度 %i 下文本沿 Beat anchor，命中使用最终几何",
    (systemWidth) => {
      const layout = buildLayout(EXAMPLE_MVP_6_DOCUMENT, {
        systemWidth,
        musicTextMetrics: metrics(),
      });
      for (const system of layout.systems)
        for (const measure of system.measures) {
          for (const lyric of measure.lyrics!) {
            expect(lyric.label.x).toBe(
              measure.beats.find((b) => b.id === lyric.beatId)!.x,
            );
            const b = lyric.bounds;
            expect(
              hitTestMusicText(layout, {
                x: b.x + b.width / 2,
                y: b.y + b.height / 2,
              }),
            ).toMatchObject({
              id: lyric.id,
              beatId: lyric.beatId,
              kind: "lyric",
            });
            expect(b.y).toBeGreaterThanOrEqual(
              getMeasureContentBottom(measure) + 8 - 0.001,
            );
          }
          for (const chord of measure.chordSymbols!) {
            expect(chord.label.x).toBe(
              measure.beats.find((b) => b.id === chord.beatId)!.x +
                (chord.diagram ? 22.5 * 0.85 : 0),
            );
            expect(chord.bounds.y).toBeGreaterThanOrEqual(system.y);
            expect(chord.bounds.y + chord.bounds.height).toBeLessThan(
              measure.strings[0]!.y1,
            );
            // 只检查第一弦上方且横向接近的实际内容，允许远处标记共用高度。
            for (const obstacle of [
              ...system.techniques.map((t) => t.visualBounds),
              ...system.measures.flatMap((m) => m.notes.map(getFretTextBounds)),
            ]) {
              if (
                obstacle.y < measure.strings[0]!.y1 &&
                chord.bounds.x < obstacle.x + obstacle.width + 4 &&
                chord.bounds.x + chord.bounds.width + 4 > obstacle.x
              )
                expect(
                  chord.bounds.y + chord.bounds.height + 4,
                ).toBeLessThanOrEqual(obstacle.y + 0.001);
            }
          }
        }
      for (let i = 1; i < layout.systems.length; i++)
        expect(layout.systems[i]!.y).toBeGreaterThan(
          layout.systems[i - 1]!.y + layout.systems[i - 1]!.height,
        );
    },
  );
  it("四段共用行距，只有第三段也保留前两行槽位", () => {
    const layout = buildLayout(EXAMPLE_MVP_6_DOCUMENT, { systemWidth: 180 });
    const first = layout.systems[0]!;
    expect(first.lyricVerseLabels).toHaveLength(4);
    const system = layout.systems.find((s) =>
      s.measures.some((m) => m.id === "mvp51-7-measure"),
    )!;
    expect(system.lyricVerseLabels).toHaveLength(3);
    const label = system.measures.find((m) => m.id === "mvp51-7-measure")!
      .lyrics![0]!.label;
    expect(label.y).toBe(system.lyricVerseLabels![2]!.y);
  });
  it("相邻长文本预先扩宽并溢出，不缩字号、不裁切", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    document.score.tracks[0]!.measures = [
      document.score.tracks[0]!.measures[0]!,
    ];
    document.score.tracks[0]!.techniques = [];
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.lyrics = measure.beats.slice(0, 2).map((b, i) => ({
      id: `long-${i}`,
      beatId: b.id,
      verse: 1,
      text: "超长中文歌词".repeat(8),
    }));
    const layout = buildLayout(document, { systemWidth: 180 });
    const [a, b] = layout.systems[0]!.measures[0]!.lyrics!;
    expect(layout.width).toBeGreaterThan(180);
    expect(a!.bounds.x + a!.bounds.width + 6).toBeLessThanOrEqual(
      b!.bounds.x + 0.001,
    );
    expect(a!.bounds.x).toBeGreaterThanOrEqual(0);
    expect(b!.bounds.x + b!.bounds.width).toBeLessThanOrEqual(layout.width);
    expect(a!.label.fontSize).toBe(13);
  });
  it("纯名称隐藏图；高品位与横按均进入包围框", () => {
    const layout = buildLayout(EXAMPLE_MVP_6_DOCUMENT);
    const chord = layout.systems
      .flatMap((s) => s.measures)
      .find((m) => m.id === "mvp51-6-measure")!.chordSymbols![0]!;
    expect(chord.diagram).toBeNull();
    const f = copyChordPreset("F")!.diagram;
    f.startFret = 8;
    f.strings.forEach((s) => {
      if (typeof s.fret === "number" && s.fret > 0) s.fret += 7;
    });
    f.barres.forEach((b) => {
      b.fret += 7;
    });
    const diagram = layoutChordDiagram(f);
    expect(diagram.roundedRects).toHaveLength(1);
    expect(
      scaleChordDiagram(diagram, 0.85).roundedRects[0]!.height,
    ).toBeCloseTo(4);
    expect(
      diagram.texts.some((t) => t.text === "8" && t.textAnchor === "end"),
    ).toBe(true);
    diagram.texts.forEach((t) =>
      expect(t.bounds.x).toBeGreaterThanOrEqual(diagram.bounds.x),
    );
  });
  it("Am/C/F 名称、网格顶线及六弦中心轴统一，横按与高品位附件不会偏移网格", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const measures = document.score.tracks[0]!.measures.slice(0, 3);
    document.score.tracks[0]!.measures = measures;
    document.score.tracks[0]!.techniques = [];
    for (const [i, measure] of measures.entries()) {
      const name = ["Am", "C", "F"][i]!;
      measure.chordSymbols = [
        {
          id: `chord-${i}`,
          beatId: measure.beats[0]!.id,
          display: "nameAndDiagram",
          chord: copyChordPreset(name)!,
        },
      ];
    }
    const layout = buildLayout(document, { systemWidth: 1800 });
    const chords = layout.systems[0]!.measures.flatMap((m) => m.chordSymbols!);
    expect(chords).toHaveLength(3);
    expect(new Set(chords.map((c) => c.label.y)).size).toBe(1);
    expect(new Set(chords.map((c) => c.diagram!.lines[0]!.y1)).size).toBe(1);
    for (const chord of chords) {
      const xs = chord.diagram!.lines.flatMap((l) => [l.x1, l.x2]);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(chord.label.x);
      const vertical = chord.diagram!.lines[0]!;
      expect(vertical.y2 - vertical.y1).toBeCloseTo(30.6);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(38.25);
      expect(chord.diagram!.texts.every((t) => t.fontSize >= 7)).toBe(true);
      expect(
        hitTestMusicText(layout, { x: chord.label.x, y: vertical.y1 + 15.3 }),
      ).toMatchObject({ id: chord.id, kind: "chord" });
      for (const text of chord.diagram!.texts) {
        expect(text.bounds.x).toBeGreaterThanOrEqual(chord.diagram!.bounds.x);
        expect(text.bounds.x + text.bounds.width).toBeLessThanOrEqual(
          chord.diagram!.bounds.x + chord.diagram!.bounds.width + 0.001,
        );
      }
    }
    const f = measures[2]!.chordSymbols[0]!.chord.diagram!;
    f.startFret = 8;
    f.strings.forEach((s) => {
      if (typeof s.fret === "number" && s.fret > 0) s.fret += 7;
    });
    f.barres.forEach((b) => {
      b.fret += 7;
    });
    const updated = buildLayout(document, {
      systemWidth: 1800,
    }).systems[0]!.measures.flatMap((m) => m.chordSymbols!);
    expect(new Set(updated.map((c) => c.diagram!.lines[0]!.y1)).size).toBe(1);
    expect(updated[2]!.diagram!.lines[0]!.x1 + 22.5 * 0.85).toBe(
      updated[2]!.label.x,
    );
  });
  it("正常字号四段基线间隔 24，较高文字轮廓自动扩大行距", () => {
    const snapshot = { ...metrics() };
    for (const request of collectMusicTextMeasureRequests(
      EXAMPLE_MVP_6_DOCUMENT,
    )) {
      if (request.fontSize === 13)
        snapshot[request.key] = { x: -6, y: -12, width: 12, height: 15 };
    }
    const labels = buildLayout(EXAMPLE_MVP_6_DOCUMENT, {
      musicTextMetrics: snapshot,
    }).systems[0]!.lyricVerseLabels!;
    expect(labels[1]!.y - labels[0]!.y).toBeCloseTo(24);
    for (const request of collectMusicTextMeasureRequests(
      EXAMPLE_MVP_6_DOCUMENT,
    )) {
      if (request.fontSize === 13)
        snapshot[request.key] = { x: -6, y: -20, width: 12, height: 28 };
    }
    const tall = buildLayout(EXAMPLE_MVP_6_DOCUMENT, {
      musicTextMetrics: snapshot,
    }).systems[0]!.lyricVerseLabels!;
    expect(tall[1]!.y - tall[0]!.y).toBeGreaterThan(24);
    expect(tall[0]!.bounds.y + tall[0]!.bounds.height + 3).toBeLessThanOrEqual(
      tall[1]!.bounds.y + 0.001,
    );
  });
});
