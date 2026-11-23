import {
  numberedTargetKey,
  formatNumberedBeatPosition,
  resolveNumberedEditorTarget,
} from "../numbered/numbered-editor-target";
import {
  NumberedEditor,
  type NumberedEditorController,
} from "../numbered/NumberedEditor";
import { ScoreSettings, type ScoreSettingsController, type ScoreSettingsStatus } from "../settings/ScoreSettings";
import { createPortal } from "react-dom";
import { SidebarFrame } from "../workspace/SidebarFrame";
import { MusicTextRangeEditor, type MusicTextRangeEditorController } from "./MusicTextRangeEditor";
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
  EllipsisOutlined,
  FileTextOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Button, ConfigProvider, Dropdown, Segmented, Select, Tabs, Tooltip, type TabsProps } from "antd";
import {
  createCollapsedTabCellSelection,
  getLyricVerseCount,
  getMusicTextRows,
  LXMScoreCommandEnum,
  normalizeMusicText,
  planLyricPositions,
  planLyricSequence,
  resolveLyricPosition,
  resolveMusicTextRange,
  resolveTabCellSelection,
  validateChordDiagram,
  type ILXMLayoutOptions,
  type ILXMTabCellSelection,
  type ILXMLyricVerse,
  type ILXMScoreCommand,
  type MusicTextRange,
} from "@liuxianmao/lxm-editor";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../../stores/editor-store";
import { LyricFormView } from "../lyrics/LyricFormView";
import { ChordEditor } from "../chords/ChordEditor";
import { ChordQuickEditor } from "../chords/ChordQuickEditor";
import type { ChordDraft } from "../chords/ChordEditor";
import { ChordLibraryModal } from "../chords/ChordLibraryModal";
import { ChordCustomSurface } from "../chords/ChordCustomSurface";
import type { ChordLibraryTab } from "../chords/ChordPresetControls";
import { saveCustomChordVoicing } from "../chords/chord-preferences";
import { createChordEditSession } from "../chords/chord-edit-session";
import type { SettingsGroup } from "../settings/score-settings-draft";
import { chordIssueField } from "../chords/chord-issue-field";
import { shouldIgnoreMusicTextKey } from "./music-text-interaction";
import { nextLyricTextInput } from "./text-apply-advance";
import { isEditorInputEnter } from "../shared/editor-input-enter";
import {
  readMusicTextDraft,
  lyricDraftMappingDependency,
  parseLyricDraftSequence,
  normalizeMusicTextTarget,
  musicTextDraftValue,
  resolveSidebarRequest,
  selectedChordTarget,
  type MusicTextTarget,
  type MusicTextDraft,
  type SidebarAction as DraftSidebarAction,
  type SidebarTab,
} from "./music-text-draft";
import {
  isScoreSelectionValid,
  type SelectionRequestResult,
} from "../session/editor-object-selection";
import musicTextSidebarStyles from "./MusicTextSidebar.module.scss";
import editorFormStyles from "../shared/editor-form.module.scss";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";
import {
  useEditorDraftRecords,
  useEditorRuntime,
} from "../session/EditorSessionRuntime";
import type { NumberedDraftGroup } from "../numbered/numbered-submission";
import { captureEditorVersion, sameEditorVersion, type EditorSessionVersion } from "../session/editor-session-version";
import type { EditorDraftRecord, EditorDraftRegistration } from "../session/editor-draft-coordinator";
import type { FloatingAnchorRect } from "./music-text-floating-position";
import { useMusicTextFloatingPanel } from "./use-music-text-floating-panel";
import { contextPanelPosition } from "../score/context-panel-position";

import type { ToolNavigation } from "../tools/editor-tool-catalog";
import type {
  ToolActionHandler,
  MeasureToolTarget,
} from "../tools/editor-tool-actions";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { NoteToolDetails } from "../tools/NoteToolDetails";
import { MeasureToolDetails } from "../tools/MeasureToolDetails";
import { TupletToolbar } from "../tools/TupletToolbar";
import { SidebarRhythmPatternPanel } from "../tools/RhythmPatternPanel";
import { resolveParagraphLyricTarget } from "./music-text-target";
import { navigateMusicTextRange, rangeFromTarget, sameRangePoint } from "./music-text-range-selection";

export type ParagraphEditingSession = {
  trackId: string;
  measureId: string;
  kind: "lyric" | "numbered";
  verse: ILXMLyricVerse;
};

type LyricFocusSurface = "sidebar" | "popover";
type ContextChord = { anchor: HTMLElement; onClose: () => void };
type ParagraphRowCommand = Extract<ILXMScoreCommand, {
  type: LXMScoreCommandEnum.AddNumberedRow | LXMScoreCommandEnum.AddLyricVerse |
    LXMScoreCommandEnum.RemoveNumberedRow | LXMScoreCommandEnum.RemoveLyricVerse;
}>;
type SidebarAction = DraftSidebarAction & {
  lyricFocusSurface?: LyricFocusSurface;
  targetSurface?: "sidebar";
  protectTextDraft?: boolean;
  settingsFocus?: boolean;
  contextChord?: ContextChord;
};
type PendingSidebarAction = SidebarAction | { type: "paragraphRow"; command: ParagraphRowCommand };

export interface MusicTextController {
  discardSong: () => boolean;
  navigateTool: (destination: ToolNavigation) => SelectionRequestResult;
  /** 输出前只读检查草稿，不自动提交或取消用户输入。 */
  isOutputBlocked: (options?: { allowSettingsBusy?: boolean; ignoreModalId?: number }) => boolean;
  isNumberedActionBlocked: (options?: { ignoreModalId?: number }) => boolean;
  isTransitionBlocked: () => boolean;
  canCollapse: () => boolean;
  restoreSidebarFocus: () => void;
  open: (target: MusicTextTarget) => void;
  openContextChord: (anchor: HTMLElement, onClose: () => void) => boolean;
  closeContextChord: () => boolean;
  select: (
    selection: ILXMTabCellSelection | null,
    techniqueId?: string,
    traversalIds?: readonly string[],
  ) => SelectionRequestResult;
  returnToScore: () => SelectionRequestResult;
  moveEditTarget: (direction: -1 | 1, source: EventTarget | null, fromScore: boolean) => boolean;
  dismissCleanPopover: () => boolean;
  clearRange: () => boolean;
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
  onParagraphEditingChange,
  paragraphPlaceholders,
  onScoreFocus,
  onScoreSelection,
  strumInspector,
  getNumberedBeatEventIds,
  onToolAction,
  executeTool,
  getFloatingAnchor,
  getFloatingViewport,
  getFloatingObservedElements,
  collapsed: collapsedByEditor = false,
  suspendedForPlayback = false,
  modal = false,
  showChordDiagrams,
  onShowChordDiagramsChange,
  onExpandSidebar = () => {},
  onLocate = () => {},
  continuousRange = null,
  onRangeChange = () => {},
}: {
  modal?: boolean;
  showChordDiagrams?: boolean;
  onShowChordDiagramsChange?: (show: boolean) => void;
  ref: Ref<MusicTextController>;
  onToolAction?: ToolActionHandler;
  executeTool?: EditorCommandAdapter;
  onOpen: () => void;
  onEditingChange: (editing: boolean) => void;
  onPopoverHiddenChange: (hidden: boolean) => void;
  onNumberedActionBlockedChange: (blocked: boolean) => void;
  onTransitionBlockedChange?: (blocked: boolean) => void;
  onTargetChange: (target: MusicTextTarget | null) => void;
  /** 即使当前休止或延音不可写词，也保留当前小节的空歌词行。 */
  onParagraphEditingChange?: (session: ParagraphEditingSession | null) => void;
  paragraphPlaceholders?: ILXMLayoutOptions["paragraphPlaceholders"];
  onScoreFocus: () => void;
  onScoreSelection: (
    selection: ILXMTabCellSelection | null,
    techniqueId: string | null,
    traversalIds?: readonly string[],
  ) => void;
  strumInspector?: React.ReactNode;
  getNumberedBeatEventIds: (target: MusicTextTarget) => string[];
  getFloatingAnchor: (
    target: MusicTextTarget | null,
  ) => FloatingAnchorRect | null;
  getFloatingViewport: () => FloatingAnchorRect;
  getFloatingObservedElements?: () => readonly (Element | null)[];
  collapsed?: boolean;
  suspendedForPlayback?: boolean;
  onExpandSidebar?: () => void;
  onLocate?: (location: SidebarLocation) => void;
  continuousRange?: MusicTextRange | null;
  onRangeChange?: (range: MusicTextRange | null) => void;
}) => {
  const collapsed = collapsedByEditor || suspendedForPlayback;
  const editorStore = useEditorSessionStore();
  const rangeEditor = useRef<MusicTextRangeEditorController>(null);
  const focusRangeOnOpen = useRef(false);
  const { modals, drafts } = useEditorRuntime();
  const activeModal = useSyncExternalStore(
    modals.subscribe,
    modals.getSnapshot,
    () => null,
  );
  const score = useEditorStore((s) => s.document);
  const textRows = useMemo(() => score ? getMusicTextRows(score) : null, [score]);
  const selection = useEditorStore((s) => s.selection);
  const numberedSelection = useEditorStore((s) => s.numberedSelection);
  const selectedNumberedMarkId = useEditorStore(
    (s) => s.selectedNumberedMarkId,
  );
  const [kind, setKind] = useState<SidebarTab>("score");
  type PropertyTab = "selection" | "paragraph" | "chord" | "song";
  // 一级栏目只负责组织界面；真实业务目标仍由 kind 和现有草稿闸门维护。
  const [propertyTab, setPropertyTab] = useState<PropertyTab>("selection");
  const [showRangeTools, setShowRangeTools] = useState(false);
  if (!continuousRange && showRangeTools) setShowRangeTools(false);
  const [selectionDetail, setSelectionDetail] =
    useState<"note" | "measure">("note");
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
  // 两类编辑器和两个表面共用这一会话偏好，切换目标或重挂载表单时不重置。
  const [advanceAfterApply, setAdvanceAfterApply] = useState(true);
  const textAdvance = { checked: advanceAfterApply, onChange: setAdvanceAfterApply };
  const revealAdvancedTarget = useRef<MusicTextTarget | null>(null);
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
  const [lyricVerse, setLyricVerse] = useState<ILXMLyricVerse>(1);
  const settingsRef = useRef<ScoreSettingsController>(null);
  const [settingsStatus, setSettingsStatus] = useState<ScoreSettingsStatus | null>(null);
  const settingsDirty = settingsStatus?.groups.label.dirty ?? false;
  const [draft, setDraft] = useState<MusicTextDraft | null>(null);
  const [pending, setPending] = useState<PendingSidebarAction | null>(null);
  const pendingVersion = useRef<EditorSessionVersion | null>(null);
  const ownerGeneration = useRef(0);
  const pendingGeneration = useRef(0);
  const activeTextOwner = useRef(true);
  const renderedGeneration = ownerGeneration.current;
  const [songHost, setSongHost] = useState<HTMLDivElement | null>(null);
  const [measureHost, setMeasureHost] = useState<HTMLDivElement | null>(null);
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
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const popoverInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const lyricFocusSurface = useRef<LyricFocusSurface>("popover");
  const [popoverContainer, setPopoverContainer] = useState<HTMLDivElement | null>(null);
  const [inspection, setInspection] = useState(0);
  const [inputEditing, setInputEditing] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [surface, setSurface] = useState<"popover" | "sidebar">("popover");
  const [dismissed, setDismissed] = useState(false);
  const [contextChord, setContextChord] = useState<ContextChord | null>(null);
  const contextChordRef = useRef<ContextChord | null>(null);
  const [contextPosition, setContextPosition] = useState<ReturnType<typeof contextPanelPosition> | null>(null);
  const [compositionCooling, setCompositionCooling] = useState(false);
  const compositionCoolingRef = useRef(false);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfaceFocusGroup = useRef<NumberedDraftGroup | undefined>(undefined);
  const focusDestination = useRef<"score" | "input">("input");
  const lastPlacedTarget = useRef("");
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const addRowRef = useRef<HTMLButtonElement>(null);
  const rowMenuRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const lastInputFocus = useRef<HTMLElement | null>(null);
  const lastSidebarFocus = useRef<HTMLElement | null>(null);
  const draftRegistrationRef = useRef<ReturnType<typeof useEditorDraftRecords> | null>(null);
  const draftLive = useRef(draft);
  useLayoutEffect(() => { draftLive.current = draft; }, [draft]);
  const [chordModalActive, setChordModalActive] = useState(false);
  type SuspendedChord = {
    draft: MusicTextDraft; identity: EditorDraftRegistration;
    version: EditorSessionVersion; surface: "popover" | "sidebar";
  };
  const suspendedChord = useRef<SuspendedChord | null>(null);
  const [chordSuspended, setChordSuspended] = useState(false);
  const infoAuthorization = useRef<{ identity: EditorDraftRegistration; version: EditorSessionVersion } | null>(null);
  const [chordSession] = useState(createChordEditSession);
  useLayoutEffect(() => { chordSession.setReader(() => {
    const current = draftLive.current, registration = draftRegistrationRef.current;
    const state = editorStore.getState();
    if (!current || current.target.kind !== "chord" || !registration ||
      !normalizeMusicTextTarget(state.document, current.target)) return null;
    return { identity: registration.captureIdentity(), version: captureEditorVersion(state),
      targetKey: JSON.stringify(current.target), parentValue: musicTextDraftValue(current) };
  }); }, [chordSession, editorStore]);
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
  const floating = textSession && surface === "popover" && !chordSuspended;
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
  const paragraphSource = activeObject ?? numberedSelection ?? selection?.focus;
  const paragraphTrackId = propertyTab === "paragraph" ? paragraphSource?.trackId : undefined;
  const paragraphMeasureId = propertyTab === "paragraph" ? paragraphSource?.measureId : undefined;
  const paragraphVerse = score && lyricVerse <= getLyricVerseCount(score) ? lyricVerse : 1;
  const paragraphRowAvailable = activeObject?.kind === kind ||
    (kind === "numbered" ? textRows?.numbered : !!textRows?.lyricVerses);
  useEffect(() => {
    onParagraphEditingChange?.(paragraphRowAvailable && paragraphTrackId && paragraphMeasureId && (kind === "lyric" || kind === "numbered")
      ? { trackId: paragraphTrackId, measureId: paragraphMeasureId, kind, verse: paragraphVerse }
      : null);
  }, [onParagraphEditingChange, paragraphRowAvailable, paragraphTrackId, paragraphMeasureId, kind, paragraphVerse]);
  const numberedEntry = score ? resolveNumberedEditorTarget(score,
    numberedSelection ?? selection?.focus ?? null) : null;
  const lyricStart = (() => {
    if (kind !== "lyric" || !score || draft) return null;
    if (lyricSource) return resolveParagraphLyricTarget(score, lyricSource, paragraphVerse);
    if (selection) return resolveParagraphLyricTarget(
      score, numberedEntry && { ...numberedEntry, kind: "numbered" }, paragraphVerse,
    );
    // 仅为录入按钮准备起点，浏览歌词页签时不激活这个位置。
    const track = score.score.tracks[0];
    if (!track) return null;
    for (const measure of track.measures) {
      const [position] = planLyricPositions(measure);
      if (position) return { ...position, trackId: track.id, measureId: measure.id, kind: "lyric" as const, verse: paragraphVerse };
    }
    return null;
  })();
  const target =
    draft?.target ??
    (kind === "lyric"
      ? lyricStart
      : numberedSelection ? null : selection?.focus);
  const track = target
    ? score?.score.tracks.find((t) => t.id === target.trackId)
    : score?.score.tracks[0];
  const measure = track?.measures.find((m) => m.id === target?.measureId);
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
  const removingChord = draft?.target.kind === "chord" && !!existing &&
    draft.chord.chord.name.trim() === "";
  const sequence =
    draft?.target.kind === "lyric";
  const parsed = useMemo(
    () =>
      sequence && draft?.text !== undefined
        ? parseLyricDraftSequence(draft.text)
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
            true,
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
      : removingChord ? null
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
  const transitionBlocked = surfaceDisabled || chordSuspended || !!settingsStatus?.busy || !!settingsStatus?.composing;
  useEffect(() => onTransitionBlockedChange?.(transitionBlocked), [transitionBlocked, onTransitionBlockedChange]);
  const surfaceBlocked = useCallback((ignoreModalId?: number) =>
    composing.current || compositionCoolingRef.current || compositionActive || compositionCooling ||
     !!pending || numberedBusy || !!suspendedChord.current || (!!activeModal && activeModal.id !== ignoreModalId) || navigationApplying.current,
    [compositionActive, compositionCooling, pending, numberedBusy, activeModal]);
  const focusSidebar = useCallback((
    group?: NumberedDraftGroup,
  ): SelectionRequestResult => {
    if (!textSession || surfaceBlocked()) return "blocked";
    const generation = ownerGeneration.current;
    const source = popoverInputRef.current;
    const caret = source ? { start: source.selectionStart, end: source.selectionEnd, direction: source.selectionDirection } : null;
    onExpandSidebar();
    focusDestination.current = "input";
    requestAnimationFrame(() => {
      if (ownerGeneration.current !== generation) return;
      if (kind === "numbered") numberedRef.current?.focus(group ?? "content");
      else {
        lyricFocusSurface.current = "sidebar";
        const input = inputRef.current;
        input?.focus({ preventScroll: true });
        if (caret && caret.start !== null && caret.end !== null && input) input.setSelectionRange(caret.start, caret.end, caret.direction ?? undefined);
      }
    });
    return "accepted";
  }, [textSession, surfaceBlocked, kind, onExpandSidebar]);
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
    if (contextChordRef.current) return closeContextChord();
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
    mode: MusicTextDraft["lyricMode"] = "sequence",
    focus: "score" | "input" = "input",
    lyricSurface: LyricFocusSurface = "popover",
    fromContextMenu = false,
  ) => {
    activeTextOwner.current = true;
    lyricFocusSurface.current = lyricSurface;
    const value = readMusicTextDraft(
      editorStore.getState().document,
      next,
      next.kind === "lyric" ? "sequence" : mode,
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
      setLyricVerse(value?.target.verse ?? 1);
    }
    baseline.current = editorStore.getState().document;
    if (value) {
      focusTarget(focus);
      onOpen();
      editorStore.getState().setSelectedTechniqueId(null);
      // 菜单已选定 TAB 拍点。和弦目标规范化时统一使用第一弦，不能用它覆盖菜单保留的弦格选区。
      if (value.target.kind === "chord" && !fromContextMenu)
        editorStore
          .getState()
          .setSelection(createCollapsedTabCellSelection(value.target));
    }
  };
  // 菜单与谱面入口共用同一草稿。只在编辑目标切换获准后交接菜单状态，
  // 先清引用再通知父级，避免同一事件中再次关闭时重复触发回调。
  const changeContextChord = (next: ContextChord | null) => {
    const previous = contextChordRef.current;
    if (previous === next) return;
    contextChordRef.current = next;
    setContextChord(next);
    setContextPosition(null);
    previous?.onClose();
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
    if (action.type === "range" &&
      (!current.document || !resolveMusicTextRange(current.document, action.range).ok)) {
      setPending(null);
      setMessage("音乐文本选区已失效，请重新选择。");
      return false;
    }
    if (action.type === "tab" && action.focus)
      requestedTabFocus.current = `${action.focus === "paragraph" ? "paragraph" : "music"}-tab-${action.kind === "numbered" && action.focus !== "paragraph" ? "lyric" : action.kind}`;
    if (propertyTab === "song" && settingsRef.current?.discardSong() === false) return false;
    setPending(null);
    ownerGeneration.current += 1;
    activeTextOwner.current = false;
    draftRegistrationRef.current?.invalidateOwner();
    if (action.type === "target") {
      setDismissed(false);
      setSurface(action.targetSurface ?? "popover");
      if (action.targetSurface === "sidebar") onExpandSidebar();
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
    if (action.type === "range") {
      setDraft(null);
      setNumberedTarget(null);
      setActiveObject(null);
      setKind("score");
      setInputEditing(false);
      setMessage(null);
      focusDestination.current = "score";
      focusRangeOnOpen.current = true;
      setShowRangeTools(false);
      onRangeChange(action.range);
      onExpandSidebar();
      onOpen();
    } else if (action.type === "tool") {
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
        setSelectionDetail(action.destination === "barline" ? "measure" : action.destination === "tuplet" ? "note" : action.destination);
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
          : activeObject?.kind === "chord" && !contextChordRef.current
            ? createCollapsedTabCellSelection(activeObject)
            : current.selection;
      settingsRef.current?.discard();
      // 和弦页签可以跟随 TAB 单拍显示表单，谱面仍处于 TAB 编辑态。
      current.setNumberedSelection(null);
      const editingStrum = action.type === "selection" && !!action.techniqueId &&
        current.document?.score.tracks.some(track => track.techniques.some(t => t.id === action.techniqueId && t.type === "strum"));
      // 扫弦手柄和侧栏字段修改同一对象。只有草稿闸门接受了选区，才切到它的音符属性。
      if (editingStrum) {
        setPropertyTab("selection");
        setSelectionDetail("note");
        setKind("score");
      }
      const chordTarget = !editingStrum && propertyTab === "chord"
        ? selectedChordTarget(current.document, nextSelection) : null;
      const chordDraft = chordTarget ? readMusicTextDraft(current.document, chordTarget) : null;
      setDraft(chordDraft);
      setNumberedTarget(null);
      setActiveObject(null);
      activeTextOwner.current = !!chordDraft;
      if (chordDraft) {
        baseline.current = current.document;
        setKind("chord");
        setSurface("sidebar");
      }
      setInputEditing(false);
      focusDestination.current = "score";
      setMessage(null);
      if (action.type === "close" && contextChordRef.current) {
        // 菜单关闭保留六线谱选区。同步通知父级释放文字目标，焦点由菜单的关闭回调处理。
        onTargetChange(null);
      } else {
        onScoreSelection(
          nextSelection,
          action.type === "selection" ? (action.techniqueId ?? null) : null,
          ...(action.type === "selection" && action.traversalIds ? [action.traversalIds] as const : []),
        );
      }
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
        loadTarget(action.target, draft?.lyricMode, action.focus, action.targetSurface ?? action.lyricFocusSurface, !!action.contextChord);
      }
    } else if (action.type === "numberedMode") {
      activeTextOwner.current = true;
      setNumberedMode("sequence");
    } else if (action.type === "mode") {
      if (draft) loadTarget(draft.target, action.mode, "input", action.lyricFocusSurface ?? lyricFocusSurface.current);
    } else {
      const source = activeObject?.kind === "numbered" ? numberedPreview ?? activeObject
        : activeObject?.kind === "lyric" ? activeObject
        : current.numberedSelection ? { ...current.numberedSelection, kind: "numbered" as const }
        : numberedTarget;
      const rows = current.document && getMusicTextRows(current.document);
      const lyricAvailable = !!rows?.lyricVerses || !!paragraphPlaceholders?.lyric;
      const numberedAvailable = !!rows?.numbered || !!paragraphPlaceholders?.numberedMeasureId;
      const lyricTarget = action.kind === "lyric" && lyricAvailable
        ? resolveParagraphLyricTarget(current.document, source, lyricVerse) : null;
      if (lyricTarget) {
        current.setNumberedSelection(null);
        loadTarget(lyricTarget, "sequence", "input", "sidebar");
        setSurface("sidebar");
        changeContextChord(null);
        return true;
      }
      const numberedPosition = (action.kind === "numbered" || action.kind === "lyric") && current.document && source
        ? resolveNumberedEditorTarget(current.document, source) : null;
      const numberedEntry = action.kind === "numbered" && numberedAvailable ? numberedPosition : null;
      const chordTarget = action.kind === "chord" && !current.numberedSelection
        ? selectedChordTarget(current.document, current.selection) : null;
      const chordDraft = chordTarget ? readMusicTextDraft(current.document, chordTarget) : null;
      setDraft(chordDraft);
      const nextNumbered = numberedEntry ? { ...numberedEntry, kind: "numbered" as const } : null;
      setNumberedTarget(nextNumbered);
      setActiveObject(nextNumbered);
      activeTextOwner.current = !!chordDraft || !!nextNumbered;
      // 空行未建立时保留录入位置，等待用户明确开始录入。
      if (numberedPosition) current.setNumberedSelection(numberedPosition);
      if (numberedEntry) {
        setSurface("sidebar");
      }
      if (chordDraft) {
        baseline.current = current.document;
        setSurface("sidebar");
      }
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
    changeContextChord(action.contextChord ?? null);
    return true;
  };
  const holdPending = (action: PendingSidebarAction): SelectionRequestResult => {
    onExpandSidebar();
    pendingVersion.current = captureEditorVersion(editorStore.getState());
    pendingGeneration.current = ownerGeneration.current;
    setPending(action);
    return "pending";
  };
  /** 统一处理对象／页签切换；先校验目标和输入状态，再丢弃旧输入并迁移 selection。 */
  const request = (action: SidebarAction): SelectionRequestResult => {
    if (suspendedChord.current) { setMessage("请先返回和弦编辑，或处理当前曲谱信息输入。"); return "blocked"; }
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
        ? "measure" : action.destination === "tuplet" ? "note" : action.destination;
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
    if (action.type === "selection" && !action.techniqueId && propertyTab === "chord" && !activeObject && draft?.target.kind === "chord") {
      const next = selectedChordTarget(editorStore.getState().document, action.selection);
      if (next && next.trackId === draft.target.trackId && next.measureId === draft.target.measureId && next.beatId === draft.target.beatId) {
        onScoreSelection(action.selection, action.techniqueId ?? null);
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
        if (action.targetSurface === "sidebar") {
          setSurface("sidebar");
          setPropertyTab("paragraph");
          onExpandSidebar();
        }
        focusDestination.current = "input";
        setNumberedInputActive(true);
        setFocusRequest((value) => value + 1);
        return "accepted";
      }
    }
    // 同一业务 kind 下仍需区分页签；歌曲未应用输入在请求接受后直接丢弃。
    if (
      action.type === "tab" &&
      action.kind === kind &&
      (!action.propertyTab || action.propertyTab === propertyTab)
    )
      return "accepted";
    if (action.type === "numberedMode" && action.mode === numberedMode)
      return "accepted";
    const textDraftDirty = !!numberedRef.current?.dirty || (!!draft && musicTextDraftValue(draft) !== draft.initial);
    const decision = resolveSidebarRequest(draft, action, {
      numberedTarget,
      numberedDirty: numberedRef.current?.dirty,
      settingsDirty: action.settingsFocus ? false : settingsRef.current?.isProtectedDirty(),
      visibleTaskChanged: action.type === "tab" && !!action.propertyTab && action.propertyTab !== propertyTab,
    });
    if (decision === "ignore" && action.type === "target") {
      setDismissed(false);
      setActiveObject(action.target);
      changeContextChord(action.contextChord ?? null);
      if (action.targetSurface === "sidebar") {
        lyricFocusSurface.current = "sidebar";
        setSurface("sidebar");
        setPropertyTab("paragraph");
        onExpandSidebar();
      } else if (action.target.kind === "chord") {
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
    if (decision === "confirm" || (action.protectTextDraft && textDraftDirty))
      return action.contextChord ? "blocked" : holdPending(action);
    return decision === "ignore" || perform(action) ? "accepted" : "blocked";
  };
  const returnToScore = (): SelectionRequestResult =>
    request({ type: "close" });
  const advanceTextTarget = (target: MusicTextTarget, source: LyricFocusSurface) => {
    // 自动前进沿用统一的目标和草稿保护，但不打开其它草稿的导航确认。
    if (settingsRef.current?.isProtectedDirty()) return false;
    if (request({ type: "target", target, lyricFocusSurface: source,
      targetSurface: source === "sidebar" ? "sidebar" : undefined }) !== "accepted") return false;
    surfaceFocusGroup.current = source === "sidebar" && target.kind === "numbered" ? "content" : undefined;
    revealAdvancedTarget.current = target;
    return true;
  };
  const closeContextChord = (restoreAnchorFocus = false): boolean => {
    const entry = contextChordRef.current;
    if (!entry) return true;
    // 切工具、点外部和 Esc 使用同一关闭规则。组合输入、子弹窗及表单保护期间保留原编辑，
    // 其余情况按现有和弦退出规则丢弃未应用内容，不修改谱面。
    if (surfaceBlocked() || modals.isOpen() || settingsRef.current?.isProtectedDirty() ||
      settingsRef.current?.isComposing() || settingsRef.current?.readStatus().busy) return false;
    if (!perform({ type: "close" })) return false;
    // 表单内的关闭、应用和 Esc 回到菜单行。外部点击或切换工具保留调用方的焦点意图。
    if (restoreAnchorFocus && entry.anchor.isConnected) entry.anchor.focus({ preventScroll: true });
    return true;
  };
  // 拖选等谱面操作会直接更新 store 选区；只同步目标，不打断 pointer capture。
  useLayoutEffect(() => {
    if (propertyTab !== "chord" || activeObject || activeModal || pending || suspendedChord.current) return;
    const current = editorStore.getState();
    const next = !numberedSelection && !continuousRange ? selectedChordTarget(current.document, selection) : null;
    const previous = draftLive.current;
    if (next && previous?.target.kind === "chord" &&
      next.trackId === previous.target.trackId && next.measureId === previous.target.measureId && next.beatId === previous.target.beatId) return;
    if (!next && !previous) return;
    const value = next ? readMusicTextDraft(current.document, next) : null;
    ownerGeneration.current += 1;
    draftRegistrationRef.current?.invalidateOwner();
    activeTextOwner.current = !!value;
    baseline.current = current.document;
    setDraft(value);
    setInputEditing(false);
    setTextConflict(false);
    setMessage(null);
    setSurface("sidebar");
    focusDestination.current = "score";
  }, [selection, numberedSelection, continuousRange, propertyTab, activeObject, activeModal, pending, editorStore]);
  const cancelTextEditing = (): SelectionRequestResult => {
    if (contextChordRef.current) return closeContextChord(true) ? "accepted" : "blocked";
    if (surfaceBlocked()) return "blocked";
    if (kind === "lyric" || kind === "numbered") {
      setDismissed(true);
      setInputEditing(false);
      setNumberedInputActive(false);
      focusDestination.current = "score";
      onScoreFocus();
      return "accepted";
    }
    return request({ type: "close" });
  };
  useImperativeHandle(ref, () => ({
    discardSong: () => settingsRef.current?.discardSong() ?? true,
    clearRange: () => rangeEditor.current?.clear() ?? false,
    restoreSidebarFocus: () => {
      if (continuousRange) { rangeEditor.current?.focus(); return; }
      // 窄屏气泡回退到侧栏时延续原输入意图，不能由抽屉默认焦点抢到关闭按钮。
      if (textSession && focusDestination.current === "input") {
        if (kind === "numbered") { numberedRef.current?.focus(); return; }
        const input = inputRef.current;
        if (input?.isConnected && !input.closest("[hidden],[inert]")) {
          input.focus({ preventScroll: true });
          return;
        }
      }
      const previous = lastSidebarFocus.current;
      if (previous?.isConnected && !previous.closest("[hidden], [inert]")) previous.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('#music-text-sidebar [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    },
    canCollapse: () => !rangeEditor.current?.isComposing() && !pending && !activeModal && !numberedBusy && !numberedRef.current?.readStatus().busy && !settingsRef.current?.readStatus().busy && !settingsRef.current?.isComposing() &&
      (!(composing.current || compositionCoolingRef.current) || (kind !== "chord" && compositionSurface.current === "popover")),
    isTransitionBlocked: () => !!rangeEditor.current?.isComposing() || surfaceBlocked() || !!settingsRef.current?.isComposing() || !!settingsRef.current?.readStatus().busy || !!numberedRef.current?.readStatus().busy,
    isOutputBlocked: (options) =>
      !!rangeEditor.current?.isDirty() || !!rangeEditor.current?.isComposing() ||
      surfaceBlocked(options?.ignoreModalId) ||
      !!settingsRef.current?.isComposing() ||
      (!options?.allowSettingsBusy && !!settingsRef.current?.readStatus().busy) ||
      !!numberedRef.current?.readStatus().busy ||
      !!pending ||
      (activeTextOwner.current && renderedGeneration === ownerGeneration.current && !!numberedRef.current?.dirty) ||
      !!settingsRef.current?.isProtectedDirty() ||
      (activeTextOwner.current && renderedGeneration === ownerGeneration.current && !!draft && musicTextDraftValue(draft) !== draft.initial),
    isNumberedActionBlocked: (options) =>
      !!rangeEditor.current?.isDirty() || !!rangeEditor.current?.isComposing() ||
      surfaceBlocked(options?.ignoreModalId) ||
      !!settingsRef.current?.isComposing() ||
      !!settingsRef.current?.readStatus().busy ||
      !!numberedRef.current?.readStatus().busy ||
      !!pending ||
      (activeTextOwner.current && renderedGeneration === ownerGeneration.current && !!numberedRef.current?.dirty) ||
      !!settingsRef.current?.isProtectedDirty() ||
      (activeTextOwner.current && renderedGeneration === ownerGeneration.current && !!draft && musicTextDraftValue(draft) !== draft.initial),
    open: (next) => {
      if (rangeEditor.current?.isComposing()) return;
      onRangeChange(null);
      request({ type: "target", target: next });
    },
    openContextChord: (anchor, onClose) => {
      // 右键菜单只接受当前有效的 TAB 单拍，简谱和连续文字选区不隐式换成和弦目标。
      // 菜单需要立即知道是否打开，已受保护的设置留在原表单，不排队等待确认后再打开。
      const current = editorStore.getState();
      if (!portalRoot || !anchor.isConnected || current.numberedSelection || continuousRange ||
        modals.isOpen() || settingsRef.current?.isProtectedDirty()) return false;
      const target = selectedChordTarget(current.document, current.selection);
      const existingContext = contextChordRef.current;
      const entry = existingContext?.anchor === anchor ? existingContext : { anchor, onClose };
      if (!target || request({ type: "target", target, contextChord: entry }) !== "accepted") return false;
      entry.onClose = onClose;
      return true;
    },
    closeContextChord: () => closeContextChord(),
    moveEditTarget: (direction, source, fromScore) => {
      const target = activeObject?.kind === "numbered" ? numberedPreview ?? activeObject : activeObject;
      const current = editorStore.getState().document;
      if (!current || !target || target.kind === "chord" || continuousRange) return false;
      if (!fromScore) {
        if (target.kind === "lyric" && source !== inputRef.current && source !== popoverInputRef.current) return false;
        if (target.kind === "numbered" && !(source instanceof HTMLInputElement &&
          (source.id === "numbered-popover-content" || source.id === "numbered-sidebar-content"))) return false;
      }
      const numberedStatus = numberedRef.current?.readStatus();
      if (surfaceBlocked() || numberedStatus?.busy || numberedStatus?.composing) return true;
      const range = rangeFromTarget(target);
      const next = range && navigateMusicTextRange(current, range, direction, false);
      if (next) request({
        type: "target",
        target: target.kind === "lyric"
          ? { kind: "lyric", trackId: target.trackId, verse: target.verse, ...next.focus }
          : { kind: "numbered", trackId: target.trackId, ...next.focus },
        protectTextDraft: true,
        ...(source === inputRef.current ? { lyricFocusSurface: "sidebar" } : {}),
      });
      return true;
    },
    select: (next, techniqueId, traversalIds) => {
      if (rangeEditor.current?.isComposing()) return "blocked";
      onRangeChange(null);
      return request({ type: "selection", selection: next, techniqueId, traversalIds });
    },
    returnToScore: () => {
      if (rangeEditor.current?.isComposing()) return "blocked";
      if (continuousRange) { onRangeChange(null); onScoreFocus(); return "accepted"; }
      if (contextChordRef.current) return closeContextChord() ? "accepted" : "blocked";
      return returnToScore();
    },
    dismissCleanPopover,
    navigateTool: (destination) => {
      if (rangeEditor.current?.isComposing() || rangeEditor.current?.isDirty()) return "blocked";
      const current = editorStore.getState();
      const source = continuousRange ? { trackId: continuousRange.trackId, measureId: continuousRange.focus.measureId }
        : activeObject ?? detailTarget ?? current.numberedSelection ?? current.selection?.focus;
      const result = request({
        type: "tool",
        kind: "score",
        destination,
        sessionId: current.sessionId,
        sessionVersion: current.sessionVersion,
        target: source
          ? { trackId: source.trackId, measureId: source.measureId }
          : undefined,
      });
      if (result === "accepted" && continuousRange) setShowRangeTools(true);
      return result;
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
          `[data-selection-detail="${selectionDetail}"] :is([data-selection-detail-focus], h3)`,
        )
        ?.focus({ preventScroll: true });
  }, [detailFocus, pending, propertyTab, selectionDetail]);

  useEffect(() => {
    if (!focusRangeOnOpen.current || !continuousRange || showRangeTools || collapsed) return;
    focusRangeOnOpen.current = false;
    rangeEditor.current?.focus();
  }, [continuousRange, showRangeTools, collapsed]);

  // 同会话外部变化保留当前原文；目标失效时撤下候选，不寻找邻近对象。
  useEffect(
    () =>
      editorStore.subscribe((state) => {
        if (suspendedChord.current && !committing.current &&
          !sameEditorVersion(captureEditorVersion(state), suspendedChord.current.version)) {
          suspendedChord.current = null;
          infoAuthorization.current = null;
          setChordSuspended(false);
          draftRegistrationRef.current?.invalidateOwner();
          setDraft(null);
          setActiveObject(null);
          setMessage("原和弦会话已变化，请重新选择和弦位置。");
        }
        if (state.document !== baseline.current && !committing.current) {
          const previousDocument = baseline.current;
          setPending(null);
          setNumberedPreview(null);
          setDraft((previous) => {
            if (!previous) return previous;
            const verseCount = state.document ? getLyricVerseCount(state.document) : 1;
            const removedVerse = previous.target.kind === "lyric" && (previous.target.verse ?? 1) > verseCount;
            const fresh = readMusicTextDraft(state.document, removedVerse
              ? { ...previous.target, verse: verseCount as ILXMLyricVerse }
              : previous.target, previous.lyricMode);
            if (removedVerse && fresh) {
              setLyricVerse(fresh.target.verse ?? 1);
              setActiveObject(fresh.target);
              setTextConflict(false);
              setInspection(0);
              return fresh;
            }
            if (!fresh) { setMessage("原编辑目标已失效，当前原文仅供查看，请重新选择。"); return previous; }
            if (musicTextDraftValue(previous) === previous.initial) return fresh;
            if ((previous.target.kind !== "lyric" && fresh.initial !== previous.initial) ||
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
  const floatingAnchorTarget = activeObject?.kind === "numbered" && activeObject.eventId && score &&
    !resolveNumberedEditorTarget(score, activeObject) ? numberedPreview ?? activeObject : activeObject;
  useLayoutEffect(() => {
    const target = revealAdvancedTarget.current;
    if (!target || activeObject?.kind !== target.kind || activeObject.trackId !== target.trackId ||
      activeObject.measureId !== target.measureId || activeObject.eventId !== target.eventId || activeObject.tick !== target.tick) return;
    revealAdvancedTarget.current = null;
    const anchor = getFloatingAnchor(activeObject);
    const viewport = getFloatingViewport();
    // 跨系统写入时先让新占位进入视口，再由既有气泡布局和焦点请求完成重定位。
    if (anchor && anchor.right > viewport.left && anchor.left < viewport.right &&
      anchor.bottom > viewport.top && anchor.top < viewport.bottom) return;
    if (target.kind === "numbered" || target.kind === "lyric") onLocate({
      kind: target.kind, trackId: target.trackId, measureId: target.measureId, verse: target.verse,
      eventId: target.eventId, startTick: target.tick ?? 0, endTick: target.endTick,
    });
  }, [activeObject, getFloatingAnchor, getFloatingViewport, onLocate]);
  const {
    ref: floatingPanelRef,
    geometry,
  } = useMusicTextFloatingPanel({
    open: !contextChord && floating && (!dismissed || chordModalActive),
    allowNarrowing: kind !== "chord",
    targetKey,
    freeze: compositionActive || compositionCooling || !!pending || numberedBusy || chordModalActive,
    getAnchor: useCallback(
      () => getFloatingAnchor(floatingAnchorTarget),
      [getFloatingAnchor, floatingAnchorTarget],
    ),
    getViewport: getFloatingViewport,
    getObservedElements: getFloatingObservedElements,
    layoutKey: getFloatingAnchor,
  });
  useLayoutEffect(() => {
    if (!contextChord || !floating || !floatingPanelRef.current) return;
    const panel = floatingPanelRef.current;
    const { anchor } = contextChord;
    const ownerWindow = anchor.ownerDocument.defaultView;
    const position = () => {
      if (!anchor.isConnected) return;
      // 以实际表单尺寸对齐菜单行。名称校验、指法预览会改变高度，内容重排后沿用同一锚点重新定位。
      const { width, height } = panel.getBoundingClientRect();
      const next = contextPanelPosition(anchor, width, height);
      setContextPosition((previous) => previous?.left === next.left && previous.top === next.top ? previous : next);
    };
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(panel);
    observer?.observe(anchor);
    ownerWindow?.addEventListener("resize", position);
    ownerWindow?.addEventListener("scroll", position, true);
    return () => {
      observer?.disconnect();
      ownerWindow?.removeEventListener("resize", position);
      ownerWindow?.removeEventListener("scroll", position, true);
    };
  }, [contextChord, floating, floatingPanelRef]);
  // 浮层经由 Portal 挂载，收起属性栏时需要单独隐藏。保留同一个表单实例和其中的草稿以便退出试听后恢复。
  const popoverHidden = floating && (suspendedForPlayback || dismissed || (contextChord ? !contextPosition : geometry.kind !== "placed"));
  useEffect(() => onPopoverHiddenChange(popoverHidden), [popoverHidden, onPopoverHiddenChange]);
  // 隐藏的干净气泡释放谱面操作；未提交草稿继续走原有阻断链。
  const editing =
    (!!activeObject && !popoverHidden && !(activeObject.kind === "chord" && surface === "sidebar")) ||
    settingsDirty ||
    numberedDirty ||
    numberedInputActive ||
    !!pending ||
    compositionActive || compositionCooling ||
    (!!draft && (inputEditing || musicTextDraftValue(draft) !== draft.initial));
  useEffect(() => onEditingChange(editing), [editing, onEditingChange]);
  useEffect(() => {
    if (contextChord || !floating || dismissed || surfaceBlocked()) return;
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
  }, [contextChord, floating, dismissed, geometry, targetKey, surfaceBlocked, floatingPanelRef, onScoreFocus, focusSidebar]);
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
  const lyricDirty = !!draft && musicTextDraftValue(draft) !== draft.initial;
  const restoreTextDraft = () => {
    if (!draft || surfaceBlocked()) return;
    // 连续提交的原文可包含多个位置；恢复保留本次已应用的整条原文。
    setDraft(draft.target.kind === "lyric" && !textConflict
      ? { ...draft, text: (JSON.parse(draft.initial) as { text: string }).text }
      : readMusicTextDraft(editorStore.getState().document, draft.target, draft.lyricMode));
    setTextConflict(false);
    setInspection(0);
    setMessage(null);
  };
  /** 取消待切换时恢复原控件，不把设置字段或 checkbox 的焦点统一抢到文字框。 */
  const continueEditing = () => {
    restoreInputFocus.current = true;
    setPending(null);
  };
  // 只在明确激活或确认区退出时聚焦；页签浏览和预览更新不能抢输入焦点。
  useEffect(() => {
    // 聚焦会同步触发旧控件的 blur（例如 Ant Design Popover），需等 React 提交完成。
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
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
          } else numberedRef.current?.focus(surfaceFocusGroup.current);
        } else {
          const focusPopover = floating && lyricFocusSurface.current === "popover";
          if (focusPopover && popoverHidden) return;
          (focusPopover ? popoverInputRef : inputRef).current?.focus({
            preventScroll: true,
          });
        }
        surfaceFocusGroup.current = undefined;
      }
    });
    return () => { cancelled = true; };
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

  const applyNumbered = async (isCurrent = () => true) => {
    const owner = numberedRef.current;
    if (!owner || composing.current || compositionCoolingRef.current) return "blocked" as const;
    const result = await owner.apply(isCurrent);
    if (result.status === "applied" || result.status === "noop") {
      setNumberedInputActive(false);
      return "applied" as const;
    }
    return result.status === "stale"
      ? ("stale" as const)
      : ("blocked" as const);
  };
  const applyAndNavigate = async (finish: (action: PendingSidebarAction) => boolean) => {
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
        settingsRef.current?.isProtectedDirty()
          ? settingsRef.current.applyGroup("label") ? "applied" : "blocked"
          : kind === "numbered"
          ? await applyNumbered(isCurrent)
          : kind === "score"
            ? settingsRef.current?.applyGroup("label") ? "applied" : "blocked"
            : apply() ? "applied" : "blocked";
      if (result === "applied" && isCurrent())
        finish(action);
      else if (result !== "stale" && isCurrent()) {
        setFocusRequest((value) => value + 1);
      }
    } finally {
      navigationApplying.current = false;
    }
  };
  /** 提交标记在异常、失败及 no-op 时也释放；失败保留当前草稿。 */
  const commit = (command: ILXMScoreCommand, ownModalId?: number) => {
    if (composing.current || compositionCoolingRef.current || compositionCooling) return null;
    const modal = modals.getSnapshot();
    if (modal && command.type !== LXMScoreCommandEnum.SetScoreInfo && modal.id !== ownModalId) return null;
    if (suspendedChord.current) {
      const authorization = infoAuthorization.current;
      const paused = suspendedChord.current;
      const inspection = drafts.inspect(authorization?.identity.owner);
      if (command.type !== LXMScoreCommandEnum.SetScoreInfo || !authorization ||
        !sameEditorVersion(captureEditorVersion(editorStore.getState()), authorization.version) ||
        authorization.identity.owner.generation !== authorization.identity.generation ||
        !draftRegistrationRef.current?.isCurrent(paused.identity) || modals.isOpen() ||
        inspection.composing || inspection.busy || inspection.pending.some(record => {
          const registration = drafts.registrationOf(record);
          return !registration || (registration.owner !== paused.identity.owner &&
            registration.owner !== authorization.identity.owner);
        })) return null;
      infoAuthorization.current = null;
    }
    committing.current = true;
    try {
      const result = editorStore.getState().execute(command);
      if (result?.ok) {
        baseline.current = result.document;
        if (navigationApplying.current) pendingVersion.current = captureEditorVersion(editorStore.getState());
        if (
          result.nextNumberedFocus &&
          // 正文替换可能重建选中的多音成员；NumberedEditor 在同一 owner 内重绑，
          // 这里切换 target 会重挂载输入并丢失刚应用的完整连续内容。
          command.type !== "numbered.sequence.overwrite" &&
          command.type !== "numbered.sequence.insert" &&
          command.type !== "numbered.range.replace" &&
          command.type !== "numbered.event.set" &&
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
  const apply = (advanceSource?: LyricFocusSurface): boolean => {
    if (modals.isOpen() || suspendedChord.current) return false;
    if (!draft || issue || committing.current || composing.current || compositionCoolingRef.current || compositionCooling) return false;
    if (draft.target.kind === "lyric" &&
      lyricDraftMappingDependency(score, draft) !== lyricDraftMappingDependency(editorStore.getState().document, draft)) {
      setTextConflict(true);
      setInspection(0);
      setMessage("歌词位置或原内容已变化，输入已保留，请重新检查。");
      return false;
    }
    const closeAfterApply = () => {
      // 校验或提交失败时继续显示原输入。导航确认有自己的后续目标，由该目标切换负责关闭菜单。
      if (contextChordRef.current && !navigationApplying.current) closeContextChord(true);
    };
    if (draft.target.kind === "chord" && musicTextDraftValue(draft) === draft.initial) {
      closeAfterApply();
      return true;
    }
    const target = draft.target;
    // 使用提交前规划的末项（包括末尾清空项）记录边界，保存后虚拟位置可能变成 gap。
    const last = advanceSource && advanceAfterApply && plan?.rows.some((row) => row.status === "add" || row.status === "change")
      ? plan.rows.at(-1)?.target : null;
    const lastMeasure = last && score?.score.tracks.find((track) => track.id === last.trackId)?.measures.find((measure) => measure.id === last.measureId);
    const lastPosition = last && lastMeasure ? resolveLyricPosition(lastMeasure, last) : null;
    const result = commit(
      target.kind === "lyric"
        ? sequence && parsed?.ok
          ? {
              type: LXMScoreCommandEnum.SetLyricSequence,
              ...target,
              verse: target.verse!,
              items: parsed.items,
              allowOverwrite: true,
            }
          : {
              type: LXMScoreCommandEnum.SetLyric,
              ...target,
              verse: target.verse!,
              text: draft.text,
            }
        : removingChord && existing ? {
            type: LXMScoreCommandEnum.RemoveChordSymbol,
            ...target,
            chordSymbolId: existing.id,
          } : {
            type: LXMScoreCommandEnum.SetChordSymbol,
            ...target,
            ...draft.chord,
            display: draft.chord.display,
          },
    );
    if (!result?.ok) return false;
    if (result.changed && last && lastPosition && advanceSource) {
      const next = nextLyricTextInput(result.document, last, lastPosition.endTick);
      if (next && advanceTextTarget(next, advanceSource)) return true;
    }
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
    if (result.changed && advanceSource && target.kind === "lyric") {
      lyricFocusSurface.current = advanceSource;
      focusTarget("input");
    }
    setMessage(target.kind === "lyric" ? null : result.changed ? removingChord ? "已删除，保留当前拍点。" : "已应用" : "内容未变化");
    if (target.kind === "chord") closeAfterApply();
    return true;
  };
  const applyLyricPrimary = (source: LyricFocusSurface) => {
    if (surfaceBlocked() || !draft || draft.target.kind !== "lyric") return false;
    return lyricDirty && apply(source);
  };
  const remove = () => {
    if (!draft || composing.current || compositionCoolingRef.current) return;
    if (!existing) {
      if (draft.target.kind === "chord") {
        setDraft(readMusicTextDraft(editorStore.getState().document, draft.target, draft.lyricMode));
        setMessage(null);
      }
      return;
    }
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
      (chordModalActive || chordSuspended || musicTextDraftValue(draft) !== draft.initial ||
        (compositionActive && kind !== "score"))
    ) {
      records.push({
        id: `music:${targetKey}`,
        kind: draft.target.kind,
        targetKey,
        label: draft.target.kind === "lyric" ? "歌词输入" : "和弦编辑",
        location: draftLocation(draft.target),
        dirty: chordModalActive || chordSuspended || musicTextDraftValue(draft) !== draft.initial,
        composing: compositionActive,
        canApply: !issue && !pending && !chordModalActive && !chordSuspended,
        error: issue,
        version,
        inputKey: musicTextDraftValue(draft),
        focus: () => {
          if (modals.isOpen()) {
            document.querySelector<HTMLElement>('.ant-modal:not([aria-hidden="true"]) input')?.focus();
            return true;
          }
          if (suspendedChord.current) { onExpandSidebar(); setPropertyTab("song"); return true; }
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
          if (composing.current || compositionCoolingRef.current || pending || modals.isOpen() || suspendedChord.current) return false;
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
  const resumeChord = () => {
    const paused = suspendedChord.current;
    if (!paused || settingsRef.current?.isComposing() || settingsRef.current?.readStatus().busy) return;
    if (!settingsRef.current?.discardSong()) return;
    if (!draftRegistration.isCurrent(paused.identity) ||
      !sameEditorVersion(captureEditorVersion(editorStore.getState()), paused.version) ||
      !normalizeMusicTextTarget(editorStore.getState().document, paused.draft.target)) {
      suspendedChord.current = null; setChordSuspended(false); setDraft(null);
      setMessage("原和弦目标已变化，请重新选择。"); return;
    }
    suspendedChord.current = null; setChordSuspended(false);
    setDraft(paused.draft); setKind("chord"); setPropertyTab("chord");
    setSurface(paused.surface); setDismissed(false); setActiveObject(paused.draft.target);
    setMessage(null); focusTarget("input");
  };
  const suspendForSettings = () => {
    const current = draftLive.current;
    if (!current || current.target.kind !== "chord" || suspendedChord.current ||
      composing.current || compositionCoolingRef.current || pending || numberedBusy ||
      settingsRef.current?.isComposing() || settingsRef.current?.readStatus().busy) return false;
    suspendedChord.current = { draft: structuredClone(current), identity: draftRegistration.captureIdentity(),
      version: captureEditorVersion(editorStore.getState()), surface };
    // 曲谱设置可保留和弦草稿，菜单行却无法继续作为锚点。恢复草稿时采用常规谱面定位。
    changeContextChord(null);
    setChordSuspended(true); setChordModalActive(false); setKind("score"); setPropertyTab("song");
    setDismissed(true); setInputEditing(false); onExpandSidebar();
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#settings-mode')?.focus());
    return true;
  };
  const guardSettingsApply = (group: SettingsGroup | undefined, identity?: EditorDraftRegistration) => {
    if (!suspendedChord.current) return !modals.isOpen();
    const paused = suspendedChord.current;
    const inspection = drafts.inspect(identity?.owner);
    if (group !== "info" || !identity || identity.generation !== identity.owner.generation ||
      !draftRegistration.isCurrent(paused.identity) ||
      !sameEditorVersion(captureEditorVersion(editorStore.getState()), paused.version) ||
      modals.isOpen() || inspection.busy || inspection.composing ||
      inspection.pending.some(record => drafts.registrationOf(record)?.owner !== paused.identity.owner)) return false;
    infoAuthorization.current = { identity, version: captureEditorVersion(editorStore.getState()) };
    return true;
  };
  const rebaseSuspendedChord = () => {
    const paused = suspendedChord.current;
    if (!paused) return;
    const fresh = readMusicTextDraft(editorStore.getState().document, paused.draft.target, paused.draft.lyricMode);
    if (!fresh || fresh.initial !== paused.draft.initial) {
      suspendedChord.current = null; setChordSuspended(false); setDraft(null);
      setMessage("原和弦内容已变化，请重新打开。"); return;
    }
    draftRegistration.invalidateOwner();
    ownerGeneration.current += 1;
    paused.identity = draftRegistration.captureIdentity();
    paused.version = captureEditorVersion(editorStore.getState());
    setDraft({ ...paused.draft });
  };
  const openChordModal = (mode: "library" | "custom", tab: ChordLibraryTab = "all", seed?: ChordDraft, trigger?: HTMLElement) => {
    const parent = draftLive.current;
    if (!parent || parent.target.kind !== "chord" || surfaceBlocked() || suspendedChord.current ||
      !score || !track) return;
    const token = chordSession.open();
    if (token === null) return;
    const failedHandoff = () => {
      chordSession.cancel(token);
      setChordModalActive(false);
      setDismissed(false);
      setMessage("原编辑目标已变化，请重新打开。");
      return false;
    };
    const tuning = track.tuning.strings;
    const focused = document.activeElement;
    const parentSurface = surface === "popover" ? floatingPanelRef.current : document.querySelector<HTMLElement>("#music-text-sidebar");
    const opener = trigger ?? (focused instanceof HTMLElement && parentSurface?.contains(focused) ? focused : null);
    const restore = () => {
      requestAnimationFrame(() => {
        if (modals.isOpen()) return;
        if (opener?.isConnected && !opener.closest('[hidden],[inert],[aria-hidden="true"]') && opener.getClientRects().length) {
          opener.focus({ preventScroll: true });
          return;
        }
        const input = surface === "popover" ? popoverInputRef.current : inputRef.current;
        if (input?.isConnected && !input.closest('[hidden],[inert],[aria-hidden="true"]') && input.getClientRects().length)
          input.focus({ preventScroll: true });
        else onScoreFocus();
      });
    };
    const openSurface = (nextMode: "library" | "custom", value: ChordDraft): boolean => {
      if (!chordSession.isCurrent(token)) return failedHandoff();
      let requestId: number | null = null;
      const closeRef = { current: null as ((reason?: "escape" | "cancel") => void) | null };
      const cancel = () => {
        if (requestId !== null) modals.close(requestId, "cancel");
      };
      const complete = (next: ChordDraft) => {
        if (requestId === null) return;
        const updated = chordSession.complete(token, () => {
          setDraft({ ...parent, chord: { ...structuredClone(next), display: parent.chord.display } });
          setMessage(null);
        });
        modals.close(requestId, updated ? "resolved" : "stale");
      };
      const toSettings = () => {
        if (requestId === null || !chordSession.isCurrent(token)) return;
        modals.handoff(requestId, () => {
          if (!chordSession.isCurrent(token)) return failedHandoff();
          chordSession.cancel(token);
          return suspendForSettings() || failedHandoff();
        });
      };
      const content = nextMode === "custom" ? (
        <ChordCustomSurface seed={value} tuning={tuning} onComplete={complete} onCancel={cancel}
          document={score} presetsEnabled={JSON.stringify(tuning.map(s => [s.pitch, s.midi])) === JSON.stringify([["E4",64],["B3",59],["G3",55],["D3",50],["A2",45],["E2",40]])}
          requestCloseRef={closeRef}
          onSave={async chord => {
            if (!chordSession.isCurrent(token)) return { ok: false, message: "原编辑目标已变化。" };
            const result = saveCustomChordVoicing(chord, tuning);
            return result.ok ? { ok: true, message: result.persistence === "browser" ? "已保存到我的指法；取消编辑仍会保留收藏。" : "本次会话可用，未保存到浏览器。" }
              : { ok: false, message: result.error };
          }} />
      ) : (
        <ChordLibraryModal draft={value} document={score} tuning={tuning} presetsEnabled={JSON.stringify(tuning.map(s => [s.pitch, s.midi])) === JSON.stringify([["E4",64],["B3",59],["G3",55],["D3",50],["A2",45],["E2",40]])}
          initialTab={tab} onConfirm={complete} onCancel={cancel} onOpenSettings={toSettings}
          onOpenCustom={next => {
            if (requestId !== null) modals.handoff(requestId, () => openSurface("custom", next ?? value));
          }} />
      );
      requestId = modals.open({ kind: nextMode === "custom" ? "chord-custom" : "chord-library",
        title: nextMode === "custom" ? "自定义指法" : "和弦库", message: "",
        subtitle: nextMode === "custom" ? `${draftLocation(parent.target) ?? "当前和弦"} ／ ${JSON.stringify(tuning.map(s => s.pitch)) === JSON.stringify(["E4","B3","G3","D3","A2","E2"]) ? "标准调弦 E A D G B E" : "当前轨道调弦"}` : undefined,
        content, version: captureEditorVersion(editorStore.getState()),
        onRequestClose: nextMode === "custom" ? reason => closeRef.current?.(reason) : undefined,
        isValid: () => chordSession.isCurrent(token), restoreFocus: restore,
        onClose: reason => {
          if (reason !== "handoff") { chordSession.cancel(token); setChordModalActive(false); setDismissed(false); }
          if (reason === "stale") setMessage("原编辑目标已变化，请重新打开。");
        } });
      return requestId !== null || failedHandoff();
    };
    if (openSurface(mode, seed ?? parent.chord)) { setChordModalActive(true); setDismissed(true); }
    else chordSession.cancel(token);
  };
  const chordLibraryProps = {
    document: score ?? undefined, tuning: track?.tuning.strings, showChordDiagrams,
    onShowChordDiagramsChange,
    onOpenLibrary: (trigger: HTMLElement) => openChordModal("library", "all", undefined, trigger),
    onOpenCustom: (seed?: ChordDraft) => openChordModal("custom", "all", seed),
  };
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
  const changeLyricVerse = (verse: ILXMLyricVerse) => {
    if (!score || verse > getLyricVerseCount(score)) return;
    if (draft?.target.kind === "lyric") {
      lyricFocusSurface.current = "sidebar";
      return request({ type: "target", target: { ...draft.target, verse }, lyricFocusSurface: "sidebar" });
    }
    setLyricVerse(verse);
  };
  const performParagraphRowCommand = (command: ParagraphRowCommand): boolean => {
    const current = editorStore.getState();
    const version = captureEditorVersion(current);
    if (!version.document || modals.isOpen()) return false;
    const removingNumbered = command.type === LXMScoreCommandEnum.RemoveNumberedRow;
    const removingLyric = command.type === LXMScoreCommandEnum.RemoveLyricVerse;
    const activeLyric = draftLive.current?.target.kind === "lyric" ? draftLive.current.target : null;

    const focusRowAction = () => {
      const control = rowMenuRef.current ?? addRowRef.current;
      control?.focus({ preventScroll: true });
      return !!control;
    };
    const run = (modalId?: number) => {
      const result = commit({ ...command, expectedRevision: version.document!.documentRevision }, modalId);
      if (!result?.ok || !result.changed) return false;
      const next = result.document;
      if (removingLyric || removingNumbered) {
        const count = getMusicTextRows(next).lyricVerses;
        ownerGeneration.current += 1;
        draftRegistrationRef.current?.invalidateOwner();
        if (removingLyric) {
          const verse = Math.min(command.verse, count || 1) as ILXMLyricVerse;
          setLyricVerse(verse);
          if (activeLyric && count) {
            loadTarget({ ...activeLyric, verse }, "sequence", "input", "sidebar");
            setMessage("已删除当前歌词段。");
            return true;
          }
        }
        activeTextOwner.current = false;
        numberedRef.current?.discard();
        setNumberedTarget(null);
        setNumberedPreview(null);
        setNumberedDirty(false);
        setNumberedInputActive(false);
        setDraft(null);
        setActiveObject(null);
        setTextConflict(false);
        setInputEditing(false);
        setDismissed(true);
        focusDestination.current = "score";
        if (removingNumbered) {
          const store = editorStore.getState();
          store.setNumberedSelection(null);
          store.setSelectedNumberedMarkId(null);
        }
        setMessage(removingNumbered ? "已删除简谱行。歌词已保留。" : "已删除当前歌词段。");
        if (modalId === undefined) requestAnimationFrame(focusRowAction);
        return true;
      }

      const preferred = activeLyric ?? numberedTarget ?? current.numberedSelection ?? current.selection?.focus;
      const track = next.score.tracks[0];
      const firstMeasure = track?.measures[0];
      const firstBeat = firstMeasure?.beats[0];
      const first = track && firstMeasure && firstBeat
        ? { trackId: track.id, measureId: firstMeasure.id, beatId: firstBeat.id, string: 1 } : null;
      const resolved = resolveNumberedEditorTarget(next, preferred ?? first);
      if (command.type === LXMScoreCommandEnum.AddNumberedRow) {
        if (resolved && perform({ type: "target", target: { ...resolved, kind: "numbered" } })) {
          setSurface("sidebar");
          surfaceFocusGroup.current = "content";
        }
        setMessage("已添加简谱行。");
        return true;
      }
      const verse = getLyricVerseCount(next);
      const source = activeLyric ?? (resolved ? { ...resolved, kind: "numbered" as const } : null);
      let lyricTarget = resolveParagraphLyricTarget(next, source, verse);
      if (!lyricTarget && !preferred && track && firstMeasure) {
        const firstPosition = planLyricPositions(firstMeasure)[0];
        if (firstPosition) lyricTarget = { ...firstPosition, trackId: track.id, measureId: firstMeasure.id, kind: "lyric", verse };
      }
      setLyricVerse(verse);
      if (lyricTarget && perform({ type: "target", target: lyricTarget, lyricFocusSurface: "sidebar" })) {
        setSurface(surface);
      }
      setMessage(`已添加第 ${verse} 段歌词。`);
      return true;
    };

    let title: string;
    let impact: string;
    if (removingNumbered) {
      const track = version.document.score.tracks[0];
      const events = track?.measures.flatMap((measure) => measure.numberedVoice.events) ?? [];
      const notes = events.reduce((count, event) => count + (event.kind === "notes" ? event.items.length : 0), 0);
      const rests = events.filter((event) => event.kind === "rest").length;
      const continuations = events.filter((event) => event.kind === "continuation").length;
      const marks = track?.numberedMarks.length ?? 0;
      if (!notes && !rests && !continuations && !marks) return run();
      title = "删除简谱行？";
      impact = `将移除整份曲谱中的简谱内容，包括 ${notes} 个音符、${rests} 个休止、${continuations} 个延音和 ${marks} 个附加记号。原歌词可继续编辑。`;
    } else if (removingLyric) {
      const count = version.document.score.tracks.reduce((total, track) => total + track.measures.reduce(
        (words, measure) => words + measure.lyrics.filter((lyric) => lyric.verse === command.verse).length, 0), 0);
      if (!count) return run();
      title = `删除第 ${command.verse} 段歌词？`;
      impact = `将移除这一段在整份曲谱中的 ${count} 处歌词，后续段落会依次补位。`;
    } else return run();

    const id = modals.open({
      kind: "music-text-row-remove",
      version,
      title,
      message: `${impact} 可使用撤销恢复。`,
      confirmLabel: "删除",
      confirmDanger: true,
      confirm: ({ isCurrent }) => {
        const modal = modals.getSnapshot();
        return !!modal && isCurrent() && run(modal.id);
      },
      restoreFocus: () => { requestAnimationFrame(focusRowAction); },
    });
    return id !== null;
  };
  const finishPending = (action: PendingSidebarAction) => {
    if (action.type !== "paragraphRow") return perform(action);
    setPending(null);
    return performParagraphRowCommand(action.command);
  };
  const requestParagraphRow = (command: ParagraphRowCommand) => {
    if (surfaceBlocked() || numberedRef.current?.readStatus().busy) return;
    if (lyricDirty || numberedRef.current?.dirty) holdPending({ type: "paragraphRow", command });
    else performParagraphRowCommand(command);
  };
  const lyricFormProps = draft && {
    document: score ?? undefined,
    draft,
    plan,
    issue,
    disabled: surfaceDisabled,
    canApply: lyricDirty,
    textAdvance,
    onApply: applyLyricPrimary,
    onTextChange: (text: string) => {
      if (text !== draft.text) setTextConflict(false);
      setDraft({ ...draft, text });
      setInspection(0);
      setMessage(null);
    },
    onInspect: (index: number) => {
      setInspection(index);
      const target = plan?.rows[index]?.target;
      if (!target) return;
      const measure = score?.score.tracks.find((track) => track.id === target.trackId)?.measures.find((measure) => measure.id === target.measureId);
      const position = measure && resolveLyricPosition(measure, target);
      if (position) onLocate({ kind: "lyric", verse: target.verse, trackId: target.trackId, measureId: target.measureId, eventId: position.eventId, startTick: position.tick, endTick: position.endTick });
    },
  };
  // 只把真实目标交给摘要；初始空选区不能用空 ID 伪造一个失效的小节。
  const resolvedRange = score && continuousRange ? resolveMusicTextRange(score, continuousRange) : null;
  const rangeFocus = resolvedRange?.ok && continuousRange
    ? { trackId: continuousRange.trackId, measureId: continuousRange.focus.measureId } : undefined;
  const numberedRange = continuousRange?.kind === "numbered" ? continuousRange : null;
  const numberedRangeFocus = numberedRange && resolvedRange?.ok
    ? resolvedRange.slots.find((slot) => sameRangePoint(slot, numberedRange.focus)) : undefined;
  const numberedNoteSelection = score && numberedRange && numberedRangeFocus
    ? resolveNumberedEditorTarget(score, { ...numberedRangeFocus, trackId: numberedRange.trackId, kind: "numbered" })
    : continuousRange ? null : numberedSelection;
  const numberedNote = propertyTab === "selection" && selectionDetail === "note" && numberedNoteSelection;
  const numberedTextActions = score && numberedNote ? (
    <div
      className={musicTextSidebarStyles.numberedTextActions}
      role="group"
      aria-label="编辑所选简谱位置的文本"
      inert={!!pending && !numberedBusy}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || modals.isOpen() || suspendedChord.current ||
          shouldIgnoreMusicTextKey(event.nativeEvent, composing.current, compositionEndedAt.current)) return;
        event.preventDefault();
        if (textSession) cancelTextEditing();
        else returnToScore();
      }}
    >
      {(["lyric", "numbered"] as const).map((textKind) => {
        const source = { ...numberedNote, kind: "numbered" as const };
        const range = numberedRange ? {
          ...numberedRange, kind: textKind, verse: textKind === "lyric" ? paragraphVerse : undefined,
        } : null;
        const target = range ? null : textKind === "lyric"
          ? resolveParagraphLyricTarget(score, source, paragraphVerse) : source;
        const resolved = range ? resolveMusicTextRange(score, range) : null;
        const valid = resolved?.ok ?? !!target;
        const reason = valid ? undefined : textKind === "lyric"
          ? "所选位置无法写入歌词，请选择可承载歌词的位置。"
          : "简谱选区已失效，请重新选择。";
        return (
          <button key={textKind} type="button" aria-disabled={!valid || surfaceDisabled} title={reason}
            onClick={() => {
              if (!valid || surfaceDisabled || rangeEditor.current?.isComposing() || rangeEditor.current?.isDirty()) return;
              if (range) request({ type: "range", range, protectTextDraft: true });
              else if (target) request({ type: "target", target, targetSurface: "sidebar", protectTextDraft: true });
            }}>
            {textKind === "lyric" ? "编辑歌词" : "编辑简谱"} <span aria-hidden="true">→</span>
          </button>
        );
      })}
    </div>
  ) : null;
  const measureTarget = rangeFocus ?? detailTarget ?? numberedSelection ?? selection?.focus;
  const copyTrack = score?.score.tracks[0];
  let selectedCopyRange: { start: string; end: string } | undefined;
  if (score && copyTrack) {
    if (resolvedRange?.ok && rangeFocus?.trackId === copyTrack.id) {
      if (resolvedRange.slots.length) selectedCopyRange = {
        start: resolvedRange.slots[0]!.measureId, end: resolvedRange.slots.at(-1)!.measureId,
      };
    } else if (numberedSelection?.trackId === copyTrack.id) {
      if (resolveNumberedEditorTarget(score, numberedSelection)) selectedCopyRange = {
        start: numberedSelection.measureId, end: numberedSelection.measureId,
      };
    } else if (selection?.focus.trackId === copyTrack.id) {
      const resolved = resolveTabCellSelection(score, selection);
      if (resolved.ok && resolved.range.beats.length) selectedCopyRange = {
        start: resolved.range.beats[0]!.measureId, end: resolved.range.beats.at(-1)!.measureId,
      };
    }
  }
  const context = deriveSidebarContext({ document: score,
    target: numberedNote ? null : activeObject?.kind === "numbered" ? numberedPreview ?? activeObject : activeObject,
    task: propertyTab === "selection" ? selectionDetail : undefined,
    selection, numberedSelection: numberedNote || numberedSelection, song: propertyTab === "song",
    measureTarget: propertyTab === "selection" && selectionDetail === "measure"
      ? measureTarget : undefined });
  if (numberedNote && context.valid) {
    context.title = numberedNote.kind === "numberedEvent" ? "简谱音符" : "简谱录入位置";
    context.scope = "";
  }
  const hasExplicitSelection = !!rangeFocus || (numberedSelection
    ? !!score && !!resolveNumberedEditorTarget(score, numberedSelection)
    : !!selection && isScoreSelectionValid(score, selection));
  const hasRequestedMeasure = selectionToolsRequested && !!detailTarget && !!score?.score.tracks
    .find((track) => track.id === detailTarget.trackId)?.measures.some((measure) => measure.id === detailTarget.measureId);
  const showSelectionInvitation = !hasExplicitSelection && !hasRequestedMeasure;
  // 正文 Portal 共用实际活动表单，owner 和 host 仍常驻以保留草稿。
  // 试听仅隐藏表单，保留表面的逻辑激活状态。手动收起或切换页签仍按既有规则处理未应用的设置。
  const settingsSurface = collapsedByEditor ? null : score && propertyTab === "song" ? "song"
    : score && propertyTab === "selection" && selectionDetail === "measure" && !showSelectionInvitation && context.valid
      ? "measure" : null;
  const numberedFormActive = !!score && propertyTab === "paragraph" && kind === "numbered" && activeObject?.kind === "numbered";
  const paragraphRowControls = propertyTab === "paragraph" && (kind === "numbered" || kind === "lyric") ? textRows : null;
  const numberedRows = kind === "numbered";
  const paragraphHasRow = numberedRows ? textRows?.numbered : !!textRows?.lyricVerses;
  const addRowReason = numberedRows ? textRows?.numbered ? "曲谱已有简谱行" : null
    : textRows?.lyricVerses === 4 ? "最多支持四段歌词" : null;
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
        className={musicTextSidebarStyles.musicTextSidebar}
        data-music-text-sidebar
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
        <header className={musicTextSidebarStyles.sidebarHeader} inert={!!pending}>
          <Tabs
            activeKey={continuousRange && !showRangeTools ? "paragraph" : propertyTab}
            onChange={(key) => {
              if (rangeEditor.current?.isComposing()) return;
              const next = key as PropertyTab;
              if (continuousRange && next === "paragraph") {
                setShowRangeTools(false);
                return;
              }
              if (continuousRange && next === "selection" && rangeEditor.current?.isDirty()) return;
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
              ) {
                if (continuousRange && next === "selection") setShowRangeTools(true);
                else onRangeChange(null);
                setPropertyTab(next);
              }
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
        {continuousRange && !showRangeTools ? <MusicTextRangeEditor
          key={JSON.stringify(continuousRange)}
          ref={rangeEditor}
          range={continuousRange}
          onChange={onRangeChange}
          onClose={() => { onRangeChange(null); onScoreFocus(); }}
          onScoreFocus={onScoreFocus}
          onRequestFocus={onExpandSidebar}
        /> : <><SidebarObjectContext context={context} onLocate={onLocate} compact={!!paragraphRowControls}
          positionAction={numberedTextActions}
          action={paragraphRowControls && <Tooltip title={addRowReason} trigger={["hover", "focus"]}>
            <Button ref={addRowRef} size="small" color="primary" variant="text" icon={<PlusOutlined />}
              className={musicTextSidebarStyles.addParagraphRow}
              aria-label={numberedRows ? "添加简谱行" : "添加歌词行"}
              aria-disabled={!!addRowReason || surfaceDisabled}
              aria-description={addRowReason ?? undefined}
              onClick={() => {
                if (addRowReason || surfaceBlocked()) return;
                requestParagraphRow(numberedRows
                  ? { type: LXMScoreCommandEnum.AddNumberedRow }
                  : { type: LXMScoreCommandEnum.AddLyricVerse, ...(textRows?.lyricVerses ? {} : { first: true }) });
              }}>{numberedRows ? "简谱" : "歌词"}</Button>
          </Tooltip>}
          onCurrentSelection={() => numberedSelection
            ? request({ type: "target", target: { ...numberedSelection, kind: "numbered" } })
            : request({ type: "selection", selection })} />
        <section
        key="music-text-editor-surface"
        className={musicTextSidebarStyles.musicTextSurface}
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
         onKeyDown={(e) => {
           e.stopPropagation();
           if (e.defaultPrevented) return;
          if (shouldIgnoreMusicTextKey(e.nativeEvent, composing.current, compositionEndedAt.current)) {
            if (e.key === "Enter") e.preventDefault();
            return;
          }
          if (modals.isOpen() || suspendedChord.current) return;
          // Select 自己处理方向键、Enter 和 Esc，不能把关闭下拉框解释成退出编辑。
          if (
            e.target instanceof Element &&
            e.target.closest(".ant-select, .ant-select-dropdown")
          ) {
            e.stopPropagation();
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
            const source = e.target instanceof Element && e.target.closest("[data-music-text-floating]") ? "popover" : "sidebar";
            if (kind === "numbered") numberedRef.current?.applyContent(undefined, source);
            else if (kind === "lyric") applyLyricPrimary(source);
            else apply();
            return;
          }
          if (kind === "chord" && draft?.target.kind === "chord" && isEditorInputEnter(e)) {
            e.preventDefault();
            if (!e.repeat) apply();
          }
        }}
      >
        <div
          className={musicTextSidebarStyles.sidebarBody}
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
              if (draft.target.kind === "lyric") lyricFocusSurface.current = "sidebar";
              focusDestination.current = "input";
              setInputEditing(true);
            }
          }}
        >
          {score && (
            <div hidden={propertyTab !== "song"}>
              {chordSuspended && <div className={musicTextSidebarStyles.chordReturn}>
                <Button onClick={resumeChord}>返回和弦编辑</Button>
              </div>}
              <div ref={setSongHost} />
              <ScoreSettings
                ref={settingsRef}
                document={score}
                requestedMeasureId={rangeFocus?.measureId ?? detailTarget?.measureId ?? selection?.focus.measureId}
                selectedCopyRange={selectedCopyRange ?? null}
                songHost={songHost}
                measureHost={measureHost}
                activeSurface={settingsSurface}
                onStatus={setSettingsStatus}
                commit={commit}
                guardApply={guardSettingsApply}
                onInfoApplied={rebaseSuspendedChord}
                onApplySettled={() => { infoAuthorization.current = null; }}
                executeTool={executeTool}
                onFocusRequest={(group) => {
                  if (suspendedChord.current) return group === "info";
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
              <div className={musicTextSidebarStyles.sidebarEmpty}>
                <div className={musicTextSidebarStyles.emptyIllustration} aria-hidden="true"><svg viewBox="0 0 110 70"><path d="M8 18h94M8 28h94M8 38h94M8 48h94M8 58h94" /><rect x="36" y="12" width="28" height="51" rx="5" /><path d="M50 28v20m-10-10h20" /></svg></div>
                <p>点击谱面中的音符或小节开始编辑</p>
              </div>
            ) : score && onToolAction && executeTool ? (
              <>
                <Segmented className={musicTextSidebarStyles.selectionTaskTabs} block aria-label="选区任务" value={selectionDetail}
                  options={[{value:"note",label:"音符"},{value:"measure",label:"小节"}]}
                  onChange={(destination) => {
                    const state = editorStore.getState();
                    request({ type: "tool", kind: "score", destination: destination as ToolNavigation,
                      target: measureTarget,
                      sessionId: state.sessionId, sessionVersion: state.sessionVersion });
                  }} />
                <div
                  data-selection-detail="note"
                  hidden={selectionDetail !== "note"}
                >
                  {strumInspector}
                  <NoteToolDetails
                    numberedNote={!!numberedNote}
                    document={score}
                    selection={selection}
                    blocked={editing}
                    onAction={onToolAction}
                    tupletTools={<section className={musicTextSidebarStyles.inlineTupletTools} aria-label="连音" data-numbered-note={!!numberedNote}>
                      <h3>连音</h3>
                      <TupletToolbar document={score} selection={numberedNote ? null : selection}
                        presentation="sidebar" execute={executeTool} blocked={editing}
                        blockedReason={numberedNote ? "简谱暂不支持连音，请选择 TAB 同小节内连续拍点。" : undefined}
                        onSuccess={onScoreFocus} />
                    </section>}
                  />
                  <SidebarRhythmPatternPanel visible={!collapsed && propertyTab === "selection" && selectionDetail === "note"} />
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
              </>
            ) : (
              propertyTab === "selection" && (
                <section
                  className={musicTextSidebarStyles.selectionPanel}
                  aria-label="当前选区"
                >
                  {selection ? (
                    <>
                      <div className={musicTextSidebarStyles.selectionPanelHeader}>
                        <strong>当前选区</strong>
                        <span>已定位</span>
                      </div>
                      <p>
                        第 {selectionMeasureIndex + 1} 小节 · 第{" "}
                        {selectionBeatIndex + 1} 拍点 · 第{" "}
                        {selection.focus.string} 弦
                      </p>
                      <p className={musicTextSidebarStyles.sidebarTip}>
                        时值、休止、小节与技巧操作位于顶部工具带。
                      </p>
                    </>
                  ) : (
                    <>
                      <h3>开始编写你的曲谱</h3>
                      <p>
                        点击六线谱中的位置，输入品位。拖动可选择多个拍点与弦。
                      </p>
                      <ol className={musicTextSidebarStyles.selectionSteps}>
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
              className={musicTextSidebarStyles.paragraphTabs}
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
          {paragraphRowControls && paragraphHasRow && <div className={musicTextSidebarStyles.paragraphRowControls}>
            {numberedRows ? <strong>简谱行</strong> : <>
              <label htmlFor="lyric-verse">段落</label>
              <Select id="lyric-verse" aria-label="歌词段落" value={paragraphVerse}
                disabled={surfaceDisabled} onChange={changeLyricVerse}
                options={([1, 2, 3, 4] as const).slice(0, paragraphRowControls.lyricVerses).map((value) =>
                  ({ value, label: `第${["一", "二", "三", "四"][value - 1]}段` }))} />
            </>}
            <Dropdown trigger={["click"]} disabled={surfaceDisabled} menu={{
              items: [{ key: "remove", danger: true, label: numberedRows ? "删除简谱行" : "删除当前段" }],
              onClick: () => requestParagraphRow(numberedRows
                ? { type: LXMScoreCommandEnum.RemoveNumberedRow }
                : { type: LXMScoreCommandEnum.RemoveLyricVerse, verse: paragraphVerse }),
            }}>
              <Button ref={rowMenuRef} type="text" size="small" icon={<EllipsisOutlined />}
                aria-haspopup="menu" disabled={surfaceDisabled} aria-label={numberedRows ? "简谱行操作" : "歌词段落操作"} />
            </Dropdown>
          </div>}
          {propertyTab === "paragraph" && kind === "numbered" && !textSession && (
            <div className={musicTextSidebarStyles.sidebarEmpty}>
              <div className={musicTextSidebarStyles.emptyIllustration} aria-hidden="true"><svg viewBox="0 0 110 70"><path d="M8 18h94M8 28h94M8 38h94M8 48h94M8 58h94" /><rect x="36" y="12" width="28" height="51" rx="5" /><path d="M50 28v20m-10-10h20" /></svg></div>
              <h3>{numberedEntry ? "从当前谱面位置开始" : "先选择简谱位置"}</h3>
              {numberedEntry && <Button type="primary" onClick={() => {
                if (request({ type: "target", target: { ...numberedEntry, kind: "numbered" } }) === "accepted") {
                  onExpandSidebar();
                  surfaceFocusGroup.current = "content";
                }
              }}>录入简谱</Button>}
            </div>
          )}
          {numberedFormActive && score && (
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
                  onSelectTarget={advanceTextTarget}
                  textAdvance={textAdvance}
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
                  <div className={musicTextSidebarStyles.sidebarEmpty}>
                    {kind === "lyric" ? (
                      <FileTextOutlined style={{ fontSize: 36 }} />
                    ) : (
                      <CustomerServiceOutlined style={{ fontSize: 36 }} />
                    )}
                    <h3>{kind === "lyric"
                      ? lyricStart
                        ? paragraphSource ? "从当前谱面位置开始" : "从首个可录入位置开始"
                        : "先选择歌词位置"
                      : "先选择单个 TAB 拍点"}</h3>
                    {kind !== "lyric" && <p>选择六线谱中的单个拍点，在这里设置和弦名称与指法。</p>}
                    {kind === "lyric" && lyricStart && <Button
                      ref={editButtonRef}
                      type="primary"
                      onClick={() => {
                        request({
                          type: "target",
                          lyricFocusSurface: "sidebar",
                          target: lyricStart,
                        });
                      }}
                    >
                      录入歌词
                    </Button>}
                  </div>
                ) : kind === "lyric" ? (
                  <LyricFormView
                    {...lyricFormProps!}
                    inputRef={(element) => { inputRef.current = element; }}
                  />
                 ) : (
                  <div data-chord-full-editor inert={(compositionActive || compositionCooling) && compositionOrigin === "popover"}>
                  <ChordEditor
                    {...chordLibraryProps}
                    allowEmptyName={!!existing}
                    onApply={() => apply()}
                    canApply={lyricDirty && !issue}
                    error={issue}
                    onRemove={remove}
                    canRemove={!!existing || !!draft.chord.chord.name || !!draft.chord.chord.diagram}
                    disabled={surfaceDisabled}
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
              </div>
            )}
        </div>
        {propertyTab === "selection" && selectionDetail !== "measure" && !showSelectionInvitation && !pending && (
          <div className={musicTextSidebarStyles.sidebarFooter}>
            <p className={editorToolPanelStyles.selectionTip}>快捷操作直接作用于选区，可使用撤销。</p>
          </div>
        )}
        {/* 无编辑操作或提示时隐藏底栏，避免移除历史按钮后留下空白条。 */}
        <footer
          className={musicTextSidebarStyles.sidebarFooter}
          hidden={!pending && (kind === "chord" || (!message && (kind === "lyric" || (!issue && !draft))))}
        >
          {pending ? (
            <div
              role={numberedBusy ? undefined : "alertdialog"}
              aria-modal={numberedBusy ? undefined : true}
              inert={numberedBusy}
              aria-labelledby="draft-confirm-title"
              className={musicTextSidebarStyles.draftConfirmation}
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
                {!(kind === "numbered" && numberedGroups.length > 1) && (
                  <Button
                    disabled={
                      !!issue || (kind === "numbered" && !numberedCanApply)
                    }
                    type="primary"
                    onClick={() => void applyAndNavigate(finishPending)}
                  >
                    {pending.type === "close" ? "应用并关闭" : "应用并切换"}
                  </Button>
                )}
                <Button
                  onClick={() => {
                    if (!composing.current) {
                       if (pendingVersion.current && sameEditorVersion(editorStore.getState(), pendingVersion.current) && pendingGeneration.current === ownerGeneration.current) {
                         settingsRef.current?.discard();
                         finishPending(pending);
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
              {issue && kind !== "lyric" && !chordSuspended && (
                <p className={musicTextSidebarStyles.sidebarError} role="alert">
                  {issue}
                </p>
              )}
              {message && (
                <p className={musicTextSidebarStyles.sidebarMessage} role="status">
                  {message}
                </p>
              )}
              {chordSuspended && <p data-editor-form-hint className={editorFormStyles.settingsHint}>和弦草稿已暂停并保留；处理曲谱信息后可返回和弦编辑。</p>}
              {draft && kind !== "lyric" && kind !== "chord" && !chordSuspended && (
                <>
                <p className={musicTextSidebarStyles.actionSummary}>{lyricDirty ? "和弦有未应用修改" : "当前内容已应用"}</p>
                <div data-editor-form-actions className={editorFormStyles.sidebarActions}>
                  <Button disabled={surfaceDisabled || !lyricDirty} onClick={restoreTextDraft}>
                    恢复和弦修改
                  </Button>
                  <Button
                    disabled={!!issue || surfaceDisabled || !lyricDirty}
                    type="primary"
                    onClick={() => apply()}
                  >
                    应用
                  </Button>
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
          data-score-context-panel={contextChord ? "chord" : undefined}
          id={kind === "chord" ? "chord-edit-popover" : "music-text-edit-popover"}
          className={`${musicTextSidebarStyles.musicTextSurface} ${musicTextSidebarStyles.musicTextFloating} ${kind === "chord" ? musicTextSidebarStyles.chordFloating : ""}`}
          hidden={!floating}
          aria-label={floatingTitle}
          role="dialog"
          aria-modal={false}
          data-text-surface={floating ? "popover" : undefined}
          data-popover-placement={!contextChord && geometry.kind === "placed" ? geometry.placement : undefined}
          inert={!!activeModal || popoverHidden || !!pending}
          data-editor-inert={String(!!activeModal || popoverHidden || !!pending)}
          aria-hidden={popoverHidden || !floating || undefined}
          style={{
            left: contextChord ? (contextPosition?.left ?? 0) : geometry.kind === "placed" ? geometry.left : 0,
            top: contextChord ? (contextPosition?.top ?? 0) : geometry.kind === "placed" ? geometry.top : 0,
            visibility: popoverHidden ? "hidden" : "visible",
            width: kind === "chord" ? 378 : kind === "lyric" && !sequence ? 320 : 360,
            "--popover-arrow-offset": geometry.kind === "placed" ? `${geometry.arrowOffset}px` : "16px",
          } as CSSProperties}
        >
          <div className={musicTextSidebarStyles.floatingHeader}>
            <div className={musicTextSidebarStyles.floatingTitle}>
              <strong>{floatingTitle}</strong>
              <span>{kind === "chord" ? `TAB · ${floatingLocation}` : floatingLocation}</span>
            </div>
            <div className={musicTextSidebarStyles.floatingHeaderActions}>
              {floating && numberedBeatIndex >= 0 && numberedBeatEventIds.length > 1 && (
                <div className={musicTextSidebarStyles.numberedPopoverNavigation} role="group" aria-label="同拍简谱音符">
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
               <Button type="text" disabled={surfaceDisabled} aria-label={kind === "chord" ? "关闭快捷编辑" : kind === "lyric" ? "关闭歌词浮窗" : "结束文字编辑"} title={kind === "chord" ? "关闭快捷编辑" : kind === "lyric" ? "关闭歌词浮窗" : "结束文字编辑"} onClick={() => {
                 if (contextChord) closeContextChord(true);
                 else if (kind === "chord") { setSurface("sidebar"); setDismissed(true); setInputEditing(false); onScoreFocus(); }
                 else cancelTextEditing();
               }}>
                ×
              </Button>
            </div>
          </div>
          <div
            className={musicTextSidebarStyles.sidebarBody}
           onFocusCapture={(event) => {
             if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                lyricFocusSurface.current = "popover";
               lastInputFocus.current = event.target;
                focusDestination.current = "input";
                if (draft) setInputEditing(true);
              }
            }}
          >
            <div ref={setPopoverContainer} data-numbered-active-target={floating ? numberedEvent?.id : undefined} />
             {floating && kind === "lyric" && draft && <LyricFormView
              {...lyricFormProps!}
              presentation="popover"
              inputRef={(element) => { popoverInputRef.current = element; }}
             />}
             {floating && kind === "chord" && draft && <div inert={(compositionActive || compositionCooling) && compositionOrigin === "sidebar"}>
                 <ChordQuickEditor
                  {...chordLibraryProps}
                 draft={draft.chord}
                  allowEmptyName={!!existing}
                  onApply={() => apply()}
                  canApply={lyricDirty && !issue}
                  error={issue}
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
          {floating && kind === "lyric" && draft && message && (
            <footer className={musicTextSidebarStyles.sidebarFooter}>
              {message && <p className={musicTextSidebarStyles.sidebarMessage} role="status">{message}</p>}
            </footer>
          )}
        </section>, portalRoot)}
        </section></>}
      </SidebarFrame>
    </ConfigProvider>
  );
};
