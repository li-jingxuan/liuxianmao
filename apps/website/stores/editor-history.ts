import {
  HISTORY_LIMIT,
  type ILXMCommandEffect,
  type ILXMDocument,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";

export type HistoryTarget = Readonly<{
  summary: string;
  trackId?: string;
  measureIds?: readonly string[];
  beatIds?: readonly string[];
  objectIds?: readonly string[];
}>;

export type HistoryEntry = Readonly<{
  id: string;
  label: string;
  target: HistoryTarget;
  effects: readonly ILXMCommandEffect[];
}>;

export type EditorFeedbackEvent = Readonly<{
  eventId: string;
  sessionId: number;
  sessionVersion: number;
  source: "command" | "clipboard";
  entryId?: string;
  effects: readonly ILXMCommandEffect[];
}>;

/** UI 视图不包含文档快照；仅在历史发生变化时创建。entries 按逻辑时间排列。 */
export type EditorHistoryView = Readonly<{
  entries: readonly HistoryEntry[];
  appliedCount: number;
  currentEntryId: string | null;
  baselineAdvanced: boolean;
}>;

export interface EditorHistory {
  past: ILXMDocument[];
  future: ILXMDocument[];
  pastEntries: readonly HistoryEntry[];
  futureEntries: readonly HistoryEntry[];
  baselineAdvanced: boolean;
}

/** 只冻结独立副本，绝不冻结领域结果或宿主输入。 */
export const readonlySnapshot = <T>(value: T): T => {
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  };
  const snapshot = structuredClone(value);
  freeze(snapshot);
  return snapshot;
};

const labels: Readonly<Record<string, string>> = {
  "beat.split": "拆分拍点",
  "beat.splitAndAlignNumbered": "TAB 拆分并同步",
  "numbered.range.alignToTab": "按所选 TAB 节奏细分简谱",
  "beat.sustain": "延长拍点",
  "beat.mergeRange": "合并拍点",
  "beat.paste": "粘贴拍点",
  "numberedNotation.set": "设置简谱",
  "numberedNotation.remove": "删除简谱",
  "numberedNotation.setSequence": "设置简谱序列",
  "score.setNotationInfo": "修改歌曲信息",
  "lyric.set": "设置歌词",
  "lyrics.setSequence": "设置歌词序列",
  "lyric.remove": "删除歌词",
  "chordSymbol.set": "设置和弦",
  "chordSymbol.remove": "删除和弦",
  "note.set": "设置音符",
  "note.remove": "删除音符",
  "note.setRect": "批量设置音符",
  "note.removeRect": "批量删除音符",
  "beat.setRhythm": "修改时值",
  "beat.setKind": "修改拍点类型",
  "beat.setKindRange": "修改拍点类型",
  "measure.insert": "插入小节",
  "measure.copy": "复制并插入小节",
  "measure.copyRange": "复制并插入小节范围",
  "measure.remove": "删除小节",
  "measure.setTimeSignature": "修改拍号",
  "barline.setBoundary": "修改小节线",
  "track.setTuning": "修改调弦",
  "track.setCapo": "修改变调夹",
  "measure.setSectionLabel": "修改段落标记",
  "technique.add": "添加技巧",
  "technique.update": "修改技巧",
  "technique.remove": "删除技巧",
  "tuplet.set": "设置连音组",
  "tuplet.remove": "删除连音组",
  "numbered.sequence.set": "设置简谱序列",
  "numbered.sequence.insert": "插入简谱序列",
  "numbered.event.set": "设置简谱音符",
  "numbered.range.replace": "替换简谱范围",
  "numbered.range.paste": "粘贴简谱",
  "numbered.event.setRhythm": "修改简谱时值",
  "numbered.event.remove": "删除简谱音符",
  "numbered.event.split": "拆分简谱拍点",
  "numbered.event.merge": "合并简谱拍点",
  "numbered.tuplet.remove": "删除简谱连音组",
  "numbered.mark.add": "添加简谱记号",
  "numbered.mark.update": "修改简谱记号",
  "numbered.mark.remove": "删除简谱记号",
};

const strings = (...values: unknown[]): string[] =>
  [...new Set(values.flat().filter((value): value is string => typeof value === "string"))];

type ReferenceKey = "id" | "trackId" | "measureId" | "beatId" | "startBeatId" |
  "endBeatId" | "sourceStartMeasureId" | "sourceEndMeasureId" | "afterMeasureId" |
  "techniqueId" | "markId" | "tupletId" | "lyricId" | "chordSymbolId" |
  "eventId" | "itemId" | "fromNoteId" | "toNoteId" | "fromEventId" |
  "toEventId" | "fromItemId" | "toItemId";
type References = Partial<Record<ReferenceKey, string>>;
type CommandReferences = References & {
  type: string;
  kind?: string;
  eventIds?: string[];
  range?: { trackId?: string; anchor?: References; focus?: References };
  boundary?: References;
  technique?: References;
  mark?: References;
};

/** 仅提取位置 ID。不能把歌词、完整命令、草稿等输入保存在 metadata 中。 */
const describeCommand = (document: ILXMDocument, command: ILXMScoreCommand) => {
  // 容许未来宿主命令；只按明确白名单读取引用字段。
  const c = command as unknown as CommandReferences;
  if (!Object.hasOwn(labels, c.type))
    return { label: "编辑曲谱", target: { summary: "当前曲谱" } };
  const trackId = c.trackId ?? c.range?.trackId;
  const trackIndex = document.score.tracks.findIndex((track) => track.id === trackId);
  const track = document.score.tracks[trackIndex];
  let label = labels[c.type]!;
  if (c.type === "beat.setKind" || c.type === "beat.setKindRange")
    label = c.kind === "rest" ? "设置休止" : "取消休止（不恢复音符）";
  if (!track) return { label, target: { summary: "当前曲谱" } };

  const technique: References | undefined = c.technique ?? track.techniques.find((item) => item.id === c.techniqueId);
  const mark: References | undefined = c.mark ?? track.numberedMarks.find((item) => item.id === c.markId);
  const objectIds = strings(
    c.techniqueId, c.markId, c.tupletId, c.lyricId, c.chordSymbolId,
    c.eventId, c.eventIds, c.itemId, technique?.fromNoteId, technique?.toNoteId,
    mark?.eventId, mark?.fromEventId, mark?.toEventId, mark?.fromItemId, mark?.toItemId,
  );
  const beatIds = strings(
    c.beatId, c.startBeatId, c.endBeatId, c.range?.anchor?.beatId,
    c.range?.focus?.beatId, technique?.beatId,
  );
  const measureIds = strings(
    c.measureId, c.sourceStartMeasureId, c.sourceEndMeasureId,
    c.afterMeasureId, c.boundary?.measureId,
    c.range?.anchor?.measureId, c.range?.focus?.measureId,
  );
  const locations: { measure: number; beat?: number }[] = [];
  track.measures.forEach((measure, index) => {
    const orderedBeats = [...measure.beats].sort((left, right) => left.tick - right.tick);
    const locatedBeats = orderedBeats.filter((beat) =>
      beatIds.includes(beat.id) || beat.notes.some((note) => objectIds.includes(note.id)),
    );
    const hasObject = measure.numberedVoice.events.some((event) =>
      objectIds.includes(event.id) || event.items.some((item) => objectIds.includes(item.id)),
    ) || measure.tuplets.some((item) => objectIds.includes(item.id)) ||
      measure.lyrics.some((item) => objectIds.includes(item.id)) ||
      measure.chordSymbols.some((item) => objectIds.includes(item.id));
    if (!measureIds.includes(measure.id) && !locatedBeats.length && !hasObject) return;
    if (!measureIds.includes(measure.id)) measureIds.push(measure.id);
    locatedBeats.forEach((beat) => {
      if (!beatIds.includes(beat.id)) beatIds.push(beat.id);
      locations.push({ measure: index + 1, beat: orderedBeats.indexOf(beat) + 1 });
    });
    if (!locatedBeats.length) locations.push({ measure: index + 1 });
  });
  const position = (location: { measure: number; beat?: number }) =>
    `第 ${location.measure} 小节${location.beat ? `第 ${location.beat} 拍` : ""}`;
  const first = locations[0];
  const last = locations.at(-1);
  const summary = `第 ${trackIndex + 1} 轨${first
    ? ` · ${position(first)}${last && last !== first ? `—${position(last)}` : ""}`
    : ""}`;
  return {
    label,
    target: {
      summary, trackId: track.id,
      ...(measureIds.length ? { measureIds } : {}),
      ...(beatIds.length ? { beatIds } : {}),
      ...(objectIds.length ? { objectIds } : {}),
    },
  };
};

export const createHistoryEntry = (
  id: string,
  document: ILXMDocument,
  command: ILXMScoreCommand,
  effects: readonly ILXMCommandEffect[],
): HistoryEntry => {
  let metadata: { label: string; target: HistoryTarget };
  try {
    metadata = describeCommand(document, command);
  } catch {
    metadata = { label: "编辑曲谱", target: { summary: "当前曲谱" } };
  }
  return readonlySnapshot({ id, ...metadata, effects });
};

type HistoryTransition =
  | { type: "reset" }
  | { type: "commit"; document: ILXMDocument; entry: HistoryEntry }
  | { type: "undo" | "redo"; document: ILXMDocument };

/** 快照与 metadata 永远在同一个转换内移动和裁切。 */
export const transitionHistory = (history: EditorHistory, action: HistoryTransition): EditorHistory => {
  if (action.type === "reset")
    return { past: [], future: [], pastEntries: Object.freeze([]), futureEntries: Object.freeze([]), baselineAdvanced: false };
  if (action.type === "undo") {
    const entry = history.pastEntries.at(-1);
    if (!entry) return history;
    return {
      ...history,
      past: history.past.slice(0, -1),
      future: [action.document, ...history.future],
      pastEntries: Object.freeze(history.pastEntries.slice(0, -1)),
      futureEntries: Object.freeze([entry, ...history.futureEntries]),
    };
  }
  const entry = action.type === "commit" ? action.entry : history.futureEntries[0];
  if (!entry) return history;
  return {
    past: [...history.past, action.document].slice(-HISTORY_LIMIT),
    future: action.type === "commit" ? [] : history.future.slice(1),
    pastEntries: Object.freeze([...history.pastEntries, entry].slice(-HISTORY_LIMIT)),
    futureEntries: Object.freeze(action.type === "commit" ? [] : history.futureEntries.slice(1)),
    baselineAdvanced: history.baselineAdvanced || history.past.length >= HISTORY_LIMIT,
  };
};

export const createEmptyHistory = (): EditorHistory =>
  ({ past: [], future: [], pastEntries: Object.freeze([]), futureEntries: Object.freeze([]), baselineAdvanced: false });

export const toHistoryState = (history: EditorHistory) => {
  const entries = Object.freeze([...history.pastEntries, ...history.futureEntries]);
  return {
  history,
  pastEntries: history.pastEntries,
  futureEntries: history.futureEntries,
  baselineAdvanced: history.baselineAdvanced,
  historyEntries: entries,
  historyView: Object.freeze({
    entries,
    appliedCount: history.pastEntries.length,
    currentEntryId: history.pastEntries.at(-1)?.id ?? null,
    baselineAdvanced: history.baselineAdvanced,
  }),
  canUndo: history.past.length > 0,
  canRedo: history.future.length > 0,
  historyDepth: { past: history.past.length, future: history.future.length },
  };
};

export const retainFeedback = (event: EditorFeedbackEvent | null, history: EditorHistory) =>
  event?.entryId && ![...history.pastEntries, ...history.futureEntries].some((entry) => entry.id === event.entryId)
    ? null : event;

export const selectEditorHistory = (state: { historyView: EditorHistoryView }) => state.historyView;
export const selectHistoryEntries = (state: { historyEntries: readonly HistoryEntry[] }) => state.historyEntries;
