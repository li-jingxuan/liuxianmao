"use client";
import type { ILXMScoreCommand } from "@liuxianmao/lxm-editor";

import { useEditorHostWidth } from "./workspace/use-editor-host-width";
import { useWorkspaceOverlays } from "./workspace/use-workspace-overlays";
import { useScoreView } from "./score/use-score-view";
import { SCORE_ZOOM_LEVELS } from "./score/score-view";
import { EditorHistoryPanel, EditorHistoryRail } from "./workspace/EditorHistoryPanel";
import { EditorFeedback } from "./workspace/EditorFeedback";

import {
  buildLayout,
  createJumpMarkIndex,
  A4_CONTENT_WIDTH,
  createCollapsedTabCellSelection,
  getMeasureRepeatAvailability,
  getMusicTextRows,
  hitTestLayout,
  hitTestMusicText,
  hitTestNumbered,
  hitTestNumberedMark,
  hitTestTechniqueTarget,
  layoutTabCellCaret,
  layoutTabCellSelection,
  layoutNumberedBeatContext,
  LXMScoreCommandEnum,
  navigateTabCellSelection,
  resolveMusicTextRange,
  resolveTabCellSelection,
  resolveTechniqueSelection,
  type ILXMHitTarget,
  type ILXMDocument,
  type ILXMLayout,
  type ILXMLayoutOptions,
  type ILXMLayoutPoint,
  type ILXMNumberedTarget,
  type ILXMRepeatEnding,
  type ILXMFret,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
  type MusicTextRange,
  type NumberedClipboard,
  type PlaybackRepeatEndingIssue,
  type RhythmPatternTarget,
} from "@liuxianmao/lxm-editor";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, Dropdown, Tooltip, message, theme } from "antd";
import { DownOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";
import {
  selectScoreFileStatus,
  useEditorSessionStore,
  useEditorStore,
} from "../stores/editor-store";
import {
  resolveBeatKindShortcut,
  resolveMutedNoteShortcut,
  resolveTabContinuationShortcut,
  resolveEditorHistoryShortcut,
} from "./session/editor-interaction";
import { ScoreMusicLayer } from "./score/ScoreMusicLayer";
import type { ScoreStrumInteraction, StrumEndpoint, StrumEndpointPreview } from "./score/StrumInteractionLayer";
import { getTraversalMarqueeIds } from "./score/traversal-marquee";
import { StrumRangeInspector } from "./tools/StrumRangeInspector";
import { NumberedScoreContextMenu, ScoreContextMenu, type NumberedScoreContextAction, type ScoreContextAction } from "./score/ScoreContextMenu";
import { resolveNumberedContextActions } from "./score/numbered-context-actions";
import { CopyMeasureBubble } from "./tools/CopyMeasureBubble";
import { MeasureNumberLayer } from "./score/MeasureNumberLayer";
import { JumpMarkInteractionLayer } from "./score/JumpMarkInteractionLayer";
import { RepeatEndingInteractionLayer } from "./score/RepeatEndingInteractionLayer";
import { MeasureRepeatInteractionLayer } from "./score/MeasureRepeatInteractionLayer";
import { buildScoreScene } from "@liuxianmao/lxm-editor";
import { OutputBlockedModal } from "./output/OutputBlockedModal";
import { ImageExportModal } from "./output/ImageExportModal";
import type { ImageExportSnapshot } from "./output/image-export-controller";
import { ScorePrintLayer } from "./output/ScorePrintLayer";
import type { ScoreWatermark } from "./output/score-watermark";
import { ScoreFilePanels } from "./output/ScoreFilePanels";
import { useScoreFileFlow, type BoundScoreFile } from "./output/use-score-file-flow";
import type { EditorHost, EditorHostAction, EditorHostResult } from "../editor-host";
import { MusicTextSidebar, type MusicTextController } from "./music-text/MusicTextSidebar";
import { deriveSidebarContext, type SidebarLocation } from "./music-text/sidebar-context";
import type { MusicTextTarget } from "./music-text/music-text-draft";
import { rangeFromTarget, hitMusicTextRangePoint, sameRangePoint, navigateMusicTextRange, musicTextRangeRects } from "./music-text/music-text-range-selection";
import { resolveChordFocus, resolveParagraphFocus } from "./score/music-text-focus";
import { resolveNumberedEditorTarget } from "./numbered/numbered-editor-target";
import { MusicTextEditingHints } from "./score/MusicTextEditingHints";
import { useMusicTextMetrics } from "./score/music-text-metrics";
import { hitTestTabRangeCell, resolveScoreDeleteCommand, resolveScorePointerAction } from "./session/editor-object-selection";
import {
  resolveMusicTextHoverTarget,
  sameMusicTextTarget,
} from "./music-text/music-text-hover";
import styles from "./index.module.scss";
import editorFormStyles from "./shared/editor-form.module.scss";
import scoreInteractionStyles from "./score/score-interaction.module.scss";
import { useEditorRuntime } from "./session/EditorSessionRuntime";
import type { LxmEditorNavigation, LxmEditorToolbar, LxmEditorToolbarState } from "../editor-integration";
import {
  captureEditorVersion,
  sameEditorSession,
  sameEditorVersion,
  type EditorSessionVersion,
} from "./session/editor-session-version";
import { EditorStatusBar } from "./workspace/EditorStatusBar";
import { EditorHeader } from "./workspace/EditorHeader";
import { EditorToolbar, type EditorToolbarAction, type EditorToolbarController } from "./workspace/EditorToolbar";
import { resolveEditorChordTarget } from "./chords/editor-chord-target";
import { useScorePlayback } from "./playback/controller";
import { ScorePlaybackCursor } from "./playback/ScorePlaybackCursor";
import { JumpAuditionPanel } from "./playback/JumpAuditionPanel";
import { JumpMarkInspector, type JumpMarkInspectorRequest } from "./tools/JumpMarkInspector";
import { RepeatEndingInspector, type RepeatEndingInspectorRequest } from "./tools/RepeatEndingInspector";
import { MeasureRepeatInspector } from "./tools/MeasureRepeatInspector";
import {
  createEditorCommandAdapter,
  type EditorCommandAdapter,
} from "./session/editor-command-adapter";
import { buildEditorToolCommand, type MeasureCopyDestination, type MeasureToolTarget } from "./tools/editor-tool-actions";
import type { EditorDraftOwner } from "./session/editor-draft-coordinator";
import { resolveEditorRhythmTarget } from "./tools/editor-rhythm-target";
import { resolveNumberedArcOptions } from "./tools/editor-tie-target";
import { resolveNumberedBeatTupletTarget, resolveNumberedTupletTarget, sameTupletRatio } from "./tools/editor-numbered-tuplet-target";
import { rhythmPatternScopeRects } from "./tools/rhythm-pattern-scope-layout";
import { RhythmPatternProvider } from "./tools/RhythmPatternPanel";
import { resolveEditorRhythmPatternTarget } from "./tools/editor-rhythm-pattern-target";
import {
  captureEditorToolIntent,
  editorToolSubmissionReason,
  tabToolTargetReason,
} from "./tools/editor-tool-guard";

/** 在同一选区内，把紧接的两个数字合成一个品位。 */
const FRET_DIGIT_INTERVAL_MS = 600;

type TraversalTechnique = "strum" | "arpeggio";

interface TraversalMarqueeGesture {
  pointerId: number;
  /** 屏幕位移只区分点按和拖动；真正的命中使用整张 SVG 共用的排版坐标。 */
  clientStart: ILXMLayoutPoint;
  start: ILXMLayoutPoint;
  layout: ILXMLayout;
  document: ILXMDocument;
  selectedIds: readonly string[];
  clickedId?: string;
  dragging: boolean;
}
const SCORE_TAIL_BUTTON_WIDTH = 36;

type ScoreMenuPanel = ScoreContextAction | "numberedArc" | "tuplet";
type MeasureSelection = { anchor: MeasureToolTarget; focus: MeasureToolTarget };

/** 单点选区用已有的简谱焦点，连续选区保留用户选中的原始锚点与方向。 */
const selectedNumberedContextRange = (range: MusicTextRange | null, active: MusicTextTarget | null,
  numbered: ILXMNumberedTarget | null, markId: string | null) => {
  if (markId || (active && active.kind !== "numbered")) return null;
  if (range) return range.kind === "numbered" ? range : null;
  const target = numbered ?? active;
  return target ? rangeFromTarget({ ...target, kind: "numbered" }) : null;
};

/** 编辑、图片导出和打印统一使用固定的默认排版密度。 */
const density = "compact";

function CustomToolbar({ render, state, activeTarget }: {
  render: LxmEditorToolbar;
  state: Omit<LxmEditorToolbarState, "rhythm" | "document"> & { document: NonNullable<LxmEditorToolbarState["document"]> };
  activeTarget: MusicTextTarget | null;
}) {
  const numberedInputRhythm = useEditorStore((store) => store.numberedInputRhythm);
  const numberedInputRhythmExplicit = useEditorStore((store) => store.numberedInputRhythmExplicit);
  const tabInputRhythmOverrides = useEditorStore((store) => store.tabInputRhythmOverrides);
  const numberedAutoAdvance = useEditorStore((store) => store.numberedAutoAdvance);
  const numberedInputRhythmTarget = useEditorStore((store) => store.numberedInputRhythmTarget);
  const target = resolveEditorRhythmTarget(state.document, state.selection, activeTarget,
    numberedInputRhythm, numberedInputRhythmExplicit, tabInputRhythmOverrides,
    numberedAutoAdvance, numberedInputRhythmTarget);
  return render({ ...state, rhythm: target.rhythm ?? null });
}

/** 表单编辑目标应保留浏览器原生键盘行为，不能被谱面快捷键劫持。 */
const isTextEditingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement &&
    (target.isContentEditable ||
      !!target.closest(
        '[role="combobox"], [role="listbox"], .ant-select-dropdown',
      )));

/** Chromium 会把经典滚动条的 pointerdown 发给谱面容器，须保留选区和侧栏滚动位置。 */
function isScoreScrollbarPointerDown(event: React.PointerEvent<HTMLDivElement>): boolean {
  const { target, currentTarget: viewport, clientX, clientY } = event;
  if (target !== viewport) return false;
  const { left, top, right, bottom } = viewport.getBoundingClientRect();
  if (clientX < left || clientX >= right || clientY < top || clientY >= bottom) return false;

  // 谱面容器无边框，外框与 client 尺寸之差就是经典滚动槽的实际尺寸。
  // 覆盖式没有占槽，只有预留竖槽但内容未溢出时也保留灰区点击语义。
  const verticalSlot = viewport.offsetWidth - viewport.clientWidth;
  const horizontalSlot = viewport.offsetHeight - viewport.clientHeight;
  const inVerticalSlot = viewport.clientLeft > 0
    ? clientX < left + verticalSlot
    : clientX >= right - verticalSlot;
  return (verticalSlot > 0 && viewport.scrollHeight > viewport.clientHeight && inVerticalSlot) ||
    (horizontalSlot > 0 && viewport.scrollWidth > viewport.clientWidth && clientY >= bottom - horizontalSlot);
}

export const EditorShell: React.FC<{
  navigation?: LxmEditorNavigation;
  toolbar?: LxmEditorToolbar;
  host?: EditorHost;
  boundFileRef?: React.RefObject<BoundScoreFile | undefined>;
}> = ({ navigation, toolbar, host, boundFileRef }) => {
  const session = useEditorSessionStore();
  const { token } = theme.useToken();
  const [messages, messageHolder] = message.useMessage();
  const { drafts, modals, idPrefix } = useEditorRuntime();
  const historyPanelId = `${idPrefix}editor-history-panel`;
  const activeModal = useSyncExternalStore(
    modals.subscribe,
    modals.getSnapshot,
    () => null,
  );
  const activeMusicTextTargetRef = useRef<MusicTextTarget | null>(null);
  const musicTextController = useRef<MusicTextController>(null);
  const toolbarController = useRef<EditorToolbarController>(null);
  const [scoreMenu, setScoreMenu] = useState<{
    point: { x: number; y: number }; sessionKey: string;
    numbered?: { rangeKey: string; version: EditorSessionVersion };
    wholeMeasure?: boolean;
  } | null>(null);
  const [scoreMenuPanel, setScoreMenuPanel] = useState<ScoreMenuPanel | null>(null);
  const [jumpDraftMeasure, setJumpDraftMeasure] = useState<string>();
  const [jumpInspectorRequest, setJumpInspectorRequest] = useState<{
    sessionKey: string; measureId: string; request: JumpMarkInspectorRequest;
  }>();
  const [repeatEndingPreview, setRepeatEndingPreview] = useState<ILXMRepeatEnding>();
  const [repeatEndingInspectorRequest, setRepeatEndingInspectorRequest] = useState<{
    sessionKey: string; target: MeasureToolTarget; measureIds: readonly string[]; request: RepeatEndingInspectorRequest;
  }>();
  const [measureRepeatInspectorTarget, setMeasureRepeatInspectorTarget] = useState<{
    sessionKey: string; target: MeasureToolTarget;
  }>();
  const [measureSelection, setMeasureSelection] = useState<{ sessionKey: string; range: MeasureSelection }>();
  const [activeMeasureMarkTool, setActiveMeasureMarkTool] = useState<"jump" | "ending" | "repeat">("jump");
  const measureRepeatInspectorFocus = useRef<HTMLDivElement>(null);
  // 剪贴板独立于单个乐谱和撤销栈，只有成功复制才替换保存的简谱内容。
  const [numberedClipboard, setNumberedClipboard] = useState<NumberedClipboard | null>(null);
  const [contextCopy, setContextCopy] = useState<{
    anchor: HTMLElement; document: ILXMDocument;
    selection: ILXMTabCellSelection; isCurrent: () => boolean;
  } | null>(null);
  const toolExecute = useMemo(
    // 工厂只保存保护回调，真正提交及确认时才读取 owner 的实时状态。
    () =>
      // eslint-disable-next-line react-hooks/refs
      createEditorCommandAdapter(session, modals, (command, submission, ownModalId) => {
        const reason = editorToolSubmissionReason(
          session.getState(),
          activeMusicTextTargetRef.current,
          drafts,
          command,
          submission,
        );
        if (reason) return reason;
        const blocked =
          command.type === "numbered.event.setRhythm" || submission?.numberedContext
            ? musicTextController.current?.isNumberedActionBlocked({ ignoreModalId: ownModalId })
            : musicTextController.current?.isOutputBlocked({
                allowSettingsBusy:
                  command.type === LXMScoreCommandEnum.CopyMeasureRange,
                ignoreModalId: ownModalId,
              });
        return blocked ? "请先应用或取消属性草稿，再修改音乐。" : null;
      }),
    [session, modals, drafts],
  );
  const document = useEditorStore((state) => state.document);
  const fileBaseline = useEditorStore((state) => state.fileBaseline);
  const fileStatus = useMemo(() => selectScoreFileStatus({ document, fileBaseline }), [document, fileBaseline]);
  const selection = useEditorStore((state) => state.selection);
  const numberedSelection = useEditorStore((state) => state.numberedSelection);
  const selectedNumberedMarkId = useEditorStore(
    (state) => state.selectedNumberedMarkId,
  );
  const errorMessage = useEditorStore((state) => state.errorMessage);
  const errorNoticeVersion = useEditorStore((state) => state.errorNoticeVersion);
  const loadNotice = useEditorStore((state) => state.loadNotice);
  const executeInStore = useEditorStore((state) => state.execute);
  /** 公共结构确认绑定真实会话快照，不在第一次失败后写任何历史。 */
  const execute = (command: ILXMScoreCommand, replaceFretEntryId?: string) => {
    const snapshot = session.getState();
    const result = executeInStore(command, replaceFretEntryId);
    if (
      result &&
      !result.ok &&
      result.code === "NUMBERED_IMPACT_REQUIRED" &&
      snapshot.document
    )
      modals.open({
        kind: "structure-impact",
        title: "公共结构影响确认",
        message: `这次结构修改将删除 ${result.removedMarkIds?.length ?? 0} 个简谱连接记号。确认后与结构修改一起提交、一起撤销。`,
        version: captureEditorVersion(snapshot),
        confirm: ({ isCurrent }) => {
          if (!isCurrent()) return false;
          return !!executeInStore({
            ...command,
            expectedRevision: snapshot.document!.documentRevision,
            confirmedRemovedMarkIds: result.removedMarkIds ?? [],
          })?.ok;
        },
        onClose: (reason) => {
          if (
            reason === "stale" &&
            sameEditorSession(session.getState(), snapshot)
          )
            session.getState().setErrorMessage("结构预览已过期，请重新操作。");
        },
      });
    return result;
  };
  const setSelection = useEditorStore((state) => state.setSelection);
  const selectedTechniqueId = useEditorStore(
    (state) => state.selectedTechniqueId,
  );
  const setSelectedTechniqueId = useEditorStore(
    (state) => state.setSelectedTechniqueId,
  );
  const selectedTraversalIds = useEditorStore(state => state.selectedTraversalIds);
  const [strumPreview, setStrumPreview] = useState<StrumEndpointPreview | null>(null);
  const setErrorMessage = useEditorStore((state) => state.setErrorMessage);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const historyEntries = useEditorStore((state) => state.historyEntries);
  const appliedHistoryCount = useEditorStore(
    (state) => state.pastEntries.length,
  );
  const baselineAdvanced = useEditorStore((state) => state.baselineAdvanced);
  const feedbackEvent = useEditorStore((state) => state.feedbackEvent);
  const sessionVersion = useEditorStore((state) => state.sessionVersion);
  const sessionKey = `${session.getState().sessionId}:${sessionVersion}`;
  const wholeMeasureSelection = measureSelection?.sessionKey === sessionKey && document?.score.tracks.some(({ id, measures }) =>
    id === measureSelection.range.focus.trackId && [measureSelection.range.anchor, measureSelection.range.focus].every(
      ({ measureId }) => measures.some((measure) => measure.id === measureId))) ? measureSelection.range : undefined;
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<string[]>([]);
  const [storedMusicTextTarget, setActiveMusicTextTarget] =
    useState<MusicTextTarget | null>(null);
  const activeMusicTextTarget = useMemo(() => {
    // 单音编辑沿会话仍选中的同一事件移动，避免拆组跨线后侧栏指向旧小节。
    if (storedMusicTextTarget?.kind === "numbered" && numberedSelection?.kind === "numberedEvent" &&
        storedMusicTextTarget.trackId === numberedSelection.trackId && storedMusicTextTarget.eventId === numberedSelection.eventId &&
        storedMusicTextTarget.measureId !== numberedSelection.measureId)
      return { ...storedMusicTextTarget, measureId: numberedSelection.measureId };
    return storedMusicTextTarget;
  }, [storedMusicTextTarget, numberedSelection]);
  const [storedContinuousRange, setContinuousRange] = useState<MusicTextRange | null>(null);
  const continuousRange = useMemo(() => {
    if (!storedContinuousRange || !document) return storedContinuousRange;
    const track = document.score.tracks.find(({ id }) => id === storedContinuousRange.trackId);
    if (!track) return storedContinuousRange;
    // 跨小节连音会移动原音。选区用稳定事件 ID 找到新小节，撤销时也沿用同一对端点。
    const currentPosition = (position: MusicTextRange["anchor"]) => {
      if (!position.eventId) return position;
      const owner = track.measures.find(({ numberedVoice }) => numberedVoice.events.some(({ id }) => id === position.eventId));
      return owner && owner.id !== position.measureId ? { measureId: owner.id, eventId: position.eventId } : position;
    };
    const anchor = currentPosition(storedContinuousRange.anchor);
    const focus = currentPosition(storedContinuousRange.focus);
    return anchor === storedContinuousRange.anchor && focus === storedContinuousRange.focus
      ? storedContinuousRange
      : { ...storedContinuousRange, anchor, focus };
  }, [document, storedContinuousRange]);
  const resolvedSelection = useMemo(() => {
    if (!document || !selection) return null;
    const result = resolveTabCellSelection(document, selection);
    return result.ok ? result.range : null;
  }, [document, selection]);
  const playback = useScorePlayback(document, sessionKey);
  const scoreReadOnly = playback.enabled;

  const [imageExportSnapshot, setImageExportSnapshot] = useState<ImageExportSnapshot | null>(null);
  const [outputMode, setOutputMode] = useState<"png" | "print">("png");
  // 会话替换时 EditorSession 会重建整个壳。水印跟随当前谱，改字、换图或旋转均不写入曲谱历史。
  const [watermark, setWatermark] = useState<{
    value: ScoreWatermark;
    version: number;
  }>({ value: null, version: 0 });
  const [outputBlockedOpen, setOutputBlockedOpen] = useState(false);
  const outputBlockedTrigger = useRef<HTMLElement | null>(null);
  const [editSidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** 全谱共享的会话视图偏好，不修改和弦指法或音乐历史。 */
  const [showChordDiagrams, setShowChordDiagrams] = useState(true);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const { width: hostWidth, mode: layoutMode } =
    useEditorHostWidth(editorRootRef, !!document);
  const narrowPanels = layoutMode === "compact" || layoutMode === "narrow";
  const [editHistoryOpen, setHistoryOpen] = useState(false);
  // 试听只覆盖面板的可见性。保留编辑时的布局偏好以及侧栏 owner，退出后自动恢复原布局和未应用草稿。
  const sidebarCollapsed = scoreReadOnly || editSidebarCollapsed;
  const historyOpen = !scoreReadOnly && editHistoryOpen;
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingPanel = useRef<{
    kind: "history" | "close-sidebar";
    sessionVersion: number;
    narrowOnly?: boolean;
  } | null>(null);
  const previousNarrow = useRef<boolean | null>(null);
  const retryPendingLayout = useRef<() => void>(() => {});
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const [inspectionRect, setInspectionRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const inspectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (inspectionTimer.current) clearTimeout(inspectionTimer.current);
    },
    [],
  );
  /** 文档、状态版本或会话任一变化立即关闭旧输出，晚到回调不能发布旧谱。 */
  useEffect(
    () =>
      session.subscribe((state) => {
        setImageExportSnapshot((current) =>
          current &&
          !sameEditorVersion(captureEditorVersion(state), current.version)
            ? null
            : current,
        );
      }),
    [session],
  );
  const restorePanelTrigger = useCallback((kind: "history" | "sidebar") => {
    requestAnimationFrame(() => {
      const target =
        kind === "history"
          ? historyTriggerRef.current
          : sidebarToggleRef.current;
      if (
        target?.isConnected &&
        target.getClientRects().length &&
        !target.closest("[hidden],[inert]")
      )
        target.focus({ preventScroll: true });
      else scoreSvgRef.current?.focus({ preventScroll: true });
    });
  }, []);
  const canHideSidebar = useCallback(
    () => !!musicTextController.current?.canCollapse(),
    [],
  );
  const openHistory = useCallback(() => {
    if (scoreReadOnly) return false;
    if (narrowPanels && !sidebarCollapsed && !canHideSidebar()) {
      pendingPanel.current = {
        kind: "history",
        sessionVersion: session.getState().sessionVersion,
      };
      return false;
    }
    pendingPanel.current = null;
    if (narrowPanels) setSidebarCollapsed(true);
    setHistoryOpen(true);
    return true;
  }, [scoreReadOnly, narrowPanels, sidebarCollapsed, canHideSidebar, session]);
  const closeHistory = useCallback(() => {
    pendingPanel.current = null;
    setHistoryOpen(false);
    restorePanelTrigger("history");
  }, [restorePanelTrigger]);
  const openHistoryEntry = useCallback(
    (entryId: string) => {
      if (
        !session.getState().historyEntries.some((entry) => entry.id === entryId)
      )
        return false;
      if (
        modals.isOpen() ||
        imageExportSnapshot ||
        outputBlockedOpen ||
        !openHistory()
      )
        return false;
      setExpandedHistoryIds((ids) =>
        ids.includes(entryId) ? ids : [...ids, entryId],
      );
      return true;
    },
    [session, modals, imageExportSnapshot, outputBlockedOpen, openHistory],
  );
  const openSidebar = useCallback(() => {
    if (scoreReadOnly) return;
    pendingPanel.current = null;
    if (narrowPanels) setHistoryOpen(false);
    setSidebarCollapsed(false);
  }, [narrowPanels, scoreReadOnly]);
  const closeSidebar = useCallback(() => {
    if (!canHideSidebar()) {
      pendingPanel.current = {
        kind: "close-sidebar",
        sessionVersion: session.getState().sessionVersion,
      };
      return;
    }
    pendingPanel.current = null;
    setSidebarCollapsed(true);
    restorePanelTrigger("sidebar");
  }, [canHideSidebar, session, restorePanelTrigger]);
  const closeDrawer = useCallback(() => {
    if (historyOpen) closeHistory();
    else closeSidebar();
  }, [historyOpen, closeHistory, closeSidebar]);
  useWorkspaceOverlays({
    rootRef: editorRootRef,
    workspaceRef,
    hasDocument: !!document,
    panel: narrowPanels
      ? historyOpen
        ? "history"
        : !sidebarCollapsed
          ? "sidebar"
          : null
      : null,
    onClose: closeDrawer,
  });
  useEffect(() => {
    if (!narrowPanels || (!historyOpen && sidebarCollapsed)) return;
    const frame = requestAnimationFrame(() => {
      if (
        globalThis.document.querySelector(
          '.ant-modal-wrap:not([style*="display: none"])',
        )
      )
        return;
      const panel = workspaceRef.current?.querySelector<HTMLElement>(
        historyOpen ? "[data-history-panel]" : "[data-music-text-sidebar]",
      );
      const current = globalThis.document.activeElement;
      const inAssociatedSurface =
        !historyOpen &&
        current instanceof HTMLElement &&
        !!current.closest(
          `[data-editor-associated-panel="${panel?.id}"]`,
        );
      if (panel && !panel.contains(current) && !inAssociatedSurface) {
        if (!historyOpen) musicTextController.current?.restoreSidebarFocus();
        else panel.querySelector<HTMLElement>('button:not(:disabled),[tabindex="0"]')?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [narrowPanels, historyOpen, sidebarCollapsed]);
  useEffect(() => {
    if (!hostWidth) return;
    const frame = requestAnimationFrame(() => {
      if (previousNarrow.current !== narrowPanels) {
        previousNarrow.current = narrowPanels;
        if (narrowPanels) {
          if (canHideSidebar()) setSidebarCollapsed(true);
          else {
            // 跨断点时原属性 owner 的组合输入优先保留可见；历史等待保护解除后再开。
            setHistoryOpen(false);
            pendingPanel.current = {
              kind: editHistoryOpen ? "history" : "close-sidebar",
              sessionVersion: session.getState().sessionVersion,
              narrowOnly: true,
            };
          }
        } else if (pendingPanel.current?.narrowOnly) {
          if (pendingPanel.current.kind === "history") setHistoryOpen(true);
          pendingPanel.current = null;
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [hostWidth, narrowPanels, canHideSidebar, session, editHistoryOpen]);
  useEffect(() => {
    let frame = 0;
    const retry = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const pending = pendingPanel.current;
        if (!pending) return;
        if (session.getState().sessionVersion !== pending.sessionVersion) {
          pendingPanel.current = null;
          return;
        }
        if (!canHideSidebar()) return;
        pendingPanel.current = null;
        if (pending.kind === "history") {
          if (narrowPanels) setSidebarCollapsed(true);
          setHistoryOpen(true);
        } else if (narrowPanels || !pending.narrowOnly)
          setSidebarCollapsed(true);
      });
    };
    const unsubscribe = drafts.subscribe(retry);
    retryPendingLayout.current = retry;
    globalThis.document.addEventListener("compositionend", retry, true);
    globalThis.document.addEventListener("focusout", retry, true);
    return () => {
      unsubscribe();
      retryPendingLayout.current = () => {};
      cancelAnimationFrame(frame);
      globalThis.document.removeEventListener("compositionend", retry, true);
      globalThis.document.removeEventListener("focusout", retry, true);
    };
  }, [drafts, canHideSidebar, session, narrowPanels]);
  const [musicTextEditing, setMusicTextEditing] = useState(false);
  const [musicTextPopoverHidden, setMusicTextPopoverHidden] = useState(false);
  const [numberedActionBlocked, setNumberedActionBlocked] = useState(true);
  const [chordEntryBlocked, setChordEntryBlocked] = useState(false);
  useEffect(() => {
    // 组合结束缓冲只改变 owner 的 UI 保护状态，也须唤醒延迟布局请求。
    retryPendingLayout.current();
  }, [chordEntryBlocked, numberedActionBlocked, musicTextEditing]);
  const pageViewportRef = useRef<HTMLDivElement>(null);
  const continuousRangeRef = useRef<MusicTextRange | null>(null);
  const [rhythmPatternScope, setRhythmPatternScope] = useState<RhythmPatternTarget | null>(null);
  const [paragraphEditingSession, setParagraphEditingSession] =
    useState<ILXMLayoutOptions["paragraphEditing"] | null>(null);
  const [paragraphPlaceholders, setParagraphPlaceholders] = useState<
    NonNullable<ILXMLayoutOptions["paragraphPlaceholders"]>
  >({});
  const updateParagraphEditing = useCallback((editing: typeof paragraphEditingSession) => {
    setParagraphEditingSession(editing);
    if (!editing) return;
    const current = session.getState().document;
    if (!current) return;
    const rows = getMusicTextRows(current);
    if (editing.kind === "numbered" ? rows.numbered : rows.lyricVerses > 0) return;
    setParagraphPlaceholders((previous) => {
      const { measureId, kind, verse } = editing;
      if (kind === "numbered")
        return previous.numberedMeasureId === measureId
          ? previous : { ...previous, numberedMeasureId: measureId };
      return previous.lyric?.measureId === measureId && previous.lyric.verse === verse
        ? previous : { ...previous, lyric: { measureId, verse } };
    });
  }, [session]);
  const rangeDragRef = useRef<MusicTextRange | null>(null);
  const pendingTextClickRef = useRef<MusicTextTarget | null>(null);
  useLayoutEffect(() => {
    activeMusicTextTargetRef.current = activeMusicTextTarget;
    continuousRangeRef.current = continuousRange;
  }, [activeMusicTextTarget, continuousRange]);
  /** 悬停只属于当前布局快照，换谱或重排后不沿用旧坐标。 */
  const [hoveredMusicText, setHoveredMusicText] = useState<{
    layout: ILXMLayout;
    target: MusicTextTarget;
  } | null>(null);
  /** 弦格悬停独立于实际选区，不改变输入目标、草稿或撤销历史。 */
  const [hoveredTabCell, setHoveredTabCell] = useState<{
    layout: ILXMLayout;
    target: ILXMHitTarget;
  } | null>(null);
  const clearHover = useCallback(() => {
    setHoveredMusicText(null);
    setHoveredTabCell(null);
  }, []);
  const { metrics: musicTextMetrics, hasMissingMetrics } = useMusicTextMetrics(
    document,
    showChordDiagrams,
  );

  /** 只记住已写入谱面的 1 或 2，第二键按下时才比较时间。 */
  const fretPrefix = useRef<{
    digit: number;
    timeStamp: number;
    selection: ILXMTabCellSelection;
    stateVersion: number;
    historyEntryId?: string;
  } | null>(null);
  const endFretInput = useCallback(() => { fretPrefix.current = null; }, []);
  /** drag anchor 用 ref 保存，避免 pointermove 读取到尚未提交的 React/store 状态。 */
  const dragAnchorRef = useRef<ILXMTabCellReference | null>(null);
  const traversalClickRef = useRef<{ selection: ILXMTabCellSelection; cell: ILXMTabCellReference } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const traversalMarqueeRef = useRef<TraversalMarqueeGesture | null>(null);
  const [traversalMarquee, setTraversalMarquee] = useState<{
    x: number; y: number; width: number; height: number; ids: readonly string[];
  } | null>(null);
  const focusCaretRef = useRef<SVGRectElement | null>(null);
  const rangeFocusRef = useRef<SVGRectElement | null>(null);
  const paragraphFocusRef = useRef<SVGRectElement | null>(null);
  const scoreSvgRef = useRef<SVGSVGElement | null>(null);
  const appendingMeasure = useRef(false);
  const imageExportButtonRef = useRef<HTMLButtonElement | null>(null);

  const layoutOptions = useMemo<ILXMLayoutOptions>(() => ({
      purpose: "editing",
      editingTailWidth: SCORE_TAIL_BUTTON_WIDTH,
      repeatEndingPreview,
      x: 0,
      y: 0,
      systemWidth: A4_CONTENT_WIDTH,
      density,
      musicTextMetrics,
      showChordDiagrams,
      paragraphPlaceholders,
      paragraphEditing:
        continuousRange ? { ...continuousRange.focus, kind: continuousRange.kind, verse: continuousRange.verse } :
        activeMusicTextTarget?.kind === "lyric" ||
        activeMusicTextTarget?.kind === "numbered"
          ? { ...activeMusicTextTarget, kind: activeMusicTextTarget.kind }
          : paragraphEditingSession ?? undefined,
  }), [musicTextMetrics, showChordDiagrams, activeMusicTextTarget, continuousRange, paragraphEditingSession, paragraphPlaceholders, repeatEndingPreview]);
  /** document 变化后重新生成 system、命中索引和所有 SVG 几何数据。 */
  const lxmLayout = useMemo(() => document ? buildLayout(document, layoutOptions) : null, [document, layoutOptions]);
  const scoreExceedsPaper = lxmLayout?.systems.some((system) =>
    Math.max(system.width, system.visualBounds?.width ?? 0) > A4_CONTENT_WIDTH + 1,
  ) ?? false;
  useEffect(() => {
    const key = "score-paper-width";
    if (!scoreExceedsPaper) return;
    messages.warning({ key, content: "当前谱面超过 A4 内容宽度，可横向滚动；请调整内容后再导出 A4 图片。" });
    return () => messages.destroy(key);
  }, [messages, scoreExceedsPaper, sessionKey]);
  useEffect(() => {
    const key = "score-text-metrics";
    if (!hasMissingMetrics) return;
    // 文字编辑后会重新度量，给字体和 SVG 度量留出完成的时间。
    const timer = window.setTimeout(() => {
      messages.warning({ key, content: "部分文字暂使用保守估算排版，真实字体边界尚未全部确认。" });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      messages.destroy(key);
    };
  }, [messages, hasMissingMetrics, sessionKey]);
  const rangeRects = useMemo(() => document && lxmLayout && continuousRange
    ? musicTextRangeRects(document, lxmLayout, continuousRange) : [], [document, lxmLayout, continuousRange]);
  const rhythmPatternRects = useMemo(() => lxmLayout && rhythmPatternScope
    ? rhythmPatternScopeRects(lxmLayout, rhythmPatternScope) : [], [lxmLayout, rhythmPatternScope]);

  const clearTraversalMarquee = useCallback(() => {
    const gesture = traversalMarqueeRef.current;
    if (!gesture) return;
    // 先清手势再释放捕获，lostpointercapture 不会重复取消或提交。
    traversalMarqueeRef.current = null;
    const svg = scoreSvgRef.current;
    if (svg?.hasPointerCapture(gesture.pointerId)) svg.releasePointerCapture(gesture.pointerId);
    setTraversalMarquee(null);
  }, []);
  const clearScorePointerInteraction = useCallback(() => {
    clearTraversalMarquee();
    const svg = scoreSvgRef.current;
    const pointer = activePointerIdRef.current;
    if (svg && pointer !== null && svg.hasPointerCapture(pointer))
      svg.releasePointerCapture(pointer);
    activePointerIdRef.current = null;
    dragAnchorRef.current = null;
    rangeDragRef.current = null;
    pendingTextClickRef.current = null;
    clearHover();
  }, [clearHover, clearTraversalMarquee]);
  const onScoreGeometryChange = useCallback(() => {
    clearScorePointerInteraction();
    // transform 不会触发 ResizeObserver；浮层必须在同一次实际矩阵变化后重定位。
    window.dispatchEvent(new Event("resize"));
  }, [clearScorePointerInteraction]);
  const scoreView = useScoreView({
    viewportRef: pageViewportRef,
    layoutWidth: lxmLayout?.width ?? 0,
    layoutHeight: lxmLayout?.height ?? 0,
    sessionKey: `${session.getState().sessionId}/${session.getState().sessionVersion}`,
    onGeometryChange: onScoreGeometryChange,
  });
  const scoreZoomTriggerRef = useRef<HTMLButtonElement>(null);

  /** 音乐图元与图片渲染共享，选区变化不重新生成全部音乐。 */
  const scoreScene = useMemo(
    () => (lxmLayout ? buildScoreScene(lxmLayout) : null),
    [lxmLayout],
  );

  const playbackMessage = playback.enabled ? playback.message : "";
  const playbackNoticeType = playback.phase === "loading" ? "loading" : playback.phase === "error" ? "error" : "warning";
  useEffect(() => {
    if (!playbackMessage) return;
    const key = "score-playback";
    messages.open({
      key,
      type: playbackNoticeType,
      content: <span role="status">{playbackMessage}</span>,
      duration: playbackNoticeType === "loading" ? 0 : undefined,
    });
    return () => messages.destroy(key);
  }, [messages, playbackMessage, playbackNoticeType]);
  const scoreReadOnlyRef = useRef(scoreReadOnly);
  useLayoutEffect(() => {
    scoreReadOnlyRef.current = scoreReadOnly;
  }, [scoreReadOnly]);
  const setPlaybackEnabled = (enabled: boolean) => {
    if (enabled) {
      // 放弃等待中的面板切换，防止焦点离开编辑区时重新打开编辑面板。
      pendingPanel.current = null;
      clearScorePointerInteraction();
      endFretInput();
      setRhythmPatternScope(null);
      dismissScoreMenu(false);
    }
    playback.setEnabled(enabled);
  };
  const selectionRects = useMemo(
    () =>
      lxmLayout && resolvedSelection
        ? layoutTabCellSelection(lxmLayout, resolvedSelection)
        : [],
    [lxmLayout, resolvedSelection],
  );
  const playbackStartBounds = playback.startMeasureId === null ? undefined
    : lxmLayout?.hitIndex.measureBounds.find(({ measureId }) => measureId === playback.startMeasureId);
  const selectPlaybackMeasure: React.MouseEventHandler<SVGSVGElement> = (event) => {
    if (event.button !== 0 || !lxmLayout) return;
    const point = getLayoutPoint(event.currentTarget, event);
    if (!point) return;
    // 试听按排版的小节边界整体命中，弦线间的空白也能选择。沿用 SVG 坐标换算以支持缩放，
    // 只更新试听会话，避免触碰编辑选区、未应用的草稿、待导出状态及撤销历史。
    const bounds = lxmLayout.hitIndex.measureBounds.find(({ x, y, width, height }) =>
      point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height,
    );
    if (bounds) playback.setStartMeasure(bounds.measureId);
  };
  const lyricFocus = useMemo(() => resolveParagraphFocus(lxmLayout, activeMusicTextTarget ??
    (!selection && !continuousRange && numberedSelection ? { ...numberedSelection, kind: "numbered" } : null)),
  [lxmLayout, activeMusicTextTarget, selection, continuousRange, numberedSelection]);
  const chordFocus = useMemo(
    () => resolveChordFocus(lxmLayout, activeMusicTextTarget),
    [lxmLayout, activeMusicTextTarget],
  );
  const numberedBeatContext = useMemo(
    () =>
      lxmLayout && activeMusicTextTarget?.kind === "numbered"
        ? layoutNumberedBeatContext(lxmLayout, activeMusicTextTarget)
        : null,
    [lxmLayout, activeMusicTextTarget],
  );
  const musicTextHoverFocus = useMemo(() => {
    if (!hoveredMusicText || hoveredMusicText.layout !== lxmLayout) return null;
    const target = hoveredMusicText.target;
    // 当前对象已有选中框，不再叠加同一对象的悬停描边。
    if (sameMusicTextTarget(activeMusicTextTarget, target)) return null;
    const focus = resolveParagraphFocus(lxmLayout, target);
    // 相同可见范围不再叠加悬停描边；同拍独立事件使用各自范围。
    if (
      focus &&
      lyricFocus &&
      focus.kind === lyricFocus.kind &&
      focus.x === lyricFocus.x &&
      focus.y === lyricFocus.y &&
      focus.width === lyricFocus.width &&
      focus.height === lyricFocus.height
    )
      return null;
    return focus;
  }, [lxmLayout, hoveredMusicText, activeMusicTextTarget, lyricFocus]);
  const tabCellHoverCaret = useMemo(() => {
    if (!hoveredTabCell || hoveredTabCell.layout !== lxmLayout) return null;
    const target = hoveredTabCell.target;
    // 已选范围继续使用正式选区；文字编辑时允许预览切回 TAB 的目标弦格。
    if (
      !activeMusicTextTarget &&
      resolvedSelection &&
      target.string >= resolvedSelection.startString &&
      target.string <= resolvedSelection.endString &&
      resolvedSelection.beats.some(
        (beat) =>
          beat.measureId === target.measureId && beat.beatId === target.beatId,
      )
    )
      return null;
    return layoutTabCellCaret(hoveredTabCell.layout, target);
  }, [lxmLayout, hoveredTabCell, activeMusicTextTarget, resolvedSelection]);
  const lyricEditing =
    activeMusicTextTarget?.kind === "lyric" ||
    activeMusicTextTarget?.kind === "numbered";
  const getFloatingAnchor = useCallback(
    (target: MusicTextTarget | null) => {
      const focus =
        target?.kind === "chord"
          ? resolveChordFocus(lxmLayout, target)
          : resolveParagraphFocus(lxmLayout, target);
      if (!focus || !scoreSvgRef.current) return null;
      const matrix = scoreSvgRef.current.getScreenCTM();
      if (!matrix) return null;
      const points = [
        [focus.x, focus.y],
        [focus.x + focus.width, focus.y],
        [focus.x, focus.y + focus.height],
        [focus.x + focus.width, focus.y + focus.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      return {
        left: Math.min(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        right: Math.max(...points.map((point) => point.x)),
        bottom: Math.max(...points.map((point) => point.y)),
      };
    },
    [lxmLayout],
  );
  const getFloatingViewport = useCallback(() => {
    const visible = window.visualViewport;
    const left = visible?.offsetLeft ?? 0;
    const top = visible?.offsetTop ?? 0;
    const right = left + (visible?.width ?? window.innerWidth);
    const bottom = top + (visible?.height ?? window.innerHeight);
    const scoreArea = pageViewportRef.current?.getBoundingClientRect();
    if (!scoreArea) return { left, top, right, bottom };
    return {
      left: Math.max(left, scoreArea.left),
      top: Math.max(top, scoreArea.top),
      right: Math.min(right, scoreArea.right),
      bottom: Math.min(bottom, scoreArea.bottom),
    };
  }, []);
  const locateSidebarObject = useCallback(
    (location: SidebarLocation) => {
      const measure = lxmLayout?.systems
        .flatMap((system) => system.measures)
        .find((item) => item.id === location.measureId);
      const svg = scoreSvgRef.current;
      const viewport = pageViewportRef.current;
      if (!measure || !svg || !viewport) return;
      let bounds = {
        x: measure.x,
        y: measure.y,
        width: measure.width,
        height: measure.height,
      };
      if (location.beatId) {
        const caret = layoutTabCellCaret(lxmLayout!, {
          ...location,
          beatId: location.beatId,
          string: 1,
        });
        if (caret) bounds = caret;
      } else if (location.startTick !== undefined) {
        const position = {
          trackId: location.trackId,
          measureId: location.measureId,
          eventId: location.eventId,
          tick: location.startTick,
          endTick: location.endTick,
        };
        const focus = resolveParagraphFocus(
          lxmLayout,
          location.kind === "lyric"
            ? { ...position, kind: "lyric", verse: location.verse }
            : { ...position, kind: "numbered", itemId: location.itemId },
        );
        if (focus) bounds = focus;
      }
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const center = new DOMPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      ).matrixTransform(matrix);
      const view = viewport.getBoundingClientRect();
      viewport.scrollBy({
        left: center.x - (view.left + view.right) / 2,
        top: center.y - (view.top + view.bottom) / 2,
      });
      setInspectionRect(bounds);
      if (inspectionTimer.current) clearTimeout(inspectionTimer.current);
      inspectionTimer.current = setTimeout(() => setInspectionRect(null), 1500);
    },
    [lxmLayout],
  );
  /** 选拍或草稿确认结束后保留谱面焦点，不触发浏览器默认滚动。 */
  const focusScore = useCallback(
    () => scoreSvgRef.current?.focus({ preventScroll: true }),
    [],
  );
  const dismissScoreMenu = useCallback((restoreFocus: boolean) => {
    // 输入法组字和工具确认沿用原有的关闭保护。只有浮窗允许关闭时，才移除菜单锚点。
    if (musicTextController.current?.closeContextChord() === false ||
        toolbarController.current?.closeContextTool() === false) return false;
    setScoreMenu(null);
    setScoreMenuPanel(null);
    setContextCopy(null);
    if (restoreFocus) focusScore();
    return true;
  }, [focusScore]);
  const numberedContextRange = useMemo(() =>
    selectedNumberedContextRange(continuousRange, activeMusicTextTarget, numberedSelection, selectedNumberedMarkId),
  [continuousRange, activeMusicTextTarget, numberedSelection, selectedNumberedMarkId]);
  const numberedContextRangeKey = JSON.stringify(numberedContextRange);
  const numberedContextValid = !!scoreMenu?.numbered && scoreMenu.sessionKey === sessionKey &&
    scoreMenu.numbered.rangeKey === numberedContextRangeKey && sameEditorVersion(session.getState(), scoreMenu.numbered.version);
  const numberedMenuOpen = useRef(false);
  useLayoutEffect(() => { numberedMenuOpen.current = numberedContextValid; }, [numberedContextValid]);
  const numberedMenuActions = useMemo(() => numberedContextValid && numberedContextRange && document
    ? resolveNumberedContextActions(document, numberedContextRange, numberedClipboard) : null,
  [numberedContextValid, numberedContextRange, document, numberedClipboard]);
  useEffect(() => {
    // 撤销、换谱和外部选区变化均使旧菜单失效；只有仍在原会话时才归还谱面焦点。
    if (scoreMenu?.numbered && (!numberedContextValid || scoreReadOnly))
      dismissScoreMenu(scoreMenu.sessionKey === sessionKey && !scoreReadOnly && !modals.isOpen());
  }, [scoreMenu, numberedContextValid, scoreReadOnly, sessionKey, modals, dismissScoreMenu]);
  useEffect(() => {
    const state = session.getState();
    if (!state.loadNotice && (state.fileBaseline || !state.selection)) return;
    const frame = requestAnimationFrame(focusScore);
    return () => cancelAnimationFrame(frame);
  }, [focusScore, session]);
  const focusCaret = useMemo(
    () =>
      lxmLayout && selection
        ? layoutTabCellCaret(lxmLayout, selection.focus)
        : null,
    [lxmLayout, selection],
  );
  /**
   * 小节线工具跟随 selection.focus，而不是范围的第一个 Beat。
   * 用户反向拖动或跨小节扩展时，focus 才代表当前正在操作的业务位置。
   */
  const focusedMeasureContext = useMemo(() => {
    if (!document || !selection) return null;
    const track = document.score.tracks.find(
      (candidate) => candidate.id === selection.focus.trackId,
    );
    const measureIndex =
      track?.measures.findIndex(
        (measure) => measure.id === selection.focus.measureId,
      ) ?? -1;
    if (!track || measureIndex < 0) return null;
    return {
      track,
      measure: track.measures[measureIndex]!,
      measureIndex,
      isFirstMeasure: measureIndex === 0,
      isLastMeasure: measureIndex === track.measures.length - 1,
    };
  }, [document, selection]);

  /** 只滚动谱面视口，文本编辑期间也能跟随目标；不会滚动侧栏输入区。 */
  useEffect(() => {
    const viewport = pageViewportRef.current;
    // 气泡隐藏时保留用户滚动位置，未提交草稿也不能把视口拉回。
    if (!viewport || (activeMusicTextTarget && musicTextPopoverHidden)) return;
    const revealTarget = () => {
      // 按下文字位置时会先结束上一处编辑，等松手才打开新目标。
      // 这期间恢复的 TAB 光标不应把谱面拉离指针所在位置。右键菜单打开时也沿用当下视口。
      if (scoreReadOnlyRef.current || pendingTextClickRef.current || numberedMenuOpen.current) return;
      const caret = continuousRange ? rangeFocusRef.current : focusCaretRef.current;
      const matrix = scoreSvgRef.current?.getScreenCTM();
      if (!caret && !(lyricFocus && matrix)) return;
      // 有歌词优先滚动到当前段文字；空拍使用临时 caret，不合并其他段与和弦。
      const a =
        lyricFocus && matrix
          ? new DOMPoint(lyricFocus.x, lyricFocus.y).matrixTransform(matrix)
          : null;
      const z =
        lyricFocus && matrix
          ? new DOMPoint(
              lyricFocus.x + lyricFocus.width,
              lyricFocus.y + lyricFocus.height,
            ).matrixTransform(matrix)
          : null;
      const caretBox =
        a && z
          ? new DOMRect(a.x, a.y, z.x - a.x, z.y - a.y)
          : caret!.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      const padding = 12;
      let box = caretBox;
      // 空间足够时连同当前拍的歌词/和弦一起显示；过高的组合仍优先显示拍点。
      if (activeMusicTextTarget && !lyricEditing && matrix && selection) {
        const texts =
          lxmLayout?.hitIndex.musicTextBounds?.filter(
            (b) =>
              b.trackId === selection.focus.trackId &&
              b.measureId === selection.focus.measureId &&
              b.beatId === selection.focus.beatId,
          ) ?? [];
        let left = caretBox.left,
          right = caretBox.right;
        let top = caretBox.top,
          bottom = caretBox.bottom;
        texts.forEach((b) => {
          const a = new DOMPoint(b.x, b.y).matrixTransform(matrix);
          const z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(
            matrix,
          );
          left = Math.min(left, a.x);
          right = Math.max(right, z.x);
          top = Math.min(top, a.y);
          bottom = Math.max(bottom, z.y);
        });
        if (
          right - left < view.width - padding * 2 &&
          bottom - top < view.height - padding * 2
        )
          box = new DOMRect(left, top, right - left, bottom - top);
      }
      // 超宽歌词优先露出左侧锚点，避免追逐右缘导致锚点离开视口。
      if (lyricFocus && box.width > view.width - padding * 2)
        box = new DOMRect(box.x, box.y, 8, box.height);
      const dx =
        box.left < view.left + padding
          ? box.left - view.left - padding
          : box.right > view.right - padding
            ? box.right - view.right + padding
            : 0;
      const dy =
        box.top < view.top + padding
          ? box.top - view.top - padding
          : box.bottom > view.bottom - padding
            ? box.bottom - view.bottom + padding
            : 0;
      if (dx || dy)
        viewport.scrollBy({ left: dx, top: dy, behavior: "instant" });
    };
    revealTarget();
    const observer = new ResizeObserver(revealTarget);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [
    focusCaret,
    musicTextEditing,
    musicTextPopoverHidden,
    selection,
    lxmLayout,
    lyricFocus,
    lyricEditing,
    activeMusicTextTarget,
    continuousRange,
    rangeRects,
  ]);

  /** 其他谱面快捷键结束当前的连续数字输入。 */
  const runImmediateEditorAction = (action: () => void): void => {
    if (musicTextController.current?.isTransitionBlocked()) return;
    endFretInput();
    action();
  };

  /** 将品位或弦格标记作为一条原子矩形命令提交，选区只产生一条历史。 */
  const setSelectedNotes = (fret: ILXMFret, replaceFretEntryId?: string) => {
    const { selection } = session.getState();
    if (!selection) {
      setErrorMessage("请先选择谱面中的 TAB 单元格，再输入品位或标记。");
      return;
    }
    if (fret === "-") {
      execute({ type: LXMScoreCommandEnum.SetTabContinuation, range: {
        trackId: selection.anchor.trackId, anchor: selection.anchor, focus: selection.focus,
      } });
      return;
    }
    return execute({
      type: LXMScoreCommandEnum.SetNotesInRect,
      range: {
        trackId: selection.anchor.trackId,
        anchor: {
          measureId: selection.anchor.measureId,
          beatId: selection.anchor.beatId,
          string: selection.anchor.string,
        },
        focus: {
          measureId: selection.focus.measureId,
          beatId: selection.focus.beatId,
          string: selection.focus.string,
        },
      },
      fret,
    }, replaceFretEntryId);
  };

  /** 删除按当前对象分发：技巧只删自身，普通 TAB 选区使用一条批量音符命令。 */
  const removeScoreSelection = async () => {
    const now = session.getState();
    if (!now.document) return;
    const command = resolveScoreDeleteCommand(now.document, now.selection, now.selectedTechniqueId);
    if (!command) return;
    const isCurrent = captureEditorToolIntent(session.getState, () => activeMusicTextTargetRef.current);
    const result = await executeTool(command, "modal", { isCurrent, tabOnly: true });
    if (result.status === "blocked" || result.status === "stale")
      setErrorMessage(result.message);
  };

  const hasFileInput = () => !!musicTextController.current?.isOutputBlocked();
  const isOutputBlocked = () => !!imageExportSnapshot || modals.isOpen() || drafts.isOutputBlocked() || hasFileInput();
  const showOutputBlocked = (trigger: HTMLElement | null) => {
    if (modals.isOpen() || imageExportSnapshot) setErrorMessage("请先完成当前弹层操作。");
    else {
      outputBlockedTrigger.current = trigger;
      setOutputBlockedOpen(true);
    }
  };
  const fileFlow = useScoreFileFlow({
    session, drafts, isBlocked: isOutputBlocked, onBlocked: showOutputBlocked, host, boundFileRef,
    onNotice: (type, content) => messages.open({ key: "score-file", type, content }),
  });
  useEffect(() => {
    if (scoreMenu?.numbered && (fileFlow.panel || fileFlow.pending || imageExportSnapshot || outputBlockedOpen))
      dismissScoreMenu(false);
  }, [scoreMenu, fileFlow.panel, fileFlow.pending, imageExportSnapshot, outputBlockedOpen, dismissScoreMenu]);
  const traversalTrack = document?.score.tracks.find(track => track.id === lxmLayout?.trackId);
  const traversalContext = !!traversalTrack && !activeMusicTextTarget && !continuousRange && !numberedSelection && selection?.focus.trackId === traversalTrack.id;
  const traversals = useMemo(() => {
    if (!traversalContext || !selectedTraversalIds.length) return [];
    const ids = new Set(selectedTraversalIds);
    return traversalTrack.techniques.filter(t => t.type === "strum" || t.type === "arpeggio").filter(t => ids.has(t.id));
  }, [traversalContext, traversalTrack, selectedTraversalIds]);
  const canInteractWithTraversals = !scoreReadOnly && !activeModal && !imageExportSnapshot && !fileFlow.panel && !fileFlow.pending;
  const changeTraversalEndpoint = useCallback(async (endpoint: StrumEndpoint, string: number, techniqueType: TraversalTechnique) => {
    const now = session.getState();
    if (!canInteractWithTraversals || !traversalTrack || modals.isOpen() ||
      now.document !== document || now.selectedTraversalIds !== selectedTraversalIds) return;
    // 扫弦和琶音可以混合选中做休止等通用操作。范围编辑按类型各走一个原子命令，保留其他技巧及各自对端。
    const techniqueIds = traversals.filter(technique => technique.type === techniqueType).map(technique => technique.id);
    if (!techniqueIds.length) return;
    endFretInput();
    const type = techniqueType === "strum" ? LXMScoreCommandEnum.SetStrumEndpoint : LXMScoreCommandEnum.SetArpeggioEndpoint;
    const result = await toolExecute({ type, trackId: traversalTrack.id, techniqueIds, endpoint, string }, "modal", { tabOnly: true });
    if (result.status === "blocked" || result.status === "stale") setErrorMessage(result.message);
  }, [canInteractWithTraversals, document, traversalTrack, traversals, selectedTraversalIds, session, modals, endFretInput, toolExecute, setErrorMessage]);
  const changeStrumEndpoint = useCallback((endpoint: StrumEndpoint, string: number) =>
    changeTraversalEndpoint(endpoint, string, "strum"), [changeTraversalEndpoint]);
  const changeArpeggioEndpoint = useCallback((endpoint: StrumEndpoint, string: number) =>
    changeTraversalEndpoint(endpoint, string, "arpeggio"), [changeTraversalEndpoint]);
  /** 点按和框选共用技巧选区。原活动项仍在选区时保留焦点及其范围手柄，否则定位第一项。 */
  const applyTraversalSelection = useCallback((ids: readonly string[]) => {
    const now = session.getState();
    if (!now.document) return;
    const active = now.selectedTechniqueId && ids.includes(now.selectedTechniqueId) ? now.selectedTechniqueId : ids[0];
    const mapped = active ? resolveTechniqueSelection(now.document, active, "end") : null;
    if (!active || mapped) musicTextController.current?.select(mapped, active, ids);
  }, [session]);
  const selectTraversal = useCallback((id: string, toggle: boolean) => {
    const ids = session.getState().selectedTraversalIds;
    const next = !toggle ? [id] : ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id];
    applyTraversalSelection(next);
  }, [session, applyTraversalSelection]);
  const traversalPreviewIds = traversalMarquee?.ids;
  // 避免每次悬停都重绘整谱。原 TAB 工具只接收活动音符的弦格，范围编辑直接使用离散的技巧 ID。
  const strumInteraction = useMemo<ScoreStrumInteraction | undefined>(() => {
    if (!canInteractWithTraversals || !lxmLayout || !document || !traversalTrack) return undefined;
    return {
      layout: lxmLayout, selectedIds: traversalContext ? selectedTraversalIds : [], activeId: selectedTechniqueId,
      previewIds: traversalPreviewIds, onPreview: setStrumPreview,
      onSelect: selectTraversal, onCommit: changeTraversalEndpoint,
    };
  }, [canInteractWithTraversals, lxmLayout, document, traversalTrack, traversalContext, selectedTraversalIds, selectedTechniqueId,
    traversalPreviewIds, selectTraversal, changeTraversalEndpoint]);
  useLayoutEffect(() => {
    // 换谱、重排、进入只读或外部选区变化时，旧坐标和目标都不能继续提交。
    clearTraversalMarquee();
  }, [canInteractWithTraversals, lxmLayout, document, selectedTraversalIds, clearTraversalMarquee]);
  useEffect(() => {
    if (loadNotice) messages.success({ key: "score-file", content: loadNotice });
  }, [messages, loadNotice, sessionKey]);
  const editorError = document ? errorMessage : null;
  useEffect(() => {
    if (editorError) messages.error({ key: "score-edit-error", content: editorError });
  }, [messages, editorError, errorNoticeVersion, sessionKey]);

  const navigateTo = (destination: string) => {
    if (navigation?.onNavigate) navigation.onNavigate(destination);
    else {
      fileFlow.allowPageUnload();
      window.location.assign(destination);
    }
  };
  const requestNavigation = (destination: string, label: string, trigger: HTMLElement | null) =>
    fileFlow.requestNavigation(label, trigger, (discard) => {
      if (discard) navigation?.onDiscard?.();
      navigateTo(destination);
    });

  /** 使用 SVG CTM 完成 client 坐标到 layout 逻辑坐标的唯一转换。 */
  const getLayoutPoint = (
    svg: SVGSVGElement,
    event: Pick<React.PointerEvent<SVGSVGElement>, "clientX" | "clientY">,
  ): { x: number; y: number } | null => {
    const matrix = svg.getScreenCTM();
    if (!matrix || !lxmLayout) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: point.x, y: point.y };
  };

  const hitTestPointer = (
    svg: SVGSVGElement,
    event: Pick<React.PointerEvent<SVGSVGElement>, "clientX" | "clientY">,
  ): ILXMTabCellReference | null => {
    const point = getLayoutPoint(svg, event);
    return point && lxmLayout && document ? hitTestTabRangeCell(document, lxmLayout, point) : null;
  };

  const startTraversalMarquee: React.PointerEventHandler<SVGSVGElement> = (event) => {
    if (!event.altKey || event.button !== 0 || !event.isPrimary || !canInteractWithTraversals ||
      !document || !lxmLayout || modals.isOpen() || activePointerIdRef.current !== null || traversalMarqueeRef.current ||
      musicTextController.current?.isTransitionBlocked()) return;
    const start = getLayoutPoint(event.currentTarget, event);
    if (!start) return;
    const surface = event.target instanceof Element ? event.target.closest("[data-strum-hit], [data-strum-handle]") : null;
    const hit = hitTestTechniqueTarget(lxmLayout, start);
    const clickedId = surface?.getAttribute("data-strum-id") ??
      (traversalTrack?.techniques.some(t => t.id === hit?.techniqueId && (t.type === "strum" || t.type === "arpeggio"))
        ? hit?.techniqueId : undefined);
    // Alt 只在起手时判定。先保留起点和旧选区，松手时区分单击切换与跨谱行追加。
    event.preventDefault();
    event.stopPropagation();
    clearHover();
    endFretInput();
    traversalMarqueeRef.current = {
      pointerId: event.pointerId, clientStart: { x: event.clientX, y: event.clientY }, start,
      layout: lxmLayout, document, selectedIds: session.getState().selectedTraversalIds, clickedId, dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    focusScore();
  };

  const updateTraversalMarquee = (event: React.PointerEvent<SVGSVGElement>, finish: boolean) => {
    const gesture = traversalMarqueeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const now = session.getState();
    const end = getLayoutPoint(event.currentTarget, event);
    if (!end || !canInteractWithTraversals || modals.isOpen() || gesture.layout !== lxmLayout ||
      gesture.document !== now.document || gesture.selectedIds !== now.selectedTraversalIds) {
      clearTraversalMarquee();
      return;
    }
    gesture.dragging ||= Math.hypot(event.clientX - gesture.clientStart.x, event.clientY - gesture.clientStart.y) >= 4;
    if (!gesture.dragging) {
      if (finish) {
        clearTraversalMarquee();
        if (gesture.clickedId) selectTraversal(gesture.clickedId, true);
      }
      return;
    }
    const { start } = gesture;
    const ids = getTraversalMarqueeIds(gesture.layout, gesture.document, start, end);
    if (finish) {
      clearTraversalMarquee();
      const previous = new Set(gesture.selectedIds);
      const added = ids.filter(id => !previous.has(id));
      if (added.length) applyTraversalSelection([...previous, ...added]);
    } else {
      // 预览只画框和命中高亮，等松手才更新选区和侧栏。逆向拖动也使用同一矩形。
      setTraversalMarquee({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), ids });
    }
  };

  const cancelTraversalPointer: React.PointerEventHandler<SVGSVGElement> = (event) => {
    if (traversalMarqueeRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    clearTraversalMarquee();
  };

  /** 接受对象切换后清理旧输入与 pointer capture，文字激活和 beat 选择共用。 */
  const clearScoreInteraction = () => {
    endFretInput();
    clearScorePointerInteraction();
  };

  /** 确认期间不修改选区，只有接受请求后才更新六线谱对象与焦点。 */
  const acceptScoreSelection = (
    next: ILXMTabCellSelection | null,
    techniqueId: string | null,
    traversalIds?: readonly string[],
  ) => {
    const nextMeasure = next && session.getState().document?.score.tracks.find(({ id }) => id === next.focus.trackId)
      ?.measures.find(({ id }) => id === next.focus.measureId);
    setMeasureRepeatInspectorTarget(undefined);
    if (next && nextMeasure?.measureRepeat?.type === "previousSingle") {
      // 从普通 TAB 拍位用方向键走进缩写时，也建立整节选区，避免随后输入修改隐藏的快照拍。
      const { trackId } = next.focus;
      selectWholeMeasures({ anchor: { trackId, measureId: next.anchor.measureId }, focus: { trackId, measureId: next.focus.measureId } });
      focusScore();
      return;
    }
    clearScoreInteraction();
    setMeasureSelection(undefined);
    setContinuousRange(null);
    setActiveMusicTextTarget(null);
    setSelection(next);
    setSelectedTechniqueId(techniqueId, traversalIds);
    setErrorMessage(
      techniqueId && !next ? "当前技巧无法映射到可编辑的 TAB 单元格。" : null,
    );
    focusScore();
  };

  /** 整节选区只引用小节。在缩写内部没有可见的拍点，不向 TAB 编辑工具暴露快照拍位。 */
  const selectWholeMeasures = (range: MeasureSelection) => {
    clearScoreInteraction();
    setContinuousRange(null);
    setActiveMusicTextTarget(null);
    const state = session.getState();
    state.setSelection(null);
    state.setNumberedSelection(null);
    state.setSelectedTechniqueId(null);
    setMeasureSelection({ sessionKey, range });
  };

  const selectedWholeMeasureIds = (range: MeasureSelection) => {
    const measures = session.getState().document?.score.tracks.find(({ id }) => id === range.focus.trackId)?.measures ?? [];
    const first = measures.findIndex(({ id }) => id === range.anchor.measureId);
    const last = measures.findIndex(({ id }) => id === range.focus.measureId);
    return first < 0 || last < 0 ? [] : measures.slice(Math.min(first, last), Math.max(first, last) + 1).map(({ id }) => id);
  };

  const openWholeMeasureMenu = (target: MeasureToolTarget, point: { x: number; y: number }) => {
    if (scoreReadOnly || modals.isOpen() || musicTextController.current?.isTransitionBlocked() ||
      drafts.inspect().pending.some((record) => record.kind === "jumpMark" || record.kind === "repeatEnding") || !dismissScoreMenu(false)) return;
    const inside = wholeMeasureSelection?.focus.trackId === target.trackId && selectedWholeMeasureIds(wholeMeasureSelection).includes(target.measureId);
    if (!inside) {
      if (musicTextController.current?.select(null) !== "accepted") return;
      selectWholeMeasures({ anchor: target, focus: target });
    }
    clearHover();
    setRhythmPatternScope(null);
    setScoreMenu({ point, sessionKey, wholeMeasure: true });
  };

  const openScoreMenu = (cell: ILXMTabCellReference, point: { x: number; y: number }) => {
    if (scoreReadOnly || modals.isOpen() || musicTextController.current?.isTransitionBlocked()) return;
    if (wholeMeasureSelection?.focus.trackId === cell.trackId && selectedWholeMeasureIds(wholeMeasureSelection).includes(cell.measureId)) {
      openWholeMeasureMenu({ trackId: cell.trackId, measureId: cell.measureId }, point);
      return;
    }
    if (toolbarController.current?.closeContextTool() === false) return;
    // 单小节沿用弦格命中。跨节选择按小节保留 anchor 和 focus，使右键也能用同一范围添加反复房子。
    const spansMeasures = selection && selection.anchor.measureId !== selection.focus.measureId;
    const inside = resolvedSelection && cell.trackId === resolvedSelection.trackId &&
      resolvedSelection.beats.some((beat) => beat.measureId === cell.measureId && (spansMeasures ||
        (beat.beatId === cell.beatId && cell.string >= resolvedSelection.startString && cell.string <= resolvedSelection.endString)));
    if (!inside || activeMusicTextTarget || continuousRange || numberedSelection) {
      const next = inside ? selection : createCollapsedTabCellSelection(cell);
      if (musicTextController.current?.select(next) !== "accepted") return;
    } else clearScoreInteraction();
    clearHover();
    setRhythmPatternScope(null);
    setScoreMenuPanel(null);
    setContextCopy(null);
    setScoreMenu({ point, sessionKey });
  };

  const getNumberedContextRange = () => {
    const now = session.getState();
    return selectedNumberedContextRange(continuousRangeRef.current, activeMusicTextTargetRef.current,
      now.numberedSelection, now.selectedNumberedMarkId);
  };
  const canUseNumberedContext = () => {
    if (scoreReadOnlyRef.current || modals.isOpen() || outputBlockedOpen || imageExportSnapshot ||
      fileFlow.panel || fileFlow.pending || musicTextController.current?.isTransitionBlocked()) return false;
    const inspection = drafts.inspect();
    if (inspection.busy || inspection.composing) return false;
    if (inspection.pending.length || musicTextController.current?.isNumberedActionBlocked()) {
      // 草稿处理不保留旧的右键坐标或待执行操作。关闭确认后由用户重新发起，按最新曲谱定位。
      if (dismissScoreMenu(false)) showOutputBlocked(null);
      return false;
    }
    return true;
  };

  const openNumberedScoreMenu = (target: ILXMNumberedTarget | null, point: { x: number; y: number }) => {
    const current = session.getState().document;
    if (!current || !canUseNumberedContext()) return;
    const previous = getNumberedContextRange();
    const candidate = target ? rangeFromTarget({ ...target, kind: "numbered" }) : previous;
    if (!candidate || candidate.trackId !== lxmLayout?.trackId || !resolveMusicTextRange(current, candidate).ok) return;
    const resolved = previous?.trackId === candidate.trackId ? resolveMusicTextRange(current, previous) : null;
    const inside = !!resolved?.ok && (!target || resolved.slots.some((slot) => sameRangePoint(slot, candidate.focus)));
    if (!dismissScoreMenu(false)) return;
    if (!inside || activeMusicTextTargetRef.current) {
      // 单点只记录谱面焦点。只有普通左键或显式的侧栏编辑入口才创建录入表单。
      const source = inside ? session.getState().numberedSelection ?? { ...previous!.focus, kind: "numbered" as const, trackId: candidate.trackId } : target;
      const next = resolveNumberedEditorTarget(current, source);
      if (!next || musicTextController.current?.returnToScore() !== "accepted") return;
      const now = session.getState();
      now.setNumberedSelection(next);
      now.setSelectedNumberedMarkId(null);
    }
    clearScoreInteraction();
    clearHover();
    if (session.getState().selection) setSelection(null);
    setRhythmPatternScope(null);
    setScoreMenu({ point, sessionKey, numbered: { rangeKey: JSON.stringify(inside ? previous : candidate),
      version: captureEditorVersion(session.getState()) } });
  };

  const handleScoreContextMenu: React.MouseEventHandler<SVGSVGElement> = (event) => {
    if (scoreReadOnly) return;
    event.preventDefault();
    const point = getLayoutPoint(event.currentTarget, event);
    if (!point || !lxmLayout) return;
    const anchor = { x: event.clientX + 8, y: event.clientY + 8 };
    const repeatMeasureId = (event.target as Element).closest("[data-measure-repeat-target]")?.getAttribute("data-measure-repeat-target");
    if (repeatMeasureId) {
      openWholeMeasureMenu({ trackId: lxmLayout.trackId, measureId: repeatMeasureId }, anchor);
      return;
    }
    // 连接记号沿用独立编辑入口。歌词窗口先于简谱空位判定，防止空位命中扩展到歌词行。
    if (hitTestNumberedMark(lxmLayout, point)) return;
    const numbered = hitTestMusicText(lxmLayout, point)?.kind === "lyric" ? null : hitTestNumbered(lxmLayout, point);
    if (numbered) { openNumberedScoreMenu(numbered, anchor); return; }
    const hit = hitTestLayout(lxmLayout, point);
    if (!hit) return;
    const { trackId, measureId, beatId, string } = hit;
    openScoreMenu({ trackId, measureId, beatId, string }, anchor);
  };

  const handlePointerDown: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    if (scoreReadOnly || event.button !== 0) return;
    clearHover();
    if (!document || !lxmLayout) return;
    const point = getLayoutPoint(event.currentTarget, event);
    if (!point) return;
    const traversalClick = traversalClickRef.current;
    const shiftSelection = event.shiftKey && selection && selectedTechniqueId && traversalClick?.selection === selection
      ? { ...selection, anchor: traversalClick.cell }
      : selection;
    const action = resolveScorePointerAction(
      document,
      lxmLayout,
      point,
      shiftSelection,
      event.shiftKey,
    );
    if (!action) {
      if (!event.shiftKey) musicTextController.current?.dismissCleanPopover();
      return;
    }
    event.preventDefault();
    if (action.type === "target") {
      if (musicTextController.current?.isTransitionBlocked()) return;
      const candidate = rangeFromTarget(action.target);
      if (candidate && !action.numberedMarkId) {
        const previous = continuousRange ?? (activeMusicTextTarget ? rangeFromTarget(activeMusicTextTarget) : getNumberedContextRange());
        const extend = event.shiftKey && previous?.kind === candidate.kind && previous.trackId === candidate.trackId &&
          (candidate.kind !== "lyric" || (previous.verse ?? 1) === (candidate.verse ?? 1));
        if (musicTextController.current?.returnToScore() !== "accepted") return;
        if (extend) {
          const next = { ...candidate, anchor: previous.anchor };
          if (!resolveMusicTextRange(document, next).ok) return;
          setContinuousRange(next);
          setSelection(null);
          session.getState().setNumberedSelection(null);
          rangeDragRef.current = next;
          openSidebar();
          focusScore();
        } else {
          setContinuousRange(null);
          rangeDragRef.current = candidate;
          pendingTextClickRef.current = action.target;
        }
        activePointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      musicTextController.current?.open(action.target);
      return;
    }
    if (action.type !== "selection") return;
    if (
      !action.selection &&
      !action.techniqueId &&
      !event.shiftKey &&
      (activeMusicTextTarget?.kind === "numbered" ||
        activeMusicTextTarget?.kind === "lyric")
    ) {
      musicTextController.current?.dismissCleanPopover();
      return;
    }
    const result = musicTextController.current?.select(
      action.selection,
      action.techniqueId,
    );
    // 有草稿时只记录待选区，不捕获原 PointerEvent，也不重放已松开的拖动。
    if (
      result !== "accepted" ||
      !action.selection ||
      (action.techniqueId && !action.dragAnchor) ||
      action.startDrag === false
    )
      return;
    traversalClickRef.current = action.dragAnchor ? { selection: action.selection, cell: action.dragAnchor } : null;
    dragAnchorRef.current = action.dragAnchor ?? action.selection.anchor;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    if (scoreReadOnly) return;
    if (activePointerIdRef.current === event.pointerId && rangeDragRef.current && lxmLayout && document) {
      const point = getLayoutPoint(event.currentTarget, event);
      const drag = rangeDragRef.current;
      const focus = point && hitMusicTextRangePoint(lxmLayout, point, drag);
      if (!focus || sameRangePoint(focus, drag.focus)) return;
      const next = { ...drag, focus };
      if (!resolveMusicTextRange(document, next).ok) return;
      pendingTextClickRef.current = null;
      setContinuousRange(next);
      setSelection(null);
      session.getState().setNumberedSelection(null);
      rangeDragRef.current = next;
      activePointerIdRef.current = event.pointerId;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      openSidebar();
      focusScore();
      return;
    }
    if (
      activePointerIdRef.current !== event.pointerId ||
      !dragAnchorRef.current
    ) {
      // 悬停沿用点击的文字、技巧、弦格优先级，放大的提示框不参与命中。
      const point = getLayoutPoint(event.currentTarget, event);
      const bounds =
        point && lxmLayout ? hitTestMusicText(lxmLayout, point) : null;
      const hoverTarget =
        point && lxmLayout
          ? resolveMusicTextHoverTarget(lxmLayout, point)
          : null;
      const next =
        !event.buttons &&
        event.pointerType !== "touch" &&
        hoverTarget &&
        lxmLayout
          ? { layout: lxmLayout, target: hoverTarget }
          : null;
      setHoveredMusicText((current) =>
        current?.layout === next?.layout &&
        sameMusicTextTarget(current?.target ?? null, next?.target ?? null)
          ? current
          : next,
      );
      const target =
        !event.buttons &&
        event.pointerType !== "touch" &&
        !bounds &&
        !hoverTarget &&
        point &&
        lxmLayout &&
        !hitTestTechniqueTarget(lxmLayout, point)
          ? hitTestLayout(lxmLayout, point)
          : null;
      const nextTabCell =
        target && lxmLayout ? { layout: lxmLayout, target } : null;
      // 同一弦格内移动复用原状态，避免每个像素都重绘整张谱面。
      setHoveredTabCell((current) =>
        current?.layout === nextTabCell?.layout &&
        current?.target.trackId === nextTabCell?.target.trackId &&
        current?.target.measureId === nextTabCell?.target.measureId &&
        current?.target.beatId === nextTabCell?.target.beatId &&
        current?.target.string === nextTabCell?.target.string
          ? current
          : nextTabCell,
      );
      return;
    }
    const target = hitTestPointer(event.currentTarget, event);
    // 谱面空白不产生伪坐标，保留最后一个合法 focus。
    if (!target) return;
    const anchor = dragAnchorRef.current;
    if (session.getState().selectedTechniqueId) {
      // 单击仍选中技巧对象；拖到另一弦格后才切换成 TAB 选区。
      if (target.beatId === anchor.beatId && target.string === anchor.string) return;
      setSelectedTechniqueId(null);
    }
    setSelection({ anchor, focus: target });
  };

  const finishPointerDrag: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    if (scoreReadOnly) return;
    clearHover();
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const pendingClick = pendingTextClickRef.current;
    pendingTextClickRef.current = null;
    activePointerIdRef.current = null;
    dragAnchorRef.current = null;
    rangeDragRef.current = null;
    if (pendingClick && event.type !== "pointercancel") musicTextController.current?.open(pendingClick);
    else if (continuousRange) focusScore();
  };

  const handleMusicTextNavigation: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (scoreReadOnly || event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
      (event.target instanceof Element && event.target.closest('[data-editor-playback-controls], [data-practice-metronome]')) ||
      event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || modals.isOpen()) return;
    const handled = musicTextController.current?.moveEditTarget(
      event.key === "ArrowLeft" ? -1 : 1,
      event.target,
      event.target === scoreSvgRef.current,
    );
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  function runHistoryAction(action: "undo" | "redo"): boolean;
  function runHistoryAction(action: "rollback", entryId: string | null): number;
  function runHistoryAction(action: "undo" | "redo" | "rollback", entryId: string | null = null) {
    const blockedResult = action === "rollback" ? 0 : false;
    // 历史面板与单步操作共享只读、弹层和草稿守卫；面板回退还遵守其禁用状态。
    if (scoreReadOnlyRef.current || modals.isOpen() || (action === "rollback" && chordEntryBlocked))
      return blockedResult;
    endFretInput();
    if (
      musicTextController.current?.isTransitionBlocked() ||
      drafts.inspect().pending.some((record) => record.kind === "technique" || record.kind === "jumpMark" || record.kind === "repeatEnding")
    )
      return blockedResult;
    const now = session.getState();
    if (action === "rollback") return now.rollback(entryId);
    if (action === "undo") now.undo();
    else now.redo();
    return true;
  }

  /** 编辑器级历史快捷键在 SVG 或 Toolbar 持有焦点时都生效。 */
  const handleEditorKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (scoreReadOnly || modals.isOpen()) return;
    if (isTextEditingTarget(event.target)) return;
    if (
      event.target instanceof Element &&
      event.target.closest('dialog, [role="dialog"], [role="alertdialog"]')
    )
      return;
    const action = resolveEditorHistoryShortcut(event, { canUndo, canRedo });
    if (!action) return;

    event.preventDefault();
    runHistoryAction(action);
  };

  /**
    * 谱面键盘入口处理导航、当前对象删除和 Note 输入，避免劫持 Toolbar 的方向键。
   * 边界处 changed:false 时保留浏览器默认行为。
   */
  const handleScoreKeyDown: React.KeyboardEventHandler<SVGSVGElement> = (
    event,
  ) => {
    if (
      modals.isOpen() ||
      isTextEditingTarget(event.target) ||
      event.nativeEvent.isComposing
    )
      return;
    if (!scoreReadOnly && wholeMeasureSelection) {
      const { focus } = wholeMeasureSelection;
      if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
        const measure = event.currentTarget.querySelector(`[data-measure-repeat-target="${CSS.escape(focus.measureId)}"], [data-measure-number="${CSS.escape(focus.measureId)}"]`);
        const rect = measure?.getBoundingClientRect();
        if (rect) {
          event.preventDefault();
          openWholeMeasureMenu(focus, { x: rect.right + 6, y: rect.top });
        }
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        if (musicTextController.current?.isTransitionBlocked() || drafts.inspect().pending.some((record) =>
          record.kind === "jumpMark" || record.kind === "repeatEnding")) return;
        const measures = document?.score.tracks.find(({ id }) => id === focus.trackId)?.measures;
        const index = measures?.findIndex(({ id }) => id === focus.measureId) ?? -1;
        const next = index >= 0 ? measures?.[index + (event.key === "ArrowLeft" ? -1 : 1)] : undefined;
        if (next) {
          const target = { trackId: focus.trackId, measureId: next.id };
          setMeasureRepeatInspectorTarget(undefined);
          selectWholeMeasures({ anchor: event.shiftKey ? wholeMeasureSelection.anchor : target, focus: target });
          locateSidebarObject(target);
        }
        return;
      }
    }
    if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
      if (numberedContextRange) {
        const caret = (continuousRange ? rangeFocusRef.current : paragraphFocusRef.current)?.getBoundingClientRect();
        if (!caret) return;
        event.preventDefault();
        openNumberedScoreMenu(null, { x: caret.right + 6, y: caret.top });
        return;
      }
      if (!selection || !resolvedSelection || activeMusicTextTarget || continuousRange || numberedSelection) return;
      const caret = focusCaretRef.current?.getBoundingClientRect();
      if (!caret) return;
      event.preventDefault();
      openScoreMenu(selection.focus, { x: caret.right + 6, y: caret.top });
      return;
    }
    if (document && (continuousRange || event.shiftKey && activeMusicTextTarget && rangeFromTarget(activeMusicTextTarget))) {
      const range = continuousRange ?? rangeFromTarget(activeMusicTextTarget!)!;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (musicTextController.current?.isTransitionBlocked()) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const next = navigateMusicTextRange(document, range, event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
        if (next) {
          if (!continuousRange && musicTextController.current?.returnToScore() !== "accepted") return;
          setContinuousRange(next);
          setSelection(null);
          session.getState().setNumberedSelection(null);
          openSidebar();
          focusScore();
        }
        return;
      }
      if (continuousRange && event.key === "Escape") {
        event.preventDefault();
        setContinuousRange({ ...range, anchor: range.focus });
        focusScore();
        return;
      }
      if (continuousRange && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        musicTextController.current?.clearRange();
        return;
      }
      if (continuousRange) return;
    }
    if (document && numberedContextRange && !activeMusicTextTarget && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        if (!canUseNumberedContext()) return;
        const next = navigateMusicTextRange(document, numberedContextRange, event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
        if (!next) return;
        if (event.shiftKey) {
          setContinuousRange(next);
          session.getState().setNumberedSelection(null);
          openSidebar();
        } else {
          session.getState().setNumberedSelection(resolveNumberedEditorTarget(document, { ...next.focus, kind: "numbered", trackId: next.trackId }));
        }
        return;
      }
    }
    // 段落活动对象上的 Esc 也走草稿保护，不能被文字输入锁提前拦住。
    if (event.key === "Escape" && activeMusicTextTarget) {
      event.preventDefault();
      musicTextController.current?.returnToScore();
      return;
    }
    // 和弦页签自动绑定单拍后，谱面仍允许方向键选拍；目标迁移经过草稿入口。
    if (musicTextEditing && activeMusicTextTarget?.kind === "chord" && document && selection &&
      !event.metaKey && !event.ctrlKey && !event.altKey &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      const direction = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"];
      const result = navigateTabCellSelection(document, selection, direction, event.shiftKey);
      if (result.ok && result.changed) {
        event.preventDefault();
        musicTextController.current?.select(result.selection);
      }
      return;
    }
    if (musicTextEditing) return;
    const isPrimaryModifier = event.metaKey || event.ctrlKey;
    // 历史快捷键向上冒泡到编辑器根节点统一处理。
    if (isPrimaryModifier || event.altKey) return;

    const directions = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    } as const;
    const direction = directions[event.key as keyof typeof directions];
    if (direction && document && selection) {
      const result = navigateTabCellSelection(
        document,
        selection,
        direction,
        event.shiftKey,
      );
      if (result.ok && result.changed) {
        event.preventDefault();
        musicTextController.current?.select(result.selection);
      } else if (!result.ok) setErrorMessage(result.message);
      return;
    }

    if (event.key === "Escape") {
      if (!selection) return;
      event.preventDefault();
      endFretInput();
      setSelection(createCollapsedTabCellSelection(selection.focus));
      // Esc 收起离散多选并保留活动记号，避免后续休止仍作用在已收起的对象上。
      if (selectedTraversalIds.length > 1) setSelectedTechniqueId(selectedTechniqueId);
      setErrorMessage(null);
      return;
    }
    if (resolveMutedNoteShortcut(event)) {
      event.preventDefault();
      runImmediateEditorAction(() => setSelectedNotes("x"));
      return;
    }
    if (resolveTabContinuationShortcut(event)) {
      event.preventDefault();
      runImmediateEditorAction(() => setSelectedNotes("-"));
      return;
    }
    const beatKindAction = resolveBeatKindShortcut(event);
    if (beatKindAction && selection) {
      event.preventDefault();
      // 快捷键与顶部及侧栏共用目标解析和草稿保护，离散记号只提交一次。
      void handleToolbarAction({ type: beatKindAction === "setRest" ? "rest" : "restore" });
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      if (!selection && !selectedTechniqueId) return;
      event.preventDefault();
      endFretInput();
      void removeScoreSelection();
      return;
    }
    if (!/^\d$/.test(event.key)) return;

    event.preventDefault();
    if (event.repeat) return;
    const current = session.getState();
    const previous = fretPrefix.current;
    endFretInput();
    const prefix = previous && previous.selection === current.selection &&
      previous.stateVersion === current.stateVersion &&
      event.timeStamp - previous.timeStamp <= FRET_DIGIT_INTERVAL_MS ? previous : null;
    const digit = Number(event.key);
    const fret = prefix ? 10 * prefix.digit + digit : digit;
    if (fret > 24) {
      setErrorMessage("品位必须在 0 到 24 之间。");
      return;
    }
    const result = setSelectedNotes(fret, prefix?.historyEntryId);
    if (!prefix && (digit === 1 || digit === 2) && result?.ok && current.selection) {
      const next = session.getState();
      if (next.document === result.document && next.selection === current.selection)
        fretPrefix.current = {
          digit, timeStamp: event.timeStamp, selection: current.selection, stateVersion: next.stateVersion,
          historyEntryId: result.changed ? next.historyView.currentEntryId ?? undefined : undefined,
        };
    }
  };

  /** 点击 SVG 外的 A4 空白或灰色工作区时清空临时选区。 */
  const handleWorkspacePointerDown: React.PointerEventHandler<
    HTMLDivElement
  > = (event) => {
    const target = event.target;
    if (
      scoreReadOnly || event.button !== 0 || event.shiftKey ||
      (target instanceof Node && scoreSvgRef.current?.contains(target)) ||
      isScoreScrollbarPointerDown(event)
    )
      return;

    if (
      activeMusicTextTarget?.kind === "numbered" ||
      activeMusicTextTarget?.kind === "lyric"
    ) {
      musicTextController.current?.dismissCleanPopover();
      return;
    }
    musicTextController.current?.select(null);
  };

  const editorVariables = {
    "--panel": token.colorBgContainer,
    "--panel-muted": token.colorBgLayout,
    "--background": token.colorBgLayout,
    "--foreground": token.colorText,
    "--muted": token.colorTextSecondary,
    "--border": token.colorBorderSecondary,
    "--border-strong": token.colorBorder,
    "--accent": token.colorPrimary,
    "--accent-soft": token.colorPrimaryBg,
  };
  const toggleSidebar = () => {
    if (scoreReadOnly) return;
    if (!sidebarCollapsed) {
      closeSidebar();
      return;
    }
    openSidebar();
    requestAnimationFrame(() => musicTextController.current?.restoreSidebarFocus());
  };
  const openOutput = (mode: "json" | "png" | "print", trigger: HTMLElement | null) => {
    if (mode === "json") {
      fileFlow.showPanel(mode, trigger);
      return;
    }
    if (host && (fileFlow.panel || fileFlow.pending || fileFlow.isNativeBusy())) return;
    if (isOutputBlocked()) {
      showOutputBlocked(trigger);
      return;
    }
    const state = session.getState();
    if (!state.document) return;
    // 已打开的对话框独占导出任务；弹窗内部的模式切换会先核对是否仍有草稿或输出在途。
    if (imageExportSnapshot) return;
    setOutputMode(mode);
    setImageExportSnapshot({ version: captureEditorVersion(state), document: state.document, density, showChordDiagrams });
  };
  const handleHostAction = useRef<(action: EditorHostAction) => void>(() => {});
  useLayoutEffect(() => {
    handleHostAction.current = (action) => {
      switch (action) {
        case "open": fileFlow.showPanel("import", null); break;
        case "save": void fileFlow.saveNative(); break;
        case "saveAs": void fileFlow.saveNative(true); break;
        case "print": openOutput("print", null); break;
        case "close": fileFlow.requestClose(); break;
      }
    };
  });
  // 只在换谱重建或宿主改变时重订阅，避免一次关闭确认因界面重渲染而被宿主重复派发。
  useLayoutEffect(() => host?.onAction((action) => handleHostAction.current(action)), [host]);

  const editorHeader = <EditorHeader
    title={document?.score.title ?? ""}
    status={fileStatus}
    empty={!document || !lxmLayout}
    canUndo={!scoreReadOnly && canUndo}
    canRedo={!scoreReadOnly && canRedo}
    sidebarCollapsed={sidebarCollapsed}
    sidebarToggleDisabled={scoreReadOnly}
    zoom={scoreView.zoom}
    onHistory={runHistoryAction}
    onToggleSidebar={toggleSidebar}
    onZoom={scoreView.setZoom}
    navigation={navigation}
    onFollowLink={navigation?.onNavigate ? navigateTo : undefined}
    onNavigate={(destination, label, trigger) => {
      const allowed = requestNavigation(destination, label, trigger);
      if (allowed && !navigation?.onNavigate && !navigation?.renderLink) fileFlow.allowPageUnload();
      return allowed;
    }}
    onLearning={(trigger) => {
      const destination = navigation?.learningHref;
      if (destination && requestNavigation(destination, "进入吉他进阶", trigger)) navigateTo(destination);
    }}
    onShortcuts={(trigger, fromKeyboard) => {
      if (imageExportSnapshot || fileFlow.panel) return;
      modals.open({
        kind: "shortcuts",
        title: "快捷键",
        message: "",
        focusSearch: fromKeyboard || !window.matchMedia("(pointer: coarse)").matches,
        restoreFocus: () => {
          // 等工作区的浮层协调器解除背景 inert，再恢复入口焦点。
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!modals.isOpen()) trigger.focus({ preventScroll: true });
          }));
        },
      });
    }}
    onFileAction={(action, trigger) => {
      if (action !== "home") fileFlow.showPanel(action, trigger);
      else if (navigation?.homeHref && requestNavigation(navigation.homeHref, "返回首页", trigger)) navigateTo(navigation.homeHref);
    }}
    onSave={host ? (saveAs, trigger) => void fileFlow.saveNative(saveAs, false, trigger) : undefined}
    exportButtonRef={imageExportButtonRef}
    onExportAction={openOutput}
  />;

  if (!document || !lxmLayout)
    return (
      <div id={`${idPrefix}workspace`} ref={editorRootRef} className={styles.editor} data-editor-shell data-layout={layoutMode} style={editorVariables as React.CSSProperties}>
        {messageHolder}
        {editorHeader}
        <div ref={workspaceRef} className={styles.emptyWorkspace}>
          {(!host || errorMessage) && <p className={editorFormStyles.errorMessage} role="alert">{errorMessage ?? "当前没有可编辑的乐谱文档。"}</p>}
          <div>
            <Button type="primary" onClick={(event) => fileFlow.showPanel("new", event.currentTarget)}>新建曲谱</Button>
            <Button onClick={(event) => fileFlow.showPanel("import", event.currentTarget)}>{host ? "打开曲谱" : "导入曲谱"}</Button>
          </div>
        </div>
        <ScoreFilePanels flow={fileFlow} session={session} document={document} />
      </div>
    );

  /** 工具提交前核对属性保护；粘贴允许自己的 Modal。 */
  const executeTool: EditorCommandAdapter = async (
    command,
    impact = "modal",
    submission,
  ) => {
    endFretInput();
    const reason = editorToolSubmissionReason(
      session.getState(),
      activeMusicTextTargetRef.current,
      drafts,
      command,
      submission,
    );
    if (reason) return { status: "blocked", message: reason };
    if (
      (submission?.numberedContext || command.type === "numbered.event.setRhythm" ||
        command.type === "numbered.tuplet.add" ||
        command.type === "numbered.tuplet.createInBeat" ||
        command.type === "numbered.tuplet.remove" ||
        command.type === "numbered.mark.add" ||
        command.type === "numbered.mark.update" ||
        command.type === "numbered.mark.remove")
        ? musicTextController.current?.isNumberedActionBlocked()
        : musicTextController.current?.isOutputBlocked({
            allowSettingsBusy:
              command.type === LXMScoreCommandEnum.CopyMeasureRange,
          })
    )
      return {
        status: "blocked",
        message: "请先应用或取消属性草稿，再修改音乐。",
      };
    const modal = modals.getSnapshot();
    if (modal && !(impact === "caller" && modal.request.kind === "beat-paste"))
      return { status: "blocked", message: "请先完成当前弹层操作。" };
    return toolExecute(command, impact, submission);
  };

  const beginMeasureInspector = (target: MeasureToolTarget, selectMeasure: boolean) => {
    if (scoreReadOnlyRef.current || modals.isOpen() || drafts.inspect().pending.some((record) =>
      record.kind === "jumpMark" || record.kind === "repeatEnding")) return false;
    const now = session.getState();
    const measure = now.document?.score.tracks.find(({ id }) => id === target.trackId)?.measures.find(({ id }) => id === target.measureId);
    if (!measure) return false;
    if (!dismissScoreMenu(false)) return false;
    const sidebar = musicTextController.current;
    if (!sidebar) return false;
    if (selectMeasure && (now.selection?.focus.measureId !== measure.id || now.numberedSelection || activeMusicTextTargetRef.current)) {
      // 文件允许不含拍点的小节。它仍有小节属性和可定位的排版边界。
      const beat = measure.beats[0];
      const selected = beat ? createCollapsedTabCellSelection({ ...target, beatId: beat.id, string: 1 }) : null;
      if (sidebar.select(selected) !== "accepted") return false;
    }
    if (sidebar.navigateTool("measure", target) !== "accepted") return false;
    pendingPanel.current = null;
    if (narrowPanels) setHistoryOpen(false);
    setSidebarCollapsed(false);
    if (selectMeasure) locateSidebarObject(target);
    return true;
  };

  const openJumpMarks = (target: MeasureToolTarget, request: JumpMarkInspectorRequest = { mode: "section" }, selectMeasure = false) => {
    const measure = session.getState().document?.score.tracks.find(({ id }) => id === target.trackId)?.measures.find(({ id }) => id === target.measureId);
    if (!measure || (request.markId && !measure.jumpMarks?.some(({ id }) => id === request.markId))) return false;
    if (!beginMeasureInspector(target, !!request.markId || selectMeasure)) return false;
    setActiveMeasureMarkTool("jump");
    setMeasureRepeatInspectorTarget(undefined);
    setRepeatEndingInspectorRequest(undefined);
    setJumpInspectorRequest({ sessionKey, measureId: target.measureId, request });
    return true;
  };

  const openRepeatEnding = (target: MeasureToolTarget, measureIds: readonly string[] = [target.measureId],
    request: RepeatEndingInspectorRequest = { mode: "insert" }) => {
    const track = session.getState().document?.score.tracks.find(({ id }) => id === target.trackId);
    const ending = request.endingId && track?.repeatEndingGroups?.flatMap(({ endings }) => endings).find(({ id }) => id === request.endingId);
    if (request.endingId && !ending) return false;
    if (!beginMeasureInspector(target, false)) return false;
    if (ending) selectRepeatEndingRange(target.trackId, ending.startMeasureId, ending.endMeasureId);
    setActiveMeasureMarkTool("ending");
    setJumpInspectorRequest(undefined);
    setMeasureRepeatInspectorTarget(undefined);
    setRepeatEndingInspectorRequest({ sessionKey, target, measureIds, request });
    return true;
  };

  // 已经进入房子属性后，范围定位只动谱面，不重新发起侧栏导航或抢走表单焦点。
  const selectRepeatEndingRange = (trackId: string, startMeasureId: string, endMeasureId: string) => {
    const state = session.getState();
    const measures = state.document?.score.tracks.find(({ id }) => id === trackId)?.measures;
    const startBeat = measures?.find(({ id }) => id === startMeasureId)?.beats[0];
    const endBeat = measures?.find(({ id }) => id === endMeasureId)?.beats.at(-1);
    if (startBeat && endBeat) {
      clearScoreInteraction();
      setMeasureSelection(undefined);
      setContinuousRange(null);
      state.setNumberedSelection(null);
      state.setSelectedTechniqueId(null);
      state.setSelection({
        anchor: { trackId, measureId: startMeasureId, beatId: startBeat.id, string: 1 },
        focus: { trackId, measureId: endMeasureId, beatId: endBeat.id, string: 6 },
      });
    }
    locateSidebarObject({ trackId, measureId: startMeasureId });
  };

  const openMeasureRepeat = (target: MeasureToolTarget) => {
    const state = session.getState();
    if (!state.document) return false;
    const repeat = getMeasureRepeatAvailability(state.document.score, target.measureId, target.trackId);
    if (!repeat.enabled || !beginMeasureInspector(target, false)) return false;
    selectWholeMeasures({ anchor: target, focus: target });
    locateSidebarObject(target);
    setActiveMeasureMarkTool("repeat");
    setJumpInspectorRequest(undefined);
    setRepeatEndingInspectorRequest(undefined);
    setMeasureRepeatInspectorTarget({ sessionKey, target });
    const version = captureEditorVersion(state);
    requestAnimationFrame(() => {
      if (!sameEditorSession(session.getState(), version)) return;
      const host = measureRepeatInspectorFocus.current;
      host?.scrollIntoView({ block: "nearest" });
      (host?.querySelector<HTMLElement>("[data-measure-repeat-inspector]") ?? host)?.focus({ preventScroll: true });
    });
    return true;
  };

  const findJumpMark = (markId: string): MeasureToolTarget | undefined => {
    const track = session.getState().document?.score.tracks[0];
    if (!track) return undefined;
    const entry = createJumpMarkIndex(track.measures).byId.get(markId);
    return entry && { trackId: track.id, measureId: entry.measureId };
  };
  const repairJumpMark = (markId: string) => {
    const version = captureEditorVersion(session.getState());
    setPlaybackEnabled(false);
    // 退出只读的提交完成后再用同一个属性入口，修复对象可能在另一小节。
    requestAnimationFrame(() => {
      if (!sameEditorSession(session.getState(), version)) return;
      const target = findJumpMark(markId);
      if (target) openJumpMarks(target, { markId });
    });
  };

  const repairRepeatEnding = (issue: PlaybackRepeatEndingIssue) => {
    const version = captureEditorVersion(session.getState());
    setPlaybackEnabled(false);
    requestAnimationFrame(() => {
      const state = session.getState();
      if (!sameEditorSession(state, version)) return;
      const track = state.document?.score.tracks.find(({ repeatEndingGroups }) => repeatEndingGroups?.some(({ id }) => id === issue.groupId));
      if (!track) return;
      if (issue.reason === "invalidDestination" && issue.repairMarkId) {
        const location = findJumpMark(issue.repairMarkId);
        if (location && openJumpMarks(location, { markId: issue.repairMarkId })) return;
      }
      const target = { trackId: track.id, measureId: issue.measureId };
      const request: RepeatEndingInspectorRequest = issue.reason === "invalidDestination"
        ? { mode: "section", groupId: issue.groupId }
        : { mode: "insert", groupId: issue.groupId, pass: issue.pass };
      if (openRepeatEnding(target, [target.measureId], request)) selectRepeatEndingRange(track.id, target.measureId, target.measureId);
    });
  };

  const renderMeasureMarks = (target: MeasureToolTarget) => {
    const track = document.score.tracks.find(({ id }) => id === target.trackId);
    if (!track) return null;
    const jumpRequest = jumpInspectorRequest?.sessionKey === sessionKey && jumpInspectorRequest.measureId === target.measureId
      ? jumpInspectorRequest.request : undefined;
    const matches = (entry?: { sessionKey: string; target: MeasureToolTarget }) => entry?.sessionKey === sessionKey &&
      entry.target.measureId === target.measureId && entry.target.trackId === target.trackId;
    const endingRequest = matches(repeatEndingInspectorRequest) ? repeatEndingInspectorRequest : undefined;
    const selectedRange = wholeMeasureSelection?.focus.trackId === track.id ? wholeMeasureSelection
      : continuousRange?.trackId === track.id ? continuousRange
        : selection?.focus.trackId === track.id && !numberedSelection && !activeMusicTextTarget ? selection : undefined;
    const start = track.measures.findIndex(({ id }) => id === (selectedRange?.anchor.measureId ?? target.measureId));
    const end = track.measures.findIndex(({ id }) => id === (selectedRange?.focus.measureId ?? target.measureId));
    const measureIds = endingRequest?.measureIds ?? track.measures.slice(Math.min(start, end), Math.max(start, end) + 1).map(({ id }) => id);
    const version = captureEditorVersion(session.getState());
    const disabled = musicTextEditing || !!activeModal;
    const commit = async (command: ILXMScoreCommand, owner?: EditorDraftOwner) => {
      const result = await executeTool(command, "modal", { owner });
      if ("message" in result) setErrorMessage(result.message);
      return result.status === "applied" || result.status === "noop";
    };
    const selectBeat = (measureId: string, beatId?: string) => {
      const now = session.getState();
      const measure = now.document?.score.tracks.find(({ id }) => id === track.id)?.measures.find(({ id }) => id === measureId);
      const beat = beatId ? measure?.beats.find(({ id }) => id === beatId) : measure?.beats[0];
      if (!measure || !sameEditorSession(now, version)) return;
      const location = { trackId: track.id, measureId };
      const next = beat ? createCollapsedTabCellSelection({ ...location, beatId: beat.id, string: 1 }) : null;
      if (musicTextController.current?.select(next) !== "accepted") return;
      setMeasureRepeatInspectorTarget(undefined);
      locateSidebarObject(beat ? { ...location, beatId: beat.id } : location);
    };
    return <>
    <JumpMarkInspector key={`jump:${sessionKey}:${activeMeasureMarkTool === "jump"}`} measures={track.measures} measureId={target.measureId}
      request={jumpRequest} onRequestHandled={(handled) => setJumpInspectorRequest((current) => current?.request === handled ? undefined : current)}
      version={version} disabled={disabled}
      onDraftMeasure={setJumpDraftMeasure}
      onLocateMark={(id) => {
        const location = findJumpMark(id);
        if (location) openJumpMarks(location, { markId: id });
      }}
      onApply={async (measureId, mark, owner) => {
        const result = await executeTool({ type: LXMScoreCommandEnum.SetJumpMark, trackId: track.id, measureId, mark }, "modal", { owner });
        if ("message" in result) setErrorMessage(result.message);
        if (result.status === "applied" && measureId !== target.measureId) {
          const applied = result.result.document;
          requestAnimationFrame(() => {
            if (session.getState().document === applied)
              openJumpMarks({ trackId: track.id, measureId }, undefined, true);
          });
        }
        return result.status === "applied" || result.status === "noop";
      }}
      onDelete={async (markId, owner) => {
        const result = await executeTool({ type: LXMScoreCommandEnum.RemoveJumpMark, trackId: track.id, markId }, "modal", { owner });
        if ("message" in result) setErrorMessage(result.message);
        return result.status === "applied";
      }} />
    <RepeatEndingInspector key={`ending:${sessionKey}:${activeMeasureMarkTool === "ending"}`} track={track} measureIds={measureIds}
      request={endingRequest?.request} version={version} disabled={disabled}
      onRequestHandled={(handled) => setRepeatEndingInspectorRequest((current) => current?.request === handled ? undefined : current)}
      onLocateRange={(start, end) => selectRepeatEndingRange(track.id, start, end)}
      onPreviewChange={setRepeatEndingPreview}
      onApply={(group, ending, owner) => commit({ type: LXMScoreCommandEnum.UpsertRepeatEnding, trackId: track.id, group, ending }, owner)}
      onDelete={(endingId, owner) => commit({ type: LXMScoreCommandEnum.DeleteRepeatEnding, trackId: track.id, endingId }, owner)}
      onDeleteGroup={(groupId, owner) => commit({ type: LXMScoreCommandEnum.DeleteRepeatEndingGroup, trackId: track.id, groupId }, owner)} />
    {matches(measureRepeatInspectorTarget) && <div key={`repeat:${sessionKey}:${target.measureId}`} ref={measureRepeatInspectorFocus} tabIndex={-1}>
      <MeasureRepeatInspector score={document.score} measureId={target.measureId} documentRevision={document.documentRevision}
        onApply={(command) => {
          // 替换确认由 Inspector 持有，适配器再次校验命令观察到的版本；换谱后的旧表单不能提交。
          if (session.getState().document !== document) return false;
          return commit(command);
        }}
        onSelectMeasure={(id) => selectBeat(id)} onSelectBeat={(id) => selectBeat(target.measureId, id)} />
    </div>}
    </>;
  };

  const appendMeasure = async () => {
    if (scoreReadOnly || appendingMeasure.current) return;
    const track = session.getState().document?.score.tracks[0];
    const lastMeasure = track?.measures.at(-1);
    if (!track || !lastMeasure) return;

    appendingMeasure.current = true;
    try {
      const result = await executeTool({
        type: LXMScoreCommandEnum.InsertMeasure,
        trackId: track.id,
        afterMeasureId: lastMeasure.id,
      });
      if (result.status !== "applied") {
        if ("message" in result) setErrorMessage(result.message);
        return;
      }
      const state = session.getState();
      if (scoreReadOnlyRef.current || state.document !== result.result.document) return;
      const inserted = state.document.score.tracks[0]?.measures.at(-1);
      const firstBeat = inserted?.beats[0];
      if (!inserted || !firstBeat) return;
      state.setSelectedNumberedMarkId(null);
      musicTextController.current?.select(createCollapsedTabCellSelection({
        trackId: track.id,
        measureId: inserted.id,
        beatId: firstBeat.id,
        string: 1,
      }));
    } finally {
      appendingMeasure.current = false;
    }
  };
  /** 菜单/详情共享最新目标和最终确认结果，不捕获旧 render 的音乐对象。 */
  const handleToolbarAction = async (
    action: EditorToolbarAction,
  ): Promise<boolean> => {
    if (action.type === "undo" || action.type === "redo")
      return runHistoryAction(action.type);
    if (modals.isOpen()) return false;
    endFretInput();
    const tabQuick =
      action.type === "restToggle" || action.type === "rest" || action.type === "restore" ||
      action.type === "quickTechnique";
    if (tabQuick) {
      const reason = tabToolTargetReason(
        session.getState(),
        activeMusicTextTargetRef.current,
      );
      if (reason) {
        setErrorMessage(reason);
        return false;
      }
    }
    const intentIsCurrent = captureEditorToolIntent(
      session.getState,
      () => activeMusicTextTargetRef.current,
    );
    if (action.type === "numberedArc" || action.type === "numberedTuplet") {
      const now = session.getState();
      const document = now.document;
      if (!document) return false;
      const range = continuousRangeRef.current;
      const capturedRange = JSON.stringify(range);
      // 以点击时的文档和连续选区重算所选命令。异步确认后也必须匹配原选区，避免操作落到其它音符。
      const target = action.type === "numberedArc" ? resolveNumberedArcOptions(document, range)[action.kind]
        : action.operation === "createInBeat"
          ? resolveNumberedBeatTupletTarget(document, range, activeMusicTextTargetRef.current, now.numberedSelection)
          : (() => {
              const choices = resolveNumberedTupletTarget(document, range, activeMusicTextTargetRef.current, now.numberedSelection);
              if (!choices.ok) return choices;
              if (action.operation !== "add") return choices.remove;
              // 五连音有两种时值，重算后按实际与常规音数共同定位点击的选项。
              return choices.ratios.find(({ ratio }) => sameTupletRatio(ratio, action.ratio))?.target ??
                { ok: false as const, message: "简谱连音选区已变化，请重新选择。" };
            })();
      if (!target.ok) {
        setErrorMessage(target.message);
        return false;
      }
      if (action.type === "numberedTuplet" && target.command.type !== `numbered.tuplet.${action.operation}`) {
        setErrorMessage("简谱连音选区已变化，请重新选择。");
        return false;
      }
      const result = await executeTool(target.command, "modal", {
        isCurrent: () => intentIsCurrent() && capturedRange === JSON.stringify(continuousRangeRef.current),
      });
      if (result.status === "blocked") setErrorMessage(result.message);
      return result.status === "applied" || result.status === "noop";
    }
    if (action.type === "rhythm" || action.type === "dots") {
      const now = session.getState();
      if (!now.document) return false;
      const target = resolveEditorRhythmTarget(
        now.document,
        now.selection,
        activeMusicTextTarget,
        now.numberedInputRhythm,
        now.numberedInputRhythmExplicit,
        now.tabInputRhythmOverrides,
        now.numberedAutoAdvance,
        now.numberedInputRhythmTarget,
      );
      if (!target.enabled || !target.rhythm) return false;
      if (target.kind === "numbered" && target.target) {
        if (musicTextController.current?.isNumberedActionBlocked()) {
          setErrorMessage("请先应用或取消当前草稿。");
          return false;
        }
        const rhythm =
          action.type === "rhythm"
            ? { ...target.rhythm, base: action.base }
            : { ...target.rhythm, dots: action.dots };
        if (target.target.kind === "numberedTime") {
          now.setNumberedInputRhythm(rhythm, target.target);
          return true;
        }
        const result = await executeTool({
          type: "numbered.event.setRhythm",
          trackId: target.target.trackId,
          measureId: target.target.measureId,
          eventId: target.target.eventId,
          rhythm,
          timeline: "preservePositions",
        });
        return result.status === "applied" || result.status === "noop";
      }
    }
    if (musicTextController.current?.isOutputBlocked()) {
      setErrorMessage("请先应用或取消属性草稿，再修改音乐。");
      return false;
    }
    const now = session.getState();
    if (!now.document) return false;
    const command = buildEditorToolCommand(now.document, now.selection, action, now.tabInputRhythmOverrides, now.selectedTraversalIds);
    if (!command) {
      setErrorMessage("当前目标不适用此操作，请重新选择。");
      return false;
    }
    const result = await executeTool(command, "modal", {
      isCurrent: () => intentIsCurrent() &&
        (action.type !== "copyMeasures" || !action.isCurrent || action.isCurrent()),
      tabOnly: tabQuick,
    });
    if ((action.type === "copyMeasures" || action.type === "removeMeasure") &&
      (result.status === "blocked" || result.status === "stale")) setErrorMessage(result.message);
    return result.status === "applied" || result.status === "noop";
  };
  const currentPosition = deriveSidebarContext({
    document,
    selection,
    numberedSelection,
  });
  const rhythmTarget = resolveEditorRhythmPatternTarget(document, selection, continuousRange, activeMusicTextTarget, numberedSelection);
  const contextChord = resolveEditorChordTarget(document, selection, null);
  const wholeMeasureIds = wholeMeasureSelection ? selectedWholeMeasureIds(wholeMeasureSelection) : [];
  const wholeMeasureTrack = wholeMeasureSelection && document.score.tracks.find(({ id }) => id === wholeMeasureSelection.focus.trackId);
  const firstWholeMeasure = wholeMeasureTrack ? wholeMeasureTrack.measures.findIndex(({ id }) => id === wholeMeasureIds[0]) + 1 : 0;
  const wholeMeasureScope = firstWholeMeasure ? wholeMeasureIds.length > 1
    ? `第 ${firstWholeMeasure}–${firstWholeMeasure + wholeMeasureIds.length - 1} 小节` : `第 ${firstWholeMeasure} 小节` : "";
  const contextScope = scoreMenu?.wholeMeasure ? wholeMeasureScope : focusedMeasureContext && resolvedSelection && selection
    ? resolvedSelection.beats.length === 1
      ? `第 ${focusedMeasureContext.measureIndex + 1} 小节第 ${focusedMeasureContext.measure.beats.findIndex((beat) => beat.id === selection.focus.beatId) + 1} 拍`
      : `${resolvedSelection.beats.length} 个拍点 · 当前第 ${focusedMeasureContext.measureIndex + 1} 小节`
    : "";
  const handleNumberedMenuAction = async (action: NumberedScoreContextAction, anchor: HTMLButtonElement) => {
    const opening = scoreMenu?.numbered;
    const isCurrent = () => !scoreReadOnlyRef.current && !!opening && sameEditorVersion(session.getState(), opening.version) &&
      opening.rangeKey === JSON.stringify(getNumberedContextRange());
    if (!isCurrent() || !canUseNumberedContext()) return;
    if (action === "beat" || action === "numberedArc" || action === "tuplet") {
      const onClose = () => setScoreMenuPanel((active) => active === action ? null : active);
      const toolbar = toolbarController.current;
      const reason = toolbar?.getContextToolDisabledReason(action);
      if (reason) { setErrorMessage(reason); return; }
      if (toolbar?.openContextTool(action, anchor, onClose)) setScoreMenuPanel(action);
      return;
    }
    const current = session.getState();
    const range = getNumberedContextRange();
    if (!current.document || !range) return;
    // 菜单的可用状态只供展示。执行时按当前选区、剪贴板与真实时值重新检查边界和影响。
    const options = resolveNumberedContextActions(current.document, range, numberedClipboard);
    if (!options.ok) { setErrorMessage(options.message); return; }
    const option = action === "copyNumbered" ? options.copy : action === "pasteNumbered" ? options.paste : options.clear;
    if (!option.ok) { setErrorMessage(option.message); return; }
    if (!dismissScoreMenu(true)) return;
    if ("clipboard" in option) {
      setNumberedClipboard(option.clipboard);
      const omitted = option.clipboard.omissions.length;
      messages.success(omitted ? `已复制简谱，已略过 ${omitted} 个端点在选区外的记号。` : "已复制简谱。");
      return;
    }
    const overwriteScope = "overwriteScope" in option ? option.overwriteScope : undefined;
    const restoreFocus = () => {
      if (opening && sameEditorSession(session.getState(), opening.version) && !scoreReadOnlyRef.current) focusScore();
    };
    const result = await executeTool(option.command, "modal", {
      isCurrent,
      numberedContext: { scope: overwriteScope ?? options.scope, overwrite: !!overwriteScope, restoreFocus },
    });
    if (result.status === "blocked" || result.status === "stale") setErrorMessage(result.message);
    if (result.status !== "applied" || session.getState().document !== result.result.document || scoreReadOnlyRef.current) return;
    // 清空保留事件 ID 与原选区。粘贴由核心返回新事件焦点，释放可能引用被替换事件的旧选区。
    if (option.command.type === "numbered.range.paste") setContinuousRange(null);
    if (session.getState().selection) setSelection(null);
    if (!modals.isOpen()) restoreFocus();
    messages.success(action === "pasteNumbered" ? "已粘贴简谱。" : "已清空简谱内容。");
  };
  const closeContextCopy = (restoreFocus: boolean) => {
    setContextCopy(null);
    setScoreMenuPanel((active) => active === "copy" ? null : active);
    if (restoreFocus && contextCopy?.anchor.isConnected) contextCopy.anchor.focus({ preventScroll: true });
  };
  const copyCurrentMeasure = async (destination: MeasureCopyDestination): Promise<boolean> => {
    const now = session.getState();
    if (!contextCopy?.isCurrent() || !now.document || modals.isOpen() || scoreReadOnlyRef.current) return false;
    const target = contextCopy.selection.focus;
    // 跨小节选区仍只复制 focus 小节。目标位置改变时，副本按插入锚点定位，而不再假设它紧跟来源。
    const command = buildEditorToolCommand(now.document, now.selection, { type: "copyMeasures", target, destination });
    if (command?.type !== LXMScoreCommandEnum.CopyMeasureRange) return false;
    const result = await executeTool(command, "modal", {
      isCurrent: contextCopy.isCurrent,
    });
    if (result.status !== "applied") {
      if (result.status === "blocked" || result.status === "stale") setErrorMessage(result.message);
      return false;
    }
    const current = session.getState();
    // 命令或确认弹窗返回后，若已换谱或进入播放，不能再把焦点移回旧副本。
    if (current.document !== result.result.document || scoreReadOnlyRef.current) return true;
    dismissScoreMenu(true);
    const measures = current.document.score.tracks.find((track) => track.id === target.trackId)?.measures;
    const index = command.afterMeasureId === undefined ? -1 : measures?.findIndex((measure) => measure.id === command.afterMeasureId) ?? -1;
    const duplicate = measures?.[index + 1];
    const beat = duplicate?.beats[0];
    if (duplicate && beat) musicTextController.current?.select(createCollapsedTabCellSelection({
      trackId: target.trackId, measureId: duplicate.id, beatId: beat.id, string: target.string,
    }));
    return true;
  };
  const visibleContextCopy = scoreMenuPanel === "copy" && contextCopy?.document === document && contextCopy.selection === selection ? contextCopy : null;
  const handleScoreMenuAction = (action: ScoreContextAction, anchor: HTMLButtonElement) => {
    if (modals.isOpen() || scoreReadOnlyRef.current) return;
    // 和弦编辑占用文字编辑目标。切回 TAB 工具前先让退出状态提交，目标校验才能读到 TAB 选区。
    const switchingFromChord = scoreMenuPanel === "chord" && action !== "chord";
    if (switchingFromChord && musicTextController.current?.closeContextChord() === false) return;
    if (action === "chord" || action === "copy") {
      if (toolbarController.current?.closeContextTool() === false) return;
    }
    const activate = () => {
      if (!anchor.isConnected || modals.isOpen() || scoreReadOnlyRef.current) return;
      if (action === "copy") {
        if (visibleContextCopy) { closeContextCopy(true); return; }
        const now = session.getState();
        if (!now.document || !now.selection) return;
        setContextCopy({ anchor, document: now.document, selection: now.selection,
          isCurrent: captureEditorToolIntent(session.getState, () => activeMusicTextTargetRef.current) });
        setScoreMenuPanel("copy");
        return;
      }
      if (scoreMenuPanel === "copy") closeContextCopy(false);
      const onClose = () => setScoreMenuPanel((active) => active === action ? null : active);
      const tool = action === "jumpMarks" ? "measure" : action;
      const accepted = tool === "chord"
        ? musicTextController.current?.openContextChord(anchor, onClose)
        : toolbarController.current?.openContextTool(tool, anchor, onClose, action === "jumpMarks" ? "[data-measure-symbol-heading]" : undefined);
      if (accepted) setScoreMenuPanel(action);
      else if (tool !== "chord") {
        const reason = toolbarController.current?.getContextToolDisabledReason(tool);
        if (reason) setErrorMessage(reason);
      }
    };
    if (switchingFromChord) requestAnimationFrame(activate);
    else activate();
  };
  const getRhythmTarget = () => {
    const now = session.getState();
    return now.document
      ? resolveEditorRhythmPatternTarget(now.document, now.selection, continuousRangeRef.current, activeMusicTextTargetRef.current, now.numberedSelection)
      : { ok: false as const, message: "当前没有可编辑的乐谱。" };
  };
  const getRhythmBlocked = () => {
    const target = getRhythmTarget();
    return scoreReadOnlyRef.current || modals.isOpen() || drafts.inspect().busy || drafts.inspect().pending.length > 0 ||
      !!(target.ok && target.target.layer === "numbered"
        ? musicTextController.current?.isNumberedActionBlocked()
        : musicTextController.current?.isOutputBlocked());
  };
  const tailMeasure = lxmLayout.systems.at(-1)?.measures.at(-1);
  const tailTop = tailMeasure?.strings[0];
  const tailBottom = tailMeasure?.strings.at(-1);
  return (
    <RhythmPatternProvider
      session={session}
      document={document}
      targetResult={rhythmTarget}
      targetIdentity={JSON.stringify({ selection, numberedSelection, continuousRange, activeTarget: activeMusicTextTarget })}
      getTargetResult={getRhythmTarget}
      getTargetIdentity={() => {
        const now = session.getState();
        return JSON.stringify({ selection: now.selection, numberedSelection: now.numberedSelection,
          continuousRange: continuousRangeRef.current, activeTarget: activeMusicTextTargetRef.current });
      }}
      execute={executeTool}
      beforeAction={() => { endFretInput(); musicTextController.current?.dismissCleanPopover(); }}
      blocked={scoreReadOnly || !!activeModal || drafts.inspect().busy || drafts.inspect().pending.length > 0 ||
        (rhythmTarget.ok && rhythmTarget.target.layer === "numbered" ? numberedActionBlocked : musicTextEditing)}
      getBlocked={getRhythmBlocked}
      onSuccess={(scope) => {
        if (scope.endMeasureId && scope.layer === "numbered" && session.getState().numberedSelection) setContinuousRange(null);
        focusScore();
      }}
      onScopeChange={setRhythmPatternScope}
      onOpenSidebar={() => musicTextController.current?.navigateTool("note") === "accepted"}
      onUndo={() => runHistoryAction("undo")}
      onBusyChange={() => {}}
    >
    <div
      ref={editorRootRef}
      id={`${idPrefix}workspace`}
      className={styles.editor}
      data-editor-shell
      data-layout={layoutMode}
      style={
        {
          ...editorVariables,
          "--sidebar-width": `${Math.min(384, Math.max(352, hostWidth * 0.24))}px`,
          color: token.colorText,
        } as React.CSSProperties
      }
      onKeyDownCapture={handleMusicTextNavigation}
      onKeyDown={handleEditorKeyDown}
    >
      {messageHolder}
      {editorHeader}
      <ScoreFilePanels flow={fileFlow} session={session} document={document} />
      <EditorToolbar
        ref={toolbarController}
        continuousRange={continuousRange}
        measureSelection={wholeMeasureSelection}
        onRhythmPatternScopeChange={setRhythmPatternScope}
        sidebarCollapsed={sidebarCollapsed}
        sidebarToggleRef={sidebarToggleRef}
        onToggleSidebar={toggleSidebar}
        playback={{ ...playback, setEnabled: setPlaybackEnabled }}
        onOpenJumpMarks={openJumpMarks}
        onOpenRepeatEnding={(target, measureIds, endingId) => openRepeatEnding(target, measureIds, endingId ? { endingId } : undefined)}
        onOpenMeasureRepeat={openMeasureRepeat}
        isPlaybackEntryBlocked={() => musicTextController.current?.isTransitionBlocked() ?? false}
        activeTarget={activeMusicTextTarget}
        blocked={musicTextEditing}
        numberedBlocked={numberedActionBlocked}
        chordEntryBlocked={chordEntryBlocked}
        contextChordOpen={scoreMenuPanel === "chord"}
        onOpenChord={(target) => musicTextController.current?.open(target)}
        onAction={handleToolbarAction}
        beforeAction={endFretInput}
        beforeRhythmPatternAction={() => { musicTextController.current?.dismissCleanPopover(); }}
        execute={executeTool}
        onNavigate={(destination) =>
          musicTextController.current?.navigateTool(destination) ?? "blocked"
        }
        customToolbar={toolbar && <CustomToolbar render={toolbar} activeTarget={activeMusicTextTarget}
          state={{ document, selection,
            readOnly: scoreReadOnly, blocked: scoreReadOnly || musicTextEditing || !!activeModal,
            canUndo: !scoreReadOnly && !activeModal && canUndo,
            canRedo: !scoreReadOnly && !activeModal && canRedo,
            sidebarCollapsed, toggleSidebar,
            execute: async (command) => {
              if (scoreReadOnlyRef.current) return false;
              const result = await executeTool(command);
              if ("message" in result) setErrorMessage(result.message);
              return result.status === "applied" || result.status === "noop";
            },
            undo: () => session.getState().canUndo && runHistoryAction("undo"),
            redo: () => session.getState().canRedo && runHistoryAction("redo"),
          }} />}
      />
      <div
        ref={workspaceRef}
        className={styles.editorWorkspace}
        data-layout={layoutMode}
        data-history-open={historyOpen}
        data-sidebar-collapsed={sidebarCollapsed}
        data-jump-audition-open={Boolean(playback.jumpRoute) || undefined}
      >
        <EditorHistoryRail
          open={historyOpen}
          panelId={historyPanelId}
          disabled={scoreReadOnly}
          buttonRef={historyTriggerRef}
          onToggle={() => (historyOpen ? closeHistory() : openHistory())}
        />
        <EditorHistoryPanel
          open={historyOpen}
          id={historyPanelId}
          modal={narrowPanels}
          entries={historyEntries}
          tracks={document.score.tracks}
          appliedCount={appliedHistoryCount}
          baselineAdvanced={baselineAdvanced}
          sessionKey={sessionKey}
          expandedEntryIds={expandedHistoryIds}
          onExpandedEntryIdsChange={setExpandedHistoryIds}
          onClose={closeHistory}
          onUndo={() => void handleToolbarAction({ type: "undo" })}
          onRedo={() => void handleToolbarAction({ type: "redo" })}
          onRollback={(entryId) => runHistoryAction("rollback", entryId)}
          canUndo={canUndo}
          canRedo={canRedo}
          blocked={scoreReadOnly || chordEntryBlocked}
        />
        {narrowPanels && (historyOpen || !sidebarCollapsed) && (
          <div
            className={styles.drawerMask}
            data-drawer-mask
            aria-hidden="true"
            onClick={closeDrawer}
          />
        )}
        <div
          ref={pageViewportRef}
          className={scoreInteractionStyles.pageViewport}
          data-score-viewport
          onPointerDownCapture={(event) => {
            if (!scoreReadOnly && event.button === 0 && !isScoreScrollbarPointerDown(event)) setRhythmPatternScope(null);
          }}
          onPointerDown={handleWorkspacePointerDown}
          onScroll={() => {
            clearHover();
            if (scoreMenu?.numbered) {
              const focused = window.document.activeElement?.closest("[data-score-context-menu], [data-score-context-panel]");
              dismissScoreMenu(!!focused && !modals.isOpen());
            }
          }}
        >
          <div
            className={scoreInteractionStyles.scoreStage}
            style={scoreView.stageStyle}
            data-score-scale={scoreView.geometry.scale}
            data-score-zoom={scoreView.zoom}
          >
            <main
              className={scoreInteractionStyles.paper}
              style={scoreView.paperStyle}
              aria-label="A4 乐谱页面"
            >
              <svg
                ref={scoreSvgRef}
                className={scoreInteractionStyles.scoreSvg}
                viewBox={`0 0 ${lxmLayout?.width} ${lxmLayout?.height}`}
                style={scoreView.svgStyle}
                width={lxmLayout?.width}
                height={lxmLayout?.height}
                tabIndex={0}
                role="application"
                aria-label="六线谱编辑器"
                data-score-read-only={scoreReadOnly || undefined}
                onClick={scoreReadOnly ? selectPlaybackMeasure : undefined}
                onPointerDownCapture={startTraversalMarquee}
                onPointerMoveCapture={(event) => updateTraversalMarquee(event, false)}
                onPointerUpCapture={(event) => updateTraversalMarquee(event, true)}
                onPointerCancelCapture={cancelTraversalPointer}
                onLostPointerCapture={cancelTraversalPointer}
                onPointerDown={handlePointerDown}
                onContextMenu={handleScoreContextMenu}
                onPointerMove={handlePointerMove}
                onPointerLeave={clearHover}
                onBlur={() => {
                  endFretInput();
                  clearTraversalMarquee();
                }}
                onPointerUp={finishPointerDrag}
                onPointerCancel={finishPointerDrag}
                onKeyDown={(event) => {
                  if (scoreReadOnly || event.target !== event.currentTarget) return;
                  if (event.key === "Escape" && traversalMarqueeRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    clearTraversalMarquee();
                    return;
                  }
                  setRhythmPatternScope(null);
                  handleScoreKeyDown(event);
                }}
              >
                {!scoreReadOnly && <MusicTextEditingHints
                  layout={lxmLayout}
                  activeFocus={lyricFocus}
                  hoverFocus={musicTextHoverFocus}
                  beatContext={numberedBeatContext?.bounds ?? null}
                />}
                {scoreReadOnly && playbackStartBounds && (
                  <rect data-playback-start-measure={playbackStartBounds.measureId} aria-hidden="true" pointerEvents="none"
                    className={scoreInteractionStyles.focusCaret} x={playbackStartBounds.x} y={playbackStartBounds.y}
                    width={playbackStartBounds.width} height={playbackStartBounds.height} rx={3} />
                )}
                {/* 选区层位于音乐元素下方，且永不参与指针命中。 */}
                {!scoreReadOnly && <g className={scoreInteractionStyles.selectionLayer} pointerEvents="none">
                  {traversalMarquee && <rect data-traversal-marquee aria-hidden="true"
                    x={traversalMarquee.x} y={traversalMarquee.y}
                    width={traversalMarquee.width} height={traversalMarquee.height}
                    fill="var(--accent)" fillOpacity={0.12} stroke="var(--accent)" strokeDasharray="4 3" />}
                  {rhythmPatternRects.map(({ measureId, ...rect }) => <rect key={measureId} data-rhythm-pattern-scope
                    data-rhythm-pattern-measure={measureId}
                    data-rhythm-pattern-layer={rhythmPatternScope?.layer}
                    {...rect} rx={3} fill="#e6f4ff" fillOpacity={0.65}
                    stroke="#69b1ff" strokeDasharray="4 3" />)}
                  {rangeRects.map((rect) => <rect key={rect.key} ref={rect.focused ? rangeFocusRef : undefined} data-music-text-range-cell={rect.key} data-range-focus={rect.focused || undefined}
                    x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={3}
                    fill={rect.focused ? "#dce7ff" : "#edf3ff"} fillOpacity={0.72}
                    stroke={rect.focused ? "#285be0" : "#9cb5fa"} strokeWidth={rect.focused ? 1.5 : 1} />)}
                  {chordFocus && "kind" in chordFocus && (
                    <rect
                      data-chord-focus
                      className={scoreInteractionStyles.lyricFocus}
                      x={chordFocus.x}
                      y={chordFocus.y}
                      width={chordFocus.width}
                      height={chordFocus.height}
                      rx={3}
                    />
                  )}
                  {inspectionRect && (
                    <rect
                      {...inspectionRect}
                      className={scoreInteractionStyles.inspectionOutline}
                      rx={3}
                    />
                  )}
                  {tabCellHoverCaret && (
                    <rect
                      data-tab-cell-hover={`${tabCellHoverCaret.measureId}/${tabCellHoverCaret.beatId}/${tabCellHoverCaret.string}`}
                      className={scoreInteractionStyles.tabCellHover}
                      x={tabCellHoverCaret.x}
                      y={tabCellHoverCaret.y}
                      width={tabCellHoverCaret.width}
                      height={tabCellHoverCaret.height}
                    />
                  )}
                  {!lyricEditing && traversals.length < 2 &&
                    selectionRects.map((rect) => (
                      <rect
                        key={`${rect.measureId}-${rect.beatIds.join("-")}`}
                        className={scoreInteractionStyles.selectionRange}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                      />
                    ))}
                  {wholeMeasureIds.length > 0 && lxmLayout.systems.flatMap(({ measures }) => measures.flatMap((measure) => {
                    if (!wholeMeasureIds.includes(measure.id) || measure.measureRepeat) return [];
                    const top = measure.strings[0]?.y1;
                    const bottom = measure.strings.at(-1)?.y1;
                    return top !== undefined && bottom !== undefined ? <rect key={measure.id} data-whole-measure-selection={measure.id}
                      className={scoreInteractionStyles.selectionRange} x={measure.x} y={top} width={measure.width} height={bottom - top} /> : [];
                  }))}
                  {focusCaret && !lyricFocus && (
                    <rect
                      ref={focusCaretRef}
                      className={
                        lyricEditing
                          ? scoreInteractionStyles.emptyLyricCaret
                          : scoreInteractionStyles.focusCaret
                      }
                      x={focusCaret.x}
                      y={focusCaret.y}
                      width={focusCaret.width}
                      height={focusCaret.height}
                    />
                  )}
                </g>}
                {!scoreReadOnly && lyricFocus && (
                  <rect
                    ref={paragraphFocusRef}
                    data-paragraph-focus={lyricFocus.kind}
                    data-numbered-event-focus={
                      activeMusicTextTarget?.kind === "numbered"
                        ? activeMusicTextTarget.eventId
                        : lyricFocus.kind === "numbered" && numberedSelection?.kind === "numberedEvent" ? numberedSelection.eventId : undefined
                    }
                    className={scoreInteractionStyles.lyricFocus}
                    pointerEvents="none"
                    x={lyricFocus.x}
                    y={lyricFocus.y}
                    width={lyricFocus.width}
                    height={lyricFocus.height}
                    rx={3}
                  />
                )}
                {scoreScene && (
                  <ScoreMusicLayer
                    scene={scoreScene}
                    strumInteraction={strumInteraction}
                    selectedTechniqueId={scoreReadOnly ? null : selectedTechniqueId}
                    selectedNumberedMarkId={scoreReadOnly ? null : selectedNumberedMarkId}
                    selectedNumberedEventId={
                      !scoreReadOnly && activeMusicTextTarget?.kind === "numbered"
                        ? activeMusicTextTarget.eventId
                        : null
                    }
                  />
                )}
                <MeasureNumberLayer
                  layout={lxmLayout}
                  editingMeasures={scoreReadOnly ? undefined : traversalTrack?.measures}
                  activeMeasureId={scoreReadOnly ? playback.startMeasureId ?? undefined
                    : wholeMeasureSelection?.focus.measureId ?? continuousRange?.focus.measureId ?? activeMusicTextTarget?.measureId ?? numberedSelection?.measureId ?? selection?.focus.measureId}
                />
                {!scoreReadOnly && <JumpMarkInteractionLayer layout={lxmLayout} draftMeasureId={jumpDraftMeasure}
                  onEditMark={(measureId, markId) => openJumpMarks({ trackId: lxmLayout.trackId, measureId }, { markId })} />}
                {!scoreReadOnly && <RepeatEndingInteractionLayer layout={lxmLayout} onEditEnding={(start, end, endingId) => {
                  openRepeatEnding({ trackId: lxmLayout.trackId, measureId: start }, [start, end], { endingId });
                }} />}
                {!scoreReadOnly && <MeasureRepeatInteractionLayer layout={lxmLayout}
                  activeMeasureId={wholeMeasureSelection?.focus.measureId}
                  onEdit={(measureId) => openMeasureRepeat({ trackId: lxmLayout.trackId, measureId })} />}
                {playback.enabled && <ScorePlaybackCursor layout={lxmLayout} viewportRef={pageViewportRef} playback={playback} />}
                {!scoreReadOnly && tailMeasure && tailTop && tailBottom && (
                  <foreignObject
                    className={scoreInteractionStyles.scoreTail}
                    x={tailTop.x2}
                    y={tailTop.y1}
                    width={SCORE_TAIL_BUTTON_WIDTH}
                    height={tailBottom.y1 - tailTop.y1}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === " ") &&
                        (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229))
                        event.preventDefault();
                    }}
                  >
                    <Tooltip title="在曲末新增小节" trigger={["hover", "focus"]}>
                      <button
                        type="button"
                        className={scoreInteractionStyles.scoreTailButton}
                        aria-label="在曲末新增小节"
                        data-score-tail-insert
                        onClick={() => void appendMeasure()}
                      >
                        <svg
                          className={scoreInteractionStyles.scoreTailGraphic}
                          width="100%"
                          height="100%"
                          aria-hidden="true"
                        >
                          {tailMeasure.strings.map((line) => (
                            <line
                              key={line.y1}
                              className={scoreInteractionStyles.scoreTailLine}
                              x1={1}
                              x2={30}
                              y1={line.y1 - tailTop.y1}
                              y2={line.y2 - tailTop.y1}
                            />
                          ))}
                          <path
                            className={scoreInteractionStyles.scoreTailPlus}
                            transform={`translate(16 ${(tailBottom.y1 - tailTop.y1) / 2})`}
                            d="M-6 0h12M0 -6v12"
                          />
                        </svg>
                      </button>
                    </Tooltip>
                  </foreignObject>
                )}
              </svg>
            </main>
          </div>
        </div>
        {/* 同级覆盖层不经过谱面 pointerdown，缩放不会清空选区或提交草稿。 */}
        <div className={styles.scoreZoom} role="group" aria-label="谱面缩放" data-score-zoom-controls>
          <Button
            type="text"
            className={styles.scoreZoomStep}
            aria-label="缩小谱面"
            icon={<MinusOutlined />}
            disabled={scoreView.zoom === SCORE_ZOOM_LEVELS[0]}
            onClick={() => scoreView.setZoom(SCORE_ZOOM_LEVELS[SCORE_ZOOM_LEVELS.indexOf(scoreView.zoom) - 1])}
          />
          <Dropdown
            autoFocus
            trigger={["click"]}
            placement="topRight"
            align={{ offset: [29, -4] }}
            getPopupContainer={(trigger) => trigger.parentElement!}
            menu={{
              selectable: true,
              selectedKeys: [String(scoreView.zoom)],
              items: SCORE_ZOOM_LEVELS.map((zoom) => ({
                key: String(zoom),
                label: `${zoom}%`,
                onClick: () => {
                  scoreView.setZoom(zoom);
                  // 选择档位后归还焦点；方向键和 Escape 仍由 Dropdown 处理。
                  scoreZoomTriggerRef.current?.focus();
                },
              })),
            }}
          >
            <Button ref={scoreZoomTriggerRef} type="text" className={styles.scoreZoomValue} aria-label={`谱面缩放：${scoreView.zoom}%`}>
              {scoreView.zoom}%<DownOutlined />
            </Button>
          </Dropdown>
          <Button
            type="text"
            className={styles.scoreZoomStep}
            aria-label="放大谱面"
            icon={<PlusOutlined />}
            disabled={scoreView.zoom === SCORE_ZOOM_LEVELS[SCORE_ZOOM_LEVELS.length - 1]}
            onClick={() => scoreView.setZoom(SCORE_ZOOM_LEVELS[SCORE_ZOOM_LEVELS.indexOf(scoreView.zoom) + 1])}
          />
        </div>
        <MusicTextSidebar
          renderMeasureMarks={renderMeasureMarks}
          onOpenMeasureSymbols={() => toolbarController.current?.openMeasureSymbols()}
          wholeMeasureTarget={wholeMeasureSelection?.focus}
          strumInspector={canInteractWithTraversals && traversalTrack && traversals.length > 0
            ? (["strum", "arpeggio"] as const).map(techniqueType => {
              const ranges = traversals.filter(t => t.type === techniqueType);
              const preview = strumPreview?.techniqueType === techniqueType ? strumPreview : null;
              return <StrumRangeInspector key={techniqueType} techniqueType={techniqueType}
                ranges={preview ? ranges.map(t => ({ ...t, [preview.endpoint]: preview.string })) : ranges}
                stringCount={traversalTrack.tuning.strings.length}
                disabled={!!strumPreview || musicTextEditing}
                onChange={techniqueType === "strum" ? changeStrumEndpoint : changeArpeggioEndpoint} />;
            }) : undefined}
          continuousRange={continuousRange}
          paragraphPlaceholders={paragraphPlaceholders}
          onRangeChange={(range) => { if (range) setMeasureSelection(undefined); setContinuousRange(range); }}
          showChordDiagrams={showChordDiagrams}
          onShowChordDiagramsChange={setShowChordDiagrams}
          modal={narrowPanels && !sidebarCollapsed}
          collapsed={editSidebarCollapsed}
          suspendedForPlayback={scoreReadOnly}
          onExpandSidebar={openSidebar}
          onLocate={locateSidebarObject}
          getNumberedBeatEventIds={(target) =>
            target.kind === "numbered"
              ? (layoutNumberedBeatContext(lxmLayout, target)?.eventIds ?? [])
              : []
          }
          ref={musicTextController}
          onToolAction={handleToolbarAction}
          executeTool={executeTool}
          onOpen={clearScoreInteraction}
          onEditingChange={setMusicTextEditing}
          onNumberedActionBlockedChange={setNumberedActionBlocked}
          onTransitionBlockedChange={setChordEntryBlocked}
          onTargetChange={(target) => { if (target) setMeasureSelection(undefined); setActiveMusicTextTarget(target); }}
          onParagraphEditingChange={updateParagraphEditing}
          onScoreFocus={focusScore}
          onPopoverHiddenChange={setMusicTextPopoverHidden}
          onScoreSelection={acceptScoreSelection}
          getFloatingAnchor={getFloatingAnchor}
          getFloatingViewport={getFloatingViewport}
          getFloatingObservedElements={() => [pageViewportRef.current]}
        />
        {playback.jumpRoute && <JumpAuditionPanel playback={{ ...playback, setEnabled: setPlaybackEnabled }}
          onRepair={repairJumpMark} onRepairRepeatEnding={repairRepeatEnding} />}
      </div>
      {scoreMenu && !scoreReadOnly && numberedMenuActions?.ok && (
        <NumberedScoreContextMenu point={scoreMenu.point} scope={numberedMenuActions.scope}
          active={scoreMenuPanel === "beat" || scoreMenuPanel === "numberedArc" || scoreMenuPanel === "tuplet" ? scoreMenuPanel : null}
          disabled={{
            beat: !rhythmTarget.ok ? rhythmTarget.message : undefined,
            copyNumbered: !numberedMenuActions.copy.ok ? numberedMenuActions.copy.message : undefined,
            pasteNumbered: !numberedMenuActions.paste.ok ? numberedMenuActions.paste.message : undefined,
            clearNumbered: !numberedMenuActions.clear.ok ? numberedMenuActions.clear.message : undefined,
          }}
          onAction={handleNumberedMenuAction} onDismiss={dismissScoreMenu} />
      )}
      {scoreMenu?.sessionKey === sessionKey && !scoreMenu.numbered && !scoreReadOnly && contextScope && (
        <ScoreContextMenu point={scoreMenu.point} scope={contextScope}
          active={scoreMenuPanel === "numberedArc" || scoreMenuPanel === "tuplet" || (scoreMenuPanel === "copy" && !visibleContextCopy) ? null : scoreMenuPanel}
          chordLabel={contextChord.label}
          disabled={{
            chord: contextChord.enabled ? undefined : contextChord.reason,
            beat: !rhythmTarget.ok && scoreMenuPanel !== "chord" ? rhythmTarget.message : undefined,
            technique: scoreMenu.wholeMeasure ? "请选择 TAB 拍点。" : undefined,
            copy: scoreMenu.wholeMeasure ? "请使用小节工具复制当前小节。" : undefined,
          }}
          onAction={handleScoreMenuAction} onDismiss={dismissScoreMenu} />
      )}
      {visibleContextCopy && scoreMenu?.sessionKey === sessionKey && !scoreMenu.numbered && !scoreReadOnly && contextScope && (
        <CopyMeasureBubble anchor={visibleContextCopy.anchor} document={visibleContextCopy.document} target={visibleContextCopy.selection.focus}
          contextCopy blocked={!!activeModal} onCopy={copyCurrentMeasure} onDismiss={closeContextCopy} />
      )}
      <EditorFeedback
        event={feedbackEvent}
        entries={historyEntries}
        appliedCount={appliedHistoryCount}
        sessionKey={sessionKey}
        onOpenHistoryEntry={openHistoryEntry}
        retryKey={`${historyOpen}:${sidebarCollapsed}:${chordEntryBlocked}:${activeModal?.id ?? ""}`}
        hidden={
          scoreReadOnly || !!activeModal ||
          !!imageExportSnapshot ||
          !!fileFlow.panel || !!fileFlow.pending ||
          outputBlockedOpen ||
          (narrowPanels && !sidebarCollapsed)
        }
      />
      <EditorStatusBar
        position={
          traversals.length > 1 && !scoreReadOnly
            ? `已选 ${traversals.length} 个${traversals.every(t => t.type === "strum") ? "扫弦音符" : traversals.every(t => t.type === "arpeggio") ? "琶音音符" : "扫弦与琶音记号"}`
            : wholeMeasureScope && !scoreReadOnly
            ? wholeMeasureScope
            : continuousRange
            ? `已选择 ${rangeRects.length} 个${continuousRange.kind === "numbered" ? "简谱事件" : `歌词位置 · 第 ${continuousRange.verse ?? 1} 段`}`
            : numberedSelection && currentPosition.valid
            ? `${currentPosition.title}：${currentPosition.position}${currentPosition.scope ? ` · ${currentPosition.scope}` : ""}`
            : selection && focusedMeasureContext
              ? `当前位置：第 ${focusedMeasureContext.measureIndex + 1} 小节，第 ${focusedMeasureContext.measure.beats.findIndex((beat) => beat.id === selection.focus.beatId) + 1} 拍点，第 ${selection.focus.string} 弦。`
              : "请在谱面选择编辑位置。"
        }
        cellCount={resolvedSelection?.cellCount ?? 0}
      />
      <ScorePrintLayer
        score={document}
        watermark={watermark.value}
        watermarkVersion={watermark.version}
        density={density}
        showChordDiagrams={showChordDiagrams}
      />
      <OutputBlockedModal
        open={outputBlockedOpen}
        drafts={drafts}
        returnFocus={() => {
          const trigger = outputBlockedTrigger.current;
          if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus({ preventScroll: true });
          else focusScore();
        }}
        onClose={() => setOutputBlockedOpen(false)}
        onBlocked={setErrorMessage}
      />
      {imageExportSnapshot && (
        <ImageExportModal
          snapshot={imageExportSnapshot}
          watermark={watermark.value}
          onWatermarkApply={(value) =>
            setWatermark((previous) => ({ value, version: previous.version + 1 }))
          }
          onSwitchPreview={() =>
            setOutputMode((mode) => mode === "png" ? "print" : "png")
          }
          returnFocus={imageExportButtonRef}
          onClose={() => setImageExportSnapshot(null)}
          writeOutput={host ? (request) => host.writeOutput(request) : undefined}
          onPrint={outputMode === "print" ? () => {
            const root = editorRootRef.current;
            // 显式打印只消费本次成品快照和已经提交到常驻打印层的水印版本。
            const readyLayer = `[data-score-print-layer][data-print-ready="true"][data-watermark-version="${watermark.version}"]`;
            if (!root?.querySelector(readyLayer)) return false;
            // 页面嵌入多个会话时，显式打印只输出触发操作的工作区。
            // Safari 的 print() 可能在打印窗口关闭前返回，等 afterprint 才恢复默认打印范围。
            root.setAttribute("data-lxm-print-active", "");
            const reset = () => root.removeAttribute("data-lxm-print-active");
            if (host) {
              // 系统打印异步结束。字体加载后再次检查快照，退出对话框时统一清理打印标记。
              return (async (): Promise<EditorHostResult> => {
                try {
                  await root.ownerDocument.fonts.ready;
                  if (!root.isConnected || !root.querySelector(readyLayer) || !sameEditorVersion(session.getState(), imageExportSnapshot.version))
                    return { status: "error", message: "曲谱已变化，请重新打开打印预览。" };
                  return await host.print();
                } finally { reset(); }
              })();
            }
            window.addEventListener("afterprint", reset, { once: true });
            try {
              window.print();
              return true;
            } catch {
              window.removeEventListener("afterprint", reset);
              reset();
              return false;
            }
          } : undefined}
          isCurrent={() =>
            sameEditorVersion(
              captureEditorVersion(session.getState()),
              imageExportSnapshot.version,
            )
          }
        />
      )}
    </div>
    </RhythmPatternProvider>
  );
};
