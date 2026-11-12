import type { ILXMDocument, ILXMTabCellSelection, ILXMNumberedTarget, ILXMLyricVerse } from "@liuxianmao/lxm-editor";
import { resolveTupletSelection } from "@liuxianmao/lxm-editor";
import { normalizeMusicTextTarget, type MusicTextTarget } from "./music-text-draft";
import { sameMusicTextTarget } from "./music-text-hover";
import { formatNumberedBeatPosition } from "../numbered/numbered-editor-target";
import type { MeasureToolTarget } from "../tools/editor-tool-actions";
import { formatTupletLabel } from "../shared/tuplet-label";

/** 只读定位引用，与可编辑业务目标分离。 */
export type SidebarLocation = {
  trackId: string; measureId: string; beatId?: string; eventId?: string; itemId?: string;
  kind?: "lyric" | "numbered" | "chord"; verse?: ILXMLyricVerse;
  startTick?: number; endTick?: number;
};
export type SidebarContext = {
  title: string; position: string; scope: string; valid: boolean;
  reason: string | null; location: SidebarLocation | null; differentSelection: boolean;
};
export function deriveSidebarContext({ document, target, selection, numberedSelection, measureTarget, song = false, task }:
  { document: ILXMDocument | null; target?: MusicTextTarget | null; selection?: ILXMTabCellSelection | null;
    numberedSelection?: ILXMNumberedTarget | null; measureTarget?: MeasureToolTarget; song?: boolean; task?: string }): SidebarContext {
  const empty = { title: "尚未选择对象", position: "在谱面选择音符或小节", scope: "", valid: false, reason: null, location: null, differentSelection: false };
  if (song) return { ...empty, title: "整首歌曲", position: "歌曲信息、基础拍号与变调夹", valid: !!document };
  const source = target ?? measureTarget ?? numberedSelection ?? selection?.focus;
  if (!document || !source) return empty;
  const track = document.score.tracks.find((item) => item.id === source.trackId);
  const index = track?.measures.findIndex((item) => item.id === source.measureId) ?? -1;
  const measure = track?.measures[index];
  const invalid = { ...empty, title: target?.kind === "lyric" ? "歌词位置已失效" : "原编辑位置已失效", reason: "目标已删除或无法解析，请重新选择。" };
  if (!measure) return invalid;
  const musicTarget = target ?? (!measureTarget && numberedSelection ? { ...numberedSelection, kind: "numbered" as const } : null);
  const resolved = musicTarget ? normalizeMusicTextTarget(document, musicTarget) : null;
  if (musicTarget && !resolved) return invalid;
  let title = measureTarget ? "当前小节" : "TAB 音符";
  let position = `第 ${index + 1} 小节`;
  let scope = "";
  const location: SidebarLocation = { trackId: source.trackId, measureId: source.measureId };
  if (resolved) {
    location.kind = resolved.kind;
    if (resolved.kind === "lyric") location.verse = resolved.verse ?? 1;
  }
  if (resolved?.kind === "lyric" || resolved?.kind === "numbered") {
    const event = measure.numberedVoice.events.find((item) => item.id === resolved.eventId);
    const tick = event?.tick ?? resolved.tick;
    if (tick === undefined) return invalid;
    location.startTick = tick;
    location.endTick = resolved.endTick;
    location.eventId = resolved.eventId;
    location.itemId = resolved.itemId;
    position += ` · ${formatNumberedBeatPosition(tick, measure.timeSignature.denominator)}`;
    if (resolved.kind === "lyric") { title = "歌词"; scope = `第 ${resolved.verse ?? 1} 段`; }
    else {
      title = event ? "简谱音符" : "简谱连续输入";
      const member = event?.items.findIndex((item) => item.id === resolved.itemId) ?? -1;
      if (member >= 0) scope = `第 ${member + 1} 音`;
      if (resolved.endTick !== undefined) scope += ` 至 ${formatNumberedBeatPosition(resolved.endTick, measure.timeSignature.denominator)}`;
      if (task === "tuplet") {
        const group = event && measure.numberedVoice.tuplets.find((item) => item.eventIds.includes(event.id));
        title = "简谱连音组";
        scope = group ? `${group.eventIds.length} 个成员 · ${formatTupletLabel(group.ratio)}` : "当前简谱位置没有连音组";
      }
    }
  } else if (!measureTarget) {
    const beatId = resolved?.beatId ?? ("beatId" in source && typeof source.beatId === "string" ? source.beatId : undefined);
    const beatIndex = measure.beats.findIndex((item) => item.id === beatId);
    if (beatIndex < 0) return invalid;
    location.beatId = beatId;
    title = resolved?.kind === "chord" ? "TAB 和弦" : "TAB 音符";
    position += ` · ${formatNumberedBeatPosition(measure.beats[beatIndex]!.tick, measure.timeSignature.denominator)}`;
    if (!target && selection) {
      const endpoint = track?.measures.find((item) => item.id === selection.anchor.measureId);
      const anchorBeat = endpoint?.beats.find((item) => item.id === selection.anchor.beatId);
      if (!endpoint || !anchorBeat) return invalid;
      const isRange = selection.anchor.measureId !== selection.focus.measureId || selection.anchor.beatId !== selection.focus.beatId;
      if (isRange) {
        const anchorIndex = track!.measures.indexOf(endpoint);
        const start = `第 ${anchorIndex + 1} 小节 · ${formatNumberedBeatPosition(anchorBeat.tick, endpoint.timeSignature.denominator)}`;
        position = anchorIndex < index || (anchorIndex === index && anchorBeat.tick < measure.beats[beatIndex]!.tick)
          ? `${start} 至 ${position}` : `${position} 至 ${start}`;
        title = "TAB 范围";
      }
      if (task === "tuplet") {
        const range = resolveTupletSelection(document, selection);
        title = "连音组";
        scope = range ? `${range.beatIds.length} 个成员${range.group ? ` · ${formatTupletLabel(range.group.ratio)}` : ""}` : "请选择同小节内的连续拍点";
      }
    }
  }
  const current = numberedSelection ?? selection?.focus;
  let differentSelection = !!current && (current.trackId !== source.trackId || current.measureId !== source.measureId);
  // 同小节也可能是另一拍、另一空窗或同时音中的另一成员；歌词只比较其承载位置。
  if (current && resolved) {
    const currentTarget: MusicTextTarget | null = numberedSelection
      ? resolved.kind === "chord" ? null : resolved.kind === "lyric"
        ? { kind: "lyric", trackId: numberedSelection.trackId, measureId: numberedSelection.measureId,
            eventId: numberedSelection.kind === "numberedEvent" ? numberedSelection.eventId : undefined,
            tick: numberedSelection.kind === "numberedTime" ? numberedSelection.tick : undefined,
            endTick: numberedSelection.kind === "numberedTime" ? numberedSelection.endTick : undefined,
            verse: resolved.verse }
        : { ...numberedSelection, kind: "numbered" }
      : resolved.kind === "chord" && selection ? { ...selection.focus, kind: "chord" } : null;
    const normalized = currentTarget && normalizeMusicTextTarget(document, currentTarget);
    differentSelection = !normalized || !sameMusicTextTarget(resolved, normalized);
  }
  return { title, position, scope, valid: true, reason: null, location, differentSelection };
}
