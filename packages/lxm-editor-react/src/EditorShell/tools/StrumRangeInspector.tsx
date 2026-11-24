"use client";

import styles from "./StrumRangeInspector.module.scss";

const ENDPOINTS = [
  { key: "minString", opposite: "maxString", label: "上端弦" },
  { key: "maxString", opposite: "minString", label: "下端弦" },
] as const;

export const StrumRangeInspector = ({ ranges, stringCount, disabled, onChange }: {
  ranges: readonly { minString: number; maxString: number; stroke?: "up" | "down" }[];
  stringCount: number;
  disabled?: boolean;
  onChange: (endpoint: "minString" | "maxString", string: number) => void;
}) => {
  const first = ranges[0];
  if (!first) return null;
  const strings = Array.from({ length: stringCount }, (_, index) => index + 1);
  const mixedUpper = ranges.some((range) => range.minString !== first.minString);
  const mixedLower = ranges.some((range) => range.maxString !== first.maxString);
  const rangeLabel = mixedUpper || mixedLower ? "多个范围" : `${first.minString}–${first.maxString} 弦`;
  const direction = ranges.length === 1 && first.stroke && (first.stroke === "up" ? "↓ 上扫" : "↑ 下扫");

  return (
    <section className={styles.inspector} aria-label="扫弦范围">
      <h3 className={styles.heading}>扫弦范围</h3>
      <div className={styles.readout}>
        {direction && <span>{direction}</span>}
        <strong>{rangeLabel}</strong>
        <span className={styles.selectedCount}>已选 {ranges.length} 个音符</span>
      </div>
      <div className={styles.fields}>
        {ENDPOINTS.map(({ key, opposite, label }) => {
          // 批量编辑只改当前端点。新弦号须与每个扫弦各自的另一端保持严格次序，以保留至少两根弦。
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
      <p className={styles.hint}><kbd>Alt / ⌥</kbd> + 点按箭头或符干，增选或移除单个音符</p>
    </section>
  );
};
