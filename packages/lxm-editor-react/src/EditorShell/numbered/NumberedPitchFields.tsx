import { EditorToolSymbolButton } from "../tools/EditorToolSymbolButton";
import styles from "./NumberedSymbolControls.module.scss";

export interface NumberedPitchFieldsProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}

const octaves = [-2, -1, 0, 1, 2, 3];
const accidentals = [
  { value: "", label: "无变音", symbol: "无" },
  { value: "n", label: "还原号", symbol: "♮" },
  { value: "#", label: "升号", symbol: "♯" },
  { value: "b", label: "降号", symbol: "♭" },
];
const octaveLabel = (octave: number) =>
  octave === 0 ? "本位" :
    `${octave > 0 ? "高" : "低"}${Math.abs(octave) === 1 ? "" : Math.abs(octave)}八度`;

/** 仅编辑 token 的一个维度，保留另外两维及原有变音编码；草稿仍由编辑器持有。 */
export const NumberedPitchFields = ({
  value,
  onChange,
  disabled,
  disabledReason,
}: NumberedPitchFieldsProps) => {
  const parts = value.match(/^([#bn♯♭♮]?)([1-7])('{1,3}|\.{1,2})?$/);
  const accidental = parts?.[1] ?? "";
  const pitch = parts?.[2];
  const suffix = parts?.[3] ?? "";
  const octave = suffix.startsWith("'") ? suffix.length : -suffix.length;
  const normalizedAccidental =
    ({ "♯": "#", "♭": "b", "♮": "n" } as Record<string, string>)[accidental] ?? accidental;
  const availability = {
    enabled: !disabled && !!parts,
    reason: disabled || !parts
      ? disabledReason || "请选择单个简谱音符；休止与延续不适用八度及变音"
      : "",
  };
  return (
    <div className={styles.pitchFields}>
      <div role="group" aria-label="简谱单音符八度">
        <div className={styles.fieldLabel}>八度</div>
        <div className={styles.octaveRow}>
          {octaves.map((next) => (
            <EditorToolSymbolButton
              key={next}
              label={octaveLabel(next)}
              availability={availability}
              pressed={!!parts && octave === next}
              onClick={() => {
                if (availability.enabled) {
                  onChange(`${accidental}${pitch}${next > 0 ? "'".repeat(next) : ".".repeat(-next)}`);
                }
              }}
            >
              <svg className={styles.octaveIcon} viewBox="0 0 28 40" aria-hidden="true" focusable="false">
                <text x="14" y="25" textAnchor="middle" fill="currentColor" fontSize="17">1</text>
                {Array.from({ length: Math.abs(next) }, (_, index) => (
                  <circle key={index} cx="14" cy={next > 0 ? 13 - index * 4 : 30 + index * 4} r="1.2" fill="currentColor" />
                ))}
              </svg>
            </EditorToolSymbolButton>
          ))}
        </div>
      </div>
      <div role="group" aria-label="简谱单音符变音">
        <div className={styles.fieldLabel}>变音</div>
        <div className={styles.accidentalRow}>
          {accidentals.map((next) => (
            <EditorToolSymbolButton
              key={next.value}
              label={next.label}
              availability={availability}
              pressed={!!parts && normalizedAccidental === next.value}
              onClick={() => {
                if (availability.enabled) onChange(`${next.value}${pitch}${suffix}`);
              }}
            >
              <span className={next.value ? styles.accidentalSymbol : undefined} aria-hidden="true">{next.symbol}</span>
            </EditorToolSymbolButton>
          ))}
        </div>
      </div>
    </div>
  );
};
