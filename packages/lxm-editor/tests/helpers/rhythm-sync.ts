import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../src";
import {
  applyScoreCommand,
  type ILXMScoreCommand,
} from "../../src/core/commands";
import type { ILXMDocument, ILXMNumberedEvent } from "../../src/core/types";

export const rhythmSyncFixture = (scenario: "A" | "B" | "combined" = "A") => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  track.measures = [measure];
  track.techniques = [];
  track.numberedMarks = [];
  measure.tuplets = [];
  measure.chordSymbols = [];
  const starts =
    scenario === "combined"
      ? [0, 960, 1920, 2880]
      : scenario === "A"
        ? [0, 480, 960, 1920, 2880]
        : [0, 240, 480, 960, 1920, 2880];
  measure.beats = starts.map((tick, i) => ({
    id: `tab-${i}`,
    tick,
    kind: "notes",
    rhythm: {
      base:
        tick < 480 && scenario === "B"
          ? "sixteenth"
          : tick < 960 && scenario !== "combined"
            ? "eighth"
            : "quarter",
      dots: 0,
    },
    notes: [{ id: `tab-note-${i}`, string: 1, fret: 3 }],
  }));
  const eventStarts =
    scenario === "B" ? [0, 480, 960, 1920, 2880] : [0, 960, 1920, 2880];
  measure.numberedVoice = {
    events: eventStarts.map(
      (tick, i): ILXMNumberedEvent => ({
        id: `event-${i}`,
        tick,
        kind: "notes",
        rhythm: {
          base: scenario === "B" && tick < 960 ? "eighth" : "quarter",
          dots: 0,
        },
        items: [{ id: `item-${i}`, token: "3" }],
      }),
    ),
    tuplets: [],
  };
  measure.lyrics = ([1, 2, 3, 4] as const).map((verse) => ({
    id: `lyric-${verse}`,
    eventId: "event-0",
    verse,
    text: `词${verse}`,
  }));
  const target = { trackId: track.id, measureId: measure.id };
  const align: ILXMScoreCommand = {
    type: "numbered.range.alignToTab",
    ...target,
    startTick: 0,
    endTick: 960,
  };
  const split: ILXMScoreCommand = {
    type: "beat.splitAndAlignNumbered",
    ...target,
    beatId: "tab-0",
  };
  return { document, track, measure, target, align, split };
};

export const applyRhythmSync = (
  document: ILXMDocument,
  command: ILXMScoreCommand,
) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
};
