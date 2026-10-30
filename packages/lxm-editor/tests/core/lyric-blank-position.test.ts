import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  hitTestMusicText,
  loadDocument,
  LXMScoreCommandEnum,
  planLyricPositions,
} from "../../src";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  track.measures = [measure];
  track.techniques = [];
  track.numberedMarks = [];
  measure.lyrics = [];
  measure.chordSymbols = [];
  measure.numberedVoice = { events: [], tuplets: [] };
  return { document, track, measure };
};

describe("空简谱位置填词", () => {
  it("整小节没有简谱时提供歌词占位，填词保存空事件，补音后歌词仍在原位", () => {
    const { document, track, measure } = fixture();
    const before = structuredClone(document);
    const target = {
      trackId: track.id,
      measureId: measure.id,
      tick: 0,
      endTick: 960,
      verse: 1 as const,
    };
    const layout = buildLayout(document, {
      purpose: "editing",
      paragraphEditing: { ...target, kind: "lyric" },
    });
    expect(
      layout.systems[0]!.measures[0]!.numberedInputSlots!.length,
    ).toBeGreaterThan(0);
    const cells = layout.systems[0]!.musicTextCells!;
    expect(cells.length).toBeGreaterThanOrEqual(4);
    expect(
      hitTestMusicText(layout, {
        x: cells[0]!.anchorX!,
        y: cells[0]!.y + cells[0]!.height / 2,
      }),
    ).toMatchObject({ tick: 0, endTick: 960 });
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetLyric,
      ...target,
      text: "风",
    });
    if (!result.ok) throw new Error(result.message);
    expect(document).toEqual(before);
    const saved = result.document.score.tracks[0]!.measures[0]!;
    const event = saved.numberedVoice.events[0]!;
    expect(event).toMatchObject({
      kind: "gap",
      tick: 0,
      rhythm: { base: "quarter", dots: 0 },
    });
    expect(saved.lyrics[0]!.eventId).toBe(event.id);
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
    const filled = applyScoreCommand(result.document, {
      type: "numbered.event.set",
      trackId: track.id,
      measureId: measure.id,
      eventId: event.id,
      tokens: ["3"],
    });
    if (!filled.ok) throw new Error(filled.message);
    expect(filled.document.score.tracks[0]!.measures[0]!.lyrics).toEqual(
      saved.lyrics,
    );
    const rendered = buildLayout(result.document).systems[0]!.measures[0]!;
    expect(rendered.lyrics![0]!.label.x).toBe(rendered.numberedSlots[0]!.x);
  });

  it("空白时间窗连续填词与预览一致，跳过的位置不创建事件且整批只增加一次 revision", () => {
    const { document, track, measure } = fixture();
    const positions = planLyricPositions(measure);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetLyricSequence,
      trackId: track.id,
      measureId: measure.id,
      tick: positions[0]!.tick,
      endTick: positions[0]!.endTick,
      verse: 2,
      items: [
        { kind: "set", text: "轻" },
        { kind: "skip" },
        { kind: "set", text: "唱" },
      ],
      allowOverwrite: false,
    });
    if (!result.ok) throw new Error(result.message);
    const saved = result.document.score.tracks[0]!.measures[0]!;
    expect(saved.numberedVoice.events.map((event) => event.tick)).toEqual([
      positions[0]!.tick,
      positions[2]!.tick,
    ]);
    expect(saved.lyrics.map((lyric) => lyric.text)).toEqual(["轻", "唱"]);
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });

  it("过期或重叠的时间窗被原子拒绝", () => {
    const { document, track, measure } = fixture();
    const before = structuredClone(document);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetLyric,
      trackId: track.id,
      measureId: measure.id,
      tick: 0,
      endTick: 3840,
      verse: 1,
      text: "风",
    });
    expect(result.ok).toBe(false);
    expect(document).toEqual(before);
  });
});
