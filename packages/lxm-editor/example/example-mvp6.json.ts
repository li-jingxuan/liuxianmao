/** 八小节真实混合谱例；保留 v5/v5.1 独立样例作为回归依据。 */
import source from "./example-mvp5.1.json";
import { copyChordPreset } from "../src/core/chord-presets";
import type { ILXMDocument } from "../src/core/types";
const document: ILXMDocument = structuredClone(source);
document.score.title = "MVP v6 歌词与和弦";
document.score.meta = { fixture: "mvp-v6" };
const track = document.score.tracks[0]!;
const names = ["Am", "C", "F", "G", "Dm", "Em", "Bm", "Cmaj7"];
const words = [
  ["风", "吹", "过"],
  ["Sing", "a", "song"],
  ["一", "起", "走"],
  ["把", "梦", "留", "在", "这"],
  ["五", "个", "小", "音", "符"],
  ["轻", "轻", "拨", "动", "琴", "弦"],
  ["日", "光", "里"],
  ["最", "后", "拍"],
];
track.measures.forEach((measure, index) => {
  // 歌词谱例显式提供旋律事件；TAB 与简谱仅在本 fixture 中采用相同节奏。
  measure.numberedVoice = {
    events: measure.beats.map((beat, i) => ({
      id: `mvp6-event-${index}-${i}`,
      tick: beat.tick,
      rhythm: { ...beat.rhythm },
      kind: "notes",
      items: [{ id: `mvp6-item-${index}-${i}`, token: String((i % 7) + 1) }],
    })),
    tuplets: measure.tuplets.map((group, i) => ({
      id: `mvp6-numbered-tuplet-${index}-${i}`,
      eventIds: group.beatIds.map(
        (beatId) =>
          `mvp6-event-${index}-${measure.beats.findIndex((beat) => beat.id === beatId)}`,
      ),
      ratio: { ...group.ratio },
    })),
  };
  measure.chordSymbols = [
    {
      id: `mvp6-chord-${index}`,
      beatId: measure.beats[0]!.id,
      display: index === 5 ? "name" : "nameAndDiagram",
      chord: copyChordPreset(names[index]!)!,
    },
  ];
  measure.lyrics = words[index]!.map((text, i) => ({
    id: `mvp6-lyric-${index}-${i}`,
    eventId: measure.numberedVoice.events[i]!.id,
    verse: index === 6 ? 3 : 1,
    text,
  }));
  if (index === 0)
    for (const verse of [2, 3, 4] as const)
      measure.lyrics.push({
        id: `mvp6-verse-${verse}`,
        eventId: measure.numberedVoice.events[0]!.id,
        verse,
        text: `第${verse}段`,
      });
  measure.lyrics.sort(
    (a, b) =>
      measure.numberedVoice.events.findIndex(
        (event) => event.id === a.eventId,
      ) -
        measure.numberedVoice.events.findIndex(
          (event) => event.id === b.eventId,
        ) || a.verse - b.verse,
  );
});
// 跨小节延音覆盖的尾部拍点改为真实发声，避免技巧穿过容量休止。
track.measures[2]!.beats.filter((b) => b.kind === "rest").forEach((b, i) => {
  b.kind = "notes";
  b.notes = [{ id: `mvp6-sustain-${i}`, string: 3, fret: 5 }];
});
track.techniques.push(
  {
    id: "mvp6-bend",
    type: "bend",
    fromNoteId: track.measures[0]!.beats[0]!.notes[0]!.id,
    semitones: 2,
  },
  {
    id: "mvp6-ring",
    type: "letRing",
    fromBeatId: track.measures[2]!.beats[0]!.id,
    toBeatId: track.measures[3]!.beats[3]!.id,
  },
);
export default document;
