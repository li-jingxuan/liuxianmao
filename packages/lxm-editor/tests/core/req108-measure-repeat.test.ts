import { describe, expect, it } from "vitest";
import {
  applyScoreCommand, buildLayout, buildScoreScene, createDocumentHistory,
  createPlaybackPlan, createTuningPreset, getMeasureRepeatAvailability,
  hitTestLayout, loadDocument, LXMScoreCommandEnum as Command, transitionDocumentHistory,
  type ILXMChordDiagram, type ILXMDocument, type ILXMScoreCommand,
} from "../../src";

const practice = (): ILXMDocument => ({
  schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
  score: {
    id: "practice", title: "单小节重复", arranger: "", keySignature: "C", meta: {},
    tracks: [{
      id: "track", name: "吉他", instrument: "guitar", tuning: createTuningPreset("standard"),
      capo: 0, startBarline: "none", techniques: [], numberedMarks: [],
      measures: ["source", "target", "tail"].map((id) => ({
        id, timeSignature: { numerator: 4, denominator: 4 }, barline: "single",
        tuplets: [], chordSymbols: [], numberedVoice: { events: [], tuplets: [] }, lyrics: [],
        beats: [3, 5, 7, 8].map((fret, index) => ({
          id: `${id}-beat-${index}`, tick: index * 960, rhythm: { base: "quarter", dots: 0 },
          ...(id === "target"
            ? { kind: "rest", capacityRest: true, notes: [] }
            : { kind: "notes", notes: [{ id: `${id}-note-${index}`, string: 1, fret }] }),
        })),
      })),
    }],
  },
});

const track = (doc: ILXMDocument) => doc.score.tracks[0]!;
const measures = (doc: ILXMDocument) => track(doc).measures;
const add = { type: Command.AddMeasureRepeat, trackId: "track", measureId: "target" } as const;
const apply = (doc: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(doc, command);
  if (!result.ok) throw new Error(result.message);
  return result;
};
const reopen = (doc: ILXMDocument) => {
  const result = loadDocument(JSON.stringify(doc));
  if (!result.ok) throw new Error(result.errors.join("；"));
  return result.document;
};

describe("REQ-108 单小节重复", () => {
  it("写入独立 TAB、和弦、简谱和技巧，往返后试听走目标四拍", () => {
    const initial = practice();
    const source = measures(initial)[0]!;
    source.chordSymbols.push({ id: "chord", beatId: source.beats[0]!.id, display: "name", chord: { name: "C", diagram: null } });
    source.numberedVoice.events.push({ id: "event", tick: 0, rhythm: { base: "quarter", dots: 0 }, kind: "notes", items: [{ id: "item", token: "1" }] });
    track(initial).numberedMarks.push({ id: "fermata", type: "fermata", eventId: "event" });
    track(initial).techniques.push({ id: "stroke", type: "pickStroke", beatId: source.beats[0]!.id, stroke: "down" });
    const added = apply(initial, add).document;
    const [original, snapshot] = measures(added);
    expect(snapshot?.measureRepeat).toEqual({ type: "previousSingle" });
    expect(snapshot?.beats.map((b) => b.id)).not.toEqual(original?.beats.map((b) => b.id));
    expect(snapshot?.chordSymbols[0]?.beatId).toBe(snapshot?.beats[0]?.id);
    expect(track(added).techniques[1]).toMatchObject({ beatId: snapshot?.beats[0]?.id });
    expect(track(added).numberedMarks[1]).toMatchObject({ eventId: snapshot?.numberedVoice.events[0]?.id });
    expect(reopen(added)).toEqual(added);
    const plan = createPlaybackPlan(reopen(added));
    expect(plan.visits.map(({ measureId }) => measureId)).toEqual(["source", "target", "tail"]);
    expect(plan.beats.filter(({ measureId }) => measureId === "target").map(({ beatId, startTick }) => [beatId, startTick])).toEqual(
      snapshot?.beats.map(({ id, tick }) => [id, 3840 + tick]),
    );
    expect(plan.sounds.filter(({ measureId }) => measureId === "target").map(({ midi }) => midi)).toEqual(
      plan.sounds.filter(({ measureId }) => measureId === "source").map(({ midi }) => midi),
    );
    for (const density of ["comfortable", "compact"] as const) {
      const layout = buildLayout(added, { purpose: "editing", density, systemWidth: 155 });
      const target = layout.systems.flatMap((system) => system.measures).find(({ id }) => id === "target")!;
      expect(target.strings).toHaveLength(6);
      expect(target.beats).toEqual([]);
      expect(target.notes).toEqual([]);
      expect(target.chordSymbols).toEqual([]);
      expect(target.numberedInputSlots).toEqual([]);
      const repeat = target.measureRepeat!;
      expect(new Set(repeat.playbackBeats.map(({ x }) => x)).size).toBe(4);
      expect(hitTestLayout(layout, { x: repeat.x, y: repeat.y })).toBeNull();
      expect(buildScoreScene(layout).systems.flatMap(({ items }) => items).filter((item) => item.measureRepeatId === "target")).toHaveLength(3);
    }
  });

  it("源编辑、自动展开和撤销共享一个提交，隐藏拍拒绝直接修改", () => {
    const added = apply(practice(), add).document;
    const snapshot = measures(added)[1]!;
    const changeFirstFret = (measureId: string, beatId: string): ILXMScoreCommand => ({
      type: Command.SetNote, trackId: "track", measureId, beatId, string: 1, fret: 6,
    });
    expect(applyScoreCommand(added, changeFirstFret("target", snapshot.beats[0]!.id))).toMatchObject({ ok: false, code: "MEASURE_REPEAT_HIDDEN_CONTENT" });
    const updated = apply(added, changeFirstFret("source", "source-beat-0"));
    expect(updated.effects).toContainEqual({ kind: "measureRepeat.expanded", trackId: "track", measureId: "target", measureNumber: 2 });
    expect(updated.document.documentRevision).toBe(added.documentRevision + 1);
    expect(measures(updated.document)[0]?.beats[0]?.notes[0]?.fret).toBe(6);
    expect(measures(updated.document)[1]?.beats).toBe(snapshot.beats);
    expect(measures(updated.document)[1]?.measureRepeat).toBeUndefined();
    const history = transitionDocumentHistory(createDocumentHistory<number>(), {
      type: "commit", document: added, entry: updated.document.documentRevision,
    });
    expect(history.past.at(-1)).toBe(added);
    expect(transitionDocumentHistory(history, { type: "undo", document: updated.document, keepCount: 0 }).future).toEqual([updated.document]);
    const expanded = apply(added, { type: Command.ExpandMeasureRepeat, trackId: "track", measureId: "target" });
    expect(expanded.nextFocus).toMatchObject({ beatId: snapshot.beats[0]!.id, measureId: "target" });
    expect(reopen(expanded.document).score.tracks[0]!.measures[1]!.measureRepeat).toBeUndefined();
  });

  it("开头的 x 和扫弦继承源的节前和弦，源换和弦后仍按快照演奏", () => {
    const initial = practice();
    const [source, , tail] = measures(initial);
    const diagram = (firstFret: number): ILXMChordDiagram => ({
      startFret: 1, fretCount: 5, barres: [],
      strings: ([1, 2, 3, 4, 5, 6] as const).map((string) => ({ string, fret: string === 1 ? firstFret : 0, finger: null })),
    });
    const earlier = {
      ...structuredClone(tail!), id: "earlier",
      beats: tail!.beats.map((beat) => ({
        ...beat, id: `${beat.id}-earlier`, notes: beat.notes.map((note) => ({ ...note, id: `${note.id}-earlier` })),
      })),
      chordSymbols: [{ id: "chord-a", beatId: "tail-beat-0-earlier", display: "name" as const, chord: { name: "A", diagram: diagram(0) } }],
    };
    measures(initial).unshift(earlier);
    source!.beats[0]!.notes[0]!.fret = "x";
    source!.beats[1] = { ...source!.beats[1]!, kind: "rest", notes: [] };
    track(initial).techniques.push({ id: "inherited-strum", type: "strum", beatId: source!.beats[1]!.id, minString: 1, maxString: 3, stroke: "down" });
    source!.chordSymbols.push({ id: "chord-b", beatId: source!.beats[2]!.id, display: "name", chord: { name: "B", diagram: diagram(2) } });
    source!.beats[2]!.notes[0]!.fret = "x";
    tail!.beats[0]!.notes[0]!.fret = "x";

    const frets = (doc: ILXMDocument, measureId: string) => createPlaybackPlan(doc).sounds.filter((sound) => sound.measureId === measureId).map(({ string, midi }) => [string, midi]);
    const added = reopen(apply(initial, add).document);
    const original = frets(added, "source");
    expect(original).toContainEqual([1, 66]);
    expect(original[0]).toEqual([1, 64]);
    expect(frets(added, "target")).toEqual(original);
    const expanded = apply(added, { type: Command.ExpandMeasureRepeat, trackId: "track", measureId: "target" }).document;
    expect(frets(reopen(expanded), "target")).toEqual(original);
    const targetFirstBeat = measures(expanded).find((measure) => measure.id === "target")!.beats[0]!;
    const edited = apply(expanded, {
      type: Command.SetChordSymbol, trackId: "track", measureId: "target", beatId: targetFirstBeat.id,
      chord: { name: "A", diagram: diagram(3) }, display: "name",
    }).document;
    expect(frets(edited, "target")[0]).toEqual([1, 67]);
    expect(frets(edited, "target")).toContainEqual([1, 66]);
    const changed = apply(added, {
      type: Command.SetChordSymbol, trackId: "track", measureId: "earlier", beatId: "tail-beat-0-earlier",
      chord: { name: "A", diagram: diagram(4) }, display: "name",
    }).document;
    expect(measures(changed).find((measure) => measure.id === "target")?.measureRepeat).toBeUndefined();
    expect(frets(changed, "source")[0]).toEqual([1, 68]);
    expect(frets(changed, "target")).toEqual(original);
    expect(frets(changed, "tail")[0]).toEqual([1, 66]);

    // 目标没有谱面和弦时，固定的 A 也不能覆盖后续小节的普通继承。
    source!.chordSymbols = [];
    const withoutLocalChord = reopen(apply(initial, add).document);
    const changedHarmony = apply(withoutLocalChord, {
      type: Command.SetChordSymbol, trackId: "track", measureId: "earlier", beatId: "tail-beat-0-earlier",
      chord: { name: "A", diagram: diagram(4) }, display: "name",
    }).document;
    expect(frets(changedHarmony, "target")[0]).toEqual([1, 64]);
    expect(frets(changedHarmony, "tail")[0]).toEqual([1, 68]);

    // 源开头的无和弦同样是一份上下文。后半部 B 不得让目标前缀多发声。
    earlier.chordSymbols = [];
    source!.chordSymbols.push({ id: "chord-b", beatId: source!.beats[2]!.id, display: "name", chord: { name: "B", diagram: diagram(2) } });
    const noOpeningChord = reopen(apply(initial, add).document);
    expect(measures(noOpeningChord).find((measure) => measure.id === "target")?.openingChordPlayback).toBeNull();
    expect(frets(noOpeningChord, "target")).toEqual(frets(noOpeningChord, "source"));
  });

  it("覆盖确认绑定版本，结构变化重新核对相邻内容", () => {
    const initial = apply(practice(), { type: Command.SetNote, trackId: "track", measureId: "target", beatId: "target-beat-0", string: 1, fret: 9 }).document;
    expect(getMeasureRepeatAvailability(initial.score, "target").replacement?.notes).toBe(1);
    expect(applyScoreCommand(initial, add)).toMatchObject({ ok: false, code: "MEASURE_REPEAT_OVERWRITE_REQUIRED" });
    expect(applyScoreCommand(initial, { ...add, allowOverwrite: true, expectedRevision: 1 })).toMatchObject({ ok: false, code: "STALE_MEASURE_REPEAT_PLAN" });
    const added = apply(initial, { ...add, allowOverwrite: true, expectedRevision: initial.documentRevision }).document;
    expect(measures(initial)[1]?.beats[0]?.notes[0]?.fret).toBe(9);
    expect(measures(added)[1]?.beats[0]?.notes[0]?.fret).toBe(3);
    const copied = apply(added, { type: Command.CopyMeasure, trackId: "track", measureId: "source" });
    expect(measures(copied.document).find(({ id }) => id === "target")?.measureRepeat).toBeDefined();
    const inserted = apply(added, { type: Command.InsertMeasure, trackId: "track", afterMeasureId: "source" });
    expect(measures(inserted.document).find(({ id }) => id === "target")?.measureRepeat).toBeUndefined();
    expect(inserted.effects).toContainEqual({ kind: "measureRepeat.expanded", trackId: "track", measureId: "target", measureNumber: 3 });
    const section = apply(added, { type: Command.SetSectionLabel, trackId: "track", measureId: "target", label: "副歌" });
    expect(measures(section.document)[1]?.measureRepeat).toBeUndefined();
    expect(measures(section.document)[1]?.beats).toBe(measures(added)[1]?.beats);
  });

  it("拒绝首节、空源、不同节长、歌词、重复链和跨界连接，并拒绝导入无快照的记号", () => {
    const initial = practice();
    const [source, target] = measures(initial);
    const availability = (measureId = "target") => getMeasureRepeatAvailability(initial.score, measureId).reason;
    expect(availability("source")).toContain("第 1 小节没有前一小节");
    expect(availability("tail")).toContain("没有可重复的音乐内容");
    target!.actualDurationTicks = 2880;
    expect(availability()).toContain("3 拍");
    delete target!.actualDurationTicks;
    source!.lyrics.push({ id: "lyric", eventId: "event", verse: 1, text: "词" });
    expect(availability()).toContain("第 1 小节有歌词");
    source!.lyrics = [];
    source!.barline = "repeatEnd";
    expect(availability()).toContain("反复或跳转边界");
    source!.barline = "single";
    track(initial).techniques.push({ id: "ring", type: "letRing", fromBeatId: "source-beat-0", toBeatId: "tail-beat-1" });
    expect(availability()).toContain("跨小节的技巧");
    track(initial).techniques = [];
    const tailFirstNote = measures(initial)[2]!.beats[0]!.notes[0]!;
    tailFirstNote.fret = "-";
    expect(availability()).toContain("第 3 小节首拍有跨小节的延音");
    tailFirstNote.fret = 3;
    const added = apply(initial, add).document;
    expect(getMeasureRepeatAvailability(added.score, "tail").reason).toContain("请先展开前一小节");
    target!.measureRepeat = { type: "previousSingle" };
    expect(loadDocument(JSON.stringify(initial))).toMatchObject({ ok: false });
  });
});
