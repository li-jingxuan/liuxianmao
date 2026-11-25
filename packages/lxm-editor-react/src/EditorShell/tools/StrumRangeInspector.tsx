"use client";

import { getTraversalEndpointBounds } from "@liuxianmao/lxm-editor";
import type { LXMTraversalEndpoint } from "@liuxianmao/lxm-editor";
import styles from "./StrumRangeInspector.module.scss";

const ENDPOINTS = [
  { key: "minString", label: "上端弦" },
  { key: "maxString", label: "下端弦" },
] as const;

type TraversalRange = { minString: number; maxString: number } & (
  { type: "strum"; stroke: "up" | "down" } | { type: "arpeggio"; direction: "ascending" | "descending" }
);

export const StrumRangeInspector = ({ ranges, stringCount, disabled, onChange }: {
  ranges: readonly TraversalRange[];
  stringCount: number;
  disabled?: boolean;
  onChange: (endpoint: LXMTraversalEndpoint, string: number) => void;
}) => {
  const first = ranges[0];
  if (!first) return null;
  const strings = Array.from({ length: stringCount }, (_, index) => index + 1);
  const mixedUpper = ranges.some((range) => range.minString !== first.minString);
  const mixedLower = ranges.some((range) => range.maxString !== first.maxString);
  const rangeLabel = mixedUpper || mixedLower ? "多个范围" : `${first.minString}–${first.maxString} 弦`;
  const mixedTypes = ranges.some((range) => range.type !== first.type);
  const isArpeggio = first.type === "arpeggio";
  const heading = mixedTypes ? "扫弦与琶音范围" : isArpeggio ? "琶音范围" : "扫弦范围";
  // 琶音的上、下行按实际箭尖朝向展示，扫弦沿用原来的上扫、下扫名称。多选时各自方向独立保留。
  const direction = isArpeggio
    ? (first.direction === "ascending" ? "↑ 上行" : "↓ 下行")
    : (first.stroke === "up" ? "↓ 上扫" : "↑ 下扫");

  return (
    <section className={styles.inspector} aria-label={heading}>
      <h3 className={styles.heading}>{heading}</h3>
      <div className={styles.readout}>
        {ranges.length === 1 && direction && <span>{direction}</span>}
        <strong>{rangeLabel}</strong>
        <span className={styles.selectedCount}>已选 {ranges.length} 个{mixedTypes ? "记号" : "音符"}</span>
      </div>
      <div className={styles.fields}>
        {ENDPOINTS.map(({ key, label }) => {
          // 侧栏与手柄使用同一套共同边界，混选时每种记号的原对端都参与限制。
          const { min, max } = getTraversalEndpointBounds(ranges, key, stringCount);
          const allowed = (string: number) => string >= min && string <= max;
          const mixed = key === "minString" ? mixedUpper : mixedLower;

          return (
            <label key={key} className={styles.field}>
              <span>{label}</span>
              <select value={mixed ? "" : first[key]} disabled={disabled} onChange={(event) => {
                const string = Number(event.currentTarget.value);
                if (!disabled && Number.isInteger(string) && allowed(string)) onChange(key, string);
              }}>
                {mixed && <option value="" disabled>多个值</option>}
                {strings.map((string) => (
                  <option key={string} value={string} disabled={!allowed(string)}>第 {string} 弦</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <p className={styles.hint}><kbd>Alt / ⌥</kbd> + 点按{mixedTypes ? "箭头、波线或符干，增选或移除单个记号" : isArpeggio ? "波线箭头或符干，增选或移除单个琶音" : "箭头或符干，增选或移除单个音符"}</p>
    </section>
  );
};
