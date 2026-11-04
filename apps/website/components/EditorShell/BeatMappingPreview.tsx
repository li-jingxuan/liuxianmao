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
        const items = rows.filter((row) => (row.plannedPosition ?? row.sourcePosition)?.measureId === measure.key);
        if (!items.length) return null;
        return (
          <div key={measure.key} className={styles.measure}>
            <div className={styles.measureLabel}>{measure.label}</div>
            <div className={styles.scroll} tabIndex={0} aria-label={`${measure.label}映射，可横向滚动`}>
              <div className={styles.timeline}>
                {items.map((row) => {
                  const position = row.plannedPosition ?? row.sourcePosition!;
                  const source = row.sourcePosition;
                  const moved = source && row.plannedPosition && (source.startTick !== row.plannedPosition.startTick || source.endTick !== row.plannedPosition.endTick || source.measureId !== row.plannedPosition.measureId);
                  return (
                    <div key={row.key} className={styles.mapping} data-status={row.status}>
                      <strong className={styles.music}>{row.music ?? (row.after === "—" ? row.before : row.after)}</strong>
                      <button className={styles.position} type="button" disabled={!row.canInspect || !onInspect} title={!row.canInspect ? "应用后出现" : "定位谱面，不改变录入起点"} onPointerDown={(event) => event.preventDefault()} onClick={() => source && onInspect?.(source)}>{row.positionLabel}</button>
                      <div className={styles.description}>
                        <span>{row.before} → {row.after}</span>
                        <span className={styles.status}>{row.impactLabel ?? labels[row.status]}{moved ? " · 时间范围改变" : ""}</span>
                        <span className={styles.status}>{row.rhythm ?? `${Number(((position.endTick - position.startTick) / measure.beatTicks).toFixed(3))} 拍`}</span>
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
