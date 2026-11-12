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
