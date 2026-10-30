import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_6_DOCUMENT } from "../../src";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  type ILXMScoreCommand,
} from "../../src/core/commands";
import {
  createBeatClipboard,
  planBeatPaste,
  validateBeatClipboard,
} from "../../src/core/beat-clipboard";
import {
  createNumberedClipboard,
  validateNumberedClipboard,
} from "../../src/core/numbered-clipboard";
import { createDocumentIdFactory } from "../../src/core/id-factory";
import { loadDocument } from "../../src/core/loader";
import {
  editNumberedTrack,
  type ILXMNumberedVoiceCommand,
} from "../../src/core/numbered-commands";
import { validateNumberedVoice } from "../../src/core/numbered-rhythm";
import type { ILXMDocument } from "../../src/core/types";

const fixture = (tuplet = false) => {
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
    rhythm: { base: "quarter" as const, dots: 0 },
    notes: [],
  }));
  measure.numberedVoice = {
    events: ["1", "1", "3"].map((token, index) => ({
      id: `event-${index}`,
      tick: index * (tuplet ? 320 : 960),
      kind: "notes" as const,
      rhythm: { base: tuplet ? "eighth" : "quarter", dots: 0 },
      items: [{ id: `item-${index}`, token }],
    })),
    tuplets: tuplet
      ? [
          {
            id: "triplet",
            eventIds: ["event-0", "event-1", "event-2"],
            ratio: { actual: 3, normal: 2 },
          },
        ]
      : [],
  };
  measure.lyrics = [
    { id: "lyric-1", eventId: "event-0", verse: 1, text: "风" },
    { id: "lyric-4", eventId: "event-0", verse: 4, text: "云" },
  ];
  return {
    document,
    track,
    measure,
    target: { trackId: track.id, measureId: measure.id, eventId: "event-0" },
  };
};
const run = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  return result.document;
};

describe("简谱清空内容保留时间与歌词", () => {
  it.each([false, true])(
    "单音与批量清空、恢复均保留事件及歌词，tuplet=%s",
    (tuplet) => {
      for (const mode of ["event", "sequence"] as const) {
        const { document, measure, target } = fixture(tuplet);
        const snapshot = structuredClone(document);
        const original = measure.numberedVoice.events[0]!;
        const command: ILXMNumberedVoiceCommand =
          mode === "event"
            ? { ...target, type: "numbered.event.set", tokens: [] }
            : {
                ...target,
                type: "numbered.sequence.set",
                items: [{ kind: "set", tokens: [] }],
                allowOverwrite: true,
              };
        const cleared = run(document, command);
        const next = cleared.score.tracks[0]!.measures[0]!;
        expect(next.numberedVoice.events[0]).toEqual({
          ...original,
          kind: "gap",
          items: [],
        });
        expect(next.numberedVoice.tuplets).toEqual(
          measure.numberedVoice.tuplets,
        );
        expect(next.lyrics).toEqual(measure.lyrics);
        expect(next.beats).toEqual(measure.beats);
        expect(document).toEqual(snapshot);
        expect(applyScoreCommand(cleared, command)).toMatchObject({
          ok: true,
          changed: false,
        });

        const editedOther = run(cleared, {
          ...target,
          type: "numbered.event.set",
          eventId: "event-2",
          tokens: ["5"],
        });
        expect(editedOther.score.tracks[0]!.measures[0]!.lyrics).toEqual(
          measure.lyrics,
        );
        const restored = run(editedOther, {
          ...target,
          type: "numbered.event.set",
          tokens: ["#4'"],
        });
        const restoredMeasure = restored.score.tracks[0]!.measures[0]!;
        expect(restoredMeasure.numberedVoice.events[0]).toMatchObject({
          id: original.id,
          tick: original.tick,
          rhythm: original.rhythm,
          kind: "notes",
          items: [{ token: "#4'" }],
        });
        expect(restoredMeasure.numberedVoice.events[0]!.items[0]!.id).not.toBe(
          original.items[0]!.id,
        );
        expect(restoredMeasure.lyrics).toEqual(measure.lyrics);
      }
    },
  );

  it("清空先报告技巧影响，确认后删除失效技巧并保留歌词", () => {
    const { document, track, measure, target } = fixture();
    track.numberedMarks = [
      { id: "tie", type: "tie", fromItemId: "item-0", toItemId: "item-1" },
      {
        id: "slur",
        type: "slur",
        fromEventId: "event-0",
        toEventId: "event-2",
      },
      { id: "fermata", type: "fermata", eventId: "event-0" },
    ];
    const snapshot = structuredClone(document);
    const command: ILXMNumberedVoiceCommand = {
      ...target,
      type: "numbered.event.set",
      tokens: [],
    };
    const removedMarkIds = ["fermata", "slur", "tie"];
    expect(applyScoreCommand(document, command)).toMatchObject({
      ok: false,
      code: "NUMBERED_IMPACT_REQUIRED",
      removedMarkIds,
    });
    expect(
      editNumberedTrack(
        track,
        command,
        createDocumentIdFactory(document),
        true,
      ),
    ).toMatchObject({
      ok: true,
      removedMarkIds,
    });
    expect(document).toEqual(snapshot);
    const cleared = run(document, {
      ...command,
      confirmedRemovedMarkIds: removedMarkIds,
    });
    expect(cleared.score.tracks[0]!.numberedMarks).toEqual([]);
    expect(cleared.score.tracks[0]!.measures[0]!.lyrics).toEqual(
      measure.lyrics,
    );
  });

  it("独立 gap 可保存加载和拆分，歌词继续引用原身份", () => {
    const { document, measure, target } = fixture();
    const cleared = run(document, {
      ...target,
      type: "numbered.event.set",
      tokens: [],
    });
    const loaded = loadDocument(JSON.stringify(cleared));
    expect(loaded).toMatchObject({ ok: true, document: cleared });
    const split = run(cleared, { ...target, type: "numbered.event.split" });
    const next = split.score.tracks[0]!.measures[0]!;
    expect(
      next.numberedVoice.events.slice(0, 2).map((event) => ({
        kind: event.kind,
        tick: event.tick,
        rhythm: event.rhythm,
        items: event.items,
      })),
    ).toEqual(
      [0, 480].map((tick) => ({
        kind: "gap",
        tick,
        rhythm: { base: "eighth", dots: 0 },
        items: [],
      })),
    );
    expect(next.lyrics).toEqual(measure.lyrics);
    const invalid = structuredClone(next.numberedVoice);
    invalid.events[0]!.items = [{ id: "invalid", token: "1" }];
    expect(validateNumberedVoice(invalid, 3840)).toContain("类型");
  });

  it("清空内容不接受 itemId，休止与延续仍不能保留歌词", () => {
    const { document, target } = fixture();
    expect(
      applyScoreCommand(document, {
        ...target,
        type: "numbered.event.set",
        itemId: "item-0",
        tokens: [],
      }),
    ).toMatchObject({ ok: false, code: "NUMBERED_INVALID" });
    for (const token of ["0", "-"]) {
      const next = run(document, {
        ...target,
        type: "numbered.event.set",
        tokens: [token],
      });
      expect(next.score.tracks[0]!.measures[0]!.lyrics).toEqual([]);
    }
  });
});

describe("携带 gap 歌词的剪贴板", () => {
  it.each(["insert", "overwrite"] as const)(
    "简谱 %s 粘贴重建 gap 和各段歌词身份",
    (mode) => {
      const { document, measure, target } = fixture();
      const cleared = run(document, {
        ...target,
        type: "numbered.event.set",
        tokens: [],
      });
      const copied = createNumberedClipboard(cleared, {
        ...target,
        startTick: 0,
        endTick: 960,
      });
      if (!copied.ok) throw new Error(copied.message);
      expect(copied.clipboard.lyrics).toEqual(measure.lyrics);
      const pasted = run(cleared, {
        ...target,
        type: "numbered.range.paste",
        startTick: 960,
        mode,
        allowOverwrite: true,
        clipboard: copied.clipboard,
      });
      const next = pasted.score.tracks[0]!.measures[0]!;
      const gap = next.numberedVoice.events.find(
        (event) => event.tick === 960,
      )!;
      expect(gap.kind).toBe("gap");
      expect(gap.id).not.toBe(target.eventId);
      expect(
        next.lyrics
          .filter((lyric) => lyric.eventId === gap.id)
          .map(({ verse, text }) => [verse, text]),
      ).toEqual([
        [1, "风"],
        [4, "云"],
      ]);
      expect(
        next.lyrics
          .filter((lyric) => lyric.eventId === gap.id)
          .every((lyric) => !measure.lyrics.some((old) => old.id === lyric.id)),
      ).toBe(true);
      expect(next.lyrics.slice(0, 2)).toEqual(measure.lyrics);
      expect(next.beats).toEqual(measure.beats);
    },
  );

  it("双谱复制与粘贴携带独立 gap 歌词，两种快照均拒绝休止与延续歌词", () => {
    const { document, track, measure, target } = fixture();
    const cleared = run(document, {
      ...target,
      type: "numbered.event.set",
      tokens: [],
    });
    const numbered = createNumberedClipboard(cleared, {
      ...target,
      startTick: 0,
      endTick: 960,
    });
    const both = createBeatClipboard(cleared, {
      ...target,
      startBeatId: "tab-0",
      endBeatId: "tab-0",
      layers: "both",
    });
    if (!both.ok || !numbered.ok) throw new Error("复制失败");
    expect(both.clipboard.content.lyrics).toEqual(measure.lyrics);
    const pasteTarget = {
      trackId: target.trackId,
      measureId: target.measureId,
      beatId: "tab-1",
      mode: "overwrite" as const,
    };
    const plan = planBeatPaste(cleared, pasteTarget, both.clipboard);
    if (!plan.ok) throw new Error(plan.message);
    const pasted = run(cleared, {
      ...pasteTarget,
      type: LXMScoreCommandEnum.PasteBeats,
      clipboard: both.clipboard,
      allowOverwrite: true,
      expectedConfirmationKey: plan.confirmationKey,
    });
    const next = pasted.score.tracks[0]!.measures[0]!;
    const gap = next.numberedVoice.events.find((event) => event.tick === 960)!;
    expect(gap.kind).toBe("gap");
    expect(gap.id).not.toBe(target.eventId);
    expect(
      next.lyrics
        .filter((lyric) => lyric.eventId === gap.id)
        .map(({ verse, text }) => [verse, text]),
    ).toEqual([
      [1, "风"],
      [4, "云"],
    ]);
    for (const kind of ["rest", "continuation"] as const) {
      const numberedBad = structuredClone(numbered.clipboard);
      const bothBad = structuredClone(both.clipboard);
      for (const voice of [numberedBad.voice, bothBad.numberedVoice!]) {
        voice.events[0] = {
          ...voice.events[0]!,
          kind,
          items: [{ id: "special-item", token: kind === "rest" ? "0" : "-" }],
        };
      }
      expect(validateNumberedClipboard(numberedBad, track).ok).toBe(false);
      expect(validateBeatClipboard(bothBad, track).ok).toBe(false);
    }
  });
});
