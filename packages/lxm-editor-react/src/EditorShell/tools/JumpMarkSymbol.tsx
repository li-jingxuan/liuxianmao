import type { ILXMJumpMarkKind } from "@liuxianmao/lxm-editor";
import styles from "./MeasureControls.module.scss";

/** 小节按钮与记号类型下拉共用排列、中文短名和图标，避免两个入口的记号对不上。 */
export const JUMP_MARK_SYMBOLS: readonly { kind: ILXMJumpMarkKind; description: string; glyph?: string; hint: string }[] = [
  { kind: "segno", description: "回跳记号", glyph: "\uE047", hint: "回跳后从本小节第 1 拍继续" },
  { kind: "ds", description: "回到记号", hint: "弹完本小节，回到配对的 Segno" },
  { kind: "dsAlCoda", description: "记号至尾声", hint: "回到 Segno，重奏时经 To Coda 进入尾声" },
  { kind: "toCoda", description: "跳到尾声", hint: "重奏命中配对时跳至 Coda" },
  { kind: "coda", description: "尾声记号", glyph: "\uE048", hint: "从本小节第 1 拍进入尾声" },
  { kind: "dc", description: "回到曲首", hint: "弹完本小节，回到曲首并重奏至曲尾" },
  { kind: "fine", description: "结束记号", hint: "首遍顺行，重奏命中配对时在本小节末结束" },
  { kind: "dcAlFine", description: "曲首至结束", hint: "回到曲首，重奏到配对的 Fine 停止" },
  { kind: "dsAlFine", description: "记号至结束", hint: "回到 Segno，重奏到配对的 Fine 停止" },
  { kind: "dcAlCoda", description: "曲首至尾声", hint: "回到曲首，重奏时经 To Coda 进入尾声" },
];

export function JumpMarkSymbol({ name, glyph }: { name: string; glyph?: string }) {
  if (glyph) return <span className={`${styles.musicSymbol} ${styles.jumpGlyph}`} aria-hidden="true">{glyph}</span>;

  // 文字记号保持谱面缩写，较长的缩写分成两行以适应固定宽度的图标位置。
  const [sign, continuation] = name.includes(" al ") ? name.split(/ (?=al )/) : name === "To Coda" ? ["To", "Coda"] : [name];
  return <span className={styles.jumpText} aria-hidden="true">{sign}{continuation && <span>{continuation}</span>}</span>;
}
