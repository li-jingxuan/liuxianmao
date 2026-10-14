import { describe, expect, it } from "vitest";
import {
  A4_CONTENT_WIDTH,
  EXAMPLE_MVP_7_2_DOCUMENT,
  buildLayout,
  hitTestNumbered,
  loadDocument,
  parseNumberedSequence,
  layoutParagraphFocus,
  collectMusicTextMeasureRequests,
  copyChordPreset,
} from "@liuxianmao/lxm-editor";
import { getMeasureContentBottom } from "../../../packages/lxm-editor/src/layout/rhythm-bounds";
import { createEditorSession, editorStore } from "../stores/editor-store";
import { buildScoreScene } from "../components/EditorShell/score-scene";

/** 使用首页同一份 mock，验证真实 loader、布局、会话和导出投影。 */
describe("MVP v7.2 简谱 mock", () => {
  it("首页默认加载八小节 mock，特殊符号与空拍均经过正式加载器", () => {
    const loaded = loadDocument(JSON.stringify(EXAMPLE_MVP_7_2_DOCUMENT));
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    expect(editorStore.getState().document).toEqual(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = EXAMPLE_MVP_7_2_DOCUMENT.score.tracks[0]!;
    expect(track.measures).toHaveLength(8);
    const events = track.measures.flatMap((m) => m.numberedVoice.events);
    expect(events).toHaveLength(29);
    expect(
      track.measures[5]!.numberedVoice.events.some(
        (e) => e.tick === track.measures[5]!.beats[1]!.tick,
      ),
    ).toBe(false);
    expect(track.measures[6]!.numberedVoice.events.length === 0).toBe(true);
    expect(events.flatMap((e) => e.items.map((i) => i.token))).toEqual(
      expect.arrayContaining(["0", "-", "#4'", "b7.", "1''", "6..."]),
    );
  });

  it.each(["compact", "comfortable"] as const)(
    "%s 布局保留八度点、可命中的多音及图片图元，左线停在首行歌词上缘",
    (density) => {
      const layout = buildLayout(EXAMPLE_MVP_7_2_DOCUMENT, {
        systemWidth: A4_CONTENT_WIDTH,
        density,
      });
      const scene = buildScoreScene(layout);
      let notationCount = 0;
      let dotCount = 0;
      for (const system of layout.systems) {
        const items = scene.systems.find(
          (s) => s.index === system.index,
        )!.items;
        const lyrics = system.measures.flatMap((m) => m.lyrics ?? []);
        const tabBottom = Math.max(
          ...system.measures.map(getMeasureContentBottom),
          ...system.techniques.map(
            (t) => t.visualBounds.y + t.visualBounds.height,
          ),
        );
        if (lyrics.length) {
          const firstVerse = Math.min(...lyrics.map((l) => l.verse));
          expect(system.leftEdge![0]!.y2).toBeCloseTo(
            Math.min(
              ...lyrics
                .filter((l) => l.verse === firstVerse)
                .map((l) => l.bounds.y),
            ),
          );
        }
        for (const measure of system.measures) {
          for (const notation of measure.numberedNotation ?? []) {
            notationCount++;
            dotCount += notation.dots.length;
            const bounds = notation.bounds;
            expect(
              hitTestNumbered(layout, {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
              }),
            ).toMatchObject({
              kind: "numberedEvent",
              eventId: notation.eventId,
            });
            expect(bounds.y).toBeGreaterThan(tabBottom);
            if (lyrics.length)
              expect(bounds.y + bounds.height).toBeLessThan(
                Math.min(...lyrics.map((l) => l.bounds.y)),
              );
            expect(bounds.y + bounds.height).toBeLessThanOrEqual(
              system.y + system.height,
            );
            for (const glyph of notation.labels)
              expect(
                items.some(
                  (p) =>
                    p.kind === "text" &&
                    p.text === glyph.text &&
                    p.x === glyph.x &&
                    p.y === glyph.y,
                ),
              ).toBe(true);
            for (const dot of notation.dots)
              expect(items).toContainEqual({
                ...dot,
                kind: "circle",
                fill: "#1d2025",
              });
          }
        }
      }
      expect(notationCount).toBe(29);
      expect(dotCount).toBe(15);
      // 无简谱与歌词的小节单独成行时不创建简谱占位，竖线仅到横梁。
      const isolated = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
      isolated.score.tracks[0]!.measures = [
        isolated.score.tracks[0]!.measures[6]!,
      ];
      const emptySystem = buildLayout(isolated, { density, systemWidth: 420 })
        .systems[0]!;
      const emptyMeasure = emptySystem.measures[0]!;
      expect(emptyMeasure.numberedNotation).toEqual([]);
      expect(emptySystem.leftEdge![0]!.y2).toBeCloseTo(
        Math.max(...emptyMeasure.beamSegments.map((b) => b.y)),
      );
    },
  );

  it("三处 C 指法图与名称匹配且快照独立，显示开关只改变布局", () => {
    const chords = EXAMPLE_MVP_7_2_DOCUMENT.score.tracks[0]!.measures.flatMap(
      (m) => m.chordSymbols,
    );
    expect(chords).toHaveLength(3);
    for (const symbol of chords) {
      expect(symbol.display).toBe("nameAndDiagram");
      expect(symbol.chord).toEqual(copyChordPreset("C"));
    }
    expect(chords[0]!.chord.diagram).not.toBe(chords[1]!.chord.diagram);
    const visible = buildLayout(EXAMPLE_MVP_7_2_DOCUMENT, {
      showChordDiagrams: true,
    });
    const hidden = buildLayout(EXAMPLE_MVP_7_2_DOCUMENT, {
      showChordDiagrams: false,
    });
    expect(
      visible.systems
        .flatMap((s) => s.measures.flatMap((m) => m.chordSymbols ?? []))
        .every((c) => c.diagram),
    ).toBe(true);
    expect(
      hidden.systems
        .flatMap((s) => s.measures.flatMap((m) => m.chordSymbols ?? []))
        .every((c) => !c.diagram),
    ).toBe(true);
    expect(chords.every((c) => c.chord.diagram)).toBe(true);
  });

  it("段落说明不参与绘制和度量，空简谱焦点在正文下方且不改变正式布局", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const before = buildLayout(document);
    const requests = collectMusicTextMeasureRequests(document);
    for (const measure of document.score.tracks[0]!.measures) {
      expect(requests.some((r) => r.text.includes(measure.sectionLabel!))).toBe(
        false,
      );
      delete measure.sectionLabel;
    }
    expect(buildLayout(document)).toEqual(before);
    document.score.tracks[0]!.measures = [
      document.score.tracks[0]!.measures[6]!,
    ];
    const layout = buildLayout(document);
    const m = layout.systems[0]!.measures[0]!;
    const focus = layoutParagraphFocus(layout, {
      trackId: document.score.tracks[0]!.id,
      measureId: m.id,
      beatId: m.beats[0]!.id,
      kind: "numbered",
    });
    expect(focus!.y).toBeGreaterThan(getMeasureContentBottom(m));
    expect(buildLayout(document)).toEqual(layout);
  });

  it("跨小节连续录入需确认覆盖，跳拍保留原内容，TAB 不变且历史只有一条", () => {
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
    const before = session.getState().document!;
    const track = before.score.tracks[0]!;
    const start = {
      trackId: track.id,
      measureId: track.measures[0]!.id,
      eventId: track.measures[0]!.numberedVoice.events[3]!.id,
    };
    const parsed = parseNumberedSequence("6 _ 1+3+5 0 1' -");
    if (!parsed.ok) throw Error(parsed.message);

    expect(
      session.getState().execute({
        type: "numbered.sequence.set",
        ...start,
        items: parsed.items,
        allowOverwrite: false,
      })?.ok,
    ).toBe(false);
    expect(session.getState().document).toBe(before);
    expect(
      session.getState().execute({
        type: "numbered.sequence.set",
        ...start,
        items: parsed.items,
        allowOverwrite: true,
      })?.ok,
    ).toBe(true);
    const after = session.getState().document!;
    expect(
      after.score.tracks[0]!.measures[1]!.numberedVoice.events[0]!.items.map(
        (i) => i.token,
      ),
    ).toEqual(["5"]);
    expect(
      after.score.tracks[0]!.measures[1]!.numberedVoice.events[1]!.items.map(
        (i) => i.token,
      ),
    ).toEqual(["1", "3", "5"]);
    // 比较完整拍点去掉简谱后的内容，捕获错误修改 TAB 音符、时值或休止的情况。
    const tabContent = (document: typeof before) =>
      document.score.tracks[0]!.measures.flatMap((m) => m.beats);
    expect(tabContent(after)).toEqual(tabContent(before));
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toEqual(before);
    session.getState().redo();
    expect(session.getState().document).toEqual(after);
  });

  it("空白时间补录及删除保持 TAB，并可撤销", () => {
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT),
      track = session.getState().document!.score.tracks[0]!;
    const m = track.measures[6]!;
    const tab = structuredClone(m.beats);
    const r = session
      .getState()
      .execute({
        type: "numbered.range.replace",
        trackId: track.id,
        measureId: m.id,
        startTick: 0,
        endTick: 480,
        items: [{ kind: "set", tokens: ["2"] }],
        rhythms: [{ base: "eighth", dots: 0 }],
        allowOverwrite: false,
      });
    expect(r?.ok).toBe(true);
    const event =
      session.getState().document!.score.tracks[0]!.measures[6]!.numberedVoice
        .events[0]!;
    expect(
      session
        .getState()
        .execute({
          type: "numbered.event.remove",
          trackId: track.id,
          measureId: m.id,
          eventId: event.id,
        })?.ok,
    ).toBe(true);
    expect(
      session.getState().document!.score.tracks[0]!.measures[6]!.numberedVoice
        .events,
    ).toEqual([]);
    session.getState().undo();
    expect(
      session
        .getState()
        .document!.score.tracks[0]!.measures[6]!.numberedVoice.events[0]!.items.map(
          (i) => i.token,
        ),
    ).toEqual(["2"]);
    expect(
      session.getState().document!.score.tracks[0]!.measures[6]!.beats,
    ).toEqual(tab);
  });
});
