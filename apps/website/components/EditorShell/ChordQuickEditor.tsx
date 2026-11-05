import { Button, Input } from "antd";
import {
  CHORD_PRESETS,
  copyChordPreset,
  layoutChordDiagram,
  normalizeMusicText,
  validateChordDiagram,
} from "@liuxianmao/lxm-editor";
import type { RefCallback } from "react";
import type { ChordDraft } from "./ChordEditor";
import { ChordDiagramView } from "./MusicTextLayer";
import styles from "./ChordQuickEditor.module.scss";

export interface ChordQuickEditorProps {
  draft: ChordDraft;
  onChange: (next: ChordDraft) => void;
  inputRef: RefCallback<HTMLInputElement>;
  presetsEnabled: boolean;
  disabled: boolean;
  /** IME 锁住命令时仍须让原输入接收组合文字。 */
  inputReadOnly?: boolean;
  onFixDiagram: () => void;
}

/** 快捷表面只更新共享草稿；应用与焦点转移由会话表面负责。 */
export const ChordQuickEditor = ({
  draft,
  onChange,
  inputRef,
  presetsEnabled,
  disabled,
  inputReadOnly = disabled,
  onFixDiagram,
}: ChordQuickEditorProps) => {
  const diagram = draft.chord.diagram;
  const issue = diagram ? validateChordDiagram(diagram) : null;
  const preview = diagram && !issue ? layoutChordDiagram(diagram) : null;
  const nameInvalid = normalizeMusicText(draft.chord.name, 32) === null;
  const preset = CHORD_PRESETS.find(
    (item) =>
      item.name === draft.chord.name &&
      JSON.stringify(item.diagram) === JSON.stringify(diagram),
  );

  return (
    <div className={styles.editor}>
      <div className={styles.field}>
        <label htmlFor="chord-popover-name">和弦名称</label>
        <Input
          id="chord-popover-name"
          ref={(control) => inputRef(control?.input ?? null)}
          value={draft.chord.name}
          readOnly={inputReadOnly}
          aria-invalid={nameInvalid}
          aria-describedby={
            nameInvalid ? "chord-popover-name-error" : undefined
          }
          status={nameInvalid ? "error" : undefined}
          placeholder="例如 C、Am、G7"
          onChange={(event) => {
            if (!inputReadOnly)
              onChange({
                ...draft,
                chord: { ...draft.chord, name: event.target.value },
              });
          }}
        />
        {nameInvalid && (
          <p
            id="chord-popover-name-error"
            className={styles.error}
            role="alert"
          >
            和弦名称须为单行文字，最多 32 个字符，不能为空。
          </p>
        )}
      </div>
      <section aria-label="常用指法">
        <p className={styles.caption}>常用指法</p>
        <div className={styles.presets} role="group" aria-label="常用和弦预设">
          {["C", "G", "Am", "F", "Dm", "Em"].map((name) => (
            <Button
              key={name}
              disabled={disabled || !presetsEnabled}
              aria-pressed={preset?.name === name}
              onClick={() => {
                if (disabled || !presetsEnabled) return;
                const chord = copyChordPreset(name);
                if (chord) onChange({ display: "nameAndDiagram", chord });
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        {!presetsEnabled && (
          <p className={styles.help}>
            当前为非标准调弦，常用预设暂停；已有指法保留，不会自动转置。
          </p>
        )}
      </section>
      <section className={styles.summary} aria-label="当前指法与显示">
        {preview ? (
          <svg
            role="img"
            aria-label="指法图预览"
            width={68}
            height={82}
            viewBox={`${preview.bounds.x - 4} ${preview.bounds.y - 4} ${preview.bounds.width + 8} ${preview.bounds.height + 8}`}
          >
            <ChordDiagramView diagram={preview} />
          </svg>
        ) : (
          <div className={styles.empty}>{issue ? "预览暂停" : "暂无指法"}</div>
        )}
        <div className={styles.summaryText}>
          <strong>当前指法</strong>
          <p className={styles.tuning}>
            {presetsEnabled ? "标准调弦 E A D G B E" : "自定义调弦"}
          </p>
        </div>
      </section>
      {!diagram && (
        <p className={styles.help}>
          尚未设置指法，可在右侧和弦页创建；当前仅显示名称。
        </p>
      )}
      {diagram && draft.display === "name" && (
        <p className={styles.help}>指法保留，不显示在谱面。</p>
      )}
      {issue && (
        <div className={styles.error} role="alert">
          <p>指法无效，已暂停预览：{issue}</p>
          <Button
            type="link"
            disabled={disabled}
            onClick={() => {
              if (!disabled) onFixDiagram();
            }}
          >
            前往修正
          </Button>
        </div>
      )}
      <p className={styles.help}>
        修改名称不会自动修改指法；选择常用指法会替换名称和指法。
      </p>
    </div>
  );
};
