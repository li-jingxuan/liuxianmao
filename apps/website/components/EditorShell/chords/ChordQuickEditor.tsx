import { Button, Input } from "antd";
import { ShortcutTooltip } from "../session/EditorShortcutReference";
import {
  normalizeMusicText,
  validateChordDiagram,
} from "@liuxianmao/lxm-editor";
import type { RefCallback } from "react";
import { ChordDiagramPreview, type ChordDraft } from "./ChordEditor";
import {
  ChordPresetControls,
  type ChordEditorLibraryProps,
} from "./ChordPresetControls";
import styles from "./ChordQuickEditor.module.scss";

export interface ChordQuickEditorProps extends ChordEditorLibraryProps {
  draft: ChordDraft;
  onChange: (next: ChordDraft) => void;
  inputRef: RefCallback<HTMLInputElement>;
  presetsEnabled: boolean;
  disabled: boolean;
  /** IME 锁住命令时仍须让原输入接收组合文字。 */
  inputReadOnly?: boolean;
  /** 已有和弦清空名称后，应用表示删除名称与指法。 */
  allowEmptyName?: boolean;
  onApply?: () => void;
  canApply?: boolean;
  error?: string | null;
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
  allowEmptyName = false,
  onApply,
  canApply = false,
  error,
  onFixDiagram,
  document,
  tuning,
  onOpenLibrary,
  onOpenCustom,
}: ChordQuickEditorProps) => {
  const diagram = draft.chord.diagram;
  const issue = diagram ? validateChordDiagram(diagram) : null;
  const removing = allowEmptyName && draft.chord.name.trim() === "";
  const nameInvalid =
    !removing && normalizeMusicText(draft.chord.name, 32) === null;

  return (
    <div className={styles.editor}>
      <div className={styles.field}>
        <label htmlFor="chord-popover-name">和弦名称</label>
        <div className={styles.nameRow}><Input
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
        />{onApply && <ShortcutTooltip shortcuts={["apply", "applyModified"]} disabled={disabled || !canApply}>
          <Button type="primary" disabled={disabled || !canApply} onClick={onApply}>应用</Button>
        </ShortcutTooltip>}</div>
        {nameInvalid && (
          <p
            id="chord-popover-name-error"
            className={styles.error}
            role="alert"
          >
            和弦名称须为单行文字，最多 32 个字符，不能为空。
          </p>
        )}
        {error && !nameInvalid && error !== issue && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <section aria-label="常用指法">
        <ChordPresetControls
          draft={draft}
          onChange={onChange}
          presetsEnabled={presetsEnabled}
          disabled={disabled}
          document={document}
          tuning={tuning}
          onOpenLibrary={onOpenLibrary}
        />
        {!presetsEnabled && (
          <p className={styles.help}>
            当前为非标准调弦，常用预设暂停；已有指法保留，不会自动转置。
          </p>
        )}
      </section>
      <section className={styles.summary} aria-label="当前指法与显示">
        <ChordDiagramPreview
          diagram={diagram}
           width={44}
           height={54}
          emptyText={issue ? "预览暂停" : "暂无指法"}
        />
        <div className={styles.summaryText}>
           <strong>当前指法 · {draft.chord.name || "未命名"}</strong>
          <p className={styles.tuning}>
              {diagram ? diagram.barres?.length ? "横按指法" : "开放指法" : "暂无指法"}
           </p>
         </div>
         {onOpenCustom && <Button type="link" disabled={disabled} onClick={() => { if (!disabled) onOpenCustom(); }}>{diagram ? "编辑指法" : "创建指法"}</Button>}
      </section>
      {issue && !removing && (
        <div className={styles.error} role="alert">
          <p>指法无效，当前修改已暂停预览：{issue}</p>
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
    </div>
  );
};
