import type { ILXMCommandEffect } from "@liuxianmao/lxm-editor";
import styles from "./EditorImpactNotice.module.scss";
import { formatTupletLabel } from "../shared/tuplet-label";

export type EditorImpactContext =
  | "preview"
  | "committed"
  | "undone"
  | "clipboard";

const techniqueNames: Record<string, string> = {
  hammerOn: "击弦",
  pullOff: "勾弦",
  slideUp: "上滑音",
  slideDown: "下滑音",
  tie: "延音线",
  traversalTie: "延音线",
  bend: "推弦",
  vibrato: "颤音",
  naturalHarmonic: "自然泛音",
  artificialHarmonic: "人工泛音",
  tapping: "点弦",
  trill: "颤音奏",
  strum: "扫弦",
  arpeggio: "琶音",
  pickStroke: "拨片方向",
  palmMute: "手掌闷音",
  letRing: "持续发音",
};
const markNames: Record<string, string> = {
  tie: "延音线",
  slur: "连音线",
  fermata: "延长记号",
};
const labels: Record<string, string> = {
  "beats.structured": "拍点结构编辑",
  "beats.pasted": "拍点粘贴",
  "tuplets.structured": "连音组结构",
  "measures.copied": "小节范围复制",
  "beat.compressed": "拍时值缩短",
  "beat.retimed": "拍起点调整",
  "technique.removed": "失效技巧移除",
  "technique.omitted": "边界技巧未复制",
  "numbered.event.retimed": "简谱起点调整",
  "numbered.event.resized": "简谱时值调整",
  "numbered.event.overwritten": "简谱音符覆盖",
  "numbered.mark.removed": "简谱标记移除",
  "numbered.mark.migrated": "简谱标记端点迁移",
  "numbered.mark.omitted": "边界简谱连接未复制",
};

/** Only reads the captured effects, never the current score or selection. */
export const formatEditorImpactSummary = (
  effects: readonly ILXMCommandEffect[],
) => {
  const counts = new Map<string, number>();
  for (const effect of effects)
    counts.set(effect.kind, (counts.get(effect.kind) ?? 0) + 1);
  return [...counts]
    .map(([kind, count]) => `${labels[kind] ?? "其他影响"} ${count} 项`)
    .join("，");
};

export const formatEditorImpact = (
  effect: ILXMCommandEffect,
  context: EditorImpactContext = "committed",
) => {
  const preview = context === "preview";
  const undone = context === "undone";
  const location = `${context === "clipboard" || effect.kind.endsWith("omitted") ? "复制范围" : "编辑前"}第 ${effect.measureNumber} 小节：${"beatNumber" in effect ? `第 ${effect.beatNumber} 拍，` : ""}`;
  let description: string;
  switch (effect.kind) {
    case "beats.structured":
      description = `${effect.operation === "split" ? "等分拍点，持续音使用 Tie" : "合并拍点"}（消耗 ${effect.consumedTieCount} 个内部 Tie）`;
      break;
    case "beats.pasted":
      description = `${effect.mode === "insert" ? "插入" : "覆盖"}粘贴 ${effect.count} 拍`;
      break;
    case "tuplets.structured":
      description = `${effect.operation === "set" ? "设置" : "移除"}${formatTupletLabel(effect.ratio)}（${effect.count} 组）`;
      break;
    case "measures.copied":
      description = `复制第 ${effect.measureNumber}–${effect.endMeasureNumber} 小节（${effect.count} 小节）至${effect.afterMeasureNumber === 0 ? "谱首" : `原第 ${effect.afterMeasureNumber} 小节后`}`;
      break;
    case "beat.compressed":
      description = "为保持小节容量，时值自动缩短";
      break;
    case "beat.retimed":
      description = "随节奏变化调整起点";
      break;
    case "numbered.event.retimed":
      description = "简谱事件随明确的插入操作调整起点";
      break;
    case "numbered.event.resized":
      description = preview
        ? "简谱事件时值将调整"
        : undone
          ? "曾调整简谱事件时值"
          : "简谱事件时值已调整";
      break;
    case "numbered.event.overwritten":
      description = preview
        ? "随目标音符时值扩展，将覆盖此音符"
        : undone
          ? "曾随目标音符时值扩展覆盖此音符"
          : "随目标音符时值扩展，已覆盖此音符";
      break;
    case "numbered.mark.removed":
    case "numbered.mark.migrated":
    case "numbered.mark.omitted":
      description = `${effect.markType ? (markNames[effect.markType] ?? "简谱标记") : "简谱连接"}：${effect.kind === "numbered.mark.omitted" ? "跨越复制边界，未复制" : effect.kind === "numbered.mark.migrated" ? "随拆合操作迁移端点" : preview ? "目标或关系将失效，将移除" : undone ? "曾因目标或关系失效而移除" : "目标或关系不再有效，已移除"}`;
      break;
    case "technique.removed":
    case "technique.omitted":
      description = `${techniqueNames[effect.techniqueType] ?? "技巧"}：${effect.kind === "technique.omitted" ? "关系跨越复制边界，未复制" : preview ? "目标或关系将失效，将移除" : undone ? "曾因目标或关系失效而移除" : "目标或关系不再有效，已移除"}`;
      break;
    default:
      description = "其他附带影响";
  }
  return `${location}${description}${undone ? "（已撤销）" : ""}`;
};

const historyEffectText = (effect: ILXMCommandEffect): string => {
  switch (effect.kind) {
    case "beats.structured": {
      if (effect.operation === "split") return "等分拍点，持续音加延音线";
      return effect.consumedTieCount > 0
        ? `合并拍点（消耗 ${effect.consumedTieCount} 条内部延音线）`
        : "合并拍点";
    }
    case "beats.pasted":
      return `${effect.mode === "insert" ? "插入" : "覆盖"}粘贴 ${effect.count} 拍`;
    case "tuplets.structured":
      return `${effect.operation === "set" ? "设置" : "移除"}${formatTupletLabel(effect.ratio)}（${effect.count} 组）`;
    case "measures.copied": {
      const range =
        effect.measureNumber === effect.endMeasureNumber
          ? `${effect.measureNumber}`
          : `${effect.measureNumber}–${effect.endMeasureNumber}`;
      const destination =
        effect.afterMeasureNumber === 0
          ? "谱首"
          : `原第 ${effect.afterMeasureNumber} 小节后`;
      return `复制编辑前第 ${range} 小节到${destination}`;
    }
    case "beat.compressed":
      return "时值缩短";
    case "beat.retimed":
      return "起点调整";
    case "numbered.event.retimed":
      return "简谱音符起点调整";
    case "numbered.event.resized":
      return "简谱音符时值调整";
    case "numbered.event.overwritten":
      return "覆盖简谱音符";
    case "numbered.mark.removed":
    case "numbered.mark.migrated":
    case "numbered.mark.omitted": {
      const mark = effect.markType
        ? (markNames[effect.markType] ?? "标记")
        : "连接";
      if (effect.kind === "numbered.mark.removed") return `移除简谱${mark}`;
      if (effect.kind === "numbered.mark.migrated")
        return `简谱${mark}端点调整`;
      return `简谱${mark}跨越边界，未复制`;
    }
    case "technique.removed":
    case "technique.omitted": {
      const technique = techniqueNames[effect.techniqueType] ?? "技巧";
      return effect.kind === "technique.removed"
        ? `移除${technique}`
        : `${technique}跨越边界，未复制`;
    }
    default:
      return "其他附带影响";
  }
};

const formatHistoryBeatRanges = (beats: ReadonlySet<number>) => {
  const sorted = [...beats].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index];
    while (sorted[index + 1] === sorted[index] + 1) index++;
    const end = sorted[index];
    ranges.push(start === end ? `${start}` : `${start}–${end}`);
  }
  return `第 ${ranges.join("、")} 拍`;
};

export interface HistoryImpactTrack {
  readonly id: string;
  readonly measures: readonly { readonly id: string }[];
}

/** 历史详情只合并同轨、同小节、同类的变化，使用命令记录的原拍号。预览和反馈仍使用各自的详细文案。 */
export const formatHistoryImpacts = (
  effects: readonly ILXMCommandEffect[],
  tracks: readonly HistoryImpactTrack[],
) => {
  const groups = new Map<
    string,
    {
      effect: ILXMCommandEffect;
      text: string;
      beats: Set<number>;
      count: number;
    }
  >();
  for (const effect of effects) {
    const text = historyEffectText(effect);
    const key = JSON.stringify([
      effect.trackId,
      effect.measureId,
      effect.measureNumber,
      effect.kind,
      text,
    ]);
    const group = groups.get(key) ?? {
      effect,
      text,
      beats: new Set<number>(),
      count: 0,
    };
    if ("beatNumber" in effect) group.beats.add(effect.beatNumber);
    group.count++;
    groups.set(key, group);
  }

  const showTrack =
    tracks.length > 1 ||
    new Set(effects.map((effect) => effect.trackId)).size > 1;
  return Array.from(groups, ([key, { effect, text, beats, count }]) => {
    const trackIndex = tracks.findIndex((track) => track.id === effect.trackId);
    const track = tracks[trackIndex];
    const trackPrefix = !showTrack
      ? ""
      : track
        ? `第 ${trackIndex + 1} 轨 · `
        : "原轨道 · ";
    // 小节被移动或删除后，原编号可能已指向别处，因此明确标出编辑前的位置。
    const currentMeasureIndex = track?.measures.findIndex(
      (measure) => measure.id === effect.measureId,
    );
    const prefix = effect.kind.endsWith(".omitted")
      ? "复制范围"
      : currentMeasureIndex !== undefined &&
          currentMeasureIndex + 1 === effect.measureNumber
        ? ""
        : "编辑前";
    const location =
      effect.kind === "measures.copied"
        ? trackPrefix
        : `${trackPrefix}${prefix}第 ${effect.measureNumber} 小节 · `;
    const beatLabel = beats.size ? formatHistoryBeatRanges(beats) : "";
    const countLabel = beats.size === 0 && count > 1 ? `（${count} 项）` : "";
    return { key, text: `${location}${beatLabel}${text}${countLabel}` };
  });
};

const contextText: Record<
  EditorImpactContext,
  { title: string; note: string }
> = {
  preview: { title: "本次预览影响", note: "确认后一起提交" },
  committed: {
    title: "此操作的影响",
    note: "随操作一起提交，可通过逐步撤销恢复",
  },
  undone: {
    title: "此操作当时的影响",
    note: "此操作已撤销，以下影响当前未生效",
  },
  clipboard: {
    title: "复制遗漏详情",
    note: "以下内容未进入剪贴板，源曲谱未改变",
  },
};

export const EditorImpactDetails = ({
  effects,
  context = "committed",
}: {
  effects: readonly ILXMCommandEffect[];
  context?: EditorImpactContext;
}) =>
  effects.length === 0 ? null : (
    <div className={styles.details}>
      <p className={styles.note}>{contextText[context].note}</p>
      <ul>
        {effects.map((effect, index) => (
          <li key={`${effect.kind}-${index}`}>
            {formatEditorImpact(effect, context)}
          </li>
        ))}
      </ul>
    </div>
  );

/** Preview callers retain their expandable, pre-commit notice. */
export const EditorImpactNotice = ({
  effects,
  preview = false,
  context,
}: {
  effects: readonly ILXMCommandEffect[];
  preview?: boolean;
  context?: EditorImpactContext;
}) => {
  if (effects.length === 0) return null;
  const actualContext = context ?? (preview ? "preview" : "committed");
  return (
    <details className={styles.notice}>
      <summary>
        {contextText[actualContext].title}：{formatEditorImpactSummary(effects)}
        （
        {actualContext === "preview"
          ? "确认后一起提交"
          : actualContext === "undone"
            ? "已撤销"
            : actualContext === "clipboard"
              ? "源曲谱未改变"
              : "可撤销"}
        ）
      </summary>
      <EditorImpactDetails effects={effects} context={actualContext} />
    </details>
  );
};
