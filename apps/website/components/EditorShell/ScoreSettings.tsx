import {
  useState,
  useRef,
  useImperativeHandle,
  useEffect,
  type Ref,
} from "react";
import {
  LXMScoreCommandEnum,
  type ILXMDocument,
  type ILXMApplyScoreCommandResult,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import { useEditorSessionStore } from "../../stores/editor-store";
import type { EditorCommandAdapter } from "./editor-command-adapter";
import {
  readScoreSettings,
  submitSettingsDraft,
  rebaseSettingsDraft,
  type ScoreSettingsDraft,
  type SettingsGroup,
} from "./score-settings-draft";
import { ScoreSettingsForm, type SettingsCopyRange } from "./ScoreSettingsForm";
import { useEditorDraftRecords } from "./EditorSessionRuntime";
import {
  captureEditorVersion,
  sameEditorSession,
  sameEditorVersion,
} from "./editor-session-version";
import { createScoreSettingsComposition } from "./score-settings-composition";

export interface ScoreSettingsController {
  /** 保留属性供旧调用方使用；共同切换仲裁优先调用 isDirty。 */
  dirty: boolean;
  isDirty: () => boolean;
  isComposing: () => boolean;
  apply: () => boolean;
  /** IME 保护期间返回 false，调用方不得继续切换或卸载表单。 */
  discard: () => boolean;
  /** 经 owner 的受保护打开路径展示歌曲设置，DOM 提交后恢复输入焦点。 */
  focus: () => boolean;
  focusField: (field: "label" | "copy") => boolean;
}

/** 唯一设置草稿 owner；Form、栏目与响应式布局只消费这份受控状态。 */
export const ScoreSettings = ({
  ref,
  document,
  measureId,
  onDirty,
  commit,
  executeTool,
  onFocusRequest,
}: {
  ref: Ref<ScoreSettingsController>;
  document: ILXMDocument;
  measureId?: string;
  onDirty: (dirty: boolean) => void;
  commit: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  /** 结构复制需要先经过异步预检/影响确认，沿用统一 command adapter。 */
  executeTool?: EditorCommandAdapter;
  onFocusRequest?: () => boolean;
}) => {
  const store = useEditorSessionStore();
  const [compositionActive, setCompositionActive] = useState(false);
  const [composition] = useState(() =>
    createScoreSettingsComposition(setCompositionActive),
  );
  useEffect(() => () => composition.dispose(), [composition]);
  const container = useRef<HTMLDivElement>(null);
  const lastFocusedControl = useRef<HTMLElement | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const fresh = () => {
    const value = readScoreSettings(document, measureId);
    return { document, measureId, value, initial: value };
  };
  const [state, setState] = useState(fresh);
  const [issues, setIssues] = useState<
    Partial<Record<SettingsGroup | "copy" | "all", string>>
  >({});
  if (state.document !== document) {
    setState(fresh());
    setIssues({});
  }
  // 已编辑的局部标记保持原目标；只有干净标记才随 focus 小节切换。
  else if (
    state.measureId !== measureId &&
    state.value.label === state.initial.label
  ) {
    const next = readScoreSettings(document, measureId);
    setState({
      ...state,
      measureId,
      value: { ...state.value, label: next.label },
      initial: { ...state.initial, label: next.label },
    });
  }
  const dirty = JSON.stringify(state.value) !== JSON.stringify(state.initial);
  const renderVersion = captureEditorVersion({ ...store.getState(), document });
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (!focusRequest) return;
    const previous = lastFocusedControl.current;
    const control =
      previous &&
      container.current?.contains(previous) &&
      previous.getClientRects().length
        ? previous
        : container.current?.querySelector<HTMLInputElement>("input");
    control?.focus({ preventScroll: true });
  }, [focusRequest]);
  const focus = () => {
    if (onFocusRequest && !onFocusRequest()) return false;
    setFocusRequest((value) => value + 1);
    return true;
  };
  const update = <K extends keyof ScoreSettingsDraft>(
    key: K,
    value: ScoreSettingsDraft[K],
  ) => {
    setState((previous) => ({
      ...previous,
      value: { ...previous.value, [key]: value },
    }));
    setIssues({});
  };
  const discard = () => {
    if (composition.isComposing()) return false;
    setState(fresh());
    setIssues({});
    return true;
  };
  const apply = (group?: SettingsGroup): boolean => {
    if (composition.isComposing()) return false;
    if (!sameEditorVersion(store.getState(), renderVersion)) return false;
    const result = submitSettingsDraft({
      getState: store.getState,
      commit,
      value: state.value,
      initial: state.initial,
      measureId: state.measureId,
      group,
    });
    // 旧 owner 的结果不能向新会话写错误或恢复草稿。
    if (!sameEditorSession(store.getState(), renderVersion)) return false;
    const nextDocument = store.getState().document;
    if (
      nextDocument &&
      (result.submittedGroups.length || result.status === "stale")
    ) {
      const next = readScoreSettings(nextDocument, state.measureId);
      setState({
        document: nextDocument,
        measureId: state.measureId,
        value: rebaseSettingsDraft(
          state.value,
          state.initial,
          next,
          result.submittedGroups,
        ),
        initial: next,
      });
    }
    if (result.issue) {
      setIssues((previous) => ({
        ...previous,
        [result.issue!.group ?? "all"]: result.issue!.message,
      }));
      store.getState().setErrorMessage(result.issue.message);
      return false;
    }
    setIssues((previous) => {
      const remaining = { ...previous };
      delete remaining.all;
      for (const applied of result.submittedGroups) delete remaining[applied];
      return remaining;
    });
    store.getState().setErrorMessage(null);
    return true;
  };
  useImperativeHandle(ref, () => ({
    dirty,
    isDirty: () => dirty,
    isComposing: composition.isComposing,
    apply: () => apply(),
    discard,
    focus,
    focusField: (field) => {
      const element = container.current?.querySelector<HTMLElement>(
        field === "label" ? "#settings-label" : "#settings-copy-start",
      );
      if (!element || !element.getClientRects().length) return false;
      element.scrollIntoView({ block: "nearest" });
      element.focus({ preventScroll: true });
      return true;
    },
  }));
  const first = document.score.tracks[0]!.measures[0]!;
  const [copy, setCopy] = useState<SettingsCopyRange>({
    start: first.id,
    end: first.id,
    after: "",
  });
  const copyMeasures = async () => {
    if (composition.isComposing() || dirty) return;
    const current = store.getState().document;
    if (!current || !sameEditorVersion(store.getState(), renderVersion)) return;
    const command: ILXMScoreCommand = {
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: current.score.tracks[0]!.id,
      sourceStartMeasureId: copy.start,
      sourceEndMeasureId: copy.end,
      afterMeasureId: copy.after || undefined,
    };
    if (executeTool) {
      const outcome = await executeTool(command);
      if (!sameEditorSession(store.getState(), renderVersion)) return;
      if (outcome.status === "applied" || outcome.status === "noop")
        setIssues({});
      else
        setIssues((previous) => ({
          ...previous,
          copy:
            outcome.status === "needs-impact"
              ? outcome.result.message
              : outcome.message,
        }));
      return;
    }
    const result = commit(command);
    if (!sameEditorSession(store.getState(), renderVersion)) return;
    if (!result?.ok)
      setIssues((previous) => ({
        ...previous,
        copy: result && !result.ok ? result.message : "当前无法复制小节。",
      }));
    else setIssues({});
  };
  useEditorDraftRecords([
    {
      id: `settings:${store.getState().sessionId}`,
      kind: "settings",
      targetKey: String(store.getState().sessionId),
      label: "歌曲设置",
      location: "歌曲设置",
      dirty,
      composing: compositionActive,
      canApply: dirty && !compositionActive,
      error: null,
      version: renderVersion,
      focus,
      apply: ({ isCurrent }) =>
        isCurrent() ? (apply() ? "applied" : "blocked") : "stale",
      discard,
    },
  ]);
  return (
    <div
      ref={container}
      onCompositionStart={composition.start}
      onCompositionEnd={composition.end}
      onKeyDownCapture={(event) => composition.observeKey(event.nativeEvent)}
      onKeyDown={(event) => {
        if (composition.isComposing()) event.stopPropagation();
      }}
      onFocusCapture={(event) => {
        lastFocusedControl.current = event.target;
      }}
    >
      <ScoreSettingsForm
        document={document}
        value={state.value}
        measureId={state.measureId}
        selectedMeasureId={measureId}
        dirty={dirty}
        composing={compositionActive}
        issues={issues}
        copy={copy}
        onChange={update}
        onApply={apply}
        onDiscard={discard}
        onCopyChange={setCopy}
        onCopy={copyMeasures}
      />
    </div>
  );
};
