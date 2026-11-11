"use client";

import styles from "./BeatMappingPreview.module.scss";

/** 只读时间位置；候选事件尚未写谱时仍用当前小节范围定位。 */
export interface BeatMappingPosition {
  trackId: string;
  measureId: string;
  startTick: number;
  endTick: number;
}
export type BeatMappingStatus = "add" | "change" | "same" | "remove" | "skip" | "release" | "error";
export interface BeatMappingRow {
  key: string;
  before: string;
  after: string;
  positionLabel: string;
  status: BeatMappingStatus;
  sourcePosition: BeatMappingPosition | null;
  plannedPosition: BeatMappingPosition | null;
  canInspect: boolean;
  rhythm?: string;
  music?: string;
  impactLabel?: string;
}
export interface BeatMappingMeasure {
  key: string;
  label: string;
  durationTicks: number;
  /** 一拍的真实 tick 长度，来自所在小节拍号。 */
  beatTicks: number;
}

const labels: Record<BeatMappingStatus, string> = {
  add: "新增", change: "修改", same: "未变化", remove: "删除",
  skip: "跳过，保留原值", release: "释放空位", error: "错误",
};

/** 所有坐标直接取领域候选的 tick；重叠的新旧范围分行，保留相同时间轴。 */
export function beatMappingLayout(rows: readonly BeatMappingRow[], measure: BeatMappingMeasure) {
  const items = rows.filter((row) => (row.plannedPosition ?? row.sourcePosition)?.measureId === measure.key)
    .map((row) => ({ row, position: (row.plannedPosition ?? row.sourcePosition)! }))
    .sort((a, b) => a.position.startTick - b.position.startTick || a.position.endTick - b.position.endTick);
  const startTick = items.length ? Math.min(...items.map(({ position }) => position.startTick)) : 0;
  const endTick = items.length ? Math.max(...items.map(({ position }) => position.endTick)) : startTick;
  const duration = endTick - startTick;
  const boundaries = [...new Set([startTick, endTick, ...items.flatMap(({ position }) => [position.startTick, position.endTick])])].sort((a, b) => a - b);
  const shortest = Math.min(measure.beatTicks, ...items.map(({ position }) => position.endTick - position.startTick).filter((ticks) => ticks > 0));
  const laneEnds: number[] = [];
  return {
    duration,
    minWidth: Math.max(88, duration / shortest * 88),
    columns: boundaries.slice(1).map((tick, index) => `${tick - boundaries[index]!}fr`).join(" "),
    items: items.map(({ row, position }) => {
      let lane = laneEnds.findIndex((end) => end <= position.startTick);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = position.endTick;
      return { row, position, lane, startColumn: boundaries.indexOf(position.startTick) + 1, endColumn: boundaries.indexOf(position.endTick) + 1 };
    }),
  };
}

/** 简谱和歌词共用的纯展示视图；不解析原文，也不改变批次起点。 */
export function BeatMappingPreview({ rows, measures, onInspect, label = "节拍映射预览", notice }: {
  rows: readonly BeatMappingRow[];
  measures: readonly BeatMappingMeasure[];
  onInspect?: (position: BeatMappingPosition) => void;
  label?: string;
  notice?: string;
}) {
  if (!rows.length) return null;
  return (
    <section className={styles.preview} aria-label={label}>
      <div className={styles.heading}>{label}<span>{rows.length} 项</span></div>
      {measures.map((measure) => {
        const layout = beatMappingLayout(rows, measure);
        if (!layout.items.length) return null;
        const first = layout.items[0]!.position.startTick;
        const last = Math.max(...layout.items.map(({ position }) => position.endTick));
        const beat = (tick: number) => `第 ${Number((tick / measure.beatTicks + 1).toFixed(3))} 拍`;
        return (
          <div key={measure.key} className={styles.measure}>
            <div className={styles.measureLabel}>{measure.label}<span>{beat(first)}～{beat(last)}</span></div>
            <div className={styles.scroll} tabIndex={0} aria-label={`${measure.label}映射，可横向滚动`}>
              <div className={styles.timeline} style={{ width: layout.minWidth, gridTemplateColumns: layout.columns }}>
                {layout.items.map(({ row, position, lane, startColumn, endColumn }) => {
                  const source = row.sourcePosition;
                  const moved = source && row.plannedPosition && (source.startTick !== row.plannedPosition.startTick || source.endTick !== row.plannedPosition.endTick || source.measureId !== row.plannedPosition.measureId);
                  return (
                    <div key={row.key} className={styles.mapping} data-status={row.status} data-start-tick={position.startTick} data-end-tick={position.endTick}
                      style={{ gridColumn: `${startColumn} / ${endColumn}`, gridRow: lane + 1 }}>
                      <strong className={styles.music}>{row.music ?? (row.after === "—" ? row.before : row.after)}</strong>
                      <button className={styles.position} type="button" disabled={!row.canInspect || !onInspect} title={`${row.positionLabel} · ${!row.canInspect ? "应用后出现" : "定位谱面，不改变录入起点"}`} onPointerDown={(event) => event.preventDefault()} onClick={() => source && onInspect?.(source)}>{beat(position.startTick)}</button>
                      <div className={styles.description}>
                        {row.before !== row.after && <span>{row.before} → {row.after}</span>}
                        <span className={styles.status}>{row.impactLabel ?? labels[row.status]}{moved ? " · 时间范围改变" : ""} · {row.rhythm ?? `${Number(((position.endTick - position.startTick) / measure.beatTicks).toFixed(3))} 拍`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {rows.filter((row) => !row.sourcePosition && !row.plannedPosition).map((row) => <p key={row.key} role={row.status === "error" ? "alert" : undefined}>{row.after} · {row.impactLabel ?? labels[row.status]}</p>)}
    </section>
  );
}
