import { TICKS_PER_QUARTER } from "../constants";
import type { ILXMIdFactory } from "../id-factory";
import { cloneChordDiagram } from "../chords/chord-diagram";
import { copyNumberedVoices } from "../numbered/numbered-copy";
import { getJumpMarkSide } from "../playback/jump-marks";
import { getMeasureDurationTicks, isSameTimeSignature } from "../rhythm/rhythm";
import { copyMeasureTechniques } from "../techniques/copy-measure-techniques";
import { usesChordVoicingForTraversal } from "../techniques/technique-rules";
import type { ILXMChordSymbol, ILXMMeasure, ILXMScore, ILXMTrack } from "../types";
import { semanticJsonEqual } from "./score-tonality";

export const isMeasureRepeat = (measure: ILXMMeasure | undefined): boolean =>
  measure?.measureRepeat?.type === "previousSingle";

type MusicRelation = ILXMTrack["techniques"][number] | ILXMTrack["numberedMarks"][number];
type OpeningChord = ILXMChordSymbol["chord"] | null;

const relationRefs = (relation: MusicRelation): string[] => {
  if ("fromNoteId" in relation)
    return "toNoteId" in relation ? [relation.fromNoteId, relation.toNoteId] : [relation.fromNoteId];
  if ("fromBeatId" in relation) return [relation.fromBeatId, relation.toBeatId];
  if ("beatId" in relation) return [relation.beatId];
  if ("fromItemId" in relation) return [relation.fromItemId, relation.toItemId];
  if ("fromEventId" in relation) return [relation.fromEventId, relation.toEventId];
  return [relation.eventId];
};

/** 按小节和顺序索引端点。技巧或简谱连接即使两端都在外部，也可能贯穿本节。 */
const indexMusic = (track: ILXMTrack) => {
  const owners = new Map<string, number>();
  const openingChords = new Map<number, OpeningChord>();
  const traversalBeats = new Set(track.techniques.flatMap((technique) =>
    technique.type === "strum" || technique.type === "arpeggio" ? [technique.beatId] : [],
  ));
  let inheritedChord: OpeningChord = null;
  track.measures.forEach((measure, index) => {
    const chords = new Map(measure.chordSymbols.map((symbol) => [symbol.beatId, symbol.chord]));
    let beforeFirstChord = true;
    for (const beat of measure.beats) {
      const chord = chords.get(beat.id);
      if (chord) {
        inheritedChord = chord;
        beforeFirstChord = false;
      }
      if (beforeFirstChord && !openingChords.has(index) && (beat.notes.some((note) => note.fret === "x") ||
        (traversalBeats.has(beat.id) && usesChordVoicingForTraversal(beat)))) {
        // 只为实际依赖上下文的前缀保存节前和弦。此前小节的私有快照不向后传递。
        openingChords.set(index, measure.openingChordPlayback === undefined ? inheritedChord : measure.openingChordPlayback);
      }
      owners.set(beat.id, index);
      for (const note of beat.notes) owners.set(note.id, index);
    }
    for (const event of measure.numberedVoice.events) {
      owners.set(event.id, index);
      for (const item of event.items) owners.set(item.id, index);
    }
  });
  const internal = new Map<number, MusicRelation[]>();
  const crossing = new Uint8Array(track.measures.length);
  const relations = [...track.techniques, ...track.numberedMarks];
  for (const relation of relations) {
    const positions = relationRefs(relation).map((id) => owners.get(id) ?? -1);
    const from = Math.min(...positions), to = Math.max(...positions);
    // 悬空端点交给文档的关系校验报告，预览时不把它当作可复制关系。
    if (from < 0) continue;
    if (from !== to) {
      crossing.fill(1, from, to + 1);
    } else {
      const list = internal.get(from) ?? [];
      list.push(relation);
      internal.set(from, list);
    }
  }
  track.measures.forEach((measure, index) => {
    for (const group of measure.numberedVoice.tuplets) {
      if (!group.crossBar) continue;
      crossing[index] = 1;
      const next = track.measures[index + 1];
      if (next?.id === group.crossBar.nextMeasureId) crossing[index + 1] = 1;
    }
  });
  return { internal, crossing, openingChords };
};

const orderedBeats = (measure: ILXMMeasure) => [...measure.beats].sort((a, b) => a.tick - b.tick);

const opensWithSustain = (measure: ILXMMeasure | undefined): boolean =>
  measure?.beats[0]?.notes.some((note) => note.fret === "-") ?? false;

/** 关系以节内相对位置比较，忽略生成的 ID 及实体的存储顺序。 */
const comparableMusic = (measure: ILXMMeasure, relations: readonly MusicRelation[]) => {
  const refs = new Map<string, string>();
  const beats = orderedBeats(measure).map(({ id, notes, ...beat }, index) => {
    refs.set(id, `beat-${index}`);
    return {
      ...beat,
      notes: [...notes].sort((a, b) => a.string - b.string).map(({ id: noteId, ...note }) => {
        refs.set(noteId, `note-${index}-${note.string}`);
        return note;
      }),
    };
  });
  const events = [...measure.numberedVoice.events].sort((a, b) => a.tick - b.tick).map(({ id, items, ...event }, index) => {
    refs.set(id, `event-${index}`);
    return {
      ...event,
      items: items.map(({ id: itemId, ...item }, itemIndex) => {
        refs.set(itemId, `item-${index}-${itemIndex}`);
        return item;
      }),
    };
  });
  const compareId = (a: string | undefined, b: string | undefined) => (a ?? "").localeCompare(b ?? "");
  return {
    beats,
    events,
    chords: measure.chordSymbols.map(({ chord, display, beatId }) => ({ chord, display, beat: refs.get(beatId) }))
      .sort((a, b) => compareId(a.beat, b.beat)),
    tuplets: measure.tuplets.map(({ beatIds, ratio }) => ({ ratio, beats: beatIds.map((id) => refs.get(id)) }))
      .sort((a, b) => compareId(a.beats[0], b.beats[0])),
    numberedTuplets: measure.numberedVoice.tuplets.map(({ eventIds, ratio }) => ({ ratio, events: eventIds.map((id) => refs.get(id)) }))
      .sort((a, b) => compareId(a.events[0], b.events[0])),
    relations: relations.map(({ id: _id, ...relation }) => Object.fromEntries(
      Object.entries(relation).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [
        key, key.endsWith("Id") ? refs.get(value as string) : value,
      ]),
    )).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
};

const musicCounts = (measure: ILXMMeasure, relations: readonly MusicRelation[]) => ({
  notes: measure.beats.reduce((count, beat) => count + beat.notes.length, 0),
  rhythm: measure.beats.filter((beat) => !beat.capacityRest).length,
  chords: measure.chordSymbols.length,
  numbered: measure.numberedVoice.events.filter((event) => event.kind !== "gap").length,
  tuplets: measure.tuplets.length + measure.numberedVoice.tuplets.length,
  techniques: relations.length,
});

const describeMeasure = (measure: ILXMMeasure, index: number) => ({
  id: measure.id,
  number: index + 1,
  signature: `${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`,
  beatCount: getMeasureDurationTicks(measure) / (TICKS_PER_QUARTER * 4 / measure.timeSignature.denominator),
});

const blockedReason = (track: ILXMTrack, index: number, music: ReturnType<typeof indexMusic>): string | null => {
  const target = track.measures[index], source = track.measures[index - 1];
  if (!target) return "请选择一个小节。";
  if (!source) return "第 1 小节没有前一小节。请选择后续小节。";
  if (isMeasureRepeat(source)) return `第 ${index} 小节已有重复记号。请先展开前一小节。`;
  if (!isSameTimeSignature(source.timeSignature, target.timeSignature) ||
    getMeasureDurationTicks(source) !== getMeasureDurationTicks(target)) {
    const a = describeMeasure(source, index - 1), b = describeMeasure(target, index);
    return `前一小节为 ${a.signature}、${a.beatCount} 拍，本小节为 ${b.signature}、${b.beatCount} 拍。请在小节设置中对齐拍号及实际时长。`;
  }
  if (source.lyrics.length || target.lyrics.length) {
    const measures = [source.lyrics.length ? `第 ${index} 小节` : null, target.lyrics.length ? `第 ${index + 1} 小节` : null].filter(Boolean);
    return `${measures.join("和")}有歌词。请查看歌词或保留普通小节。`;
  }
  if (source.barline !== "single" || target.sectionLabel ||
    source.jumpMarks?.some((mark) => getJumpMarkSide(mark.kind) === "end") ||
    target.jumpMarks?.some((mark) => getJumpMarkSide(mark.kind) === "start") ||
    track.playbackReplay?.afterMeasureId === source.id ||
    track.playbackReplay?.fromMeasureId === target.id ||
    track.playbackReplay?.throughMeasureId === source.id ||
    track.repeatEndingGroups?.some((group) => group.startMeasureId === target.id ||
      group.sharedEndMeasureId === source.id || group.endMeasureId === source.id ||
      group.endings.some((ending) => ending.startMeasureId === target.id || ending.endMeasureId === source.id)))
    return "两小节之间有段落、反复或跳转边界。请调整边界或选择其他小节。";
  if (music.crossing[index - 1] || music.crossing[index])
    return `第 ${music.crossing[index - 1] ? index : index + 1} 小节有跨小节的技巧或简谱连接。请检查连接后再添加。`;
  // 首拍横线会延长前一节的真实声部，无稳定关系 ID，也必须拦住源或目标两端的跨界延音。
  const continuationIndex = [index - 1, index, index + 1].find((position) => opensWithSustain(track.measures[position]));
  if (continuationIndex !== undefined)
    return `第 ${continuationIndex + 1} 小节首拍有跨小节的延音。请检查横线延音后再添加。`;
  const counts = musicCounts(source, music.internal.get(index - 1) ?? []);
  if (!(counts.notes || counts.chords || counts.numbered || counts.tuplets || counts.techniques ||
    source.beats.some((beat) => beat.preserveInputRhythm)))
    return `第 ${index} 小节没有可重复的音乐内容。请先补录前一小节。`;
  return null;
};

export interface MeasureRepeatAvailability {
  enabled: boolean;
  reason: string | null;
  existing: boolean;
  source: ReturnType<typeof describeMeasure> | null;
  target: ReturnType<typeof describeMeasure> | null;
  replacement: ReturnType<typeof musicCounts> | null;
}

/** 小节工具与属性侧栏共用同一份目标、禁用原因和替换计数。 */
export const getMeasureRepeatAvailability = (
  score: ILXMScore,
  measureId: string,
  trackId?: string,
): MeasureRepeatAvailability => {
  const track = trackId ? score.tracks.find((item) => item.id === trackId)
    : score.tracks.find((item) => item.measures.some((measure) => measure.id === measureId));
  const index = track?.measures.findIndex((measure) => measure.id === measureId) ?? -1;
  const target = track?.measures[index], source = track?.measures[index - 1];
  if (!track || !target) return { enabled: false, reason: "请选择一个小节。", existing: false, source: null, target: null, replacement: null };
  const music = indexMusic(track);
  const existing = isMeasureRepeat(target);
  const reason = existing ? null : blockedReason(track, index, music);
  const counts = musicCounts(target, music.internal.get(index) ?? []);
  return {
    enabled: reason === null,
    reason,
    existing,
    source: source ? describeMeasure(source, index - 1) : null,
    target: describeMeasure(target, index),
    replacement: !existing && Object.values(counts).some((count) => count > 0) ? counts : null,
  };
};

/** 返回仍能写作重复记号的判定。创建、结构编辑和文件校验都遵从同一套边界。 */
export const findInvalidMeasureRepeats = (track: ILXMTrack): { measureId: string; index: number; reason: string }[] => {
  if (!track.measures.some(isMeasureRepeat)) return [];
  const music = indexMusic(track);
  return track.measures.flatMap((target, index) => {
    if (!isMeasureRepeat(target)) return [];
    const reason = blockedReason(track, index, music);
    if (reason) return [{ measureId: target.id, index, reason }];
    const source = track.measures[index - 1]!;
    const sourceOpening = music.openingChords.get(index - 1);
    if (!semanticJsonEqual(sourceOpening, target.openingChordPlayback))
      return [{ measureId: target.id, index, reason: "该小节快照的起始和弦与前一小节不同。" }];
    return semanticJsonEqual(comparableMusic(source, music.internal.get(index - 1) ?? []), comparableMusic(target, music.internal.get(index) ?? []))
      ? []
      : [{ measureId: target.id, index, reason: "该小节的快照内容与前一小节不同。" }];
  });
};

export const withoutMeasureRepeat = (measure: ILXMMeasure): ILXMMeasure => {
  const { measureRepeat: _repeat, ...expanded } = measure;
  return expanded;
};

const cloneOpeningChord = (chord: OpeningChord): OpeningChord => chord && {
  name: chord.name,
  diagram: chord.diagram && cloneChordDiagram(chord.diagram),
};

/** 复制普通小节或缩写时，节内上下文和标记也随快照独立保存。 */
export const copyMeasureRepeatFields = (measure: ILXMMeasure): Pick<ILXMMeasure, "measureRepeat" | "openingChordPlayback"> => ({
  ...(measure.measureRepeat && { measureRepeat: { ...measure.measureRepeat } }),
  ...(measure.openingChordPlayback !== undefined && { openingChordPlayback: cloneOpeningChord(measure.openingChordPlayback) }),
});

/** 排版只投影可见正文。快照仍在文档内，布局的试听坐标由真实 TAB 另行生成。 */
export const getVisibleMeasureRepeatTrack = (track: ILXMTrack): ILXMTrack => {
  if (!track.measures.some(isMeasureRepeat)) return track;
  const hidden = new Set<string>();
  const measures = track.measures.map((measure) => {
    if (!isMeasureRepeat(measure)) return measure;
    for (const beat of measure.beats) {
      hidden.add(beat.id);
      for (const note of beat.notes) hidden.add(note.id);
    }
    for (const event of measure.numberedVoice.events) {
      hidden.add(event.id);
      for (const item of event.items) hidden.add(item.id);
    }
    return { ...measure, chordSymbols: [], numberedVoice: { events: [], tuplets: [] } };
  });
  const visible = (relation: MusicRelation) => !relationRefs(relation).some((id) => hidden.has(id));
  return { ...track, measures, techniques: track.techniques.filter(visible), numberedMarks: track.numberedMarks.filter(visible) };
};

/** 将内容写入目标的独立拍位，保留目标自身的身份、小节线、拍号与跳转指令。 */
export const createMeasureRepeatSnapshot = (
  track: ILXMTrack,
  source: ILXMMeasure,
  target: ILXMMeasure,
  factory: ILXMIdFactory,
): ILXMTrack => {
  const beatIds = new Map<string, string>();
  const beats = source.beats.map((beat) => {
    const id = factory.createBeatId();
    beatIds.set(beat.id, id);
    return { ...beat, id, rhythm: { ...beat.rhythm }, notes: beat.notes.map((note) => ({ ...note, id: factory.createNoteId() })) };
  });
  const numbered = copyNumberedVoices(track, [source], factory);
  const openingChord = indexMusic(track).openingChords.get(track.measures.indexOf(source));
  const { openingChordPlayback: _oldOpeningChord, ...targetStructure } = target;
  const copy: ILXMMeasure = {
    ...targetStructure,
    measureRepeat: { type: "previousSingle" },
    ...(openingChord !== undefined && { openingChordPlayback: cloneOpeningChord(openingChord) }),
    beats,
    tuplets: source.tuplets.map((group) => ({
      ...group, id: factory.createTupletId(), ratio: { ...group.ratio }, beatIds: group.beatIds.map((id) => beatIds.get(id)!),
    })),
    chordSymbols: source.chordSymbols.map((symbol) => ({
      ...symbol, id: factory.createChordSymbolId(), beatId: beatIds.get(symbol.beatId)!,
      chord: { ...symbol.chord, diagram: symbol.chord.diagram && cloneChordDiagram(symbol.chord.diagram) },
    })),
    numberedVoice: numbered.voices[0]!,
  };
  const discarded = new Set([
    ...target.beats.flatMap((beat) => [beat.id, ...beat.notes.map((note) => note.id)]),
    ...target.numberedVoice.events.flatMap((event) => [event.id, ...event.items.map((item) => item.id)]),
  ]);
  const keep = (relation: MusicRelation) => !relationRefs(relation).some((id) => discarded.has(id));
  return {
    ...track,
    measures: track.measures.map((measure) => measure.id === copy.id ? copy : measure),
    techniques: [...track.techniques.filter(keep), ...copyMeasureTechniques(track, source, copy, factory).techniques],
    numberedMarks: [...track.numberedMarks.filter(keep), ...numbered.marks],
  };
};

/** 拍内命令直接修改缩写小节时必须先展开。轨级关系也属于隐藏的实际内容。 */
export const findEditedMeasureRepeat = (before: ILXMTrack, after: ILXMTrack): string | undefined => {
  if (!before.measures.some(isMeasureRepeat)) return;
  const oldMusic = indexMusic(before), nextMusic = indexMusic(after);
  const nextIndices = new Map(after.measures.map((measure, index) => [measure.id, index]));
  return before.measures.find((measure, index) => {
    if (!isMeasureRepeat(measure)) return false;
    const nextIndex = nextIndices.get(measure.id);
    if (nextIndex === undefined) return false;
    const next = after.measures[nextIndex]!;
    return !semanticJsonEqual(
      [measure.beats, measure.tuplets, measure.numberedVoice, measure.lyrics, measure.chordSymbols, oldMusic.internal.get(index), oldMusic.crossing[index]],
      [next.beats, next.tuplets, next.numberedVoice, next.lyrics, next.chordSymbols, nextMusic.internal.get(nextIndex), nextMusic.crossing[nextIndex]],
    );
  })?.id;
};
