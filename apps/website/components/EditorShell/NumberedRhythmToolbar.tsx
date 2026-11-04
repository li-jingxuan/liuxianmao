import type { ILXMRhythmBase } from "@liuxianmao/lxm-editor";
import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";
import { MusicAssetIcon } from "../MusicAssetIcon";
import styles from "./NumberedEditor.module.scss";
import toolbarStyles from "./index.module.scss";

const rhythms: { base: ILXMRhythmBase; label: string; icon: MusicControlIcon }[] = [
  { base: "whole", label: "全音符", icon: "noteWhole" },
  { base: "half", label: "二分音符", icon: "noteHalf" },
  { base: "quarter", label: "四分音符", icon: "noteQuarter" },
  { base: "eighth", label: "八分音符", icon: "noteEighth" },
  { base: "sixteenth", label: "十六分音符", icon: "noteSixteenth" },
  { base: "thirtySecond", label: "三十二分音符", icon: "noteThirtySecond" },
];

/** 与顶部工具栏共用音乐图标资源和尺寸；这里只更新草稿。 */
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
        <MusicAssetIcon assetId={rhythm.icon} className={toolbarStyles.toolbarIcon} />
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
      <span aria-hidden="true">·</span>
    </button>
  </div>
);
