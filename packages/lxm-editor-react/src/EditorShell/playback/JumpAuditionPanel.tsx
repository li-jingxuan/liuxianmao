import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { CornerDownLeft, CornerDownRight } from "lucide-react";
import { JUMP_MARK_LABEL, type PlaybackMeasureVisit } from "@liuxianmao/lxm-editor";
import { EditorScrollbars, editorScrollbarStyles } from "../shared/EditorScrollbars";
import type { ScorePlaybackControls } from "./controller";
import styles from "./JumpAuditionPanel.module.scss";

function groupVisits(visits: readonly PlaybackMeasureVisit[]) {
  const counts = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const { measureId } of visits) counts.set(measureId, (counts.get(measureId) ?? 0) + 1);

  // 仅按真实计划中的相邻到访分段。起点裁剪后，首项之前的跳转没有在本轮发生，不绘制连线。
  const passages: { from?: PlaybackMeasureVisit; items: { visit: PlaybackMeasureVisit; ordinal: number; repeated: boolean }[] }[] = [];
  visits.forEach((visit, index) => {
    if (!index || visit.jumped) passages.push({ from: visits[index - 1], items: [] });
    const ordinal = (seen.get(visit.measureId) ?? 0) + 1;
    seen.set(visit.measureId, ordinal);
    passages.at(-1)!.items.push({ visit, ordinal, repeated: counts.get(visit.measureId)! > 1 });
  });
  return passages;
}

export function JumpAuditionPanel({ playback, visits }: {
  playback: ScorePlaybackControls;
  visits: readonly PlaybackMeasureVisit[];
}) {
  const id = useId();
  const view = useRef<HTMLDivElement>(null);
  const current = playback.position?.visitIndex;
  const passages = useMemo(() => groupVisits(visits), [visits]);
  const loading = playback.phase === "loading";

  useLayoutEffect(() => {
    const viewport = view.current;
    const target = viewport?.querySelector("[aria-current=step]");
    if (!viewport || !target) return;
    const box = target.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    // 只滚动列表自身。scrollIntoView 会连带滚动宿主，且可能改变谱面的跟随视口。
    if (box.top < bounds.top + 6) viewport.scrollTop += box.top - bounds.top - 6;
    else if (box.bottom > bounds.bottom - 6) viewport.scrollTop += box.bottom - bounds.bottom + 6;
  }, [current, passages]);

  return (
    <aside className={styles.panel} data-jump-audition aria-labelledby={`${id}-title`} onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing) playback.setEnabled(false);
    }}>
      <header className={styles.header}>
        <div><h2 id={`${id}-title`}>小节播放顺序</h2><span>共 {visits.length} 次到访</span></div>
        <p id={`${id}-hint`}>选择小节试听单次到访</p>
      </header>
      <div className={editorScrollbarStyles.shell}>
        <div ref={view} className={`${styles.orderView} ${editorScrollbarStyles.viewport}`} data-editor-scroll-viewport data-playback-order tabIndex={0}
          role="region" aria-label="播放顺序列表" aria-describedby={`${id}-hint`}>
          {passages.map(({ from, items }) => {
            const first = items[0]!.visit;
            const last = items.at(-1)!.visit;
            const backward = Boolean(from && from.measureIndex >= first.measureIndex);
            const Arrow = backward ? CornerDownLeft : CornerDownRight;
            const jumpLabel = first.jump ? JUMP_MARK_LABEL[first.jump.kind]
              : backward ? (first.repeatEnding ? "反复回跳" : "回跳")
                : first.repeatEnding || from?.repeatEnding ? "切换反复房子" : "跳过小节";
            return <section className={styles.passage} key={first.visitIndex}>
              <div className={styles.passageHeading}>
                <h3>{from ? backward ? "重奏段" : "继续演奏" : "首次演奏"}</h3>
                <span>第 {first.measureIndex + 1}{first === last ? "" : `–${last.measureIndex + 1}`} 小节</span>
              </div>
              {from && <p className={styles.bridge} data-jump-transition={first.visitIndex}>
                <Arrow size={14} aria-hidden="true" /><strong>{from.measureIndex + 1} → {first.measureIndex + 1}</strong><span>{jumpLabel}</span>
              </p>}
              <ol className={styles.visits} role="list" start={first.visitIndex - visits[0]!.visitIndex + 1}>
                {items.map(({ visit, ordinal, repeated }) => {
                  const number = visit.measureIndex + 1;
                  const order = visit.visitIndex - visits[0]!.visitIndex + 1;
                  return <li key={visit.visitIndex}>
                    <button type="button" className={styles.visit} aria-disabled={loading || undefined} data-jump-visit={visit.visitIndex}
                      data-revisited={ordinal > 1 || undefined} aria-current={visit.visitIndex === current ? "step" : undefined}
                      aria-label={`试听第 ${number} 小节，第 ${ordinal} 次到访，播放顺序 ${order} / ${visits.length}`}
                      onClick={() => { if (!loading) playback.playVisits(visit.visitIndex); }}>
                      <strong data-visit-measure>{number}</strong>
                      {repeated && <span>第 {ordinal} 次</span>}
                    </button>
                  </li>;
                })}
              </ol>
            </section>;
          })}
        </div>
        <EditorScrollbars viewportRef={view} />
      </div>
    </aside>
  );
}
