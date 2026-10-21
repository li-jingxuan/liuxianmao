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
import {
  AimOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  FileTextOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Segmented, Tabs, type TabsProps } from "antd";
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
import { LyricFormView } from "./LyricFormView";
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
import { useEditorDraftRecords } from "./EditorSessionRuntime";
import {
  numberedDraftDependency,
  numberedTargetTrack,
} from "./numbered-draft-dependencies";
import type { NumberedImpact, NumberedDraftGroup } from "./numbered-submission";
import { captureEditorVersion } from "./editor-session-version";
import type { EditorDraftRecord } from "./editor-draft-coordinator";

import type { ToolNavigation } from "./editor-tool-catalog";
import type {
  ToolActionHandler,
  MeasureToolTarget,
} from "./editor-tool-actions";
import type { EditorCommandAdapter } from "./editor-command-adapter";
import { NoteToolDetails } from "./NoteToolDetails";
import { MeasureToolDetails } from "./MeasureToolDetails";
import { TupletToolDetails } from "./TupletToolDetails";
import {
  resolveParagraphInsertionTarget,
  resolveParagraphNumberedTarget,
  resolveSystemMeasureIds,
} from "./music-text-target";

export interface MusicTextController {
  navigateTool: (destination: ToolNavigation) => SelectionRequestResult;
  /** 输出前只读检查草稿，不自动提交或取消用户输入。 */
  isOutputBlocked: () => boolean;
  isNumberedActionBlocked: () => boolean;
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
  onNumberedActionBlockedChange,
  onTargetChange,
  onScoreFocus,
  onScoreSelection,
  getSystemMeasureIds,
  onToolAction,
  executeTool,
}: {
  ref: Ref<MusicTextController>;
  onToolAction?: ToolActionHandler;
  executeTool?: EditorCommandAdapter;
  onOpen: () => void;
  onEditingChange: (editing: boolean) => void;
  onNumberedActionBlockedChange: (blocked: boolean) => void;
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
  type PropertyTab = "selection" | "paragraph" | "chord" | "song";
  // 一级栏目只负责组织界面；真实业务目标仍由 kind 和现有草稿闸门维护。
  const [propertyTab, setPropertyTab] = useState<PropertyTab>("selection");
  const [selectionDetail, setSelectionDetail] =
    useState<ToolNavigation>("note");
  const [detailTarget, setDetailTarget] = useState<MeasureToolTarget>();
  const [detailFocus, setDetailFocus] = useState(0);
  const detailRegion = useRef<HTMLDivElement>(null);
  const settingsFieldRequest = useRef<"label" | "copy" | null>(null);
  // 活动对象独立于可见页签；null 表示普通六线谱选择，不表示关闭侧栏。
  const [activeObject, setActiveObject] = useState<MusicTextTarget | null>(
    null,
  );
  const [numberedTarget, setNumberedTarget] = useState<MusicTextTarget | null>(
    null,
  );
  const [numberedPreview, setNumberedPreview] =
    useState<MusicTextTarget | null>(null);
  const [numberedMode, setNumberedMode] = useState<"single" | "sequence">(
    "sequence",
  );
  const numberedRef = useRef<NumberedEditorController>(null);
  const numberedDrafts = useRef(new Map<string, NumberedEditorDraft>());
  const numberedDraftTargets = useRef(new Map<string, MusicTextTarget>());
  const [visibleNumberedDrafts, setVisibleNumberedDrafts] = useState<
    ReadonlyMap<string, NumberedEditorDraft>
  >(() => new Map());
  const savedNumberedCount = visibleNumberedDrafts.size;
  const [switchNotice, setSwitchNotice] = useState<MusicTextTarget | null>(
    null,
  );
  const [suppressSwitchNotice, setSuppressSwitchNotice] = useState(false);
  const [numberedGroups, setNumberedGroups] = useState<
    readonly NumberedDraftGroup[]
  >([]);
  const [numberedBusy, setNumberedBusy] = useState(false);
  const navigationApplying = useRef(false);
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
  const [compositionActive, setCompositionActive] = useState(false);
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
  const activeNumberedDraft = activeNumberedDraftKey
    ? visibleNumberedDrafts.get(activeNumberedDraftKey)
    : undefined;
  const activeNumberedMode = activeNumberedDraft?.mode ?? numberedMode;
  // 文字对象即使暂时浏览其他页签，快捷键也不能在文字高亮下误写 TAB 音符。
  const editing =
    !!activeObject ||
    settingsDirty ||
    numberedDirty ||
    numberedInputActive ||
    !!pending ||
    (!!draft && (inputEditing || musicTextDraftValue(draft) !== draft.initial));
  const numberedActionBlocked =
    numberedDirty ||
    visibleNumberedDrafts.size > 0 ||
    !!pending ||
    settingsDirty ||
    (!!draft && musicTextDraftValue(draft) !== draft.initial);
  useEffect(() => {
    onNumberedActionBlockedChange(numberedActionBlocked);
  }, [numberedActionBlocked, onNumberedActionBlockedChange]);
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
    setPropertyTab(next.kind === "chord" ? "chord" : "paragraph");
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
      action.type === "tool" &&
      (current.sessionId !== action.sessionId ||
        current.sessionVersion !== action.sessionVersion ||
        (action.target &&
          !current.document?.score.tracks
            .find((track) => track.id === action.target!.trackId)
            ?.measures.some(
              (measure) => measure.id === action.target!.measureId,
            )))
    ) {
      setPending(null);
      setMessage("工具导航目标已失效，请重新选择。");
      return false;
    }
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
    if (action.type === "tool") {
      setDraft(null);
      setNumberedTarget(null);
      setActiveObject(null);
      setInputEditing(false);
      setKind("score");
      setMessage(null);
      focusDestination.current = "score";
      setDetailTarget(action.target);
      if (action.destination === "section" || action.destination === "copy") {
        setPropertyTab("song");
        settingsFieldRequest.current =
          action.destination === "section" ? "label" : "copy";
      } else {
        setPropertyTab("selection");
        setSelectionDetail(action.destination);
      }
      setDetailFocus((value) => value + 1);
      onOpen();
    } else if (action.type === "selection" || action.type === "close") {
      setDetailTarget(undefined);
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
        current.setNumberedSelection(null);
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
        setPropertyTab("paragraph");
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
        if (resolved) {
          const saved = numberedDrafts.current.get(numberedDraftKey(resolved));
          if (saved?.mode) setNumberedMode(saved.mode);
        }
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
      } else {
        current.setNumberedSelection(null);
        loadTarget(action.target, draft?.lyricMode, action.focus);
      }
    } else if (action.type === "numberedMode") {
      if (activeNumberedDraftKey) {
        numberedDrafts.current.delete(activeNumberedDraftKey);
        numberedDraftTargets.current.delete(activeNumberedDraftKey);
        setVisibleNumberedDrafts(new Map(numberedDrafts.current));
      }
      setNumberedMode(action.mode);
    } else if (action.type === "mode") {
      if (draft) loadTarget(draft.target, action.mode);
    } else if (action.kind === "chord" && current.selection?.focus) {
      // 已选拍点切到和弦页签时直接读取该拍和弦并进入编辑态。
      current.setNumberedSelection(null);
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
      if (action.kind === "lyric") {
        paragraphKind.current = "lyric";
        current.setNumberedSelection(null);
      }
    }
    return true;
  };
  /** 新增只打开真实拍点上的编辑区域，首次应用才写入音乐数据。 */
  const addParagraph = (nextKind: "lyric" | "numbered") => {
    if (nextKind === "numbered") {
      const target = resolveParagraphNumberedTarget(
        score,
        numberedTarget ?? validTarget,
      );
      if (target) request({ type: "target", target });
      else setMessage("当前没有可用的简谱时间窗，请先添加小节。");
      return;
    }
    const next = resolveParagraphInsertionTarget(score, validTarget);
    const currentTrack = next
      ? score?.score.tracks.find((item) => item.id === next.trackId)
      : undefined;
    if (!next || !currentTrack) {
      setMessage("请先添加拍点，再添加歌词或简谱。");
      return;
    }
    const ids = resolveSystemMeasureIds(next.measureId, getSystemMeasureIds);
    if (!ids) {
      setMessage("谱行布局尚未就绪，请稍后再添加歌词行。");
      return;
    }
    const used = new Set(
      currentTrack.measures
        .filter((m) => ids.includes(m.id))
        .flatMap((m) => m.lyrics.map((l) => l.verse)),
    );
    const verse = ([1, 2, 3, 4] as const).find((v) => !used.has(v));
    if (!verse) {
      setMessage("当前谱行已有 4 段歌词，请选择段号编辑已有行。");
      return;
    }
    request({
      type: "target",
      target: { ...next, kind: "lyric", verse: verse ?? 1 },
    });
  };
  const currentVersion = () => editorStore.getState();
  /** 所有对象／页签请求通过同一草稿闸门，不提前迁移 selection。 */
  const request = (action: SidebarAction): SelectionRequestResult => {
    if (
      composing.current ||
      settingsRef.current?.isComposing() ||
      pending ||
      numberedBusy ||
      navigationApplying.current
    )
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
    // “选区”和“歌曲”都映射到 score 目标，但歌曲表单仍可能有未应用草稿；
    // 同一业务 kind 不能成为绕过草稿保护的捷径。
    if (
      action.type === "tab" &&
      action.kind === kind &&
      !settingsRef.current?.dirty &&
      !numberedRef.current?.dirty &&
      numberedDrafts.current.size === 0 &&
      !(draft && musicTextDraftValue(draft) !== draft.initial)
    )
      return "accepted";
    if (action.type === "numberedMode" && action.mode === activeNumberedMode)
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
        numberedDraftTargets.current.set(
          activeNumberedDraftKey,
          numberedTarget,
        );
        snapshot.baselineVersion = captureEditorVersion(currentVersion());
        snapshot.dependency = numberedDraftDependency(
          numberedTargetTrack(currentVersion().document, numberedTarget),
          numberedTarget,
          snapshot,
        );
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
    isNumberedActionBlocked: () =>
      !!pending ||
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
    navigateTool: (destination) => {
      const current = editorStore.getState();
      const source = activeObject ?? current.selection?.focus;
      return request({
        type: "tool",
        kind: "score",
        destination,
        sessionId: current.sessionId,
        sessionVersion: current.sessionVersion,
        target: source
          ? { trackId: source.trackId, measureId: source.measureId }
          : undefined,
      });
    },
  }));
  // 只有受保护请求真正完成且布局已提交，才定位可见详情或原歌曲字段。
  useEffect(() => {
    if (!detailFocus || pending) return;
    if (settingsFieldRequest.current) {
      const field = settingsFieldRequest.current;
      if (settingsRef.current?.focusField(field))
        settingsFieldRequest.current = null;
    } else
      detailRegion.current
        ?.querySelector<HTMLElement>(
          `[data-selection-detail="${selectionDetail}"] h3`,
        )
        ?.focus({ preventScroll: true });
  }, [detailFocus, pending, propertyTab, selectionDetail]);

  // 外部文档变化取消旧目标；自身命令的同步通知不清空原草稿。
  useEffect(
    () =>
      editorStore.subscribe((state) => {
        if (state.document !== baseline.current && !committing.current) {
          numberedDrafts.current.clear();
          numberedDraftTargets.current.clear();
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
          setMessage("文档已变化，原编辑目标和未提交草稿已失效，请重新选择。");
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
    activeNumberedMode,
  ]);

  // 接受键盘切页签后聚焦对应 TAB，不让表单的目标加载抢走导航焦点。
  useEffect(() => {
    if (!pending && requestedTabFocus.current) {
      const target = document.getElementById(requestedTabFocus.current);
      const control =
        target?.closest("label")?.querySelector("input") ?? target;
      control?.focus({ preventScroll: true });
      requestedTabFocus.current = null;
    }
  }, [kind, pending]);

  /** 暂存输入只在真实命令前后核对依赖；普通 render 不能刷新草稿基线。 */
  const checkNumberedCandidate = (candidate: NumberedImpact): string | null => {
    const current = editorStore.getState();
    for (const [key, snapshot] of numberedDrafts.current) {
      if (key === activeNumberedDraftKey) continue;
      const target = numberedDraftTargets.current.get(key);
      if (!target || target.trackId !== candidate.track.id) continue;
      const before = numberedDraftDependency(
        numberedTargetTrack(current.document, target),
        target,
        snapshot,
      );
      const after = numberedDraftDependency(candidate.track, target, snapshot);
      if (
        (snapshot.dependency && snapshot.dependency !== before) ||
        before !== after
      )
        return "此操作会影响暂存简谱草稿，请先返回该目标应用或明确丢弃，再重新预览。";
    }
    return null;
  };
  const applyNumbered = async (isCurrent = () => true) => {
    const owner = numberedRef.current;
    if (!owner || composing.current) return "blocked" as const;
    const result = await owner.apply(isCurrent);
    if (result.status === "applied" || result.status === "noop") {
      setNumberedInputActive(false);
      return "applied" as const;
    }
    return result.status === "stale"
      ? ("stale" as const)
      : ("blocked" as const);
  };
  const applyAndNavigate = async () => {
    if (!pending || navigationApplying.current) return;
    navigationApplying.current = true;
    const action = pending;
    const session = captureEditorVersion(editorStore.getState());
    try {
      const success =
        kind === "numbered"
          ? (await applyNumbered()) === "applied"
          : kind === "score"
            ? settingsRef.current?.apply()
            : apply();
      const current = editorStore.getState();
      if (
        success &&
        current.sessionId === session.sessionId &&
        current.sessionVersion === session.sessionVersion
      )
        perform(action);
      else setFocusRequest((value) => value + 1);
    } finally {
      navigationApplying.current = false;
    }
  };
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
        for (const [key, snapshot] of numberedDrafts.current) {
          const target = numberedDraftTargets.current.get(key);
          if (!target) continue;
          const dependency = numberedDraftDependency(
            numberedTargetTrack(result.document, target),
            target,
            snapshot,
          );
          if (!snapshot.dependency || snapshot.dependency === dependency) {
            snapshot.dependency = dependency;
            snapshot.baselineVersion = captureEditorVersion(
              editorStore.getState(),
            );
          }
        }
        if (
          result.nextNumberedFocus &&
          (!numberedTarget ||
            !resolveNumberedEditorTarget(result.document, numberedTarget))
        ) {
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
  // 每个简谱草稿按独立目标登记；暂存草稿只能回原编辑器处理，不能批量自动应用。
  useEditorDraftRecords(() => {
    const records: EditorDraftRecord[] = [];
    const version = captureEditorVersion(editorStore.getState());
    if (
      draft &&
      (musicTextDraftValue(draft) !== draft.initial ||
        (compositionActive && kind !== "score"))
    ) {
      records.push({
        id: `music:${targetKey}`,
        kind: draft.target.kind,
        targetKey,
        label: draft.target.kind === "lyric" ? "歌词输入" : "和弦编辑",
        dirty: musicTextDraftValue(draft) !== draft.initial,
        composing: compositionActive,
        canApply: !issue && !pending,
        error: issue,
        version,
        inputKey: musicTextDraftValue(draft),
        focus: () => {
          setPropertyTab(draft.target.kind === "chord" ? "chord" : "paragraph");
          focusTarget("input");
          return true;
        },
        apply: ({ isCurrent }) =>
          isCurrent() ? (apply() ? "applied" : "blocked") : "stale",
        discard: () => {
          if (composing.current || pending) return false;
          setDraft(
            readMusicTextDraft(
              editorStore.getState().document,
              draft.target,
              draft.lyricMode,
            ),
          );
          return true;
        },
      });
    }
    if (
      activeNumberedDraftKey &&
      (numberedDirty ||
        numberedInputActive ||
        (compositionActive && kind === "numbered"))
    ) {
      records.push({
        id: `numbered:${activeNumberedDraftKey}`,
        kind: "numbered",
        targetKey: activeNumberedDraftKey,
        label: "当前简谱输入",
        dirty: numberedDirty || numberedInputActive,
        composing: compositionActive,
        canApply: numberedCanApply && !pending,
        error: null,
        version,
        inputKey: JSON.stringify(numberedRef.current?.snapshot()),
        focus: () => {
          setPropertyTab("paragraph");
          setKind("numbered");
          focusDestination.current = "input";
          setFocusRequest((value) => value + 1);
          numberedRef.current?.focus();
          return !!numberedRef.current;
        },
        apply: ({ isCurrent }) =>
          isCurrent() ? applyNumbered(isCurrent) : "stale",
        discard: () => {
          if (composing.current || pending) return false;
          numberedRef.current?.discard();
          numberedDrafts.current.delete(activeNumberedDraftKey);
          numberedDraftTargets.current.delete(activeNumberedDraftKey);
          setVisibleNumberedDrafts(new Map(numberedDrafts.current));
          return true;
        },
      });
    }
    for (const [key, savedDraft] of visibleNumberedDrafts) {
      if (records.some((record) => record.id === `numbered:${key}`)) continue;
      const savedTarget = numberedDraftTargets.current.get(key);
      records.push({
        id: `numbered:${key}`,
        kind: "numbered",
        targetKey: key,
        label: "暂存简谱输入",
        dirty: true,
        composing: false,
        canApply: false,
        error: null,
        version: savedDraft.baselineVersion ?? version,
        inputKey: JSON.stringify(savedDraft),
        focus: () =>
          !!savedTarget &&
          request({ type: "target", target: savedTarget }) === "accepted",
        apply: () => "blocked",
        discard: () => {
          numberedDrafts.current.delete(key);
          numberedDraftTargets.current.delete(key);
          setVisibleNumberedDrafts(new Map(numberedDrafts.current));
          return true;
        },
      });
    }
    return records;
  });
  const selectionTrack = score?.score.tracks.find(
    (track) => track.id === selection?.focus.trackId,
  );
  const selectionMeasureIndex =
    selectionTrack?.measures.findIndex(
      (measure) => measure.id === selection?.focus.measureId,
    ) ?? -1;
  const selectionBeatIndex =
    selectionTrack?.measures[selectionMeasureIndex]?.beats.findIndex(
      (beat) => beat.id === selection?.focus.beatId,
    ) ?? -1;
  return (
    <aside
      id="music-text-sidebar"
      className={styles.musicTextSidebar}
      aria-label="编辑器属性"
      onCompositionStart={() => {
        composing.current = true;
        setCompositionActive(true);
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        setCompositionActive(false);
        compositionEndedAt.current = e.timeStamp;
      }}
      onPasteCapture={(e) => {
        if (/[\r\n\u2028\u2029]/u.test(e.clipboardData.getData("text"))) {
          e.preventDefault();
          setMessage("请粘贴单行文本。");
        }
      }}
      onKeyDown={(e) => {
        // Select 自己处理方向键、Enter 和 Esc，不能把关闭下拉框解释成退出编辑。
        if (
          e.target instanceof Element &&
          e.target.closest(".ant-select, .ant-select-dropdown")
        ) {
          e.stopPropagation();
          return;
        }
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
        <Tabs
          activeKey={propertyTab}
          onChange={(key) => {
            const next = key as PropertyTab;
            const nextKind: SidebarTab =
              next === "selection" || next === "song"
                ? "score"
                : next === "paragraph"
                  ? paragraphKind.current
                  : "chord";
            // 只有草稿闸门接受请求后才更新受控 Tabs，避免视觉状态先于业务状态切换。
            if (request({ type: "tab", kind: nextKind }) === "accepted")
              setPropertyTab(next);
          }}
          items={
            [
              {
                key: "selection",
                label: "选区",
                icon: <AimOutlined />,
                children: null,
              },
              {
                key: "paragraph",
                label: "段落",
                icon: <FileTextOutlined />,
                children: null,
              },
              {
                key: "chord",
                label: "和弦",
                icon: <CustomerServiceOutlined />,
                children: null,
              },
              {
                key: "song",
                label: "歌曲",
                icon: <SettingOutlined />,
                children: null,
              },
            ] satisfies TabsProps["items"]
          }
          size="small"
          tabBarGutter={12}
          animated={false}
        />
      </header>
      <div
        className={styles.sidebarBody}
        id="music-text-fields"
        role="tabpanel"
        aria-label={`${propertyTab} 属性面板`}
        inert={!!pending && !numberedBusy}
        onFocusCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("[data-editor-paragraph-switch]")
          )
            return;
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
          <div hidden={propertyTab !== "song"}>
            <ScoreSettings
              ref={settingsRef}
              document={score}
              measureId={
                propertyTab === "song" && detailTarget
                  ? detailTarget.measureId
                  : selection?.focus.measureId
              }
              onDirty={setSettingsDirty}
              commit={commit}
              executeTool={executeTool}
              onFocusRequest={() => {
                if (
                  kind !== "score" &&
                  request({ type: "tab", kind: "score" }) !== "accepted"
                )
                  return false;
                setPropertyTab("song");
                return true;
              }}
            />
          </div>
        )}
        <div
          ref={detailRegion}
          hidden={propertyTab !== "selection"}
          inert={propertyTab !== "selection"}
        >
          {score && onToolAction && executeTool ? (
            <>
              <div
                data-selection-detail="note"
                hidden={selectionDetail !== "note"}
              >
                <NoteToolDetails
                  document={score}
                  selection={selection}
                  blocked={editing || savedNumberedCount > 0}
                  onAction={onToolAction}
                />
              </div>
              <div
                data-selection-detail={
                  selectionDetail === "barline" ? "barline" : "measure"
                }
                hidden={
                  selectionDetail !== "measure" && selectionDetail !== "barline"
                }
              >
                <MeasureToolDetails
                  document={score}
                  selection={selection}
                  target={detailTarget}
                  blocked={editing || savedNumberedCount > 0}
                  boundaryOnly={selectionDetail === "barline"}
                  onAction={onToolAction}
                  navigate={(destination) =>
                    request({
                      type: "tool",
                      kind: "score",
                      destination,
                      target:
                        detailTarget ??
                        (selection?.focus
                          ? {
                              trackId: selection.focus.trackId,
                              measureId: selection.focus.measureId,
                            }
                          : undefined),
                      sessionId: editorStore.getState().sessionId,
                      sessionVersion: editorStore.getState().sessionVersion,
                    })
                  }
                />
              </div>
              <div
                data-selection-detail="tuplet"
                hidden={selectionDetail !== "tuplet"}
              >
                <TupletToolDetails
                  document={score}
                  selection={selection}
                  blocked={editing || savedNumberedCount > 0}
                  execute={executeTool}
                />
              </div>
            </>
          ) : (
            propertyTab === "selection" && (
              <section className={styles.selectionPanel} aria-label="当前选区">
                {selection ? (
                  <>
                    <div className={styles.selectionPanelHeader}>
                      <strong>当前选区</strong>
                      <span>已定位</span>
                    </div>
                    <p>
                      第 {selectionMeasureIndex + 1} 小节 · 第{" "}
                      {selectionBeatIndex + 1} 拍点 · 第{" "}
                      {selection.focus.string} 弦
                    </p>
                    <p className={styles.sidebarTip}>
                      时值、休止、小节与技巧操作位于顶部工具带。
                    </p>
                  </>
                ) : (
                  <>
                    <h3>开始编写你的曲谱</h3>
                    <p>
                      点击六线谱中的位置，输入品位。拖动可选择多个拍点与弦。
                    </p>
                    <ol className={styles.selectionSteps}>
                      <li>选择音符位置</li>
                      <li>输入品位与节奏</li>
                      <li>添加歌词、简谱或和弦</li>
                    </ol>
                    <p className={styles.sidebarTip}>
                      在头部“视图”中随时查看快捷键。
                    </p>
                  </>
                )}
              </section>
            )
          )}
        </div>
        {propertyTab === "paragraph" && (
          <div className={styles.sidebarActions}>
            <Button onClick={() => addParagraph("lyric")}>添加歌词行</Button>
            <Button onClick={() => addParagraph("numbered")}>添加简谱行</Button>
          </div>
        )}
        {propertyTab === "paragraph" && (
          <Segmented
            block
            aria-label="段落内容"
            data-editor-paragraph-switch
            className={styles.paragraphTabs}
            value={kind === "numbered" ? "numbered" : "lyric"}
            options={(["lyric", "numbered"] as const).map((tab) => ({
              value: tab,
              label: (
                <span id={`paragraph-tab-${tab}`}>
                  {tab === "lyric" ? "歌词" : "简谱"}
                </span>
              ),
            }))}
            onChange={(value) =>
              request({ type: "tab", kind: value as "lyric" | "numbered" })
            }
            onKeyDown={(event) => {
              // 页签切换仍经草稿闸门；原生方向键和首尾键共用同一请求入口。
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                event.stopPropagation();
                request({
                  type: "tab",
                  focus: "paragraph",
                  kind:
                    event.key === "Home"
                      ? "lyric"
                      : event.key === "End"
                        ? "numbered"
                        : kind === "lyric"
                          ? "numbered"
                          : "lyric",
                });
              }
            }}
          />
        )}
        {propertyTab === "paragraph" && kind === "numbered" && score && (
          <div
            id="paragraph-fields"
            role="tabpanel"
            aria-labelledby="paragraph-tab-numbered"
          >
            {savedNumberedCount > 0 && (
              <p className={styles.sidebarTip} role="status">
                有 {savedNumberedCount} 处简谱草稿暂存；点击对应音符可继续编辑。
                {[...visibleNumberedDrafts.keys()]
                  .filter((key) => key !== activeNumberedDraftKey)
                  .map((key, index) => (
                    <Button
                      key={key}
                      size="small"
                      onClick={() => {
                        const target = numberedDraftTargets.current.get(key);
                        if (target) request({ type: "target", target });
                      }}
                    >
                      返回暂存草稿 {index + 1}
                    </Button>
                  ))}
              </p>
            )}
            <NumberedEditor
              // 不再把 stateVersion 放进 key：自身提交后保持同一输入 owner，避免其他分组被重挂载清空。
              key={`${activeNumberedMode}/${activeNumberedDraftKey ?? (numberedTarget ?? selection?.focus)?.beatId}`}
              checkCandidate={checkNumberedCandidate}
              onBusyChange={setNumberedBusy}
              onGroupsChange={setNumberedGroups}
              onCancel={() => request({ type: "close" })}
              mode={activeNumberedMode}
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
        {propertyTab !== "selection" &&
          propertyTab !== "song" &&
          kind !== "score" &&
          kind !== "numbered" && (
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
                    <FileTextOutlined style={{ fontSize: 36 }} />
                  ) : (
                    <CustomerServiceOutlined style={{ fontSize: 36 }} />
                  )}
                  <h3>{kind === "lyric" ? "连续填词" : "编辑和弦与指法"}</h3>
                  <p>
                    选择目标拍后，开始编辑{kind === "lyric" ? "歌词" : "和弦"}。
                  </p>
                  <Button
                    ref={editButtonRef}
                    disabled={!validTarget}
                    type="primary"
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
                  </Button>
                </div>
              ) : kind === "lyric" ? (
                <LyricFormView
                  draft={draft}
                  plan={plan}
                  issue={issue}
                  inspection={inspection}
                  existingText={
                    existing && "text" in existing ? existing.text : undefined
                  }
                  inputRef={(element) => {
                    inputRef.current = element;
                  }}
                  sequenceInputRef={(element) => {
                    sequenceInputRef.current = element;
                  }}
                  onModeChange={(mode) => request({ type: "mode", mode })}
                  onVerseChange={(verse) =>
                    request({
                      type: "target",
                      target: { ...draft.target, verse },
                    })
                  }
                  onTextChange={(text) => {
                    setDraft({ ...draft, text });
                    setInspection(0);
                    setMessage(null);
                  }}
                  onOverwriteChange={(allowOverwrite) =>
                    setDraft({ ...draft, allowOverwrite })
                  }
                  onInspect={setInspection}
                />
              ) : (
                <ChordEditor
                  inputRef={(element) => {
                    inputRef.current = element;
                  }}
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
            role={numberedBusy ? undefined : "alertdialog"}
            aria-modal={numberedBusy ? undefined : true}
            inert={numberedBusy}
            aria-labelledby="draft-confirm-title"
            className={styles.draftConfirmation}
          >
            <h3 id="draft-confirm-title">当前草稿尚未应用</h3>
            <p>
              请先处理修改，再继续操作。
              {kind === "numbered" && numberedGroups.length > 1
                ? "有多个分组尚未应用，请继续编辑并分别处理。"
                : ""}
            </p>
            {kind === "numbered" && numberedGroups.length === 1 && (
              <p>
                将应用：
                {
                  {
                    content: "简谱内容",
                    rhythm: "事件时值",
                    itemPitch: "单音符音高",
                  }[numberedGroups[0]!]
                }
              </p>
            )}
            <div>
              <Button
                disabled={!!issue || (kind === "numbered" && !numberedCanApply)}
                type="primary"
                onClick={() => void applyAndNavigate()}
              >
                应用并切换
              </Button>
              <Button
                onClick={() => {
                  if (!composing.current) {
                    settingsRef.current?.discard();
                    perform(pending);
                  }
                }}
              >
                放弃并切换
              </Button>
              <Button ref={confirmRef} onClick={continueEditing}>
                继续编辑
              </Button>
            </div>
          </div>
        ) : (
          <>
            {switchNotice && (
              <div className={styles.sidebarMessage} role="status">
                上一处简谱修改已暂存。
                <div className={styles.sidebarActions}>
                  <Button
                    onClick={() =>
                      request({ type: "target", target: switchNotice })
                    }
                  >
                    返回编辑
                  </Button>
                  <Button
                    onClick={() => {
                      setSuppressSwitchNotice(true);
                      setSwitchNotice(null);
                    }}
                  >
                    本次编辑不再提示
                  </Button>
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
                <Button
                  danger
                  disabled={!existing || sequence}
                  onClick={remove}
                >
                  <DeleteOutlined />
                  删除{kind === "lyric" ? "歌词" : "和弦"}
                </Button>
                <Button onClick={() => request({ type: "close" })}>取消</Button>
                <Button
                  disabled={!!issue}
                  type={kind === "chord" || sequence ? "primary" : "default"}
                  onClick={() => apply()}
                >
                  {sequence
                    ? `应用全部${draft.allowOverwrite && plan?.overwrites ? `（覆盖 ${plan.overwrites} 项）` : ""}`
                    : "应用"}
                </Button>
                {kind === "lyric" && !sequence && (
                  <Button
                    disabled={!!issue}
                    type="primary"
                    onClick={() => apply(true)}
                  >
                    应用并下一拍
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </footer>
    </aside>
  );
};
