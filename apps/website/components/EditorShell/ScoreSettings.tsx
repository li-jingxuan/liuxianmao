import {
  useState,
  useRef,
  useImperativeHandle,
  useEffect,
  type Ref,
  type FormEvent,
} from "react";
import {
  applyScoreCommand,
  LXM_KEY_SIGNATURES,
  LXM_EDITABLE_TIME_SIGNATURES,
  LXMScoreCommandEnum,
  type ILXMDocument,
  type ILXMApplyScoreCommandResult,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import { useEditorSessionStore } from "../../stores/editor-store";
import {
  readScoreSettings,
  planSettingsCommands,
  settingsKeys,
  type SettingsGroup,
} from "./score-settings-draft";
import styles from "./index.module.scss";

export interface ScoreSettingsController {
  dirty: boolean;
  isComposing: () => boolean;
  apply: () => boolean;
  discard: () => void;
}
/** 常驻设置实例，自己的提交保留其他字段草稿，外部历史变化重新读取快照。 */
export const ScoreSettings = ({
  ref,
  document,
  measureId,
  onDirty,
  commit,
}: {
  ref: Ref<ScoreSettingsController>;
  document: ILXMDocument;
  measureId?: string;
  onDirty: (dirty: boolean) => void;
  commit: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
}) => {
  const store = useEditorSessionStore();
  const composing = useRef(false);
  const fresh = () => {
    const value = readScoreSettings(document, measureId);
    return { document, measureId, value, initial: value };
  };
  const [state, setState] = useState(fresh);
  if (state.document !== document) setState(fresh());
  else if (state.measureId !== measureId) {
    const next = readScoreSettings(document, measureId);
    setState({
      ...state,
      measureId,
      value: { ...state.value, label: next.label },
      initial: { ...state.initial, label: next.label },
    });
  }
  const dirty = JSON.stringify(state.value) !== JSON.stringify(state.initial);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const update = (key: keyof typeof state.value, value: string | null) =>
    setState((s) => ({ ...s, value: { ...s.value, [key]: value } }));
  const apply = (group?: SettingsGroup) => {
    const commands = planSettingsCommands(
      document,
      state.value,
      state.initial,
      measureId,
      group,
    );
    // 先验证所有待提交表单；失败时不把前面的成功表单提前写入历史。
    let planned = document;
    for (const command of commands) {
      const result = applyScoreCommand(planned, command);
      if (!result.ok) {
        store.getState().setErrorMessage(result.message);
        return false;
      }
      planned = result.document;
    }
    for (const command of commands) {
      const result = commit(command);
      if (!result?.ok) return false;
    }
    if (!commands.length) store.getState().setErrorMessage(null);
    const nextDocument = store.getState().document!;
    const next = readScoreSettings(nextDocument, measureId);
    const value = { ...state.value };
    if (group)
      for (const key of settingsKeys[group])
        Object.assign(value, { [key]: next[key] });
    else Object.assign(value, next);
    setState({ document: nextDocument, measureId, value, initial: next });
    return true;
  };
  useImperativeHandle(ref, () => ({
    isComposing: () => composing.current,
    dirty,
    apply: () => apply(),
    discard: () => setState(fresh()),
  }));
  const submit = (event: FormEvent, group: SettingsGroup) => {
    event.preventDefault();
    apply(group);
  };
  const track = document.score.tracks[0]!;
  const first = track.measures[0]!;
  const nextChange = track.measures.findIndex(
    (m, i) =>
      i > 0 &&
      (m.timeSignature.numerator !== first.timeSignature.numerator ||
        m.timeSignature.denominator !== first.timeSignature.denominator),
  );
  const [start, setStart] = useState(first.id),
    [end, setEnd] = useState(first.id),
    [after, setAfter] = useState("");
  return (
    <div
      className={`${styles.sidebarSection} ${styles.trackSettings}`}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    >
      <form onSubmit={(e) => submit(e, "info")}>
        <h3>歌曲信息</h3>
        <label>
          歌曲名称
          <input
            aria-label="歌曲名称"
            value={state.value.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
        <label>
          编谱作者
          <input
            aria-label="编谱作者"
            value={state.value.arranger}
            onChange={(e) => update("arranger", e.target.value)}
          />
        </label>
        <label>
          调性
          <select
            aria-label="调性"
            value={state.value.keySignature ?? ""}
            onChange={(e) => update("keySignature", e.target.value || null)}
          >
            <option value="">未设置</option>
            {LXM_KEY_SIGNATURES.map((k) => (
              <option key={k} value={k}>
                1={k}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">应用歌曲信息</button>
      </form>
      <form onSubmit={(e) => submit(e, "signature")}>
        <label>
          基础拍号
          <select
            aria-label="基础拍号"
            value={state.value.signature}
            onChange={(e) => update("signature", e.target.value)}
          >
            {!LXM_EDITABLE_TIME_SIGNATURES.some(
              (t) =>
                `${t.numerator}/${t.denominator}` === state.value.signature,
            ) && (
              <option value={state.value.signature}>
                {state.value.signature}（当前）
              </option>
            )}
            {LXM_EDITABLE_TIME_SIGNATURES.map((t) => (
              <option key={`${t.numerator}/${t.denominator}`}>
                {t.numerator}/{t.denominator}
              </option>
            ))}
          </select>
        </label>
        <small>
          作用于第 1–{nextChange < 0 ? track.measures.length : nextChange} 小节
        </small>
        <button type="submit">应用基础拍号</button>
      </form>
      <form onSubmit={(e) => submit(e, "capo")}>
        <label>
          Capo
          <input
            aria-label="Capo"
            type="number"
            min="0"
            max="12"
            step="1"
            value={state.value.capo}
            onChange={(e) => update("capo", e.target.value)}
          />
        </label>
        <button type="submit">应用 Capo</button>
      </form>
      <form onSubmit={(e) => submit(e, "label")}>
        <label>
          段落标记
          <input
            aria-label="段落标记"
            disabled={!measureId}
            value={state.value.label}
            onChange={(e) => update("label", e.target.value)}
          />
        </label>
        {!measureId && <small>请先选择目标小节</small>}
        <button disabled={!measureId} type="submit">
          应用段落标记
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) {
            store
              .getState()
              .setErrorMessage("请先应用或放弃设置草稿，再复制小节。");
            return;
          }
          commit({
            type: LXMScoreCommandEnum.CopyMeasureRange,
            trackId: track.id,
            sourceStartMeasureId: start,
            sourceEndMeasureId: end,
            afterMeasureId: after || undefined,
          });
        }}
      >
        <h3>小节复用</h3>
        {(
          [
            ["复制起始小节", start, setStart],
            ["复制结束小节", end, setEnd],
            ["插入位置", after, setAfter],
          ] as const
        ).map(([name, value, set]) => (
          <label key={name}>
            {name}
            <select
              aria-label={name}
              value={value}
              onChange={(e) => set(e.target.value)}
            >
              {name === "插入位置" && <option value="">谱首</option>}
              {track.measures.map((m, i) => (
                <option key={m.id} value={m.id}>
                  第 {i + 1} 小节{name === "插入位置" ? "后" : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="submit">复制小节范围</button>
      </form>
      {dirty && (
        <button type="button" onClick={() => setState(fresh())}>
          放弃设置草稿
        </button>
      )}
    </div>
  );
};
