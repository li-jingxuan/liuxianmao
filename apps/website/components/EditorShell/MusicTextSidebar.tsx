import {
  numberedTargetKey,
  formatNumberedBeatPosition,
  resolveNumberedEditorTarget,
} from "./numbered-editor-target";
import {
  NumberedEditor,
  type NumberedEditorController,
} from "./NumberedEditor";
import { ScoreSettings, type ScoreSettingsController, type ScoreSettingsStatus } from "./ScoreSettings";
import { createPortal } from "react-dom";
import { SidebarFrame } from "./SidebarFrame";
import { SidebarObjectContext } from "./SidebarObjectContext";
import { SidebarTaskIcon } from "./SidebarTaskIcon";
import { deriveSidebarContext, type SidebarLocation } from "./sidebar-context";
import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Ref,
} from "react";
import {
  CustomerServiceOutlined,
  DeleteOutlined,
  FileTextOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Button, ConfigProvider, Segmented, Tabs, type TabsProps } from "antd";
import {
  createCollapsedTabCellSelection,
  LXMScoreCommandEnum,
  normalizeMusicText,
  parseLyricSequence,
  planLyricSequence,
  resolveLyricPosition,
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
import { ChordQuickEditor } from "./ChordQuickEditor";
import { chordIssueField } from "./chord-issue-field";
import { shouldIgnoreMusicTextKey } from "./music-text-interaction";
import { isEditorInputEnter } from "./editor-input-enter";
import {
  readMusicTextDraft,
  lyricDraftMappingDependency,
  normalizeMusicTextTarget,
  musicTextDraftValue,
  resolveSidebarRequest,
  type MusicTextTarget,
  type MusicTextDraft,
  type SidebarAction as DraftSidebarAction,
  type SidebarTab,
} from "./music-text-draft";
import {
  isScoreSelectionValid,
  type SelectionRequestResult,
} from "./editor-object-selection";
import styles from "./index.module.scss";
import {
  useEditorDraftRecords,
  useEditorRuntime,
} from "./EditorSessionRuntime";
import type { NumberedDraftGroup } from "./numbered-submission";
import { captureEditorVersion, sameEditorVersion, type EditorSessionVersion } from "./editor-session-version";
import type { EditorDraftRecord } from "./editor-draft-coordinator";
import type { FloatingAnchorRect } from "./music-text-floating-position";
import { useMusicTextFloatingPanel } from "./use-music-text-floating-panel";

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
  resolveNextLyricTarget,
} from "./music-text-target";

type LyricFocusSurface = "sidebar" | "popover";
type SidebarAction = DraftSidebarAction & {
  lyricFocusSurface?: LyricFocusSurface;
  settingsFocus?: boolean;
};

export interface MusicTextController {
  navigateTool: (destination: ToolNavigation) => SelectionRequestResult;
  /** 输出前只读检查草稿，不自动提交或取消用户输入。 */
  isOutputBlocked: (options?: { allowSettingsBusy?: boolean }) => boolean;
  isNumberedActionBlocked: () => boolean;
  isTransitionBlocked: () => boolean;
  canCollapse: () => boolean;
  restoreSidebarFocus: () => void;
  open: (target: MusicTextTarget) => void;
  select: (
    selection: ILXMTabCellSelection | null,
    techniqueId?: string,
  ) => SelectionRequestResult;
  returnToScore: () => SelectionRequestResult;
  dismissCleanPopover: () => boolean;
}

/** 页签与编辑目标分开；切换文字目标丢弃未应用输入，歌曲和小节设置仍保留离开保护。 */
export const MusicTextSidebar = ({
  ref,
  onOpen,
  onEditingChange,
  onPopoverHiddenChange,
  onNumberedActionBlockedChange,
  onTransitionBlockedChange,
  onTargetChange,
  onScoreFocus,
  onScoreSelection,
  getNumberedBeatEventIds,
  onToolAction,
  executeTool,
  getFloatingAnchor,
  getFloatingViewport,
  getFloatingObservedElements,
  collapsed = false,
  modal = false,
  onExpandSidebar = () => {},
  onLocate = () => {},
}: {
  modal?: boolean;
  ref: Ref<MusicTextController>;
  onToolAction?: ToolActionHandler;
  executeTool?: EditorCommandAdapter;
  onOpen: () => void;
  onEditingChange: (editing: boolean) => void;
  onPopoverHiddenChange: (hidden: boolean) => void;
  onNumberedActionBlockedChange: (blocked: boolean) => void;
  onTransitionBlockedChange?: (blocked: boolean) => void;
  onTargetChange: (target: MusicTextTarget | null) => void;
  onScoreFocus: () => void;
  onScoreSelection: (
    selection: ILXMTabCellSelection | null,
    techniqueId: string | null,
  ) => void;
  getNumberedBeatEventIds: (target: MusicTextTarget) => string[];
  getFloatingAnchor: (
    target: MusicTextTarget | null,
  ) => FloatingAnchorRect | null;
  getFloatingViewport: () => FloatingAnchorRect;
  getFloatingObservedElements?: () => readonly (Element | null)[];
  collapsed?: boolean;
  onExpandSidebar?: () => void;
  onLocate?: (location: SidebarLocation) => void;
}) => {
  const editorStore = useEditorSessionStore();
  const { modals } = useEditorRuntime();
  const activeModal = useSyncExternalStore(
    modals.subscribe,
    modals.getSnapshot,
    () => null,
  );
  const score = useEditorStore((s) => s.document);
  const selection = useEditorStore((s) => s.selection);
  const numberedSelection = useEditorStore((s) => s.numberedSelection);
  const selectedNumberedMarkId = useEditorStore(
    (s) => s.selectedNumberedMarkId,
  );
  const [kind, setKind] = useState<SidebarTab>("score");
  type PropertyTab = "selection" | "paragraph" | "chord" | "song";
  // 一级栏目只负责组织界面；真实业务目标仍由 kind 和现有草稿闸门维护。
  const [propertyTab, setPropertyTab] = useState<PropertyTab>("selection");
  const [selectionDetail, setSelectionDetail] =
    useState<"note" | "measure" | "tuplet">("note");
  const [detailTarget, setDetailTarget] = useState<MeasureToolTarget>();
  const [detailFocus, setDetailFocus] = useState(0);
  const [selectionToolsRequested, setSelectionToolsRequested] = useState(false);
  const detailRegion = useRef<HTMLDivElement>(null);
  const settingsFieldRequest = useRef<"label" | "copy" | null>(null);
  const boundaryFocusRequest = useRef(false);
  const measureDetailsRef = useRef<{ focusBoundary: () => boolean }>(null);
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
  const [numberedGroups, setNumberedGroups] = useState<
    readonly NumberedDraftGroup[]
  >([]);
  const [numberedBusy, setNumberedBusy] = useState(false);
  const navigationApplying = useRef(false);
  const [numberedCanApply, setNumberedCanApply] = useState(false);
  const [numberedDirty, setNumberedDirty] = useState(false);
  const [numberedInputActive, setNumberedInputActive] = useState(false);
  const paragraphKind = useRef<"lyric" | "numbered">("numbered");
  const settingsRef = useRef<ScoreSettingsController>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<ScoreSettingsStatus | null>(null);
  const [draft, setDraft] = useState<MusicTextDraft | null>(null);
  const [pending, setPending] = useState<SidebarAction | null>(null);
  const pendingVersion = useRef<EditorSessionVersion | null>(null);
  const ownerGeneration = useRef(0);
  const pendingGeneration = useRef(0);
  const activeTextOwner = useRef(true);
  const renderedGeneration = ownerGeneration.current;
  const [songHost, setSongHost] = useState<HTMLDivElement | null>(null);
  const [measureHost, setMeasureHost] = useState<HTMLDivElement | null>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const registerFrame = useCallback((node: HTMLElement | null) => {
    if (node) setPortalRoot(node.ownerDocument.body);
  }, []);
  const pendingAction = useRef(pending);
  useLayoutEffect(() => {
    pendingAction.current = pending;
  }, [pending]);
  const [message, setMessage] = useState<string | null>(null);
  const [textConflict, setTextConflict] = useState(false);
  const [chordPresetMenuOpen, setChordPresetMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sequenceInputRef = useRef<HTMLTextAreaElement>(null);
  const popoverInputRef = useRef<HTMLInputElement>(null);
  const popoverSequenceInputRef = useRef<HTMLTextAreaElement>(null);
  const lyricFocusSurface = useRef<LyricFocusSurface>("popover");
  const [popoverContainer, setPopoverContainer] = useState<HTMLDivElement | null>(null);
  const [inspection, setInspection] = useState(0);
  const [inputEditing, setInputEditing] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [surface, setSurface] = useState<"popover" | "sidebar">("popover");
  const [dismissed, setDismissed] = useState(false);
  const [compositionCooling, setCompositionCooling] = useState(false);
  const compositionCoolingRef = useRef(false);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfaceFocusGroup = useRef<NumberedDraftGroup | undefined>(undefined);
  const focusDestination = useRef<"score" | "input">("input");
  const lastPlacedTarget = useRef("");
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const lastInputFocus = useRef<HTMLElement | null>(null);
  const lastSidebarFocus = useRef<HTMLElement | null>(null);
  const draftRegistrationRef = useRef<{ invalidateOwner: () => void } | null>(null);
  const restoreInputFocus = useRef(false);
  const requestedTabFocus = useRef<string | null>(null);
  const composing = useRef(false);
  const compositionSurface = useRef<"sidebar" | "popover">("sidebar");
  const [compositionOrigin, setCompositionOrigin] = useState<"sidebar" | "popover">("sidebar");
  const [compositionActive, setCompositionActive] = useState(false);
  const compositionEndedAt = useRef(-Infinity);
  const baseline = useRef(score);
  const committing = useRef(false);
  const activeNumberedTargetKey = score
    ? (() => {
        const resolved = resolveNumberedEditorTarget(
          score,
          numberedTarget ?? selection?.focus ?? null,
        );
        return resolved ? numberedTargetKey(resolved) : null;
      })()
    : null;
  const textSession =
    activeObject?.kind === "lyric" || activeObject?.kind === "numbered" || activeObject?.kind === "chord";
  const floating = textSession && surface === "popover";
  const numberedActionBlocked =
    numberedDirty ||
    !!pending ||
    settingsDirty ||
    (!!draft && musicTextDraftValue(draft) !== draft.initial);
  useEffect(() => {
    onNumberedActionBlockedChange(numberedActionBlocked);
  }, [numberedActionBlocked, onNumberedActionBlockedChange]);
  const lyricSource = activeObject?.kind === "lyric" || activeObject?.kind === "numbered"
    ? activeObject : numberedTarget ?? (numberedSelection ? { ...numberedSelection, kind: "numbered" as const } : null);
  const lyricStart = lyricSource ? resolveParagraphInsertionTarget(score, lyricSource) : null;
  const numberedEntry = score ? resolveNumberedEditorTarget(score,
    numberedSelection ?? selection?.focus ?? null) : null;
  const target =
    draft?.target ??
    (kind === "lyric"
      ? lyricStart && { ...lyricStart, kind: "lyric" as const }
      : numberedSelection ? null : selection?.focus);
  const track = target
    ? score?.score.tracks.find((t) => t.id === target.trackId)
    : score?.score.tracks[0];
  const measure = track?.measures.find((m) => m.id === target?.measureId);
  const validTarget =
    target &&
    ("kind" in target && target.kind === "lyric"
      ? measure && resolveLyricPosition(measure, target)
      : measure?.beats.some((b) => b.id === target.beatId))
      ? target
      : null;
  /** 输出闸门只展示可解析位置；无法定位时保留 label，不猜测邻近小节。 */
  const draftLocation = (
    value:
      | {
          trackId: string;
          measureId: string;
          beatId?: string;
          eventId?: string;
          tick?: number;
          endTick?: number;
        }
      | null
      | undefined,
    prefix?: string,
  ) => {
    if (!score || !value) return prefix;
    const valueTrack = score.score.tracks.find(
      (item) => item.id === value.trackId,
    );
    const measureIndex =
      valueTrack?.measures.findIndex((item) => item.id === value.measureId) ??
      -1;
    if (!valueTrack || measureIndex < 0) return prefix;
    const beatIndex = value.beatId
      ? valueTrack.measures[measureIndex]!.beats.findIndex(
          (beat) => beat.id === value.beatId,
        )
      : -1;
    const eventIndex = value.eventId
      ? valueTrack.measures[measureIndex]!.numberedVoice.events.findIndex(
          (event) => event.id === value.eventId,
        )
      : -1;
    const valueMeasure = valueTrack.measures[measureIndex]!;
    const tick =
      eventIndex >= 0
        ? valueMeasure.numberedVoice.events[eventIndex]!.tick
        : value.tick;
    return [
      ...(prefix ? [prefix] : []),
      `第 ${measureIndex + 1} 小节`,
      ...(tick !== undefined
        ? [
            formatNumberedBeatPosition(
              tick,
              valueMeasure.timeSignature.denominator,
            ) +
              (value.endTick !== undefined
                ? `～${formatNumberedBeatPosition(value.endTick, valueMeasure.timeSignature.denominator)}`
                : ""),
          ]
        : []),
      ...(beatIndex >= 0 ? [`第 ${beatIndex + 1} 拍`] : []),
      ...(eventIndex >= 0 ? [`简谱位置 ${eventIndex + 1}`] : []),
    ].join(" · ");
  };
  const existing =
    draft?.target.kind === "lyric"
      ? measure?.lyrics.find(
          (l) =>
            l.eventId === draft.target.eventId &&
            l.verse === draft.target.verse,
        )
      : measure?.chordSymbols.find((c) => c.beatId === draft?.target.beatId);
  const floatingTitle = kind === "chord"
    ? existing ? "编辑和弦" : "添加和弦"
    : kind === "numbered"
      ? (numberedTarget?.eventId ? "修改简谱" : "连续录入")
      : `歌词 · 第 ${draft?.target.verse ?? 1} 段`;
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
      !textConflict && parsed?.ok && score && draft?.target.kind === "lyric"
        ? planLyricSequence(
            score,
            { ...draft.target, verse: draft.target.verse! },
            parsed.items,
            draft.allowOverwrite,
          )
        : null,
    [parsed, score, draft, textConflict],
  );
  const issue = draft && (!score || !normalizeMusicTextTarget(score, draft.target))
    ? "原编辑目标已失效，请重新选择。"
    : textConflict ? "歌词位置或原内容已变化，输入已保留，请恢复或修改输入后重新检查。" : draft
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
        ? sequence && inspected && draft.target.kind === "lyric"
          ? { kind: "lyric" as const, ...inspected }
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

  const surfaceDisabled = compositionActive || compositionCooling || !!pending ||
    numberedBusy || !!activeModal;
  const transitionBlocked = surfaceDisabled || !!settingsStatus?.busy || !!settingsStatus?.composing;
  useEffect(() => onTransitionBlockedChange?.(transitionBlocked), [transitionBlocked, onTransitionBlockedChange]);
  const surfaceBlocked = useCallback(() =>
    composing.current || compositionCoolingRef.current || compositionActive || compositionCooling ||
    !!pending || numberedBusy || !!activeModal || navigationApplying.current,
    [compositionActive, compositionCooling, pending, numberedBusy, activeModal]);
  const focusSidebar = useCallback((
    group?: NumberedDraftGroup,
  ): SelectionRequestResult => {
    if (!textSession || surfaceBlocked()) return "blocked";
    const generation = ownerGeneration.current;
    const source = (sequence ? popoverSequenceInputRef : popoverInputRef).current;
    const caret = source ? { start: source.selectionStart, end: source.selectionEnd, direction: source.selectionDirection } : null;
    onExpandSidebar();
    focusDestination.current = "input";
    requestAnimationFrame(() => {
      if (ownerGeneration.current !== generation) return;
      if (kind === "numbered") numberedRef.current?.focus(group ?? "content");
      else {
        lyricFocusSurface.current = "sidebar";
        const input = (sequence ? sequenceInputRef : inputRef).current;
        input?.focus({ preventScroll: true });
        if (caret && caret.start !== null && caret.end !== null && input) input.setSelectionRange(caret.start, caret.end, caret.direction ?? undefined);
      }
    });
    return "accepted";
  }, [textSession, surfaceBlocked, kind, sequence, onExpandSidebar]);
  const focusChordDiagramIssue = () => {
    if (focusSidebar() !== "accepted") return;
    const generation = ownerGeneration.current;
    requestAnimationFrame(() => {
      if (generation !== ownerGeneration.current) return;
      const region = document.querySelector<HTMLElement>("[data-chord-full-editor]");
      const diagram = draft?.chord.chord.diagram;
      const label = diagram ? chordIssueField(diagram) : null;
      const control = (label ? region?.querySelector<HTMLInputElement>(`[aria-label="${label}"]`) : null)
        ?? region?.querySelector<HTMLInputElement>('[aria-label$="弦品位"]');
      if (!control) return;
      let ancestor: HTMLElement | null = control.parentElement;
      while (ancestor && ancestor !== region) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      control.scrollIntoView({ block: "nearest" });
      control.focus({ preventScroll: true });
    });
  };
  const dismissCleanPopover = () => {
    if (!floating || surfaceBlocked() || numberedRef.current?.dirty ||
        (draft && musicTextDraftValue(draft) !== draft.initial)) return false;
    setDismissed(true);
    setInputEditing(false);
    setNumberedInputActive(false);
    focusDestination.current = "score";
    onScoreFocus();
    return true;
  };
  useEffect(() => () => {
    if (compositionTimer.current) clearTimeout(compositionTimer.current);
  }, []);

  const loadTarget = (
    next: MusicTextTarget,
    mode = draft?.lyricMode ?? "single",
    focus: "score" | "input" = "input",
    lyricSurface: LyricFocusSurface = "popover",
  ) => {
    activeTextOwner.current = true;
    lyricFocusSurface.current = lyricSurface;
    const value = readMusicTextDraft(
      editorStore.getState().document,
      next,
      mode,
      editorStore.getState().selection,
    );
    setInspection(0);
    setTextConflict(false);
    setPending(null);
    setMessage(value ? null : "目标拍已失效，请重新选择。");
    setDraft(value);
    setNumberedTarget(null);
    setActiveObject(value ? value.target : null);
    setKind(next.kind);
    setPropertyTab(next.kind === "chord" ? "chord" : "paragraph");
    if (next.kind === "lyric") {
      paragraphKind.current = "lyric";
    }
    baseline.current = editorStore.getState().document;
    if (value) {
      focusTarget(focus);
      onOpen();
      editorStore.getState().setSelectedTechniqueId(null);
      if (value.target.kind === "chord")
        editorStore
          .getState()
          .setSelection(createCollapsedTabCellSelection(value.target));
    }
  };
  /** 接受请求才改变选区和草稿；延迟确认的目标按最新快照验证。 */
  const perform = (action: SidebarAction): boolean => {
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
    ownerGeneration.current += 1;
    setChordPresetMenuOpen(false);
    activeTextOwner.current = false;
    draftRegistrationRef.current?.invalidateOwner();
    if (action.type === "target") {
      setDismissed(false);
      setSurface("popover");
    } else if (action.type !== "mode" && action.type !== "numberedMode") {
      setSurface("popover");
      setDismissed(false);
    }
    restoreInputFocus.current = false;
    // 非模式请求会结束原简谱草稿，但必须在确认已经被接受之后执行。
    if (action.type !== "mode") {
      numberedRef.current?.discard();
      setNumberedDirty(false);
      setNumberedInputActive(false);
      setNumberedPreview(null);
    }
    if (action.type === "tool") {
      setSelectionToolsRequested(true);
      setDraft(null);
      setNumberedTarget(null);
      setActiveObject(null);
      setInputEditing(false);
      setKind("score");
      setMessage(null);
      focusDestination.current = "score";
      setDetailTarget(action.target);
      boundaryFocusRequest.current = action.destination === "barline";
      if (action.destination === "section" || action.destination === "copy") {
        setPropertyTab("selection");
        setSelectionDetail("measure");
        settingsFieldRequest.current =
          action.destination === "section" ? "label" : "copy";
      } else {
        setPropertyTab("selection");
        setSelectionDetail(action.destination === "barline" ? "measure" : action.destination);
      }
      setDetailFocus((value) => value + 1);
      onExpandSidebar();
      onOpen();
    } else if (action.type === "selection" || action.type === "close") {
      setSelectionToolsRequested(false);
      setDetailTarget(undefined);
      const nextSelection =
        action.type === "selection"
          ? action.selection
          : activeObject?.kind === "chord"
            ? createCollapsedTabCellSelection(activeObject)
            : current.selection;
      settingsRef.current?.discard();
      // 选拍仅改变 TAB 选区；和弦输入须通过工具栏或已有和弦显式打开。
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
    } else if (action.type === "target") {
      setDetailTarget({ trackId: action.target.trackId, measureId: action.target.measureId });
      settingsRef.current?.discard();
      if (action.target.kind === "numbered") {
        activeTextOwner.current = true;
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
        loadTarget(action.target, draft?.lyricMode, action.focus, action.lyricFocusSurface);
      }
    } else if (action.type === "numberedMode") {
      activeTextOwner.current = true;
      setNumberedMode(action.mode);
    } else if (action.type === "mode") {
      if (draft) loadTarget(draft.target, action.mode, "input", action.lyricFocusSurface ?? lyricFocusSurface.current);
    } else {
      // 页签只展示工具，保留谱面对象；显式输入／编辑按钮才加载文字草稿。
      setDraft(null);
      setNumberedTarget(null);
      setActiveObject(null);
      setInputEditing(false);
      setMessage(null);
      focusDestination.current = "score";
      setKind(action.kind);
      if (action.kind === "numbered") paragraphKind.current = "numbered";
      if (action.kind === "lyric") {
        paragraphKind.current = "lyric";
      }
    }
    if (action.type === "tab" && action.propertyTab)
      setPropertyTab(action.propertyTab);
    return true;
  };
  /** 统一处理对象／页签切换；先校验目标和输入状态，再丢弃旧输入并迁移 selection。 */
  const request = (action: SidebarAction): SelectionRequestResult => {
    if (
      composing.current ||
      compositionCoolingRef.current ||
      compositionCooling ||
      activeModal ||
      settingsRef.current?.isComposing() ||
      settingsRef.current?.readStatus().busy ||
      numberedRef.current?.readStatus().busy ||
      pending ||
      numberedBusy ||
      navigationApplying.current
    )
      return "blocked";
    if (action.type === "target") {
      const normalized = normalizeMusicTextTarget(editorStore.getState().document, action.target);
      if (!normalized) { setMessage("目标已失效，请重新选择。"); return "blocked"; }
      action = { ...action, target: normalized };
    }
    if (action.type === "tool" && propertyTab === "selection") {
      const destination = action.destination === "barline" || action.destination === "section" || action.destination === "copy"
        ? "measure" : action.destination;
      const bound = settingsRef.current?.readStatus().measureId;
      const sameMeasure = !action.target || (action.target.measureId === (bound ?? detailTarget?.measureId ?? numberedSelection?.measureId ?? selection?.focus.measureId) &&
        action.target.trackId === (detailTarget?.trackId ?? numberedSelection?.trackId ?? selection?.focus.trackId));
      if (destination === selectionDetail && sameMeasure) {
        if (action.destination === "section" || action.destination === "copy") {
          settingsRef.current?.focusField(action.destination === "section" ? "label" : "copy");
        } else if (action.destination === "barline") measureDetailsRef.current?.focusBoundary();
        return "accepted";
      }
    }
    if (
      action.type === "target" &&
      action.target.kind === "numbered" &&
      numberedTarget?.kind === "numbered" &&
      score &&
      activeNumberedTargetKey
    ) {
      const next = resolveNumberedEditorTarget(score, action.target);
      // 谱面点击可能省略 itemId；归一后相同目标只恢复焦点。
      if (next && numberedTargetKey(next) === activeNumberedTargetKey) {
        setDismissed(false);
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
      (!action.propertyTab || action.propertyTab === propertyTab)
    )
      return "accepted";
    if (action.type === "numberedMode" && action.mode === numberedMode)
      return "accepted";
    const decision = resolveSidebarRequest(draft, action, {
      numberedTarget,
      numberedDirty: numberedRef.current?.dirty,
      settingsDirty: action.settingsFocus ? false : settingsRef.current?.isDirty(),
      visibleTaskChanged: action.type === "tab" && !!action.propertyTab && action.propertyTab !== propertyTab,
    });
    if (decision === "ignore" && action.type === "target") {
      setDismissed(false);
      setActiveObject(action.target);
      if (action.target.kind === "chord") {
        lyricFocusSurface.current = "popover";
        setSurface("popover");
      }
      if (action.target.kind === "numbered") {
        focusDestination.current = "input";
        setNumberedInputActive(true);
        setFocusRequest((value) => value + 1);
      } else focusTarget(action.focus ?? "input");
      return "accepted";
    }
    if (decision === "confirm") {
      onExpandSidebar();
      pendingVersion.current = captureEditorVersion(editorStore.getState());
      pendingGeneration.current = ownerGeneration.current;
      setPending(action);
      return "pending";
    }
    return decision === "ignore" || perform(action) ? "accepted" : "blocked";
  };
  const returnToScore = (): SelectionRequestResult =>
    request({ type: "close" });
  const cancelTextEditing = (): SelectionRequestResult => {
    if (surfaceBlocked()) return "blocked";
    return request({ type: "close" });
  };
  useImperativeHandle(ref, () => ({
    restoreSidebarFocus: () => {
      // 窄屏气泡回退到侧栏时延续原输入意图，不能由抽屉默认焦点抢到关闭按钮。
      if (textSession && focusDestination.current === "input") {
        if (kind === "numbered") { numberedRef.current?.focus(); return; }
        const input = (sequence ? sequenceInputRef : inputRef).current;
        if (input?.isConnected && !input.closest("[hidden],[inert]")) {
          input.focus({ preventScroll: true });
          return;
        }
      }
      const previous = lastSidebarFocus.current;
      if (previous?.isConnected && !previous.closest("[hidden], [inert]")) previous.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('#music-text-sidebar [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    },
    canCollapse: () => !pending && !activeModal && !numberedBusy && !numberedRef.current?.readStatus().busy && !settingsRef.current?.readStatus().busy && !settingsRef.current?.isComposing() &&
      (!(composing.current || compositionCoolingRef.current) || (kind !== "chord" && compositionSurface.current === "popover")),
    isTransitionBlocked: () => surfaceBlocked() || !!settingsRef.current?.isComposing() || !!settingsRef.current?.readStatus().busy || !!numberedRef.current?.readStatus().busy,
    isOutputBlocked: (options) =>
      surfaceBlocked() ||
      !!settingsRef.current?.isComposing() ||
      (!options?.allowSettingsBusy && !!settingsRef.current?.readStatus().busy) ||
      !!numberedRef.current?.readStatus().busy ||
      !!pending ||
      (activeTextOwner.current && renderedGeneration === ownerGeneration.current && !!numberedRef.current?.dirty) ||
      !!settingsRef.current?.isDirty() ||
      (activeTextOwner.current && renderedGeneration === ownerGeneration.current && !!draft && musicTextDraftValue(draft) !== draft.initial),
    isNumberedActionBlocked: () =>
      surfaceBlocked() ||
      !!settingsRef.current?.isComposing() ||
      !!settingsRef.current?.readStatus().busy ||
      !!numberedRef.current?.readStatus().busy ||
      !!pending ||
      (activeTextOwner.current && renderedGeneration === ownerGeneration.current && !!numberedRef.current?.dirty) ||
      !!settingsRef.current?.isDirty() ||
      (activeTextOwner.current && renderedGeneration === ownerGeneration.current && !!draft && musicTextDraftValue(draft) !== draft.initial),
    open: (next) => {
      request({ type: "target", target: next });
    },
    select: (next, techniqueId) =>
      request({ type: "selection", selection: next, techniqueId }),
    returnToScore,
    dismissCleanPopover,
    navigateTool: (destination) => {
      const current = editorStore.getState();
      const source = activeObject ?? detailTarget ?? current.numberedSelection ?? current.selection?.focus;
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
    if (boundaryFocusRequest.current) {
      if (measureDetailsRef.current?.focusBoundary()) boundaryFocusRequest.current = false;
    } else if (settingsFieldRequest.current) {
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

  // 同会话外部变化保留当前原文；目标失效时撤下候选，不寻找邻近对象。
  useEffect(
    () =>
      editorStore.subscribe((state) => {
        if (state.document !== baseline.current && !committing.current) {
          const previousDocument = baseline.current;
          setPending(null);
          setNumberedPreview(null);
          setDraft((previous) => {
            if (!previous) return previous;
            const fresh = readMusicTextDraft(state.document, previous.target, previous.lyricMode);
            if (!fresh) { setMessage("原编辑目标已失效，当前原文仅供查看，请重新选择。"); return previous; }
            if (musicTextDraftValue(previous) === previous.initial) return fresh;
            if (fresh.initial !== previous.initial ||
              lyricDraftMappingDependency(previousDocument, previous) !== lyricDraftMappingDependency(state.document, previous)) {
              setTextConflict(true);
              setInspection(0);
            }
            return previous;
          });
          baseline.current = state.document;
        }
      }),
    [editorStore],
  );
  const targetKey = draft
    ? `${draft.target.trackId}/${draft.target.measureId}/${draft.target.kind === "lyric" ? (draft.target.eventId ?? `${draft.target.tick}-${draft.target.endTick}`) : draft.target.beatId}/${kind}/${draft.target.verse}`
    : numberedTarget
      ? `${numberedTarget.trackId}/${numberedTarget.measureId}/${numberedTarget.eventId ?? `${numberedTarget.tick}-${numberedTarget.endTick}`}/${numberedTarget.itemId ?? ""}/numbered`
      : "";
  const {
    ref: floatingPanelRef,
    geometry,
  } = useMusicTextFloatingPanel({
    open: floating && !dismissed,
    allowNarrowing: kind !== "chord",
    targetKey,
    freeze: compositionActive || compositionCooling || !!pending || numberedBusy,
    getAnchor: useCallback(
      () => getFloatingAnchor(activeObject),
      [getFloatingAnchor, activeObject],
    ),
    getViewport: getFloatingViewport,
    getObservedElements: getFloatingObservedElements,
    layoutKey: getFloatingAnchor,
  });
  const popoverHidden = floating && (dismissed || geometry.kind !== "placed");
  useEffect(() => onPopoverHiddenChange(popoverHidden), [popoverHidden, onPopoverHiddenChange]);
  // 隐藏的干净气泡释放谱面操作；未提交草稿继续走原有阻断链。
  const editing =
    (!!activeObject && !popoverHidden) ||
    settingsDirty ||
    numberedDirty ||
    numberedInputActive ||
    !!pending ||
    compositionActive || compositionCooling ||
    (!!draft && (inputEditing || musicTextDraftValue(draft) !== draft.initial));
  useEffect(() => onEditingChange(editing), [editing, onEditingChange]);
  useEffect(() => {
    if (!floating || dismissed || surfaceBlocked()) return;
    if (geometry.kind === "placed") {
      lastPlacedTarget.current = targetKey;
      return;
    }
    // 首次布局还未完成时保留用户的输入意图；已有锚点丢失才释放焦点。
    if (geometry.kind === "hidden" && geometry.reason === "layout-pending" &&
        lastPlacedTarget.current !== targetKey) return;
    const frame = requestAnimationFrame(() => {
      if (surfaceBlocked()) return;
      if (geometry.kind === "sidebar-required") {
        // 完整侧栏一直可用；保留定位监听，让空间恢复后气泡自动重现。
        if (document.activeElement === document.body ||
            floatingPanelRef.current?.contains(document.activeElement)) focusSidebar();
      } else if (geometry.kind === "hidden") {
        // inert 可能已让浏览器将隐藏输入的焦点退回 body。
        if (document.activeElement === document.body ||
            floatingPanelRef.current?.contains(document.activeElement)) {
          setInputEditing(false);
          setNumberedInputActive(false);
          focusDestination.current = "score";
          onScoreFocus();
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [floating, dismissed, geometry, targetKey, surfaceBlocked, floatingPanelRef, onScoreFocus, focusSidebar]);
  const floatingLocation = (draftLocation(activeObject, "") ?? "请选择编辑位置")
    .split(" · ").filter((part) => !part.startsWith("简谱位置")).join(" · ");
  const numberedEvent = activeObject?.kind === "numbered" && activeObject.eventId
    ? score?.score.tracks.find((track) => track.id === activeObject.trackId)
      ?.measures.find((measure) => measure.id === activeObject.measureId)
      ?.numberedVoice.events.find((event) => event.id === activeObject.eventId)
    : null;
  const numberedBeatEventIds = activeObject?.kind === "numbered"
    ? getNumberedBeatEventIds(activeObject)
    : [];
  const numberedBeatIndex = numberedEvent ? numberedBeatEventIds.indexOf(numberedEvent.id) : -1;
  const navigateNumberedBeat = (offset: -1 | 1) => {
    if (!activeObject || numberedBeatIndex < 0 || surfaceBlocked()) return;
    const eventId = numberedBeatEventIds[numberedBeatIndex + offset];
    const event = score?.score.tracks.find((track) => track.id === activeObject.trackId)
      ?.measures.find((measure) => measure.id === activeObject.measureId)
      ?.numberedVoice.events.find((event) => event.id === eventId);
    if (event) request({ type: "target", target: {
      kind: "numbered", trackId: activeObject.trackId,
      measureId: activeObject.measureId, eventId: event.id, itemId: event.items[0]?.id,
    } });
  };
  const nextLyricTarget =
    draft?.target.kind === "lyric" && score
      ? resolveNextLyricTarget(score, draft.target)
      : null;
  const lyricDirty = !!draft && musicTextDraftValue(draft) !== draft.initial;
  /** 取消待切换时恢复原控件，不把设置字段或 checkbox 的焦点统一抢到文字框。 */
  const continueEditing = () => {
    restoreInputFocus.current = true;
    setPending(null);
  };
  // 只在明确激活或确认区退出时聚焦；页签浏览和预览更新不能抢输入焦点。
  useEffect(() => {
    if (pending) confirmRef.current?.focus({ preventScroll: true });
    else if (activeModal) return;
    else if (restoreInputFocus.current && lastInputFocus.current?.isConnected &&
        !lastInputFocus.current.closest("[hidden], [inert]")) {
      restoreInputFocus.current = false;
      lastInputFocus.current.focus({ preventScroll: true });
    } else if (focusDestination.current === "input" && targetKey) {
      if (kind === "numbered") {
        if (floating && !surfaceFocusGroup.current) {
          if (popoverHidden) return;
          numberedRef.current?.focusPopover();
        }
        else numberedRef.current?.focus(surfaceFocusGroup.current);
      } else {
        const focusPopover = floating && lyricFocusSurface.current === "popover";
        if (focusPopover && popoverHidden) return;
        (focusPopover
          ? sequence ? popoverSequenceInputRef : popoverInputRef
          : sequence ? sequenceInputRef : inputRef).current?.focus({
          preventScroll: true,
        });
      }
      surfaceFocusGroup.current = undefined;
    }
  }, [
    pending,
    targetKey,
    sequence,
    focusRequest,
    kind,
    numberedMode,
    surface,
    floating,
    popoverHidden,
    activeModal,
    popoverContainer,
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

  const applyNumbered = async (isCurrent = () => true, advance = true) => {
    const owner = numberedRef.current;
    if (!owner || composing.current || compositionCoolingRef.current) return "blocked" as const;
    const result = await owner.apply(isCurrent, { advance });
    if (result.status === "applied" || result.status === "noop") {
      setNumberedInputActive(false);
      return "applied" as const;
    }
    return result.status === "stale"
      ? ("stale" as const)
      : ("blocked" as const);
  };
  const applyAndNavigate = async () => {
    const action = pending;
    if (!action || navigationApplying.current || !pendingVersion.current ||
        pendingGeneration.current !== ownerGeneration.current ||
        !sameEditorVersion(editorStore.getState(), pendingVersion.current)) {
      setPending(null);
      setMessage("文档已变化，请重新发起导航。");
      return;
    }
    navigationApplying.current = true;
    const session = captureEditorVersion(editorStore.getState());
    const isCurrent = () => {
      const current = editorStore.getState();
      return sameEditorVersion(current, pendingVersion.current ?? session) &&
        pendingGeneration.current === ownerGeneration.current &&
        pendingAction.current === action;
    };
    try {
      const result =
        settingsRef.current?.isDirty()
          ? settingsRef.current.apply() ? "applied" : "blocked"
          : kind === "numbered"
          ? await applyNumbered(isCurrent, false)
          : kind === "score"
            ? settingsRef.current?.apply() ? "applied" : "blocked"
            : apply() ? "applied" : "blocked";
      if (result === "applied" && isCurrent())
        perform(action);
      else if (result !== "stale" && isCurrent()) {
        setFocusRequest((value) => value + 1);
      }
    } finally {
      navigationApplying.current = false;
    }
  };
  /** 提交标记在异常、失败及 no-op 时也释放；失败保留当前草稿。 */
  const commit = (command: ILXMScoreCommand) => {
    if (composing.current || compositionCoolingRef.current || compositionCooling) return null;
    committing.current = true;
    try {
      const result = editorStore.getState().execute(command);
      if (result?.ok) {
        baseline.current = result.document;
        if (navigationApplying.current) pendingVersion.current = captureEditorVersion(editorStore.getState());
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
    if (!draft || issue || committing.current || composing.current || compositionCoolingRef.current || compositionCooling) return false;
    if (draft.target.kind === "lyric" &&
      lyricDraftMappingDependency(score, draft) !== lyricDraftMappingDependency(editorStore.getState().document, draft)) {
      setTextConflict(true);
      setInspection(0);
      setMessage("歌词位置或原内容已变化，输入已保留，请重新检查。");
      return false;
    }
    if (draft.target.kind === "chord" && musicTextDraftValue(draft) === draft.initial) return true;
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
            display: draft.chord.display,
          },
    );
    if (!result?.ok) return false;
    const saved = readMusicTextDraft(result.document, target, draft.lyricMode);
    // 首次填词可能创建 gap：编辑身份和锚点一起采用返回文档中的真实事件。
    if (target.kind === "lyric" && saved) setActiveObject(saved.target);
    if (sequence) {
      setDraft({
        ...draft,
        target: saved?.target ?? target,
        initial: musicTextDraftValue(draft),
      });
    } else setDraft(saved);
    setMessage(result.changed ? "已应用" : "内容未变化");
    if (advance && target.kind === "lyric" && !sequence) {
      const next = resolveNextLyricTarget(
        result.document,
        saved?.target.kind === "lyric" ? saved.target : target,
      );
      if (next) loadTarget(next);
      else setMessage("已应用，已到最后一个歌词位置。");
    }
    return true;
  };
  const applyLyricPrimary = (advance = true) => {
    if (surfaceBlocked() || !draft || draft.target.kind !== "lyric") return false;
    if (!lyricDirty) {
      if (advance && !sequence && nextLyricTarget)
        return request({ type: "target", target: nextLyricTarget }) === "accepted";
      return false;
    }
    return apply(advance && !sequence);
  };
  const remove = () => {
    if (!draft || !existing || composing.current || compositionCoolingRef.current) return;
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
  // 只登记当前未应用输入，供输出和文档切换检查。
  const draftRegistration = useEditorDraftRecords(() => {
    const records: EditorDraftRecord[] = [];
    const version = captureEditorVersion(editorStore.getState());
    if (
      activeTextOwner.current && draft &&
      (musicTextDraftValue(draft) !== draft.initial ||
        (compositionActive && kind !== "score"))
    ) {
      records.push({
        id: `music:${targetKey}`,
        kind: draft.target.kind,
        targetKey,
        label: draft.target.kind === "lyric" ? "歌词输入" : "和弦编辑",
        location: draftLocation(draft.target),
        dirty: musicTextDraftValue(draft) !== draft.initial,
        composing: compositionActive,
        canApply: !issue && !pending,
        error: issue,
        version,
        inputKey: musicTextDraftValue(draft),
        focus: () => {
          onExpandSidebar();
          setPropertyTab(draft.target.kind === "chord" ? "chord" : "paragraph");
          if (draft.target.kind === "lyric") {
            setSurface("sidebar");
            setDismissed(false);
          }
          focusTarget("input");
          return true;
        },
        apply: ({ isCurrent }) =>
          isCurrent() ? (apply() ? "applied" : "blocked") : "stale",
        discard: () => {
          if (composing.current || compositionCoolingRef.current || pending) return false;
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
      activeTextOwner.current && activeNumberedTargetKey &&
      (numberedDirty ||
        (compositionActive && kind === "numbered"))
    ) {
      records.push({
        id: `numbered:${activeNumberedTargetKey}`,
        kind: "numbered",
        targetKey: activeNumberedTargetKey,
        label: "当前简谱输入",
        location: draftLocation(numberedTarget ?? selection?.focus),
        dirty: numberedDirty,
        composing: compositionActive,
        canApply: numberedCanApply && !pending,
        error: null,
        version,
        inputKey: JSON.stringify(numberedRef.current?.snapshot()),
        focus: () => {
          onExpandSidebar();
          setPropertyTab("paragraph");
          setKind("numbered");
          setSurface("sidebar");
          setDismissed(false);
          focusDestination.current = "input";
          setFocusRequest((value) => value + 1);
          return !!numberedRef.current;
        },
        apply: ({ isCurrent }) =>
          isCurrent() ? applyNumbered(isCurrent) : "stale",
        discard: () => {
          if (composing.current || compositionCoolingRef.current || pending) return false;
          numberedRef.current?.discard();
          return true;
        },
      });
    }
    return records;
  });
  useLayoutEffect(() => { draftRegistrationRef.current = draftRegistration; }, [draftRegistration]);
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
  const changeLyricMode = (mode: MusicTextDraft["lyricMode"], focusSurface: LyricFocusSurface) => {
    lyricFocusSurface.current = focusSurface;
    return request({ type: "mode", mode, lyricFocusSurface: focusSurface });
  };
  const changeLyricVerse = (verse: ILXMLyricVerse, focusSurface: LyricFocusSurface) => {
    if (!draft) return;
    lyricFocusSurface.current = focusSurface;
    return request({ type: "target", target: { ...draft.target, verse }, lyricFocusSurface: focusSurface });
  };
  const lyricFormProps = draft && {
    document: score ?? undefined,
    draft,
    plan,
    issue,
    inspection,
    nextLocation: nextLyricTarget ? draftLocation(nextLyricTarget) : undefined,
    existingText: existing && "text" in existing ? existing.text : undefined,
    onTextChange: (text: string) => {
      if (text !== draft.text) setTextConflict(false);
      setDraft({ ...draft, text });
      setInspection(0);
      setMessage(null);
    },
    onOverwriteChange: (allowOverwrite: boolean) => setDraft({ ...draft, allowOverwrite }),
    onInspect: (index: number) => {
      setInspection(index);
      const target = plan?.rows[index]?.target;
      if (!target) return;
      const measure = score?.score.tracks.find((track) => track.id === target.trackId)?.measures.find((measure) => measure.id === target.measureId);
      const position = measure && resolveLyricPosition(measure, target);
      if (position) onLocate({ kind: "lyric", verse: target.verse, trackId: target.trackId, measureId: target.measureId, eventId: position.eventId, startTick: position.tick, endTick: position.endTick });
    },
  };
  const context = deriveSidebarContext({ document: score, target: activeObject,
    task: propertyTab === "selection" ? selectionDetail : undefined,
    selection, numberedSelection, song: propertyTab === "song",
    measureTarget: propertyTab === "selection" && selectionDetail === "measure"
      ? { trackId: detailTarget?.trackId ?? numberedSelection?.trackId ?? selection?.focus.trackId ?? "", measureId: settingsStatus?.measureId ?? detailTarget?.measureId ?? numberedSelection?.measureId ?? selection?.focus.measureId ?? "" } : undefined });
  const hasExplicitSelection = numberedSelection
    ? !!score && !!resolveNumberedEditorTarget(score, numberedSelection)
    : !!selection && isScoreSelectionValid(score, selection);
  const showSelectionInvitation = !hasExplicitSelection && !selectionToolsRequested;
  return (
    <ConfigProvider
      getPopupContainer={(trigger) => trigger?.closest<HTMLElement>("#music-text-sidebar,[data-editor-associated-panel]") ?? globalThis.document.body}
      theme={{
        components: {
          Select: { zIndexPopup: 60 },
          Tooltip: { zIndexPopup: 70 },
          Popover: { zIndexPopup: 70 },
        },
      }}
    >
      <SidebarFrame
        ref={registerFrame}
        collapsed={collapsed}
        id="music-text-sidebar"
        className={styles.musicTextSidebar}
        aria-label="编辑器属性"
        role={modal ? "dialog" : undefined}
        aria-modal={modal || undefined}
        aria-owns={modal && floating && !popoverHidden ? (kind === "chord" ? "chord-edit-popover" : "music-text-edit-popover") : undefined}
        tabIndex={modal ? -1 : undefined}
        inert={!!activeModal}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
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
              if (
                request({ type: "tab", kind: nextKind, propertyTab: next }) ===
                "accepted"
              )
                setPropertyTab(next);
            }}
            items={
              [
                {
                  key: "selection",
                  icon: <SidebarTaskIcon task="selection" />,
                  label: "选区",
                  children: null,
                },
                {
                  key: "paragraph",
                  icon: <SidebarTaskIcon task="paragraph" />,
                  label: "简谱与歌词",
                  children: null,
                },
                {
                  key: "chord",
                  icon: <SidebarTaskIcon task="chord" />,
                  label: "和弦",
                  children: null,
                },
                {
                  key: "song",
                  icon: <SidebarTaskIcon task="song" />,
                  label: "歌曲",
                  children: null,
                },
              ] satisfies TabsProps["items"]
            }
            size="small"
            tabBarGutter={12}
            animated={false}
          />
        </header>
        <SidebarObjectContext context={context} onLocate={onLocate}
          onCurrentSelection={() => numberedSelection
            ? request({ type: "target", target: { ...numberedSelection, kind: "numbered" } })
            : request({ type: "selection", selection })} />
        <section
        key="music-text-editor-surface"
        className={styles.musicTextSurface}
        aria-label={textSession ? floatingTitle : "属性内容"}
        data-text-surface={textSession ? "sidebar" : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
        onCompositionStart={(event) => {
          compositionSurface.current = (event.target as HTMLElement).closest('[data-text-surface="popover"]') ? "popover" : "sidebar";
          setCompositionOrigin(compositionSurface.current);
          if (compositionTimer.current) clearTimeout(compositionTimer.current);
          compositionCoolingRef.current = false;
          setCompositionCooling(false);
          composing.current = true;
          setCompositionActive(true);
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          setCompositionActive(false);
          compositionEndedAt.current = e.timeStamp;
          compositionCoolingRef.current = true;
          setCompositionCooling(true);
          compositionTimer.current = setTimeout(() => {
            compositionCoolingRef.current = false;
            setCompositionCooling(false);
          }, 60);
        }}
        onPasteCapture={(e) => {
          if (
              (e.target === inputRef.current || e.target === popoverInputRef.current) &&
            /[\r\n\u2028\u2029]/u.test(e.clipboardData.getData("text"))
          ) {
            e.preventDefault();
            setMessage("请粘贴单行文本。");
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && chordPresetMenuOpen) {
            e.preventDefault();
            setChordPresetMenuOpen(false);
            document.querySelector<HTMLButtonElement>('[data-chord-full-editor] button[aria-label="其他常用和弦预设"]')?.focus({ preventScroll: true });
            return;
          }
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
            if (textSession) cancelTextEditing();
            else returnToScore();
            return;
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (e.repeat || e.altKey) return;
            if (kind === "numbered") numberedRef.current?.applyContent();
            else apply();
            return;
          }
          if (
            e.key === "Enter" &&
            !e.altKey &&
            (e.target === inputRef.current || e.target === popoverInputRef.current ||
              e.target === sequenceInputRef.current || e.target === popoverSequenceInputRef.current) &&
            draft?.target.kind === "lyric"
          ) {
            e.preventDefault();
            if (!e.repeat) applyLyricPrimary(!e.shiftKey);
            return;
          }
          if (kind === "chord" && draft?.target.kind === "chord" && isEditorInputEnter(e)) {
            e.preventDefault();
            if (!e.repeat) apply();
          }
        }}
      >
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
              { lastInputFocus.current = event.target; lastSidebarFocus.current = event.target; }
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
              <div ref={setSongHost} />
              <ScoreSettings
                ref={settingsRef}
                document={score}
                requestedMeasureId={detailTarget?.measureId ?? selection?.focus.measureId}
                songHost={songHost}
                measureHost={measureHost}
                actionsHost={actionsHost}
                activeSurface={propertyTab === "song" ? "song" : propertyTab === "selection" && selectionDetail === "measure" ? "measure" : null}
                onDirty={setSettingsDirty}
                onStatus={setSettingsStatus}
                commit={commit}
                executeTool={executeTool}
                onFocusRequest={(group) => {
                  const local = group === "label" || group === "copy";
                  const nextTab = local ? "selection" : "song";
                  if (request({ type: "tab", kind: "score", propertyTab: nextTab, settingsFocus: true }) !== "accepted") return false;
                  onExpandSidebar();
                  setPropertyTab(nextTab);
                  if (local) setSelectionDetail("measure");
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
            {showSelectionInvitation ? (
              <div className={styles.sidebarEmpty}>
                <div className={styles.emptyIllustration} aria-hidden="true"><svg viewBox="0 0 110 70"><path d="M8 18h94M8 28h94M8 38h94M8 48h94M8 58h94" /><rect x="36" y="12" width="28" height="51" rx="5" /><path d="M50 28v20m-10-10h20" /></svg></div>
                <h3>从谱面上的一个位置开始</h3>
                <p>点击音符、简谱、歌词或和弦，这里会显示对应的编辑内容。</p>
                <Button block onClick={onScoreFocus}>前往谱面选择</Button>
                <Button block onClick={() => request({ type: "tab", kind: "numbered", propertyTab: "paragraph" })}>浏览简谱与歌词</Button>
                <Button block onClick={() => request({ type: "tab", kind: "score", propertyTab: "song" })}>查看歌曲设置</Button>
                {score && onToolAction && executeTool && <Button type="link" onClick={() => request({ type: "tool", kind: "score", destination: "measure", sessionId: editorStore.getState().sessionId, sessionVersion: editorStore.getState().sessionVersion })}>浏览小节工具</Button>}
              </div>
            ) : score && onToolAction && executeTool ? (
              <>
                <Segmented className={styles.selectionTaskTabs} block aria-label="选区任务" value={selectionDetail}
                  options={[{value:"note",label:"音符"},{value:"measure",label:"小节"},{value:"tuplet",label:"连音"}]}
                  onChange={(destination) => {
                    const state = editorStore.getState();
                    request({ type: "tool", kind: "score", destination: destination as ToolNavigation,
                      target: detailTarget ?? numberedSelection ?? (selection?.focus ? { trackId: selection.focus.trackId, measureId: selection.focus.measureId } : undefined),
                      sessionId: state.sessionId, sessionVersion: state.sessionVersion });
                  }} />
                <div
                  data-selection-detail="note"
                  hidden={selectionDetail !== "note"}
                >
                  <NoteToolDetails
                    numberedTarget={numberedSelection ? numberedSelection.kind === "numberedEvent"
                      ? { kind:"numbered", trackId:numberedSelection.trackId, measureId:numberedSelection.measureId, eventId:numberedSelection.eventId, itemId:numberedSelection.itemId }
                      : { kind:"numbered", trackId:numberedSelection.trackId, measureId:numberedSelection.measureId, tick:numberedSelection.tick, endTick:numberedSelection.endTick } : null}
                    onEdit={(target) => request({ type:"target", target })}
                    document={score}
                    selection={selection}
                    blocked={editing}
                    onAction={onToolAction}
                  />
                </div>
                <div
                  data-selection-detail="measure"
                  hidden={selectionDetail !== "measure"}
                >
                  <MeasureToolDetails
                    ref={measureDetailsRef}
                    document={score}
                    selection={selection}
                    target={detailTarget}
                    measureHost={setMeasureHost}
                    blocked={editing}
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
                    numberedSelection={numberedSelection}
                    onEditNumberedRhythm={(target) => {
                      if (request({ type: "target", target }) === "accepted") {
                        surfaceFocusGroup.current = "rhythm";
                        onExpandSidebar();
                        requestAnimationFrame(() => numberedRef.current?.focus("rhythm"));
                      }
                    }}
                    blocked={editing}
                    execute={executeTool}
                  />
                </div>
              </>
            ) : (
              propertyTab === "selection" && (
                <section
                  className={styles.selectionPanel}
                  aria-label="当前选区"
                >
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
                    </>
                  )}
                </section>
              )
            )}
          </div>
          {propertyTab === "paragraph" && (
            <Segmented
              block
              aria-label="简谱或歌词"
              data-editor-paragraph-switch
              className={styles.paragraphTabs}
              value={kind === "numbered" ? "numbered" : "lyric"}
              options={(["numbered", "lyric"] as const).map((tab) => ({
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
                         ? "numbered"
                         : event.key === "End"
                           ? "lyric"
                          : kind === "lyric"
                            ? "numbered"
                            : "lyric",
                  });
                }
              }}
            />
          )}
          {propertyTab === "paragraph" && kind === "numbered" && !textSession && (
            <div className={styles.sidebarEmpty}>
              <div className={styles.emptyIllustration} aria-hidden="true"><svg viewBox="0 0 110 70"><path d="M8 18h94M8 28h94M8 38h94M8 48h94M8 58h94" /><rect x="36" y="12" width="28" height="51" rx="5" /><path d="M50 28v20m-10-10h20" /></svg></div>
              <h3>{numberedEntry ? "从当前谱面位置开始" : "先选择简谱位置"}</h3>
              <p>{numberedEntry ? "在编辑面板录入简谱，查看节拍映射并分别应用修改。" : "点击谱面上的简谱音符或空白位置，即可在这里编辑。"}</p>
              {numberedEntry && <Button type="primary" onClick={() => {
                if (request({ type: "target", target: { ...numberedEntry, kind: "numbered" } }) === "accepted") {
                  onExpandSidebar();
                  surfaceFocusGroup.current = "content";
                }
              }}>在当前位置录入简谱</Button>}
              <p className={styles.emptyHelp}>空格分隔先后音，+ 表示同时发声；应用后才写入曲谱。</p>
            </div>
          )}
          {propertyTab === "paragraph" &&
            kind === "numbered" &&
            score &&
            activeObject?.kind === "numbered" && (
              <div
                id="paragraph-fields"
                role="tabpanel"
                aria-labelledby="paragraph-tab-numbered"
              >
                 <NumberedEditor
                   onInspectPosition={onLocate}
                   onRequestTarget={(target) => request({ type: "target", target })}
                  popoverContainer={floating ? popoverContainer : null}
                  onRequestSidebar={focusSidebar}
                  // 不再把 stateVersion 放进 key：自身提交后保持同一输入 owner，避免其他分组被重挂载清空。
                   key={`${numberedMode}/${numberedTarget ? JSON.stringify(numberedTarget) : ""}`}
                   actionsHost={propertyTab === "paragraph" && kind === "numbered" ? actionsHost : null}
                  onBusyChange={setNumberedBusy}
                  onGroupsChange={setNumberedGroups}
                  onCancel={cancelTextEditing}
                  mode={numberedMode}
                  onModeChange={(mode) =>
                    request({ type: "numberedMode", mode })
                  }
                  ref={numberedRef}
                  getClipboard={() =>
                    editorStore.getState().getNumberedClipboard()
                  }
                  copyRange={(range) =>
                    editorStore.getState().copyNumberedRange(range)
                  }
                  document={score}
                  selectedMarkId={selectedNumberedMarkId}
                  target={numberedTarget ?? selection?.focus ?? null}
                  selection={selection}
                  onSelectTarget={(next) =>
                    request({
                      type: "target",
                      target: next,
                    })
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
                        target: { ...next, kind: "numbered", verse: undefined },
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
                {!draft ? (
                  <div className={styles.sidebarEmpty}>
                    {kind === "lyric" ? (
                      <FileTextOutlined style={{ fontSize: 36 }} />
                    ) : (
                      <CustomerServiceOutlined style={{ fontSize: 36 }} />
                    )}
                    <h3>{kind === "lyric" ? "先选择歌词位置" : "先选择 TAB 拍点"}</h3>
                    <p>
                      {kind === "lyric"
                        ? "歌词跟随简谱。选择可填写歌词的简谱音符或空白位置，在这里编辑第 1–4 段。"
                        : "点击六线谱中的拍点，在这里设置和弦名称与指法。"}
                    </p>
                    <Button
                      ref={editButtonRef}
                      disabled={kind === "lyric" ? !lyricStart : !validTarget}
                      type="primary"
                      onClick={() => {
                        if (kind === "lyric") {
                          if (lyricStart)
                            request({
                              type: "target",
                              lyricFocusSurface: "sidebar",
                              target: {
                                ...lyricStart,
                                kind: "lyric",
                                verse: 1,
                              },
                            });
                        } else if (!numberedSelection && selection?.focus)
                          request({
                            type: "target",
                            target: { ...selection.focus, kind: "chord" },
                          });
                      }}
                    >
                      {kind === "lyric" ? "为当前简谱填写歌词" : "编辑当前拍和弦"}
                    </Button>
                    {kind === "lyric" && <Button type="link" onClick={() => request({ type: "tab", kind: "numbered", propertyTab: "paragraph" })}>返回简谱</Button>}
                  </div>
                ) : kind === "lyric" ? (
                  <LyricFormView
                    {...lyricFormProps!}
                    onModeChange={(mode) => changeLyricMode(mode, "sidebar")}
                    onVerseChange={(verse) => changeLyricVerse(verse, "sidebar")}
                    inputRef={(element) => { inputRef.current = element; }}
                    sequenceInputRef={(element) => { sequenceInputRef.current = element; }}
                  />
                 ) : (
                  <div data-chord-full-editor inert={(compositionActive || compositionCooling) && compositionOrigin === "popover"}>
                  <ChordEditor
                    disabled={surfaceDisabled}
                    presetMenuOpen={chordPresetMenuOpen}
                    onPresetMenuOpenChange={setChordPresetMenuOpen}
                    inputRef={(element) => {
                      inputRef.current = element;
                    }}
                    draft={draft.chord}
                    onChange={(chord) => {
                      if (JSON.stringify(chord) !== JSON.stringify(draft.chord)) setTextConflict(false);
                      setDraft({ ...draft, chord });
                      setMessage(null);
                    }}
                    presetsEnabled={
                      !!track &&
                      JSON.stringify(
                        track.tuning.strings.map((s) => s.pitch),
                      ) === JSON.stringify(["E4", "B3", "G3", "D3", "A2", "E2"])
                    }
                  />
                  </div>
                )}
                {draft && <details className={`${styles.sidebarDisclosure} ${kind === "lyric" ? styles.lyricRemoval : ""}`}>
                  <summary>移除{kind === "lyric" ? "歌词" : "和弦"}{kind === "lyric" && <span>仅当前段，保留简谱</span>}</summary>
                  <p>{kind === "lyric" ? `只删除当前第 ${draft.target.verse ?? 1} 段歌词，简谱保持原样。${sequence ? "请先切换到单点模式。" : ""}` : "删除当前 TAB 拍的和弦名称与指法。仅清除指法图请使用上方的指法操作。"}</p>
                  <Button type={kind === "lyric" ? "text" : "default"} danger disabled={!existing || sequence || surfaceDisabled} onClick={remove} icon={kind === "lyric" ? undefined : <DeleteOutlined />}>删除{kind === "lyric" ? "当前歌词" : "当前和弦"}</Button>
                </details>}
              </div>
            )}
        </div>
        {propertyTab === "selection" && selectionDetail !== "measure" && !showSelectionInvitation && !pending && (
          <div className={styles.sidebarFooter}>
            <p className={styles.selectionTip}>快捷操作直接作用于选区，可使用撤销。</p>
          </div>
        )}
        <div ref={setActionsHost} className={styles.sidebarFooter} hidden={!!pending || !(kind === "numbered" || kind === "score")} />
        {/* 无编辑操作或提示时隐藏底栏，避免移除历史按钮后留下空白条。 */}
        <footer
          className={styles.sidebarFooter}
          hidden={!pending && !issue && !message && !draft}
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
                {!(kind === "numbered" && numberedGroups.length > 1) && Object.values(settingsStatus?.groups ?? {}).filter((group) => group.dirty).length <= 1 && (
                  <Button
                    disabled={
                      !!issue || (kind === "numbered" && !numberedCanApply)
                    }
                    type="primary"
                    onClick={() => void applyAndNavigate()}
                  >
                    {pending.type === "close" ? "应用并关闭" : "应用并切换"}
                  </Button>
                )}
                <Button
                  onClick={() => {
                    if (!composing.current) {
                       if (pendingVersion.current && sameEditorVersion(editorStore.getState(), pendingVersion.current) && pendingGeneration.current === ownerGeneration.current) {
                         settingsRef.current?.discard();
                         perform(pending);
                       }
                       else { setPending(null); setMessage("文档已变化，请重新发起导航。"); }
                    }
                  }}
                >
                  {pending.type === "close"
                    ? "放弃当前目标修改并关闭"
                    : "放弃并切换"}
                </Button>
                <Button ref={confirmRef} onClick={continueEditing}>
                  {kind === "numbered" && numberedGroups.length > 1
                    ? "返回处理"
                    : "继续编辑"}
                </Button>
              </div>
            </div>
          ) : (
            <>
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
                <>
                <p className={styles.actionSummary}>{lyricDirty ? `${kind === "lyric" ? "歌词" : "和弦"}有未应用修改${sequence && plan ? ` · ${plan.changes} 项变化${plan.overwrites ? ` · ${plan.overwrites} 项覆盖` : ""}` : ""}` : "当前内容已应用"}</p>
                <p className={styles.settingsHint}>{kind === "lyric" ? "切换位置、段号或模式会丢弃未应用歌词。" : "切换位置或页签会丢弃未应用和弦修改。"}</p>
                <div className={styles.sidebarActions}>
                  <Button disabled={surfaceDisabled || !lyricDirty} onClick={() => {
                    if (draft) { setDraft(readMusicTextDraft(editorStore.getState().document, draft.target, draft.lyricMode)); setTextConflict(false); }
                  }}>
                    恢复{kind === "chord" ? "和弦修改" : "歌词"}
                  </Button>
                  <Button
                    disabled={!!issue || surfaceDisabled || !lyricDirty}
                    type={kind === "chord" || sequence ? "primary" : "default"}
                    onClick={() => apply()}
                  >
                    {sequence
                      ? `应用歌词${draft.allowOverwrite && plan?.overwrites ? `（覆盖 ${plan.overwrites} 项）` : ""}`
                      : kind === "chord" ? "应用和弦" : "应用歌词"}
                  </Button>
                  {kind === "lyric" && !sequence && (
                    <Button
                      disabled={surfaceDisabled || (lyricDirty ? !!issue : !nextLyricTarget)}
                      type="primary"
                      onClick={() => applyLyricPrimary(true)}
                    >
                      {!lyricDirty && nextLyricTarget ? "下一处" : nextLyricTarget ? "应用并下一处" : "应用"}
                    </Button>
                  )}
                </div>
                </>
              )}
            </>
          )}
        </footer>
        {portalRoot && createPortal(<section
          ref={floatingPanelRef}
          data-music-text-floating
          data-editor-associated-panel="music-text-sidebar"
          id={kind === "chord" ? "chord-edit-popover" : "music-text-edit-popover"}
          className={`${styles.musicTextSurface} ${styles.musicTextFloating} ${kind === "chord" ? styles.chordFloating : ""}`}
          hidden={!floating}
          aria-label={floatingTitle}
          role="dialog"
          aria-modal={false}
          data-text-surface={floating ? "popover" : undefined}
          data-popover-placement={geometry.kind === "placed" ? geometry.placement : undefined}
          inert={!!activeModal || popoverHidden || !!pending}
          aria-hidden={popoverHidden || !floating || undefined}
          style={{
            left: geometry.kind === "placed" ? geometry.left : 0,
            top: geometry.kind === "placed" ? geometry.top : 0,
            visibility: popoverHidden ? "hidden" : "visible",
            width: kind === "lyric" && !sequence ? 320 : 360,
            "--popover-arrow-offset": geometry.kind === "placed" ? `${geometry.arrowOffset}px` : "16px",
          } as CSSProperties}
        >
          <div className={styles.floatingHeader}>
            <div className={styles.floatingTitle}>
              <strong>{floatingTitle}</strong>
              <span>{kind === "chord" ? `TAB · ${floatingLocation}` : floatingLocation}</span>
            </div>
            <div className={styles.floatingHeaderActions}>
              {floating && numberedBeatIndex >= 0 && numberedBeatEventIds.length > 1 && (
                <div className={styles.numberedPopoverNavigation} role="group" aria-label="同拍简谱音符">
                  <Button
                    type="text" size="small" icon={<LeftOutlined />}
                    aria-label="同拍上一个简谱音符" title="同拍上一个简谱音符"
                    disabled={surfaceDisabled || numberedBeatIndex === 0}
                    onClick={() => navigateNumberedBeat(-1)}
                  />
                  <span aria-label={`同拍第 ${numberedBeatIndex + 1} 个，共 ${numberedBeatEventIds.length} 个音符`}>
                    {numberedBeatIndex + 1} / {numberedBeatEventIds.length}
                  </span>
                  <Button
                    type="text" size="small" icon={<RightOutlined />}
                    aria-label="同拍下一个简谱音符" title="同拍下一个简谱音符"
                    disabled={surfaceDisabled || numberedBeatIndex === numberedBeatEventIds.length - 1}
                    onClick={() => navigateNumberedBeat(1)}
                  />
                </div>
              )}
              <Button type="text" disabled={surfaceDisabled} aria-label={kind === "chord" ? "结束和弦编辑" : "结束文字编辑"} title={kind === "chord" ? "结束和弦编辑" : "结束文字编辑"} onClick={() => returnToScore()}>
                ×
              </Button>
            </div>
          </div>
          <div
            className={styles.sidebarBody}
           onFocusCapture={(event) => {
             if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
               if (kind === "chord") lyricFocusSurface.current = "popover";
               lastInputFocus.current = event.target;
                focusDestination.current = "input";
                if (draft) setInputEditing(true);
              }
            }}
          >
            <div ref={setPopoverContainer} data-numbered-active-target={floating ? numberedEvent?.id : undefined} />
             {floating && kind === "lyric" && draft && <LyricFormView
              {...lyricFormProps!}
              onModeChange={(mode) => changeLyricMode(mode, "popover")}
              onVerseChange={(verse) => changeLyricVerse(verse, "popover")}
              presentation="popover"
              inputRef={(element) => { popoverInputRef.current = element; }}
              sequenceInputRef={(element) => { popoverSequenceInputRef.current = element; }}
             />}
             {floating && kind === "chord" && draft && <div inert={(compositionActive || compositionCooling) && compositionOrigin === "sidebar"}>
               <ChordQuickEditor
                 draft={draft.chord}
                 inputRef={(element) => { popoverInputRef.current = element; }}
                 onChange={(chord) => {
                   if (JSON.stringify(chord) !== JSON.stringify(draft.chord)) setTextConflict(false);
                   setDraft({ ...draft, chord });
                   setMessage(null);
                 }}
                 presetsEnabled={!!track && JSON.stringify(track.tuning.strings.map((string) => string.pitch)) === JSON.stringify(["E4", "B3", "G3", "D3", "A2", "E2"])}
                 disabled={surfaceDisabled}
                 inputReadOnly={!!pending || !!activeModal || numberedBusy}
                 onFixDiagram={focusChordDiagramIssue}
               />
             </div>}
           </div>
           {floating && kind === "chord" && draft && <footer className={styles.sidebarFooter}>
             {issue && <p className={styles.sidebarError} role="alert">{issue}</p>}
             {message && <p className={styles.sidebarMessage} role="status">{message}</p>}
              <p className={styles.settingsHint}>切换位置或结束编辑会丢弃未应用输入。<br />Enter 应用，停留当前拍。</p>
             <div className={styles.sidebarActions}>
               <Button type="primary" disabled={surfaceDisabled || !!issue || !lyricDirty} onClick={() => apply()}>应用和弦</Button>
             </div>
           </footer>}
          {floating && kind === "lyric" && draft && (
            <footer className={styles.sidebarFooter}>
              {message && <p className={styles.sidebarMessage} role="status">{message}</p>}
              <p className={styles.settingsHint}>结束编辑或切换位置会丢弃未应用歌词。</p>
              <div className={styles.sidebarActions}>
                <Button type="link" disabled={surfaceDisabled} onClick={() => focusSidebar()}>完整设置</Button>
                <Button disabled={surfaceDisabled} onClick={cancelTextEditing}>结束编辑</Button>
                {sequence ? (
                  <Button type="primary" disabled={!!issue || !lyricDirty || surfaceDisabled} onClick={() => apply()}>应用</Button>
                ) : (
                  <Button
                    type="primary"
                    disabled={surfaceDisabled || (lyricDirty ? !!issue : !nextLyricTarget)}
                    onClick={() => applyLyricPrimary(true)}
                  >
                    {!lyricDirty && nextLyricTarget ? "下一处" : nextLyricTarget ? "应用并下一处" : "应用"}
                  </Button>
                )}
              </div>
            </footer>
          )}
        </section>, portalRoot)}
        </section>
      </SidebarFrame>
    </ConfigProvider>
  );
};
