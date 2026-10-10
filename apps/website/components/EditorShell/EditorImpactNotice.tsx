import type { ILXMCommandEffect } from "@liuxianmao/lxm-editor";
const techniqueNames = {
  hammerOn: "击弦",
  pullOff: "勾弦",
  slideUp: "上滑音",
  slideDown: "下滑音",
  tie: "延音线",
  bend: "全音推弦",
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
    "beat.compressed": "拍时值缩短",
    "beat.retimed": "拍起点调整",
    "technique.removed": "失效技巧移除",
    "technique.omitted": "跨小节技巧未复制",
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
            编辑前第 {effect.measureNumber} 小节：
            {"beatNumber" in effect ? `第 ${effect.beatNumber} 拍，` : ""}
            {effect.kind === "beat.compressed"
              ? "为保持小节容量，时值自动缩短"
              : effect.kind === "beat.retimed"
                ? "随节奏变化调整起点"
                : `${techniqueNames[effect.techniqueType]}：${effect.kind === "technique.omitted" ? "关系跨越复制边界，未复制" : "目标或关系不再有效，已移除"}`}
          </li>
        ))}
      </ul>
    </details>
  );
};
