import type { ILXMRhythmBase } from "@liuxianmao/lxm-editor";
import styles from "./NumberedEditor.module.scss";

const rhythms: { base: ILXMRhythmBase; label: string; flags: number }[] = [
  { base: "whole", label: "全音符", flags: 0 },
  { base: "half", label: "二分音符", flags: 0 },
  { base: "quarter", label: "四分音符", flags: 0 },
  { base: "eighth", label: "八分音符", flags: 1 },
  { base: "sixteenth", label: "十六分音符", flags: 2 },
  { base: "thirtySecond", label: "三十二分音符", flags: 3 },
];

/** 内联矢量音乐符号不依赖客户端音乐字体。这里只更新草稿。 */
export const NumberedRhythmToolbar = ({
  base,
  dots,
  disabled,
  onChange,
}: {
  base: ILXMRhythmBase;
  dots: number;
  disabled?: boolean;
  onChange: (base: ILXMRhythmBase, dots: number) => void;
}) => (
  <div className={styles.rhythmToolbar} role="group" aria-label="常用时值">
    <span className={styles.rhythmLabel}>时值</span>
    {rhythms.map((rhythm) => (
      <button
        key={rhythm.base}
        type="button"
        title={rhythm.label}
        aria-label={rhythm.label}
        aria-pressed={base === rhythm.base}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onChange(rhythm.base, dots)}
      >
        <svg viewBox="0 0 24 28" width="22" height="26" aria-hidden="true">
          <ellipse
            cx={rhythm.base === "whole" ? 12 : 8}
            cy="21"
            rx={rhythm.base === "whole" ? 6 : 4.5}
            ry="3"
            transform={rhythm.base === "whole" ? undefined : "rotate(-20 8 21)"}
            fill={
              rhythm.base === "whole" || rhythm.base === "half"
                ? "none"
                : "currentColor"
            }
            stroke="currentColor"
            strokeWidth="1.7"
          />
          {rhythm.base !== "whole" && (
            <path
              d="M12 20V3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
          )}
          {Array.from({ length: rhythm.flags }, (_, flag) => (
            <path
              key={flag}
              d={`M12 ${3 + flag * 4} C13 ${7 + flag * 4},21 ${6 + flag * 4},18 ${12 + flag * 4}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
          ))}
        </svg>
      </button>
    ))}
    <button
      type="button"
      title="附点"
      aria-label="附点"
      aria-pressed={dots === 1}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChange(base, dots === 1 ? 0 : 1)}
    >
      <svg viewBox="0 0 24 28" width="22" height="26" aria-hidden="true">
        <circle cx="12" cy="15" r="2.5" fill="currentColor" />
      </svg>
    </button>
  </div>
);
