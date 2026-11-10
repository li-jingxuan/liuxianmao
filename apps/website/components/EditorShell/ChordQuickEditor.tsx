import { Button, Input } from "antd";
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
  onFixDiagram,
  document,
  tuning,
  onOpenLibrary,
  onOpenCustom,
  onOpenSettings,
  showChordDiagrams,
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
        {removing && (
          <p className={styles.help}>应用后将删除当前拍的和弦名称与指法。</p>
        )}
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
          onOpenSettings={onOpenSettings}
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
          width={82}
          height={100}
          emptyText={issue ? "预览暂停" : "暂无指法"}
        />
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
        <p className={styles.help}>指法已保留；和弦保存方式为仅名称。</p>
      )}
      {diagram && showChordDiagrams === false && (
        <p className={styles.help}>
          指法已保留；全局已隐藏指法图，编辑预览仍可见。
        </p>
      )}
      {diagram && showChordDiagrams === true && draft.display === "name" && (
        <p className={styles.help}>保存为仅名称；全局已开启指法图。</p>
      )}
      {onOpenCustom && (
        <Button
          disabled={disabled}
          onClick={() => {
            if (!disabled) onOpenCustom();
          }}
        >
          {diagram ? "编辑指法" : "自定义指法"}
        </Button>
      )}
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
      <p className={styles.help}>
        修改名称不会自动修改指法；选择常用指法会替换名称和指法。
      </p>
    </div>
  );
};
