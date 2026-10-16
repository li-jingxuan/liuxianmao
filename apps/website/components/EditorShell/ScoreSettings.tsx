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

export interface ScoreSettingsController {
  dirty: boolean;
  isComposing: () => boolean;
  apply: () => boolean;
  discard: () => void;
  focusField: (field: "label" | "copy") => boolean;
}

/** 唯一设置草稿 owner；Form、栏目与响应式布局只消费这份受控状态。 */
export const ScoreSettings = ({
  ref,
  document,
  measureId,
  onDirty,
  commit,
  onFocusRequest,
}: {
  ref: Ref<ScoreSettingsController>;
  document: ILXMDocument;
  measureId?: string;
  onDirty: (dirty: boolean) => void;
  commit: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  onFocusRequest?: () => boolean;
}) => {
  const store = useEditorSessionStore();
  const composing = useRef(false);
  const [compositionActive, setCompositionActive] = useState(false);
  const container = useRef<HTMLDivElement>(null);
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
    if (focusRequest)
      container.current
        ?.querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true });
  }, [focusRequest]);
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
    if (composing.current) return;
    setState(fresh());
    setIssues({});
  };
  const apply = (group?: SettingsGroup): boolean => {
    if (composing.current) return false;
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
    isComposing: () => composing.current,
    apply: () => apply(),
    discard,
    focusField: (field) => {
      const element = container.current?.querySelector<HTMLElement>(field === "label" ? "#settings-label" : "#settings-copy-start");
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
  const copyMeasures = () => {
    if (composing.current || dirty) return;
    const current = store.getState().document;
    if (!current || !sameEditorVersion(store.getState(), renderVersion)) return;
    const result = commit({
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: current.score.tracks[0]!.id,
      sourceStartMeasureId: copy.start,
      sourceEndMeasureId: copy.end,
      afterMeasureId: copy.after || undefined,
    });
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
      dirty,
      composing: compositionActive,
      canApply: dirty && !compositionActive,
      error: null,
      version: renderVersion,
      focus: () => {
        if (onFocusRequest && !onFocusRequest()) return false;
        setFocusRequest((value) => value + 1);
        return true;
      },
      apply: ({ isCurrent }) =>
        isCurrent() ? (apply() ? "applied" : "blocked") : "stale",
      discard: () => {
        if (composing.current) return false;
        discard();
        return true;
      },
    },
  ]);
  return (
    <div
      ref={container}
      onCompositionStart={() => {
        composing.current = true;
        setCompositionActive(true);
      }}
      onCompositionEnd={() => {
        composing.current = false;
        setCompositionActive(false);
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
