import type { ILXMRhythmBase } from "@liuxianmao/lxm-editor";
import type { MusicControlIcon } from "../../../assets/svg/svg-assets-manifest";
import { MusicAssetIcon } from "../../MusicAssetIcon";
import { EditorToolSymbolButton } from "../tools/EditorToolSymbolButton";
import styles from "./NumberedSymbolControls.module.scss";

const rhythms: { base: ILXMRhythmBase; label: string; icon: MusicControlIcon }[] = [
  { base: "whole", label: "全音符", icon: "noteWhole" },
  { base: "half", label: "二分音符", icon: "noteHalf" },
  { base: "quarter", label: "四分音符", icon: "noteQuarter" },
  { base: "eighth", label: "八分音符", icon: "noteEighth" },
  { base: "sixteenth", label: "十六分音符", icon: "noteSixteenth" },
  { base: "thirtySecond", label: "三十二分音符", icon: "noteThirtySecond" },
];

export interface NumberedRhythmToolbarProps {
  base: ILXMRhythmBase;
  dots: number;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (base: ILXMRhythmBase, dots: number) => void;
  onSustain?: () => void;
  sustain?: boolean;
}

/** 仅呈现所选时值；所有编辑动作由调用方提供。 */
export const NumberedRhythmToolbar = ({
  base,
  dots,
  disabled,
  disabledReason,
  onChange,
  onSustain,
  sustain = false,
}: NumberedRhythmToolbarProps) => {
  const availability = {
    enabled: !disabled,
    reason: disabled ? disabledReason || "当前位置无法修改时值" : "",
  };
  return (
    <div
      className={styles.rhythmToolbar}
      role="group"
      aria-label="常用时值"
      onMouseDown={(event) => event.preventDefault()}
    >
      {rhythms.map((rhythm) => (
        <EditorToolSymbolButton
          key={rhythm.base}
          label={rhythm.label}
          pressed={base === rhythm.base}
          availability={availability}
          onClick={() => {
            if (!disabled) onChange(rhythm.base, dots);
          }}
        >
          <MusicAssetIcon assetId={rhythm.icon} className={styles.durationIcon} />
        </EditorToolSymbolButton>
      ))}
      <EditorToolSymbolButton
        label="单附点"
        pressed={dots === 1}
        availability={availability}
        onClick={() => {
          if (!disabled) onChange(base, dots === 1 ? 0 : 1);
        }}
      >
        <span className={styles.musicGlyph} aria-hidden="true">{"\uE1E7"}</span>
      </EditorToolSymbolButton>
      <EditorToolSymbolButton
        label="延音"
        pressed={sustain}
        availability={onSustain ? availability : {
          enabled: false,
          reason: disabledReason || "当前位置无法设置延音",
        }}
        onClick={() => {
          if (!disabled) onSustain?.();
        }}
      >
        <span className={styles.musicGlyph} aria-hidden="true">{"\uE874"}</span>
      </EditorToolSymbolButton>
    </div>
  );
};
