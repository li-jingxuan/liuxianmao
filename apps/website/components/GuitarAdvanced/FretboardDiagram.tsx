"use client";
import type { FretboardDiagramData } from "../../lib/guitar-advanced/model";
import styles from "./LearningUi.module.scss";
interface Props {
  diagram: FretboardDiagramData;
  selectedIds?: readonly string[];
  allowedIds?: readonly string[];
  onChange?: (ids: readonly string[]) => void;
  disabled?: boolean;
  reveal?: boolean;
}
/** 图形和文字清单共享选中集合；提交前只读出弦/品，不泄露音名。 */
export const FretboardDiagram = ({
  diagram,
  selectedIds = [],
  allowedIds,
  onChange,
  disabled = false,
  reveal = true,
}: Props) => {
  const toggle = (id: string) => {
    if (!disabled && onChange)
      onChange(
        selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id],
      );
  };
  const interactive = !!onChange;
  const label = (p: FretboardDiagramData["positions"][number]) =>
    `第 ${p.stringNumber} 弦 ${p.fret} 品${reveal ? ` ${p.noteName}` : ""}`;
  const positions = diagram.positions.filter(
    (p) => !allowedIds || allowedIds.includes(p.id),
  );
  return (
    <div>
      <p className={styles.muted}>
        {diagram.title}。上方为第 {diagram.stringNumbers[0]} 弦，0 品为空弦。
      </p>
      <svg
        className={styles.diagram}
        viewBox="0 0 720 155"
        role="group"
        aria-label="指板位置"
      >
        {Array.from(
          { length: diagram.fretRange.to - diagram.fretRange.from + 1 },
          (_, i) => (
            <g key={i}>
              <line
                x1={65 + i * 110}
                y1={30}
                x2={65 + i * 110}
                y2={130}
                stroke="#ccd3df"
              />
              <text x={65 + i * 110} y={20} textAnchor="middle" fontSize={14}>
                {i + diagram.fretRange.from} 品
              </text>
            </g>
          ),
        )}
        {diagram.stringNumbers.map((s, i) => (
          <g key={s}>
            <line
              x1={30}
              y1={60 + i * 50}
              x2={680}
              y2={60 + i * 50}
              stroke="#626e82"
              strokeWidth={2}
            />
            <text x={8} y={65 + i * 50} fontSize={14}>
              {s}
            </text>
          </g>
        ))}
        {positions.map((p) => {
          const selected = selectedIds.includes(p.id),
            x = 65 + (p.fret - diagram.fretRange.from) * 110,
            y = 60 + diagram.stringNumbers.indexOf(p.stringNumber) * 50;
          return (
            <g
              key={p.id}
              role={interactive ? "checkbox" : "img"}
              aria-label={label(p)}
              aria-checked={interactive ? selected : undefined}
              aria-disabled={interactive ? disabled : undefined}
              tabIndex={interactive && !disabled ? 0 : undefined}
              onClick={() => toggle(p.id)}
              onKeyDown={(e) => {
                if (interactive && (e.key === " " || e.key === "Enter")) {
                  e.preventDefault();
                  toggle(p.id);
                }
              }}
              style={{
                cursor: interactive && !disabled ? "pointer" : "default",
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={18}
                fill={selected ? "#285be0" : "#fff"}
                stroke="#285be0"
              />
              <text
                x={x}
                y={y + 5}
                fontSize={13}
                fill={selected ? "#fff" : "#15356d"}
                textAnchor="middle"
              >
                {reveal ? p.noteName : selected ? "✓" : "·"}
              </text>
            </g>
          );
        })}
      </svg>
      {interactive && (
        <details>
          <summary>使用文字清单选择位置</summary>
          <div className={styles.positions}>
            {positions.map((p) => (
              <label className={styles.position} key={p.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(p.id)}
                  disabled={disabled}
                  onChange={() => toggle(p.id)}
                />
                {label(p)}
              </label>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};
