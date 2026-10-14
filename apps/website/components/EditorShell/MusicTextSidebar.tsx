import {
  numberedDraftKey,
  resolveNumberedEditorTarget,
} from "./numbered-editor-target";
import {
  NumberedEditor,
  type NumberedEditorController,
  type NumberedEditorDraft,
} from "./NumberedEditor";
import { ScoreSettings, type ScoreSettingsController } from "./ScoreSettings";
import {
  useEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { FileText, Guitar, Settings, Trash2 } from "lucide-react";
import {
  createCollapsedTabCellSelection,
  LXMScoreCommandEnum,
  normalizeMusicText,
  parseLyricSequence,
  planLyricSequence,
  validateChordDiagram,
  type ILXMTabCellSelection,
  type ILXMLyricVerse,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import { ChordEditor } from "./ChordEditor";
import { shouldIgnoreMusicTextKey } from "./music-text-interaction";
import {
  readMusicTextDraft,
  musicTextDraftValue,
  resolveSidebarRequest,
  type MusicTextTarget,
  type MusicTextDraft,
  type SidebarAction,
  type SidebarTab,
} from "./music-text-draft";
import {
  isScoreSelectionValid,
  type SelectionRequestResult,
} from "./editor-object-selection";
import styles from "./index.module.scss";

export interface MusicTextController {
  /** 输出前只读检查草稿，不自动提交或取消用户输入。 */
  isOutputBlocked: () => boolean;
  open: (target: MusicTextTarget) => void;
  select: (
    selection: ILXMTabCellSelection | null,
    techniqueId?: string,
  ) => SelectionRequestResult;
  returnToScore: () => SelectionRequestResult;
}

/** 常驻三页签与编辑目标分开，切页签、换拍和结束编辑共用草稿保护。 */
export const MusicTextSidebar = ({
  ref,
  onOpen,
  onEditingChange,
  onTargetChange,
  onScoreFocus,
  onScoreSelection,
  getSystemMeasureIds,
}: {
  ref: Ref<MusicTextController>;
  onOpen: () => void;
  onEditingChange: (editing: boolean) => void;
  onTargetChange: (target: MusicTextTarget | null) => void;
  onScoreFocus: () => void;
  onScoreSelection: (
    selection: ILXMTabCellSelection | null,
    techniqueId: string | null,
  ) => void;
  getSystemMeasureIds: (measureId: string) => string[];
}) => {
  const editorStore = useEditorSessionStore();
  const score = useEditorStore((s) => s.document);
  const selection = useEditorStore((s) => s.selection);
  const selectedNumberedMarkId = useEditorStore(
    (s) => s.selectedNumberedMarkId,
  );
  const [kind, setKind] = useState<SidebarTab>("score");
  // 活动对象独立于可见页签；null 表示普通六线谱选择，不表示关闭侧栏。
  const [activeObject, setActiveObject] = useState<MusicTextTarget | null>(
    null,
  );
  const [numberedTarget, setNumberedTarget] = useState<MusicTextTarget | null>(
    null,
  );
  const [numberedPreview, setNumberedPreview] =
    useState<MusicTextTarget | null>(null);
  const stateVersion = useEditorStore((s) => s.stateVersion);
  const [numberedMode, setNumberedMode] = useState<"single" | "sequence">(
    "sequence",
  );
  const numberedRef = useRef<NumberedEditorController>(null);
  const numberedDrafts = useRef(new Map<string, NumberedEditorDraft>());
  const [visibleNumberedDrafts, setVisibleNumberedDrafts] = useState<
    ReadonlyMap<string, NumberedEditorDraft>
  >(() => new Map());
  const savedNumberedCount = visibleNumberedDrafts.size;
  const [switchNotice, setSwitchNotice] = useState<MusicTextTarget | null>(
    null,
  );
  const [suppressSwitchNotice, setSuppressSwitchNotice] = useState(false);
  const [numberedCanApply, setNumberedCanApply] = useState(false);
  const [numberedDirty, setNumberedDirty] = useState(false);
  const [numberedInputActive, setNumberedInputActive] = useState(false);
  const paragraphKind = useRef<"lyric" | "numbered">("lyric");
  const paragraphVerse = useRef<ILXMLyricVerse>(1);
  const settingsRef = useRef<ScoreSettingsController>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [draft, setDraft] = useState<MusicTextDraft | null>(null);
  const [pending, setPending] = useState<SidebarAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sequenceInputRef = useRef<HTMLTextAreaElement>(null);
  const [inspection, setInspection] = useState(0);
  const [inputEditing, setInputEditing] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusDestination = useRef<"score" | "input">("input");
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const lastInputFocus = useRef<HTMLElement | null>(null);
  const restoreInputFocus = useRef(false);
  const requestedTabFocus = useRef<string | null>(null);
  const composing = useRef(false);
  const compositionEndedAt = useRef(-Infinity);
  const baseline = useRef(score);
  const committing = useRef(false);
  const activeNumberedDraftKey = score
    ? (() => {
        const resolved = resolveNumberedEditorTarget(
          score,
          numberedTarget ?? selection?.focus ?? null,
        );
        return resolved ? numberedDraftKey(resolved) : null;
      })()
    : null;
  // 文字对象即使暂时浏览其他页签，快捷键也不能在文字高亮下误写 TAB 音符。
  const editing =
    !!activeObject ||
    settingsDirty ||
    numberedDirty ||
    numberedInputActive ||
    !!pending ||
    (!!draft && (inputEditing || musicTextDraftValue(draft) !== draft.initial));
  const target = draft?.target ?? selection?.focus;
  const track = target
    ? score?.score.tracks.find((t) => t.id === target.trackId)
    : score?.score.tracks[0];
  const measure = track?.measures.find((m) => m.id === target?.measureId);
  const validTarget =
    target && measure?.beats.some((b) => b.id === target.beatId)
      ? target
      : null;
  const existing =
    draft?.target.kind === "lyric"
      ? measure?.lyrics.find(
          (l) =>
            l.beatId === draft.target.beatId && l.verse === draft.target.verse,
        )
      : measure?.chordSymbols.find((c) => c.beatId === draft?.target.beatId);
  const sequence =
    draft?.target.kind === "lyric" && draft.lyricMode === "sequence";
  const parsed = useMemo(
    () =>
      sequence && draft?.text !== undefined
        ? parseLyricSequence(draft.text)
        : null,
    [sequence, draft],
  );
  const plan = useMemo(
    () =>
      parsed?.ok && score && draft?.target
        ? planLyricSequence(
            score,
            { ...draft.target, verse: draft.target.verse! },
            parsed.items,
            draft.allowOverwrite,
          )
        : null,
    [parsed, score, draft],
  );
  const issue = draft
    ? draft.target.kind === "lyric"
      ? sequence
        ? parsed && !parsed.ok
          ? parsed.message
          : (plan?.issue ?? null)
        : normalizeMusicText(draft.text, 64) === null
          ? "歌词须为单行非空文本，最多 64 个字符。"
          : null
      : normalizeMusicText(draft.chord.chord.name, 32) === null
        ? "和弦名须为单行非空文本，最多 32 个字符。"
        : draft.chord.chord.diagram
          ? validateChordDiagram(draft.chord.chord.diagram)
          : null
    : null;
  const inspected = plan?.rows[inspection]?.target;
  const lyricPreview = useMemo(
    () =>
      draft?.target
        ? sequence && inspected
          ? { ...draft.target, ...inspected }
          : draft.target
        : null,
    [draft, sequence, inspected],
  );
  // 预览只装饰已激活的对象，面板可见和被动重渲染不能把 beat 焦点拉回文字。
  const active =
    activeObject?.kind === kind
      ? kind === "numbered"
        ? (numberedPreview ?? activeObject)
        : (lyricPreview ?? activeObject)
      : activeObject;
  useEffect(() => onTargetChange(active), [onTargetChange, active]);
  const reportNumberedPreview = useCallback((next: MusicTextTarget | null) => {
    setNumberedPreview((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  }, []);

  /** 编辑目标与焦点意图分开：选拍同步表单，点击文本才进入文字输入。 */
  const focusTarget = (focus: "score" | "input") => {
    focusDestination.current = focus;
    setInputEditing(focus === "input");
    if (focus === "input") setFocusRequest((value) => value + 1);
    else onScoreFocus();
  };

  const loadTarget = (
    next: MusicTextTarget,
    mode = draft?.lyricMode ?? "sequence",
    focus: "score" | "input" = "input",
  ) => {
    const value = readMusicTextDraft(
      editorStore.getState().document,
      next,
      mode,
      editorStore.getState().selection,
    );
    setInspection(0);
    setPending(null);
    setMessage(value ? null : "目标拍已失效，请重新选择。");
    setDraft(value);
    setNumberedTarget(null);
    setActiveObject(value ? value.target : null);
    setKind(next.kind);
    if (next.kind === "lyric") {
      paragraphKind.current = "lyric";
      paragraphVerse.current = next.verse ?? 1;
    }
    baseline.current = editorStore.getState().document;
    if (value) {
      focusTarget(focus);
      onOpen();
      editorStore.getState().setSelectedTechniqueId(null);
      editorStore
        .getState()
        .setSelection(createCollapsedTabCellSelection(value.target));
    }
  };
  /** 接受请求才改变选区和草稿；延迟确认的目标按最新快照验证。 */
  const perform = (
    action: SidebarAction,
    preserveNumberedDraft = false,
  ): boolean => {
    const current = editorStore.getState();
    if (
      action.type === "selection" &&
      !isScoreSelectionValid(current.document, action.selection)
    ) {
      setPending(null);
      setMessage("目标拍已失效，请重新选择。");
      return false;
    }
    if (
      action.type === "target" &&
      !(action.target.kind === "numbered"
        ? current.document &&
          resolveNumberedEditorTarget(current.document, action.target)
        : readMusicTextDraft(current.document, action.target))
    ) {
      setPending(null);
      setMessage("目标拍已失效，请重新选择。");
      return false;
    }
    if (action.type === "tab" && action.focus)
      requestedTabFocus.current = `${action.focus === "paragraph" ? "paragraph" : "music"}-tab-${action.kind === "numbered" && action.focus !== "paragraph" ? "lyric" : action.kind}`;
    setPending(null);
    restoreInputFocus.current = false;
    // 非模式请求会结束原简谱草稿，但必须在确认已经被接受之后执行。
    if (action.type !== "mode") {
      if (!preserveNumberedDraft) {
        numberedRef.current?.discard();
        if (activeNumberedDraftKey) {
          numberedDrafts.current.delete(activeNumberedDraftKey);
          setVisibleNumberedDrafts(new Map(numberedDrafts.current));
        }
      }
      setNumberedDirty(false);
      setNumberedInputActive(false);
      setNumberedPreview(null);
    }
    if (action.type === "selection" || action.type === "close") {
      const nextSelection =
        action.type === "selection"
          ? action.selection
          : activeObject && activeObject.kind !== "numbered"
            ? createCollapsedTabCellSelection(activeObject)
            : current.selection;
      const chordBeat =
        action.type === "selection" &&
        kind === "chord" &&
        !action.techniqueId &&
        nextSelection &&
        nextSelection.anchor.trackId === nextSelection.focus.trackId &&
        nextSelection.anchor.measureId === nextSelection.focus.measureId &&
        nextSelection.anchor.beatId === nextSelection.focus.beatId;
      settingsRef.current?.discard();
      if (chordBeat) {
        // 和弦页签保持打开时，选中一个 Beat 就直接加载该拍表单。
        onScoreSelection(nextSelection, null);
        loadTarget({ ...nextSelection.focus, kind: "chord" });
      } else {
        setDraft(null);
        setNumberedTarget(null);
        setActiveObject(null);
        setInputEditing(false);
        focusDestination.current = "score";
        setMessage(null);
        onScoreSelection(
          nextSelection,
          action.type === "selection" ? (action.techniqueId ?? null) : null,
        );
      }
    } else if (action.type === "target") {
      settingsRef.current?.discard();
      if (action.target.kind === "numbered") {
        setDraft(null);
        setMessage(null);
        setKind("numbered");
        paragraphKind.current = "numbered";
        setNumberedTarget(action.target);
        setActiveObject(action.target);
        focusDestination.current = "input";
        setNumberedInputActive(true);
        setFocusRequest((value) => value + 1);
        onOpen();
        current.setSelectedTechniqueId(null);
        const resolved =
          current.document &&
          resolveNumberedEditorTarget(current.document, action.target);
        current.setNumberedSelection(resolved);
        current.setSelectedNumberedMarkId(action.numberedMarkId ?? null);
        if (resolved)
          setNumberedTarget({
            ...resolved,
            kind: "numbered",
            ...("beatId" in action.target && action.target.beatId
              ? { beatId: action.target.beatId }
              : {}),
          });
      } else loadTarget(action.target, draft?.lyricMode, action.focus);
    } else if (action.type === "numberedMode") {
      setNumberedMode(action.mode);
    } else if (action.type === "mode") {
      if (draft) loadTarget(draft.target, action.mode);
    } else if (action.kind === "chord" && current.selection?.focus) {
      // 已选拍点切到和弦页签时直接读取该拍和弦并进入编辑态。
      loadTarget({ ...current.selection.focus, kind: "chord" });
    } else {
      // 页签只展示工具，保留谱面对象；显式输入／编辑按钮才加载文字草稿。
      setDraft(null);
      setNumberedTarget(null);
      setInputEditing(false);
      setMessage(null);
      focusDestination.current = "score";
      setKind(action.kind);
      if (action.kind === "numbered") paragraphKind.current = "numbered";
      if (action.kind === "lyric") paragraphKind.current = "lyric";
    }
    return true;
  };
  /** 新增只打开真实拍点上的编辑区域，首次应用才写入音乐数据。 */
  const addParagraph = (nextKind: "lyric" | "numbered") => {
    const currentTrack = score?.score.tracks[0];
    const firstMeasure = currentTrack?.measures.find((m) => m.beats.length);
    const next =
      validTarget ??
      (currentTrack && firstMeasure
        ? {
            trackId: currentTrack.id,
            measureId: firstMeasure.id,
            beatId: firstMeasure.beats[0]!.id,
            string: 1 as const,
          }
        : null);
    if (!next || !currentTrack) {
      setMessage("请先添加拍点，再添加歌词或简谱。");
      return;
    }
    const ids = getSystemMeasureIds(next.measureId);
    const used = new Set(
      currentTrack.measures
        .filter((m) => ids.includes(m.id))
        .flatMap((m) => m.lyrics.map((l) => l.verse)),
    );
    const verse = ([1, 2, 3, 4] as const).find((v) => !used.has(v));
    if (nextKind === "lyric" && !verse) {
      setMessage("当前谱行已有 4 段歌词，请选择段号编辑已有行。");
      return;
    }
    request({
      type: "target",
      target:
        nextKind === "numbered"
          ? { ...next, kind: "numbered" }
          : { ...next, kind: "lyric", verse: verse ?? 1 },
    });
  };
  /** 所有对象／页签请求通过同一草稿闸门，不提前迁移 selection。 */
  const request = (action: SidebarAction): SelectionRequestResult => {
    if (composing.current || settingsRef.current?.isComposing() || pending)
      return "blocked";
    if (
      action.type === "selection" &&
      kind === "chord" &&
      draft?.target.kind === "chord" &&
      action.selection &&
      !action.techniqueId &&
      isScoreSelectionValid(score, action.selection) &&
      action.selection.anchor.trackId === action.selection.focus.trackId &&
      action.selection.anchor.measureId === action.selection.focus.measureId &&
      action.selection.anchor.beatId === action.selection.focus.beatId &&
      draft.target.trackId === action.selection.focus.trackId &&
      draft.target.measureId === action.selection.focus.measureId &&
      draft.target.beatId === action.selection.focus.beatId
    ) {
      onScoreSelection(action.selection, null);
      focusTarget("input");
      return "accepted";
    }
    if (
      action.type === "target" &&
      action.target.kind === "numbered" &&
      numberedTarget?.kind === "numbered" &&
      score &&
      activeNumberedDraftKey
    ) {
      const next = resolveNumberedEditorTarget(score, action.target);
      // 谱面点击可能省略 itemId；归一后相同目标只恢复焦点，不重复暂存。
      if (next && numberedDraftKey(next) === activeNumberedDraftKey) {
        focusDestination.current = "input";
        setNumberedInputActive(true);
        setFocusRequest((value) => value + 1);
        return "accepted";
      }
    }
    if (action.type === "tab" && action.kind === kind) return "accepted";
    if (action.type === "numberedMode" && action.mode === numberedMode)
      return "accepted";
    const decision = resolveSidebarRequest(draft, action, {
      numberedTarget,
      numberedDirty: numberedRef.current?.dirty,
      settingsDirty: settingsRef.current?.dirty,
    });
    if (decision === "ignore" && action.type === "target") {
      setActiveObject(action.target);
      if (action.target.kind === "numbered") {
        focusDestination.current = "input";
        setNumberedInputActive(true);
        setFocusRequest((value) => value + 1);
      } else focusTarget(action.focus ?? "input");
      return "accepted";
    }
    if (decision === "confirm") {
      setPending(action);
      return "pending";
    }
    if (
      decision === "execute" &&
      action.type === "target" &&
      action.target.kind === "numbered" &&
      numberedTarget?.kind === "numbered" &&
      activeNumberedDraftKey
    ) {
      const wasDirty = !!numberedRef.current?.dirty;
      const snapshot = wasDirty ? numberedRef.current?.snapshot() : null;
      if (!perform(action, wasDirty)) return "blocked";
      if (snapshot) {
        numberedDrafts.current.set(activeNumberedDraftKey, snapshot);
        setVisibleNumberedDrafts(new Map(numberedDrafts.current));
        if (!suppressSwitchNotice) setSwitchNotice(numberedTarget);
      } else setSwitchNotice(null);
      return "accepted";
    }
    return decision === "ignore" || perform(action) ? "accepted" : "blocked";
  };
  const returnToScore = (): SelectionRequestResult =>
    request({
      type: "selection",
      selection:
        activeObject && activeObject.kind !== "numbered"
          ? createCollapsedTabCellSelection(activeObject)
          : editorStore.getState().selection,
    });
  useImperativeHandle(ref, () => ({
    isOutputBlocked: () =>
      composing.current ||
      !!settingsRef.current?.isComposing() ||
      !!pending ||
      numberedInputActive ||
      !!numberedRef.current?.dirty ||
      numberedDrafts.current.size > 0 ||
      !!settingsRef.current?.dirty ||
      (!!draft && musicTextDraftValue(draft) !== draft.initial),
    open: (next) => {
      request({ type: "target", target: next });
    },
    select: (next, techniqueId) =>
      request({ type: "selection", selection: next, techniqueId }),
    returnToScore,
  }));

  // 外部文档变化取消旧目标；自身命令的同步通知不清空原草稿。
  useEffect(
    () =>
      editorStore.subscribe((state) => {
        if (state.document !== baseline.current && !committing.current) {
          numberedDrafts.current.clear();
          setVisibleNumberedDrafts(new Map());
          setSwitchNotice(null);
          setSuppressSwitchNotice(false);
          setDraft(null);
          setPending(null);
          setActiveObject(null);
          setNumberedTarget(null);
          setNumberedPreview(null);
          setInputEditing(false);
          setNumberedInputActive(false);
          setNumberedDirty(false);
          setMessage(null);
          focusDestination.current = "score";
          baseline.current = state.document;
        }
      }),
    [editorStore],
  );
  useEffect(() => onEditingChange(editing), [editing, onEditingChange]);
  const targetKey = draft
    ? `${draft.target.trackId}/${draft.target.measureId}/${draft.target.beatId}/${kind}/${draft.target.verse}`
    : numberedTarget
      ? `${numberedTarget.trackId}/${numberedTarget.measureId}/${numberedTarget.beatId}/numbered`
      : "";
  /** 取消待切换时恢复原控件，不把设置字段或 checkbox 的焦点统一抢到文字框。 */
  const continueEditing = () => {
    restoreInputFocus.current = true;
    setPending(null);
  };
  // 只在明确激活或确认区退出时聚焦；页签浏览和预览更新不能抢输入焦点。
  useEffect(() => {
    if (pending) confirmRef.current?.focus({ preventScroll: true });
    else if (restoreInputFocus.current && lastInputFocus.current?.isConnected) {
      restoreInputFocus.current = false;
      lastInputFocus.current.focus({ preventScroll: true });
    } else if (focusDestination.current === "input" && targetKey) {
      if (kind === "numbered") numberedRef.current?.focus();
      else
        (sequence ? sequenceInputRef : inputRef).current?.focus({
          preventScroll: true,
        });
    }
  }, [
    pending,
    targetKey,
    sequence,
    focusRequest,
    kind,
    numberedMode,
    stateVersion,
  ]);

  // 接受键盘切页签后聚焦对应 TAB，不让表单的目标加载抢走导航焦点。
  useEffect(() => {
    if (!pending && requestedTabFocus.current) {
      document
        .getElementById(requestedTabFocus.current)
        ?.focus({ preventScroll: true });
      requestedTabFocus.current = null;
    }
  }, [kind, pending]);

  /** 提交标记在异常、失败及 no-op 时也释放；失败保留当前草稿。 */
  const commit = (command: ILXMScoreCommand) => {
    if (composing.current) return null;
    committing.current = true;
    try {
      const result = editorStore.getState().execute(command);
      if (result?.ok) {
        baseline.current = result.document;
        if (activeNumberedDraftKey) {
          numberedDrafts.current.delete(activeNumberedDraftKey);
          setVisibleNumberedDrafts(new Map(numberedDrafts.current));
        }
        setSwitchNotice(null);
        if (result.nextNumberedFocus) {
          setNumberedTarget({ kind: "numbered", ...result.nextNumberedFocus });
          setNumberedPreview(null);
        }
        setMessage(null);
      } else
        setMessage(
          result && !result.ok ? result.message : "当前无法应用修改。",
        );
      return result;
    } finally {
      committing.current = false;
    }
  };
  const apply = (advance = false): boolean => {
    if (!draft || issue || composing.current) return false;
    const target = draft.target;
    const result = commit(
      target.kind === "lyric"
        ? sequence && parsed?.ok
          ? {
              type: LXMScoreCommandEnum.SetLyricSequence,
              ...target,
              verse: target.verse!,
              items: parsed.items,
              allowOverwrite: draft.allowOverwrite,
            }
          : {
              type: LXMScoreCommandEnum.SetLyric,
              ...target,
              verse: target.verse!,
              text: draft.text,
            }
        : {
            type: LXMScoreCommandEnum.SetChordSymbol,
            ...target,
            ...draft.chord,
            display: draft.chord.chord.diagram ? "nameAndDiagram" : "name",
          },
    );
    if (!result?.ok) return false;
    if (sequence) {
      setDraft({ ...draft, initial: musicTextDraftValue(draft) });
    } else
      setDraft(readMusicTextDraft(result.document, target, draft.lyricMode));
    setMessage(result.changed ? "已应用" : "内容未变化");
    if (advance && target.kind === "lyric" && !sequence) {
      const beats =
        result.document.score.tracks
          .find((t) => t.id === target.trackId)
          ?.measures.flatMap((m) =>
            m.beats.map((b) => ({ ...target, measureId: m.id, beatId: b.id })),
          ) ?? [];
      const next =
        beats[beats.findIndex((b) => b.beatId === target.beatId) + 1];
      if (next) loadTarget(next);
      else setMessage("已应用，已到最后一拍。");
    }
    return true;
  };
  const remove = () => {
    if (!draft || !existing || composing.current) return;
    const result = commit(
      draft.target.kind === "lyric"
        ? {
            type: LXMScoreCommandEnum.RemoveLyric,
            ...draft.target,
            lyricId: existing.id,
          }
        : {
            type: LXMScoreCommandEnum.RemoveChordSymbol,
            ...draft.target,
            chordSymbolId: existing.id,
          },
    );
    if (result?.ok) {
      setDraft(
        readMusicTextDraft(result.document, draft.target, draft.lyricMode),
      );
      setMessage("已删除，保留当前拍点。");
    }
  };
  return (
    <aside
      id="music-text-sidebar"
      className={styles.musicTextSidebar}
      aria-label="编辑器属性"
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        compositionEndedAt.current = e.timeStamp;
      }}
      onPasteCapture={(e) => {
        if (/[\r\n\u2028\u2029]/u.test(e.clipboardData.getData("text"))) {
          e.preventDefault();
          setMessage("请粘贴单行文本。");
        }
      }}
      onKeyDown={(e) => {
        if (
          shouldIgnoreMusicTextKey(
            e.nativeEvent,
            composing.current,
            compositionEndedAt.current,
          )
        ) {
          e.stopPropagation();
          if (e.key === "Enter") e.preventDefault();
          return;
        }
        if (pending) {
          e.stopPropagation();
          // 确认区域形成临时键盘边界，Tab 不逃到其他修改工具。
          if (e.key === "Tab") {
            const buttons = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="alertdialog"] button:not(:disabled)',
              ),
            );
            const index = buttons.indexOf(e.target as HTMLButtonElement);
            const next =
              buttons[
                (index + (e.shiftKey ? -1 : 1) + buttons.length) %
                  buttons.length
              ];
            if (next) {
              e.preventDefault();
              next.focus({ preventScroll: true });
            }
          }
          if (e.key === "Escape") {
            e.preventDefault();
            continueEditing();
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          returnToScore();
        }
        if (
          e.key === "Enter" &&
          e.target === inputRef.current &&
          draft?.target.kind === "lyric"
        ) {
          e.preventDefault();
          apply(!e.shiftKey);
        }
      }}
    >
      <header className={styles.sidebarHeader} inert={!!pending}>
        <div role="tablist" aria-label="属性页签">
          {(["score", "lyric", "chord"] as const).map((tab) => (
            <button
              key={tab}
              id={`music-tab-${tab}`}
              role="tab"
              aria-selected={
                kind === tab || (tab === "lyric" && kind === "numbered")
              }
              aria-controls="music-text-fields"
              tabIndex={
                kind === tab || (tab === "lyric" && kind === "numbered")
                  ? 0
                  : -1
              }
              onClick={() =>
                request({
                  type: "tab",
                  kind: tab === "lyric" ? paragraphKind.current : tab,
                })
              }
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  request({
                    type: "tab",
                    focus: "main",
                    kind:
                      e.key === "Home"
                        ? "score"
                        : e.key === "End"
                          ? "chord"
                          : (["score", "lyric", "chord"] as const)[
                              ((["score", "lyric", "chord"] as const).indexOf(
                                tab,
                              ) +
                                (e.key === "ArrowLeft" ? 2 : 1)) %
                                3
                            ]!,
                  });
                }
              }}
            >
              {tab === "score" ? (
                <Settings size={19} />
              ) : tab === "lyric" ? (
                <FileText size={19} />
              ) : (
                <Guitar size={20} />
              )}
              {tab === "score"
                ? "谱面设置"
                : tab === "lyric"
                  ? "段落编辑"
                  : "和弦编辑"}
            </button>
          ))}
        </div>
      </header>
      <div
        className={styles.sidebarBody}
        id="music-text-fields"
        role="tabpanel"
        aria-labelledby={`music-tab-${kind === "numbered" ? "lyric" : kind}`}
        inert={!!pending}
        onFocusCapture={(event) => {
          if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement ||
            event.target instanceof HTMLSelectElement
          )
            lastInputFocus.current = event.target;
          // 段落 TAB／导航按钮不激活文字输入；已有表单控件才恢复输入状态。
          if (
            draft &&
            (event.target instanceof HTMLInputElement ||
              event.target instanceof HTMLTextAreaElement ||
              event.target instanceof HTMLSelectElement)
          ) {
            focusDestination.current = "input";
            setInputEditing(true);
          }
        }}
      >
        {score && (
          <div hidden={kind !== "score"}>
            <ScoreSettings
              ref={settingsRef}
              document={score}
              measureId={selection?.focus.measureId}
              onDirty={setSettingsDirty}
              commit={commit}
            />
          </div>
        )}
        {(kind === "lyric" || kind === "numbered") && (
          <div className={styles.sidebarActions}>
            <button onClick={() => addParagraph("lyric")}>添加歌词行</button>
            <button onClick={() => addParagraph("numbered")}>添加简谱行</button>
          </div>
        )}
        {(kind === "lyric" || kind === "numbered") && (
          <div
            role="tablist"
            aria-label="段落内容"
            className={styles.paragraphTabs}
          >
            {(["lyric", "numbered"] as const).map((tab, i) => (
              <button
                key={tab}
                role="tab"
                id={`paragraph-tab-${tab}`}
                aria-controls="paragraph-fields"
                aria-selected={kind === tab}
                tabIndex={kind === tab ? 0 : -1}
                onClick={() => request({ type: "tab", kind: tab })}
                onKeyDown={(e) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    request({
                      type: "tab",
                      focus: "paragraph",
                      kind:
                        e.key === "Home"
                          ? "lyric"
                          : e.key === "End"
                            ? "numbered"
                            : i === 0
                              ? "numbered"
                              : "lyric",
                    });
                  }
                }}
              >
                {tab === "lyric" ? "歌词" : "简谱"}
              </button>
            ))}
          </div>
        )}
        {kind === "numbered" && score && (
          <div
            id="paragraph-fields"
            role="tabpanel"
            aria-labelledby="paragraph-tab-numbered"
          >
            {savedNumberedCount > 0 && (
              <p className={styles.sidebarTip} role="status">
                有 {savedNumberedCount} 处简谱草稿暂存；点击对应音符可继续编辑。
              </p>
            )}
            <NumberedEditor
              key={`${stateVersion}/${numberedMode}/${activeNumberedDraftKey ?? (numberedTarget ?? selection?.focus)?.beatId}`}
              onCancel={() => request({ type: "close" })}
              mode={numberedMode}
              onModeChange={(mode) => request({ type: "numberedMode", mode })}
              ref={numberedRef}
              getClipboard={() => editorStore.getState().getNumberedClipboard()}
              copyRange={(range) =>
                editorStore.getState().copyNumberedRange(range)
              }
              document={score}
              selectedMarkId={selectedNumberedMarkId}
              target={numberedTarget ?? selection?.focus ?? null}
              selection={selection}
              savedDraft={
                activeNumberedDraftKey
                  ? visibleNumberedDrafts.get(activeNumberedDraftKey)
                  : undefined
              }
              onSelectTarget={(next) =>
                request({ type: "target", target: next })
              }
              commit={commit}
              onDirty={setNumberedDirty}
              onInputActive={setNumberedInputActive}
              onPreviewTargetChange={reportNumberedPreview}
              onActivate={(focusInput = true) => {
                // 已激活表单内部控件只报告输入状态，不把 checkbox 的焦点抢回 textarea。
                if (
                  !focusInput &&
                  numberedTarget &&
                  activeObject?.kind === "numbered"
                ) {
                  focusDestination.current = "input";
                  setNumberedInputActive(true);
                  return;
                }
                const next =
                  numberedTarget ?? editorStore.getState().selection?.focus;
                if (next)
                  request({
                    type: "target",
                    target: { ...next, kind: "numbered" },
                  });
              }}
              onCanApply={setNumberedCanApply}
            />
          </div>
        )}
        {kind !== "score" && kind !== "numbered" && (
          <div
            id={kind === "lyric" ? "paragraph-fields" : undefined}
            role={kind === "lyric" ? "tabpanel" : undefined}
            aria-labelledby={
              kind === "lyric" ? "paragraph-tab-lyric" : undefined
            }
          >
            <p className={styles.sidebarTarget}>
              {validTarget
                ? `目标：第 ${(track?.measures.findIndex((m) => m.id === validTarget.measureId) ?? 0) + 1} 小节，第 ${(measure?.beats.findIndex((b) => b.id === validTarget.beatId) ?? 0) + 1} 拍`
                : "请先选择谱面中的一拍"}
            </p>
            {!draft ? (
              <div className={styles.sidebarEmpty}>
                {kind === "lyric" ? (
                  <FileText size={36} />
                ) : (
                  <Guitar size={36} />
                )}
                <h3>{kind === "lyric" ? "连续填词" : "编辑和弦与指法"}</h3>
                <p>
                  选择目标拍后，开始编辑{kind === "lyric" ? "歌词" : "和弦"}。
                </p>
                <button
                  ref={editButtonRef}
                  disabled={!validTarget}
                  className={styles.primaryButton}
                  onClick={() =>
                    validTarget &&
                    request({
                      type: "target",
                      target: {
                        ...validTarget,
                        kind: kind === "chord" ? "chord" : "lyric",
                        verse: 1,
                      },
                    })
                  }
                >
                  {kind === "lyric" ? "从当前拍开始" : "编辑当前拍"}
                </button>
              </div>
            ) : kind === "lyric" ? (
              <section className={styles.sidebarSection}>
                <h3>歌词设置</h3>
                <label>
                  录入方式
                  <select
                    aria-label="歌词录入方式"
                    value={draft.lyricMode}
                    onChange={(e) =>
                      request({
                        type: "mode",
                        mode: e.target.value as MusicTextDraft["lyricMode"],
                      })
                    }
                  >
                    <option value="single">单拍编辑</option>
                    <option value="sequence">连续填词</option>
                  </select>
                </label>
                <label>
                  段号
                  <select
                    aria-label="歌词段号"
                    value={draft.target.verse}
                    onChange={(e) =>
                      request({
                        type: "target",
                        target: {
                          ...draft.target,
                          verse: Number(e.target.value) as ILXMLyricVerse,
                        },
                      })
                    }
                  >
                    {[1, 2, 3, 4].map((v) => (
                      <option key={v} value={v}>
                        第 {v} 段
                      </option>
                    ))}
                  </select>
                </label>
                {sequence ? (
                  <>
                    <label>
                      连续歌词
                      <textarea
                        ref={sequenceInputRef}
                        aria-label="连续歌词"
                        aria-describedby="lyric-sequence-tips"
                        rows={4}
                        placeholder="例如：风 吹 _ 过 山 谷"
                        value={draft.text}
                        onChange={(e) => {
                          setDraft({ ...draft, text: e.target.value });
                          setInspection(0);
                          setMessage(null);
                        }}
                      />
                    </label>
                    <div id="lyric-sequence-tips" className={styles.sidebarTip}>
                      <strong>连续填词规则</strong>
                      <p>
                        用空格分词，每项依次对应一拍，休止拍也占一格。多个空格按一个分隔处理。
                      </p>
                      <p>
                        用 <code>_</code> 跳过一拍并保留原歌词，例如{" "}
                        <code>风 _ 过</code>。
                      </p>
                      <p>
                        英文短句按空格拆词；要把 <code>a song</code>{" "}
                        放在同一拍，请切到单拍编辑。
                      </p>
                      <p>
                        先核对下方对应预览，再应用全部。默认允许替换已有歌词，可取消下方勾选以保留原词。
                      </p>
                      <details>
                        <summary>详细规则</summary>
                        半角与全角空格均可分隔，首尾空格忽略；仅独立 _
                        表示跳过。每项最多 64 字，每批最多 256 拍。
                        不接受换行或制表符；谱尾位置不足时整批拒绝；整批可一次撤销。
                      </details>
                    </div>
                    <label className={styles.overwriteToggle}>
                      <input
                        type="checkbox"
                        checked={draft.allowOverwrite}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            allowOverwrite: e.target.checked,
                          })
                        }
                      />
                      允许替换预览中标记的已有歌词（{plan?.overwrites ?? 0} 项）
                    </label>
                    {plan && (
                      <div className={styles.sequencePreview}>
                        <h4>对应预览 · 写入 {plan.changes} 项</h4>
                        <table>
                          <thead>
                            <tr>
                              <th>位置</th>
                              <th>原词 → 新词</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plan.rows.map((row) => (
                              <tr
                                key={row.index}
                                aria-selected={inspection === row.index}
                              >
                                <td>
                                  <button
                                    disabled={!row.target}
                                    onClick={() => setInspection(row.index)}
                                  >
                                    {row.target
                                      ? `${row.measureNumber} 小节 / ${row.beatNumber} 拍${row.rest ? "（休止）" : ""}`
                                      : `第 ${row.index + 1} 项（超出谱尾）`}
                                  </button>
                                </td>
                                <td>
                                  {row.previous ?? "空"} →{" "}
                                  {row.item.kind === "skip"
                                    ? "保留原词"
                                    : row.item.text}
                                </td>
                                <td>
                                  {
                                    {
                                      add: "新增",
                                      change: "覆盖",
                                      same: "未变化",
                                      skip: "跳过",
                                      error: "错误",
                                    }[row.status]
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <label>
                      歌词
                      <input
                        ref={inputRef}
                        aria-label="歌词文本"
                        value={draft.text}
                        onChange={(e) => {
                          setDraft({ ...draft, text: e.target.value });
                          setMessage(null);
                        }}
                      />
                    </label>
                    {existing ? (
                      <small>将修改已有歌词。</small>
                    ) : (
                      <small>此拍暂无第 {draft.target.verse} 段歌词。</small>
                    )}
                    <div className={styles.sidebarTip}>
                      Enter 应用并下一拍；Shift+Enter 仅应用。
                      <br />
                      每拍单行，支持第 1–4 段歌词。
                    </div>
                  </>
                )}
              </section>
            ) : (
              <ChordEditor
                inputRef={inputRef}
                draft={draft.chord}
                onChange={(chord) => {
                  setDraft({ ...draft, chord });
                  setMessage(null);
                }}
                presetsEnabled={
                  !!track &&
                  JSON.stringify(track.tuning.strings.map((s) => s.pitch)) ===
                    JSON.stringify(["E4", "B3", "G3", "D3", "A2", "E2"])
                }
              />
            )}
          </div>
        )}
      </div>
      {/* 无编辑操作或提示时隐藏底栏，避免移除历史按钮后留下空白条。 */}
      <footer
        className={styles.sidebarFooter}
        hidden={!pending && !issue && !message && !draft && !switchNotice}
      >
        {pending ? (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="draft-confirm-title"
            className={styles.draftConfirmation}
          >
            <h3 id="draft-confirm-title">当前草稿尚未应用</h3>
            <p>请先处理修改，再继续操作。</p>
            <div>
              <button
                disabled={!!issue || (kind === "numbered" && !numberedCanApply)}
                className={styles.primaryButton}
                onClick={() => {
                  if (
                    kind === "score"
                      ? settingsRef.current?.apply()
                      : kind === "numbered"
                        ? numberedRef.current?.apply()
                        : apply()
                  )
                    perform(pending);
                }}
              >
                应用并切换
              </button>
              <button
                onClick={() => {
                  if (!composing.current) {
                    settingsRef.current?.discard();
                    perform(pending);
                  }
                }}
              >
                放弃并切换
              </button>
              <button ref={confirmRef} onClick={continueEditing}>
                继续编辑
              </button>
            </div>
          </div>
        ) : (
          <>
            {switchNotice && (
              <div className={styles.sidebarMessage} role="status">
                上一处简谱修改已暂存。
                <div className={styles.sidebarActions}>
                  <button
                    onClick={() =>
                      request({ type: "target", target: switchNotice })
                    }
                  >
                    返回编辑
                  </button>
                  <button
                    onClick={() => {
                      setSuppressSwitchNotice(true);
                      setSwitchNotice(null);
                    }}
                  >
                    本次编辑不再提示
                  </button>
                </div>
              </div>
            )}
            {issue && (
              <p className={styles.sidebarError} role="alert">
                {issue}
              </p>
            )}
            {message && (
              <p className={styles.sidebarMessage} role="status">
                {message}
              </p>
            )}
            {draft && (
              <div className={styles.sidebarActions}>
                <button
                  className={styles.dangerButton}
                  disabled={!existing || sequence}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                  删除{kind === "lyric" ? "歌词" : "和弦"}
                </button>
                <button onClick={() => request({ type: "close" })}>取消</button>
                <button
                  disabled={!!issue}
                  className={styles.primaryButton}
                  onClick={() => apply()}
                >
                  {sequence
                    ? `应用全部${draft.allowOverwrite && plan?.overwrites ? `（覆盖 ${plan.overwrites} 项）` : ""}`
                    : "应用"}
                </button>
                {kind === "lyric" && !sequence && (
                  <button
                    disabled={!!issue}
                    className={styles.primaryButton}
                    onClick={() => apply(true)}
                  >
                    应用并下一拍
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </footer>
    </aside>
  );
};
