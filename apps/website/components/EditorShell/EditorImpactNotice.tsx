import type { ILXMCommandEffect } from "@liuxianmao/lxm-editor";
const techniqueNames = {
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
const numberedMarkNames = {
  tie: "延音线",
  slur: "连音线",
  fermata: "延长记号",
};
import styles from "./index.module.scss";

/** 可展开的影响详情与本次命令共用一条历史，用户可通过既有撤销恢复。 */
export const EditorImpactNotice = ({
  effects,
}: {
  effects: ILXMCommandEffect[];
}) => {
  if (effects.length === 0) return null;
  const counts = new Map<string, number>();
  effects.forEach((effect) =>
    counts.set(effect.kind, (counts.get(effect.kind) ?? 0) + 1),
  );
  const labels = {
    "beats.structured": "拍点结构编辑",
    "beats.pasted": "拍点粘贴",
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
  return (
    <details className={styles.impactNotice}>
      <summary>
        本次编辑影响：
        {[...counts]
          .map(
            ([kind, count]) =>
              `${labels[kind as keyof typeof labels]} ${count} 项`,
          )
          .join("，")}
        （可撤销）
      </summary>
      <ul>
        {effects.map((effect, index) => (
          <li key={`${effect.kind}-${index}`}>
            {effect.kind.endsWith("omitted") ? "复制范围第" : "编辑前第"}{" "}
            {effect.measureNumber} 小节：
            {"beatNumber" in effect ? `第 ${effect.beatNumber} 拍，` : ""}
            {effect.kind === "beats.structured"
              ? `${effect.operation === "split" ? "等分拍点，持续音使用 Tie" : "合并拍点"}（消耗 ${effect.consumedTieCount} 个内部 Tie）`
              : effect.kind === "beats.pasted"
                ? `${effect.mode === "insert" ? "插入" : "覆盖"}粘贴 ${effect.count} 拍`
                : effect.kind === "measures.copied"
                  ? `复制第 ${effect.measureNumber}–${effect.endMeasureNumber} 小节（${effect.count} 小节）至${effect.afterMeasureNumber === 0 ? "谱首" : `原第 ${effect.afterMeasureNumber} 小节后`}`
                  : effect.kind === "beat.compressed"
                    ? "为保持小节容量，时值自动缩短"
                    : effect.kind === "numbered.event.retimed"
                      ? "简谱事件随明确的插入操作调整起点"
                      : effect.kind === "numbered.event.resized"
                        ? "简谱事件时值已调整"
                        : effect.kind === "numbered.event.overwritten"
                          ? "随目标音符时值扩展，已覆盖此音符"
                          : "markId" in effect
                            ? `${effect.markType ? numberedMarkNames[effect.markType] : "简谱连接"}：${effect.kind === "numbered.mark.omitted" ? "跨越复制边界，未复制" : effect.kind === "numbered.mark.migrated" ? "随拆合操作迁移端点" : "目标或关系不再有效，已移除"}`
                            : effect.kind === "beat.retimed"
                              ? "随节奏变化调整起点"
                              : "techniqueType" in effect
                                ? `${techniqueNames[effect.techniqueType]}：${effect.kind === "technique.omitted" ? "关系跨越复制边界，未复制" : "目标或关系不再有效，已移除"}`
                                : ""}
          </li>
        ))}
      </ul>
    </details>
  );
};
