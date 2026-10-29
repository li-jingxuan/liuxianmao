import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  hitTestMusicText,
  layoutParagraphFocus,
  loadDocument,
  LXMScoreCommandEnum,
  upgradeDocumentToCurrent,
  type ILXMDocument,
  type ILXMNumberedEvent,
} from "../../src";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.techniques = [];
  track.numberedMarks = [];
  const measure = track.measures[0]!;
  measure.chordSymbols = [];
  measure.numberedVoice = {
    events: [0, 480, 960, 1920].map((tick, i) => ({
      id: `event-${i}`,
      tick,
      rhythm: { base: i < 2 ? "eighth" : "quarter", dots: 0 },
      kind: "notes",
      items: [{ id: `item-${i}`, token: String(i + 1) }],
    })),
    tuplets: [],
  };
  measure.lyrics = [
    { id: "lyric", eventId: "event-1", verse: 1, text: "随音" },
  ];
  const target = {
    trackId: track.id,
    measureId: measure.id,
    eventId: "event-1",
    kind: "lyric" as const,
    verse: 1,
  };
  return { document, track, measure, target };
};

const checkAnchor = (document: ILXMDocument, tick: number) => {
  for (const purpose of ["editing", "presentation"] as const) {
    const layout = buildLayout(document, { purpose, systemWidth: 420 });
    const measure = layout.systems[0]!.measures[0]!;
    const lyric = measure.lyrics![0]!;
    const slot = measure.numberedSlots.find((s) => s.id === lyric.eventId)!;
    expect(slot.tick).toBe(tick);
    expect(lyric.label.x).toBe(slot.x);
    expect(measure.beats.some((b) => b.tick === tick)).toBe(false);
    const hit = hitTestMusicText(layout, {
      x: lyric.label.x,
      y: lyric.bounds.y + lyric.bounds.height / 2,
    });
    expect(hit).toMatchObject({
      id: "lyric",
      eventId: "event-1",
      kind: "lyric",
    });
    expect(hit).not.toHaveProperty("beatId");
  }
};

describe("歌词以简谱事件定位", () => {
  it("没有同 tick 的 TAB Beat 时，编辑、成品与命中仍对齐对应事件", () => {
    const { document } = fixture();
    expect(loadDocument(JSON.stringify(document)).ok).toBe(true);
    checkAnchor(document, 480);
  });

  it("真实时值命令移动后续事件后，歌词身份、命中与成品位置一起跟随", () => {
    const { document, track, measure } = fixture();
    const result = applyScoreCommand(document, {
      type: "numbered.event.setRhythm",
      trackId: track.id,
      measureId: measure.id,
      eventId: "event-0",
      rhythm: { base: "quarter", dots: 0 },
      timeline: "editTimeline",
    });
    if (!result.ok) throw new Error(result.message);
    const saved = result.document.score.tracks[0]!.measures[0]!;
    expect(saved.beats).toEqual(measure.beats);
    expect(saved.lyrics).toEqual(measure.lyrics);
    expect(saved.numberedVoice.events[1]!.tick).toBe(960);
    const layout = buildLayout(result.document);
    const rendered = layout.systems[0]!.measures[0]!;
    expect(rendered.lyrics![0]!.label.x).toBe(
      rendered.numberedSlots.find((slot) => slot.id === "event-1")!.x,
    );
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });

  it("修改 TAB 时值后歌词仍使用原简谱 tick", () => {
    const { document, track, measure } = fixture();
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetBeatRhythm,
      trackId: track.id,
      measureId: measure.id,
      beatId: measure.beats[0]!.id,
      rhythm: { base: "eighth", dots: 0 },
    });
    if (!result.ok) throw new Error(result.message);
    const saved = result.document.score.tracks[0]!.measures[0]!;
    expect(saved.numberedVoice).toEqual(measure.numberedVoice);
    expect(saved.lyrics).toEqual(measure.lyrics);
    const rendered = buildLayout(result.document).systems[0]!.measures[0]!;
    const anchor = rendered.numberedSlots.find(
      (slot) => slot.id === "event-1",
    )!;
    expect(anchor.tick).toBe(480);
    expect(rendered.lyrics![0]!.label.x).toBe(anchor.x);
  });

  it("只有 notes 事件提供空歌词格和焦点，TAB 拍点与其他简谱种类不能回退", () => {
    const { document, measure, target } = fixture();
    measure.lyrics = [];
    const kinds = ["notes", "rest", "continuation", "gap"] as const;
    measure.numberedVoice.events = kinds.map(
      (kind, i): ILXMNumberedEvent => ({
        id: `event-${i}`,
        tick: i * 960,
        rhythm: { base: "quarter", dots: 0 },
        ...(kind === "gap"
          ? { kind, items: [] }
          : {
              kind,
              items: [
                {
                  id: `item-${i}`,
                  token: kind === "notes" ? "1" : kind === "rest" ? "0" : "-",
                },
              ],
            }),
      }),
    );
    const layout = buildLayout(document, {
      purpose: "editing",
      paragraphEditing: { ...target, verse: 2 },
    });
    const cells = layout.systems[0]!.musicTextCells!;
    expect(cells.map((cell) => [cell.eventId, cell.verse])).toEqual([
      ["event-0", 1],
      ["event-0", 2],
    ]);
    expect(
      layoutParagraphFocus(layout, { ...target, eventId: "event-0" }),
    ).not.toBeNull();
    for (const eventId of ["event-1", "event-2", "event-3", "missing"])
      expect(layoutParagraphFocus(layout, { ...target, eventId })).toBeNull();
    expect(
      layoutParagraphFocus(layout, {
        ...target,
        eventId: undefined,
        beatId: measure.beats[0]!.id,
      }),
    ).toBeNull();
    measure.numberedVoice.events = [];
    const empty = buildLayout(document, {
      purpose: "editing",
      paragraphEditing: target,
    });
    expect(empty.systems[0]!.musicTextCells).toEqual([]);
    expect(layoutParagraphFocus(empty, target)).toBeNull();
  });

  it("缩短只释放简谱空位，原歌词保留且空位没有歌词入口", () => {
    const { document, track, measure, target } = fixture();
    const result = applyScoreCommand(document, {
      type: "numbered.event.setRhythm",
      trackId: track.id,
      measureId: measure.id,
      eventId: target.eventId,
      rhythm: { base: "sixteenth", dots: 0 },
      timeline: "editTimeline",
    });
    if (!result.ok) throw new Error(result.message);
    checkAnchor(result.document, 480);
    const editing = buildLayout(result.document, { purpose: "editing" });
    const released = editing.systems[0]!.measures[0]!.numberedInputSlots!.find(
      (slot) => slot.startTick === 720 && slot.endTick === 960,
    )!;
    expect(released.target.kind).toBe("numberedTime");
    expect(
      editing.systems[0]!.musicTextCells!.every((cell) => cell.eventId),
    ).toBe(true);
    expect(result.document.score.tracks[0]!.measures[0]!.lyrics).toEqual(
      measure.lyrics,
    );
  });

  it("当前 loader 和显式旧版本升级均拒绝 beatId 歌词", () => {
    const { document, measure } = fixture();
    const legacyLyric = {
      id: "legacy-lyric",
      beatId: measure.beats[0]!.id,
      verse: 1,
      text: "旧词",
    };
    const old = JSON.parse(JSON.stringify(document));
    old.score.tracks[0].measures[0].lyrics = [legacyLyric];
    expect(loadDocument(JSON.stringify(old)).ok).toBe(false);
    old.schemaVersion = 7;
    delete old.score.tracks[0].numberedMarks;
    delete old.score.tracks[0].measures[0].numberedVoice;
    expect(upgradeDocumentToCurrent(old).ok).toBe(false);
  });
});
