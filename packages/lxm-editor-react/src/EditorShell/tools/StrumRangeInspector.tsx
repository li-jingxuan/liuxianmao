"use client";

import type { StrumEndpoint, StrumRangeTechniqueType } from "../score/StrumInteractionLayer";
import styles from "./StrumRangeInspector.module.scss";

const ENDPOINTS = [
  { key: "minString", opposite: "maxString", label: "上端弦" },
  { key: "maxString", opposite: "minString", label: "下端弦" },
] as const;

export const StrumRangeInspector = ({ ranges, stringCount, disabled, onChange, techniqueType = "strum" }: {
  ranges: readonly { minString: number; maxString: number; stroke?: "up" | "down"; direction?: "ascending" | "descending" }[];
  stringCount: number;
  disabled?: boolean;
  onChange: (endpoint: StrumEndpoint, string: number) => void;
  techniqueType?: StrumRangeTechniqueType;
}) => {
  const first = ranges[0];
  if (!first) return null;
  const strings = Array.from({ length: stringCount }, (_, index) => index + 1);
  const mixedUpper = ranges.some((range) => range.minString !== first.minString);
  const mixedLower = ranges.some((range) => range.maxString !== first.maxString);
  const rangeLabel = mixedUpper || mixedLower ? "多个范围" : `${first.minString}–${first.maxString} 弦`;
  const isArpeggio = techniqueType === "arpeggio";
  const heading = isArpeggio ? "琶音范围" : "扫弦范围";
  // 琶音的上、下行按实际箭尖朝向展示，扫弦沿用原来的上扫、下扫名称。多选时各自方向独立保留。
  const direction = isArpeggio
    ? first.direction && (first.direction === "ascending" ? "↑ 上行" : "↓ 下行")
    : first.stroke && (first.stroke === "up" ? "↓ 上扫" : "↑ 下扫");

  return (
    <section className={styles.inspector} aria-label={heading}>
      <h3 className={styles.heading}>{heading}</h3>
      <div className={styles.readout}>
        {ranges.length === 1 && direction && <span>{direction}</span>}
        <strong>{rangeLabel}</strong>
        <span className={styles.selectedCount}>已选 {ranges.length} 个音符</span>
      </div>
      <div className={styles.fields}>
        {ENDPOINTS.map(({ key, opposite, label }) => {
          // 调用方按类型传入范围。批量选项取该组的合法弦号交集，每项保留原来的对端和方向，
          // 且新端点与各自对端保持严格次序，让扫弦和琶音都至少覆盖两根弦。
          const allowed = strings.filter((string) => ranges.every((range) =>
            key === "minString" ? string < range[opposite] : string > range[opposite]));
          const mixed = key === "minString" ? mixedUpper : mixedLower;

          return (
            <label key={key} className={styles.field}>
              <span>{label}</span>
              <select value={mixed ? "" : first[key]} disabled={disabled} onChange={(event) => {
                const string = Number(event.currentTarget.value);
                if (!disabled && allowed.includes(string)) onChange(key, string);
              }}>
                {mixed && <option value="" disabled>多个值</option>}
                {strings.map((string) => (
                  <option key={string} value={string} disabled={!allowed.includes(string)}>第 {string} 弦</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <p className={styles.hint}><kbd>Alt / ⌥</kbd> + 点按{isArpeggio ? "波线箭头或符干，增选或移除单个琶音" : "箭头或符干，增选或移除单个音符"}</p>
    </section>
  );
};
