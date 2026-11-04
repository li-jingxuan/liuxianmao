import type { ILXMDocument, ILXMTabCellSelection, ILXMNumberedTarget } from "@liuxianmao/lxm-editor";
import { resolveTupletSelection } from "@liuxianmao/lxm-editor";
import { normalizeMusicTextTarget, type MusicTextTarget } from "./music-text-draft";
import { formatNumberedBeatPosition } from "./numbered-editor-target";
import type { MeasureToolTarget } from "./editor-tool-actions";

/** 只读定位引用，与可编辑业务目标分离。 */
export type SidebarLocation = {
  trackId: string; measureId: string; beatId?: string;
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
  const resolved = target ? normalizeMusicTextTarget(document, target) : null;
  if (target && !resolved) return invalid;
  let title = measureTarget ? "当前小节" : "TAB 音符";
  let position = `第 ${index + 1} 小节`;
  let scope = "";
  const location: SidebarLocation = { trackId: source.trackId, measureId: source.measureId };
  if (resolved?.kind === "lyric" || resolved?.kind === "numbered") {
    const event = measure.numberedVoice.events.find((item) => item.id === resolved.eventId);
    const tick = event?.tick ?? resolved.tick;
    if (tick === undefined) return invalid;
    location.startTick = tick;
    location.endTick = resolved.endTick;
    position += ` · ${formatNumberedBeatPosition(tick, measure.timeSignature.denominator)}`;
    if (resolved.kind === "lyric") { title = "歌词"; scope = `第 ${resolved.verse ?? 1} 段`; }
    else {
      title = event ? "简谱音符" : "简谱连续输入";
      const member = event?.items.findIndex((item) => item.id === resolved.itemId) ?? -1;
      if (member >= 0) scope = `第 ${member + 1} 音`;
      if (resolved.endTick !== undefined) scope += ` 至 ${formatNumberedBeatPosition(resolved.endTick, measure.timeSignature.denominator)}`;
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
        scope = range ? `${range.beatIds.length} 个成员${range.group ? ` · ${range.group.ratio.actual}:${range.group.ratio.normal}` : ""}` : "请选择同小节连续成员";
      }
    }
  }
  const current = numberedSelection ?? selection?.focus;
  const differentSelection = !!current && (current.trackId !== source.trackId || current.measureId !== source.measureId ||
    (!!resolved?.eventId && "eventId" in current && current.eventId !== resolved.eventId));
  return { title, position, scope, valid: true, reason: null, location, differentSelection };
}
