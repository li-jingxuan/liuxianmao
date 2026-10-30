import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_6_DOCUMENT } from "../../src";
import {
  applyScoreCommand,
  LXMScoreCommandEnum as C,
  type ILXMScoreCommand,
} from "../../src/core/commands";
import {
  createBeatClipboard,
  planBeatPaste,
} from "../../src/core/beat-clipboard";
import {
  createNumberedClipboard,
  validateNumberedClipboard,
} from "../../src/core/numbered-clipboard";
import { loadDocument } from "../../src/core/loader";
import { planLyricSequence } from "../../src/core/lyric-sequence";
import type { ILXMDocument } from "../../src/core/types";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.techniques = [];
  track.numberedMarks = [];
  const measure = track.measures[0]!;
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.tuplets = [];
  measure.chordSymbols = [];
  measure.beats = Array.from({ length: 4 }, (_, index) => ({
    id: `tab-${index}`,
    tick: index * 960,
    kind: "rest" as const,
    rhythm: { base: "quarter" as const, dots: 0 as const },
    notes: [],
  }));
  measure.numberedVoice = {
    events: [0, 1].map((index) => ({
      id: `event-${index}`,
      tick: index * 960,
      kind: "notes" as const,
      rhythm: { base: "quarter" as const, dots: 0 as const },
      items: [{ id: `item-${index}`, token: `${index + 1}` }],
    })),
    tuplets: [],
  };
  measure.lyrics = [
    { id: "lyric-first", eventId: "event-0", verse: 1, text: "风" },
    { id: "lyric-fourth-verse", eventId: "event-0", verse: 4, text: "云" },
    { id: "lyric-second", eventId: "event-1", verse: 1, text: "山" },
  ];
  const target = { trackId: track.id, measureId: measure.id };
  return { document, track, measure, target };
};
const run = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  return result;
};
const clipboard = (
  document: ILXMDocument,
  target: ReturnType<typeof fixture>["target"],
) => {
  const result = createNumberedClipboard(document, {
    ...target,
    startTick: 0,
    endTick: 960,
  });
  if (!result.ok) throw new Error(result.message);
  return result.clipboard;
};

describe("独立简谱歌词复制与 TAB 隔离", () => {
  it("歌词拒绝 Beat、休止与延续锚点", () => {
    const { document, target, measure } = fixture();
    for (const eventId of ["tab-0", "missing"]) {
      expect(
        applyScoreCommand(document, {
          type: C.SetLyric,
          ...target,
          eventId,
          verse: 1,
          text: "词",
        }).ok,
      ).toBe(false);
    }
    const event = measure.numberedVoice.events[0]!;
    for (const kind of ["rest", "continuation"] as const) {
      measure.numberedVoice.events[0] = {
        ...event,
        kind,
        items: [{ id: "special-item", token: kind === "rest" ? "0" : "-" }],
      };
      expect(
        applyScoreCommand(document, {
          type: C.SetLyric,
          ...target,
          eventId: event.id,
          verse: 1,
          text: "词",
        }).ok,
      ).toBe(false);
      expect(loadDocument(JSON.stringify(document)).ok).toBe(false);
    }
    measure.numberedVoice.events[0] = event;
    expect(
      loadDocument(
        JSON.stringify({
          ...document,
          score: {
            ...document.score,
            tracks: [
              {
                ...document.score.tracks[0],
                measures: [
                  {
                    ...measure,
                    lyrics: [
                      { id: "legacy", beatId: "tab-0", verse: 1, text: "词" },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("连续填词跨过简谱休止并接受 gap 位置", () => {
    const { document, target, measure } = fixture();
    const first = measure.numberedVoice.events[0]!;
    first.rhythm = { base: "eighth", dots: 0 };
    const second = { ...measure.numberedVoice.events[1]!, tick: 2880 };
    measure.numberedVoice.events = [
      first,
      {
        id: "rest",
        tick: 320,
        rhythm: { base: "eighth", dots: 0 },
        kind: "rest",
        items: [{ id: "rest-item", token: "0" }],
      },
      {
        id: "gap",
        tick: 640,
        rhythm: { base: "eighth", dots: 0 },
        kind: "gap",
        items: [],
      },
      second,
    ];
    measure.numberedVoice.tuplets = [
      {
        id: "lyric-target-tuplet",
        eventIds: [first.id, "rest", "gap"],
        ratio: { actual: 3, normal: 2 },
      },
    ];
    measure.lyrics = [];
    const plan = planLyricSequence(
      document,
      { ...target, eventId: first.id, verse: 1 },
      [
        { kind: "set", text: "风" },
        { kind: "set", text: "山" },
      ],
    );
    expect(plan.issue).toBeNull();
    expect(plan.rows.map((row) => row.target?.eventId)).toEqual([
      first.id,
      "gap",
    ]);
    const result = run(document, {
      type: C.SetLyricSequence,
      ...target,
      eventId: first.id,
      verse: 1,
      items: [
        { kind: "set", text: "风" },
        { kind: "set", text: "山" },
      ],
      allowOverwrite: false,
    });
    expect(
      result.document.score.tracks[0]!.measures[0]!.lyrics.map(
        (lyric) => lyric.eventId,
      ),
    ).toEqual([first.id, "gap"]);
  });

  it("简谱快照只携带范围内各段歌词，深复制并拒绝旧 Beat 锚点及无效事件引用", () => {
    const { document, track, measure, target } = fixture();
    const copied = clipboard(document, target);
    expect(copied.lyrics).toEqual(measure.lyrics.slice(0, 2));
    copied.lyrics[0]!.text = "改";
    expect(measure.lyrics[0]!.text).toBe("风");
    const bad = structuredClone(copied);
    bad.lyrics[0]!.eventId = "event-1";
    expect(validateNumberedClipboard(bad, track).ok).toBe(false);
    expect(
      validateNumberedClipboard(
        {
          ...copied,
          lyrics: [{ id: "old", beatId: "tab-0", verse: 1, text: "旧" }],
        },
        track,
      ).ok,
    ).toBe(false);
    expect(
      validateNumberedClipboard(
        { ...copied, lyrics: [copied.lyrics[0], copied.lyrics[0]] },
        track,
      ).ok,
    ).toBe(false);
  });

  it.each(["insert", "overwrite"] as const)(
    "简谱 %s 粘贴重建歌词身份，保留范围外歌词和 TAB",
    (mode) => {
      const { document, measure, target } = fixture();
      const before = structuredClone(document);
      const result = run(document, {
        type: "numbered.range.paste",
        ...target,
        startTick: 960,
        mode,
        allowOverwrite: true,
        clipboard: clipboard(document, target),
      });
      const after = result.document.score.tracks[0]!.measures[0]!;
      expect(after.beats).toBe(measure.beats);
      expect(after.lyrics.slice(0, 2)).toEqual(measure.lyrics.slice(0, 2));
      const event = after.numberedVoice.events.find(
        (event) => event.tick === 960,
      )!;
      const lyrics = after.lyrics.filter((lyric) => lyric.eventId === event.id);
      expect(lyrics.map((lyric) => [lyric.verse, lyric.text])).toEqual([
        [1, "风"],
        [4, "云"],
      ]);
      expect(
        lyrics.every(
          (lyric) => !measure.lyrics.some((old) => old.id === lyric.id),
        ),
      ).toBe(true);
      if (mode === "insert") {
        expect(
          after.numberedVoice.events.find((event) => event.id === "event-1")!
            .tick,
        ).toBe(1920);
        expect(after.lyrics.at(-1)).toEqual(measure.lyrics.at(-1));
      } else
        expect(after.lyrics.some((lyric) => lyric.id === "lyric-second")).toBe(
          false,
        );
      expect(document).toEqual(before);
      expect(result.document.documentRevision).toBe(
        document.documentRevision + 1,
      );
    },
  );

  it.each(["tab", "both"] as const)(
    "%s Beat 粘贴按所选层处理歌词",
    (layers) => {
      const { document, measure, target } = fixture();
      const copied = createBeatClipboard(document, {
        ...target,
        startBeatId: "tab-0",
        endBeatId: "tab-0",
        layers,
      });
      if (!copied.ok) throw new Error(copied.message);
      expect(copied.clipboard.content.lyrics).toHaveLength(
        layers === "both" ? 2 : 0,
      );
      const pasteTarget = {
        ...target,
        beatId: "tab-1",
        mode: "overwrite" as const,
      };
      const plan = planBeatPaste(document, pasteTarget, copied.clipboard);
      if (!plan.ok) throw new Error(plan.message);
      expect(plan.replacedLyrics).toBe(layers === "both" ? 1 : 0);
      const result = run(document, {
        type: C.PasteBeats,
        ...pasteTarget,
        clipboard: copied.clipboard,
        allowOverwrite: true,
        expectedConfirmationKey: plan.confirmationKey,
      });
      const after = result.document.score.tracks[0]!.measures[0]!;
      if (layers === "tab") {
        expect(after.lyrics).toBe(measure.lyrics);
        expect(after.numberedVoice).toBe(measure.numberedVoice);
      } else {
        const event = after.numberedVoice.events.find(
          (event) => event.tick === 960,
        )!;
        expect(
          after.lyrics
            .filter((lyric) => lyric.eventId === event.id)
            .map((lyric) => lyric.text),
        ).toEqual(["风", "云"]);
      }
    },
  );

  it("TAB 拆分、合并及休止转换保持歌词和简谱引用", () => {
    const { document, measure, target } = fixture();
    const split = run(document, {
      type: C.SplitBeat,
      ...target,
      beatId: "tab-0",
    }).document;
    const beats = split.score.tracks[0]!.measures[0]!.beats;
    const merged = run(split, {
      type: C.MergeBeats,
      ...target,
      startBeatId: beats[0]!.id,
      endBeatId: beats[1]!.id,
    }).document;
    const changed = run(merged, {
      type: C.SetBeatKind,
      ...target,
      beatId: beats[0]!.id,
      kind: "notes",
    }).document;
    const after = changed.score.tracks[0]!.measures[0]!;
    expect(after.lyrics).toBe(measure.lyrics);
    expect(after.numberedVoice).toBe(measure.numberedVoice);
  });

  it.each([false, true])(
    "连续录入返回剩余空位或相邻事件焦点（相邻=%s）",
    (adjacent) => {
      const { document, target, measure } = fixture();
      measure.numberedVoice.events = adjacent
        ? [measure.numberedVoice.events[1]!]
        : [];
      measure.lyrics = [];
      const result = run(document, {
        type: "numbered.sequence.insert",
        ...target,
        startTick: 0,
        endTick: adjacent ? 960 : 1920,
        items: [{ kind: "set", tokens: ["3"] }],
        rhythms: [{ base: "quarter", dots: 0 }],
      });
      expect(result.nextNumberedFocus).toEqual({
        ...target,
        ...(adjacent ? { eventId: "event-1" } : { tick: 960, endTick: 1920 }),
      });
    },
  );
});
