"use client";
import {
  useEffect,
  useMemo,
  useState,
  useImperativeHandle,
  useRef,
  type Ref,
} from "react";
import {
  parseNumberedSequence,
  planNumberedSequence,
  LXMScoreCommandEnum,
  type ILXMDocument,
  type ILXMApplyScoreCommandResult,
  type ILXMScoreCommand,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
import styles from "./index.module.scss";
export interface NumberedEditorController {
  canApply: boolean;
  dirty: boolean;
  apply: () => boolean;
  discard: () => void;
}
/** 简谱表单只管理草稿；映射、校验、覆盖和音乐修改均由核心命令完成。 */
export const NumberedEditor = ({
  ref,
  document,
  target,
  commit,
  onDirty,
  onInputActive,
  onTargetChange,
  onCanApply,
  autoFocusInput,
  mode,
  onModeChange,
  onCancel,
}: {
  ref: Ref<NumberedEditorController>;
  document: ILXMDocument;
  target: ILXMTabCellReference | null;
  commit: (c: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  onDirty: (v: boolean) => void;
  onInputActive: (v: boolean) => void;
  onTargetChange: (t: MusicTextTarget | null) => void;
  onCanApply: (value: boolean) => void;
  autoFocusInput: boolean;
  mode: "single" | "sequence";
  onModeChange: (mode: "single" | "sequence") => void;
  onCancel: () => void;
}) => {
  const initialValue =
    mode === "single"
      ? (document.score.tracks
          .find((t) => t.id === target?.trackId)
          ?.measures.find((m) => m.id === target?.measureId)
          ?.beats.find((b) => b.id === target?.beatId)
          ?.numberedNotation?.tokens.join("+") ?? "")
      : "";
  const [raw, setRaw] = useState(initialValue),
    [initial, setInitial] = useState(initialValue),
    [overwrite, setOverwrite] = useState(false),
    [inspection, setInspection] = useState(0),
    [message, setMessage] = useState<string | null>(null);
  const beat = document.score.tracks
    .find((t) => t.id === target?.trackId)
    ?.measures.find((m) => m.id === target?.measureId)
    ?.beats.find((b) => b.id === target?.beatId);
  const parsed = useMemo(() => parseNumberedSequence(raw), [raw]);
  const plan = useMemo(
    () =>
      target && parsed.ok
        ? planNumberedSequence(
            document,
            target,
            parsed.items,
            mode === "single" || overwrite,
          )
        : null,
    [document, target, parsed, mode, overwrite],
  );
  const issue = !parsed.ok
    ? parsed.message
    : mode === "single" &&
        (parsed.items.length !== 1 || parsed.items[0]?.kind !== "set")
      ? "单拍仅输入一项简谱，多音用 + 连接。"
      : (plan?.issue ?? null);
  useEffect(() => onCanApply(!issue), [issue, onCanApply]);
  const dirty = raw !== initial || overwrite;
  const reset = () => {
    const value =
      mode === "single" ? (beat?.numberedNotation?.tokens.join("+") ?? "") : "";
    setRaw(value);
    setInitial(value);
    setOverwrite(false);
    setInspection(0);
    setMessage(null);
  };
  // 图元点击与 TAB 选拍分开：只有明确的输入焦点意图才把键盘送入简谱框。
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocusInput) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocusInput]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    const inspected = plan?.rows[inspection]?.target;
    onTargetChange(
      target ? { ...target, ...(inspected ?? {}), kind: "numbered" } : null,
    );
  }, [target, plan, inspection, onTargetChange]);
  const apply = () => {
    if (!target || issue || !parsed.ok) return false;
    const r = commit(
      mode === "sequence"
        ? {
            type: LXMScoreCommandEnum.SetNumberedSequence,
            ...target,
            items: parsed.items,
            allowOverwrite: overwrite,
          }
        : {
            type: LXMScoreCommandEnum.SetNumbered,
            ...target,
            tokens:
              parsed.items[0]!.kind === "set" ? parsed.items[0]!.tokens : [],
          },
    );
    if (!r?.ok) return false;
    setInitial(raw);
    setOverwrite(false);
    setMessage(r.changed ? "已应用" : "内容未变化");
    return true;
  };
  useImperativeHandle(ref, () => ({
    canApply: !issue,
    dirty,
    apply,
    discard: () => {
      reset();
      onInputActive(false);
    },
  }));
  const changeMode = (next: "single" | "sequence") => onModeChange(next);
  return (
    <section
      className={styles.sidebarSection}
      onFocusCapture={() => onInputActive(true)}
    >
      <h3>简谱编辑</h3>
      <label>
        录入方式
        <select
          aria-label="简谱录入方式"
          value={mode}
          onChange={(e) => changeMode(e.target.value as typeof mode)}
        >
          <option value="sequence">连续录入</option>
          <option value="single">单拍编辑</option>
        </select>
      </label>
      {!target ? (
        <p>请先选择谱面中的一拍</p>
      ) : (
        <>
          <label>
            {mode === "sequence" ? "连续简谱" : "单拍简谱"}
            <textarea
              ref={inputRef}
              aria-label={mode === "sequence" ? "连续简谱" : "单拍简谱"}
              rows={4}
              value={raw}
              placeholder="例如：1 2 3 _ 5' 6.. 1+3+5"
              onChange={(e) => {
                setRaw(e.target.value);
                setInspection(0);
                setMessage(null);
              }}
            />
          </label>
          <div className={styles.sidebarTip}>
            空格分拍，+ 输入同拍多音，_ 跳拍。高音用 &apos;，低音用 .；0
            表示休止，- 表示延音。不会改变 TAB 音符和时值。
          </div>
          {mode === "sequence" && (
            <label className={styles.overwriteToggle}>
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              允许替换已有简谱（{plan?.overwrites ?? 0} 项）
            </label>
          )}
          {plan && (
            <table className={styles.sequenceTable} aria-label="简谱对应预览">
              <thead>
                <tr>
                  <th>位置</th>
                  <th>原简谱 → 新简谱</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <button onClick={() => setInspection(i)}>
                        {r.measureNumber ?? "?"} 小节 / {r.beatNumber ?? "?"} 拍
                      </button>
                    </td>
                    <td>
                      {r.previous ?? "空"} →{" "}
                      {r.item.kind === "set" ? r.item.tokens.join("+") : "保留"}
                    </td>
                    <td>
                      {
                        {
                          add: "新增",
                          change: "覆盖",
                          same: "相同",
                          skip: "跳过",
                          error: "错误",
                        }[r.status]
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {issue && (
            <p role="status" className={styles.sidebarMessage}>
              {issue}
            </p>
          )}
          <div className={styles.sidebarActions}>
            <button
              disabled={mode !== "single" || !beat?.numberedNotation}
              onClick={() => {
                if (!target) return;
                const r = commit({
                  type: LXMScoreCommandEnum.RemoveNumbered,
                  ...target,
                });
                if (r?.ok) {
                  reset();
                  setMessage("已删除简谱");
                }
              }}
            >
              删除简谱
            </button>
            <button
              onClick={() => {
                reset();
                onInputActive(false);
                onCancel();
              }}
            >
              取消
            </button>
            <button
              className={styles.primaryButton}
              disabled={!!issue}
              onClick={() => apply()}
            >
              {mode === "sequence" ? "应用全部" : "应用"}
            </button>
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
};
