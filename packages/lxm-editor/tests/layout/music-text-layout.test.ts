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
            expect(b.y).toBeGreaterThan(measure.y + measure.height);
          }
          for (const chord of measure.chordSymbols!) {
            expect(chord.label.x).toBe(
              measure.beats.find((b) => b.id === chord.beatId)!.x,
            );
            expect(chord.bounds.y).toBeGreaterThanOrEqual(system.y);
            expect(chord.bounds.y + chord.bounds.height).toBeLessThan(
              measure.y,
            );
            for (const technique of system.techniques)
              expect(chord.bounds.y + chord.bounds.height).toBeLessThan(
                technique.visualBounds.y,
              );
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
    measure.lyrics = measure.beats
      .slice(0, 2)
      .map((b, i) => ({
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
      diagram.texts.some((t) => t.text === "8" && t.textAnchor === "end"),
    ).toBe(true);
    diagram.texts.forEach((t) =>
      expect(t.bounds.x).toBeGreaterThanOrEqual(diagram.bounds.x),
    );
  });
});
