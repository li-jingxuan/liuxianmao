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
  DEFAULT_MOCK_DOCUMENT,
  A4_CONTENT_WIDTH,
  createCollapsedTabCellSelection,
  getMusicTextRows,
  hitTestLayout,
  hitTestMusicText,
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
  type ILXMLayout,
  type ILXMLayoutOptions,
  type ILXMFret,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
  type MusicTextRange,
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
} from "../../stores/editor-store";
import {
  resolveBeatKindShortcut,
  resolveMutedNoteShortcut,
  resolveTabContinuationShortcut,
  resolveEditorHistoryShortcut,
} from "./session/editor-interaction";
import { ScoreMusicLayer } from "./score/ScoreMusicLayer";
import type { ScoreStrumInteraction, StrumEndpoint, StrumEndpointPreview } from "./score/StrumInteractionLayer";
import { StrumRangeInspector } from "./tools/StrumRangeInspector";
import { ScoreContextMenu, type ScoreContextAction } from "./score/ScoreContextMenu";
import { MeasureNumberLayer } from "./score/MeasureNumberLayer";
import { buildScoreScene } from "@liuxianmao/lxm-editor";
import { OutputBlockedModal } from "./output/OutputBlockedModal";
import { ImageExportModal } from "./output/ImageExportModal";
import type { ImageExportSnapshot } from "./output/image-export-controller";
import { ScorePrintLayer } from "./output/ScorePrintLayer";
import { ScoreFilePanels } from "./output/ScoreFilePanels";
import { useScoreFileFlow } from "./output/use-score-file-flow";
import { MusicTextSidebar, type MusicTextController } from "./music-text/MusicTextSidebar";
import { deriveSidebarContext, type SidebarLocation } from "./music-text/sidebar-context";
import type { MusicTextTarget } from "./music-text/music-text-draft";
import { rangeFromTarget, hitMusicTextRangePoint, sameRangePoint, navigateMusicTextRange, musicTextRangeRects } from "./music-text/music-text-range-selection";
import { resolveChordFocus, resolveParagraphFocus } from "./score/music-text-focus";
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
import {
  captureEditorVersion,
  sameEditorSession,
  sameEditorVersion,
} from "./session/editor-session-version";
import { EditorStatusBar } from "./workspace/EditorStatusBar";
import { EditorHeader } from "./workspace/EditorHeader";
import { EditorToolbar, type EditorToolbarAction, type EditorToolbarController } from "./workspace/EditorToolbar";
import { resolveEditorChordTarget } from "./chords/editor-chord-target";
import { useScorePlayback } from "./playback/controller";
import { ScorePlaybackCursor } from "./playback/ScorePlaybackCursor";
import {
  createEditorCommandAdapter,
  type EditorCommandAdapter,
} from "./session/editor-command-adapter";
import { buildEditorToolCommand } from "./tools/editor-tool-actions";
import { resolveEditorRhythmTarget } from "./tools/editor-rhythm-target";
import { isNumberedTieTarget, resolveEditorTieTarget } from "./tools/editor-tie-target";
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
const SCORE_TAIL_BUTTON_WIDTH = 36;

/** 编辑、图片导出和打印统一使用固定的默认排版密度。 */
const density = "compact";

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

export const EditorShell: React.FC<{ navigate?: (destination: string) => void }> = ({ navigate }) => {
  const session = useEditorSessionStore();
  const { token } = theme.useToken();
  const [messages, messageHolder] = message.useMessage();
  const { drafts, modals } = useEditorRuntime();
  const activeModal = useSyncExternalStore(
    modals.subscribe,
    modals.getSnapshot,
    () => null,
  );
  const activeMusicTextTargetRef = useRef<MusicTextTarget | null>(null);
  const musicTextController = useRef<MusicTextController>(null);
  const toolbarController = useRef<EditorToolbarController>(null);
  const [scoreMenu, setScoreMenu] = useState<{ point: { x: number; y: number }; sessionKey: string } | null>(null);
  const [scoreMenuPanel, setScoreMenuPanel] = useState<Exclude<ScoreContextAction, "copy"> | null>(null);
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
          command.type === "numbered.event.setRhythm"
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
  const selectedStrumIds = useEditorStore(state => state.selectedStrumIds);
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
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<string[]>([]);

  const [imageExportSnapshot, setImageExportSnapshot] =
    useState<(ImageExportSnapshot & { mode: "png" | "print" }) | null>(null);
  const [outputBlockedOpen, setOutputBlockedOpen] = useState(false);
  const outputBlockedTrigger = useRef<HTMLElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** 全谱共享的会话视图偏好，不修改和弦指法或音乐历史。 */
  const [showChordDiagrams, setShowChordDiagrams] = useState(true);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const { width: hostWidth, mode: layoutMode } =
    useEditorHostWidth(editorRootRef, !!document);
  const narrowPanels = layoutMode === "compact" || layoutMode === "narrow";
  const [historyOpen, setHistoryOpen] = useState(false);
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
  }, [narrowPanels, sidebarCollapsed, canHideSidebar, session]);
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
    pendingPanel.current = null;
    if (narrowPanels) setHistoryOpen(false);
    setSidebarCollapsed(false);
  }, [narrowPanels]);
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
        historyOpen ? "#editor-history-panel" : "#music-text-sidebar",
      );
      const current = globalThis.document.activeElement;
      const inAssociatedSurface =
        !historyOpen &&
        current instanceof HTMLElement &&
        !!current.closest(
          '[data-editor-associated-panel="music-text-sidebar"]',
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
              kind: historyOpen ? "history" : "close-sidebar",
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
  }, [hostWidth, narrowPanels, canHideSidebar, session, historyOpen]);
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
  const [activeMusicTextTarget, setActiveMusicTextTarget] =
    useState<MusicTextTarget | null>(null);
  const [continuousRange, setContinuousRange] = useState<MusicTextRange | null>(null);
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
  const focusCaretRef = useRef<SVGRectElement | null>(null);
  const rangeFocusRef = useRef<SVGRectElement | null>(null);
  const scoreSvgRef = useRef<SVGSVGElement | null>(null);
  const appendingMeasure = useRef(false);
  const imageExportButtonRef = useRef<HTMLButtonElement | null>(null);

  const layoutOptions = useMemo<ILXMLayoutOptions>(() => ({
      purpose: "editing",
      editingTailWidth: SCORE_TAIL_BUTTON_WIDTH,
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
  }), [musicTextMetrics, showChordDiagrams, activeMusicTextTarget, continuousRange, paragraphEditingSession, paragraphPlaceholders]);
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

  const clearScorePointerInteraction = useCallback(() => {
    const svg = scoreSvgRef.current;
    const pointer = activePointerIdRef.current;
    if (svg && pointer !== null && svg.hasPointerCapture(pointer))
      svg.releasePointerCapture(pointer);
    activePointerIdRef.current = null;
    dragAnchorRef.current = null;
    rangeDragRef.current = null;
    pendingTextClickRef.current = null;
    clearHover();
  }, [clearHover]);
  const onScoreGeometryChange = useCallback(() => {
    clearScorePointerInteraction();
    // transform 不会触发 ResizeObserver；浮层必须在同一次实际矩阵变化后重定位。
    window.dispatchEvent(new Event("resize"));
  }, [clearScorePointerInteraction]);
  const resolvedSelection = useMemo(() => {
    if (!document || !selection) return null;
    const result = resolveTabCellSelection(document, selection);
    return result.ok ? result.range : null;
  }, [document, selection]);
  const selectedPlaybackMeasure = resolvedSelection && !activeMusicTextTarget && !continuousRange && !numberedSelection
    ? selection?.focus.measureId ?? null : null;
  const playback = useScorePlayback(document, selectedPlaybackMeasure);
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
  const scoreReadOnly = playback.enabled;
  const scoreReadOnlyRef = useRef(scoreReadOnly);
  useLayoutEffect(() => {
    scoreReadOnlyRef.current = scoreReadOnly;
  }, [scoreReadOnly]);
  const setPlaybackEnabled = (enabled: boolean) => {
    if (enabled) {
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
  const lyricFocus = useMemo(
    () => resolveParagraphFocus(lxmLayout, activeMusicTextTarget),
    [lxmLayout, activeMusicTextTarget],
  );
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
        toolbarController.current?.closeContextTool() === false) return;
    setScoreMenu(null);
    setScoreMenuPanel(null);
    if (restoreFocus) focusScore();
  }, [focusScore]);
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
      // 这期间恢复的 TAB 光标不应把谱面拉离指针所在位置。
      if (scoreReadOnlyRef.current || pendingTextClickRef.current) return;
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

  /** 休止属于完整 Beat；框选的弦范围不会缩窄该命令的作用域。 */
  const setSelectedBeatKind = (kind: "notes" | "rest") => {
    if (!selection || !resolvedSelection?.beats.length) {
      setErrorMessage("请先选择需要设置休止状态的 Beat。");
      return;
    }
    execute({
      type: LXMScoreCommandEnum.SetBeatKindRange,
      range: {
        trackId: selection.anchor.trackId,
        anchor: {
          measureId: selection.anchor.measureId,
          beatId: selection.anchor.beatId,
        },
        focus: {
          measureId: selection.focus.measureId,
          beatId: selection.focus.beatId,
        },
      },
      kind,
    });
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
    session, drafts, isBlocked: isOutputBlocked, onBlocked: showOutputBlocked,
    onNotice: (type, content) => messages.open({ key: "score-file", type, content }),
  });
  const strumTrack = document?.score.tracks.find(track => track.id === lxmLayout?.trackId);
  const strumContext = !!strumTrack && !activeMusicTextTarget && !continuousRange && !numberedSelection && selection?.focus.trackId === strumTrack.id;
  const strums = useMemo(() => {
    if (!strumContext || !selectedStrumIds.length) return [];
    const ids = new Set(selectedStrumIds);
    return strumTrack.techniques.filter(t => t.type === "strum").filter(t => ids.has(t.id));
  }, [strumContext, strumTrack, selectedStrumIds]);
  const canInteractWithStrums = !scoreReadOnly && !activeModal && !imageExportSnapshot && !fileFlow.panel && !fileFlow.pending;
  const changeStrumEndpoint = useCallback(async (endpoint: StrumEndpoint, string: number) => {
    const now = session.getState();
    if (!canInteractWithStrums || !strumTrack || !strums.length || modals.isOpen() ||
      now.document !== document || now.selectedStrumIds !== selectedStrumIds) return;
    endFretInput();
    const result = await toolExecute({ type: LXMScoreCommandEnum.SetStrumEndpoint,
      trackId: strumTrack.id, techniqueIds: selectedStrumIds, endpoint, string }, "modal", { tabOnly: true });
    if (result.status === "blocked" || result.status === "stale") setErrorMessage(result.message);
  }, [canInteractWithStrums, document, strumTrack, strums, selectedStrumIds, session, modals, endFretInput, toolExecute, setErrorMessage]);
  // 避免每次悬停都重绘整谱。原 TAB 工具只接收活动音符的弦格，范围编辑直接使用离散的技巧 ID。
  const strumInteraction = useMemo<ScoreStrumInteraction | undefined>(() => {
    if (!canInteractWithStrums || !lxmLayout || !document || !strumTrack) return undefined;
    const ids = strums.length ? selectedStrumIds : [];
    return {
      layout: lxmLayout, selectedIds: ids, activeId: selectedTechniqueId, onPreview: setStrumPreview,
      onSelect(id, toggle) {
        const next = !toggle ? [id] : ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id];
        const active = selectedTechniqueId && next.includes(selectedTechniqueId) ? selectedTechniqueId : next[0];
        const mapped = active ? resolveTechniqueSelection(document, active, "end") : null;
        if (!active || mapped) musicTextController.current?.select(mapped, active, next);
      },
      onCommit: changeStrumEndpoint,
    };
  }, [canInteractWithStrums, lxmLayout, document, strumTrack, strums, selectedStrumIds, selectedTechniqueId,
    changeStrumEndpoint]);
  useEffect(() => {
    if (loadNotice) messages.success({ key: "score-file", content: loadNotice });
  }, [messages, loadNotice, sessionKey]);
  const editorError = document ? errorMessage : null;
  useEffect(() => {
    if (editorError) messages.error({ key: "score-edit-error", content: editorError });
  }, [messages, editorError, errorNoticeVersion, sessionKey]);

  const navigateTo = (destination: string) => {
    if (navigate) navigate(destination);
    else {
      fileFlow.allowPageUnload();
      window.location.assign(destination);
    }
  };
  const requestNavigation = (destination: "/" | "/guitar-advanced", trigger: HTMLElement | null) =>
    fileFlow.requestNavigation(destination === "/" ? "返回首页" : "进入吉他进阶", trigger, (discard) => {
      if (discard) session.getState().replaceDocument(DEFAULT_MOCK_DOCUMENT);
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

  /** 接受对象切换后清理旧输入与 pointer capture，文字激活和 beat 选择共用。 */
  const clearScoreInteraction = () => {
    endFretInput();
    clearScorePointerInteraction();
  };

  /** 确认期间不修改选区，只有接受请求后才更新六线谱对象与焦点。 */
  const acceptScoreSelection = (
    next: ILXMTabCellSelection | null,
    techniqueId: string | null,
    strumIds?: readonly string[],
  ) => {
    clearScoreInteraction();
    setContinuousRange(null);
    setActiveMusicTextTarget(null);
    setSelection(next);
    setSelectedTechniqueId(techniqueId, strumIds);
    setErrorMessage(
      techniqueId && !next ? "当前技巧无法映射到可编辑的 TAB 单元格。" : null,
    );
    focusScore();
  };

  const openScoreMenu = (cell: ILXMTabCellReference, point: { x: number; y: number }) => {
    if (scoreReadOnly || modals.isOpen() || musicTextController.current?.isTransitionBlocked()) return;
    if (toolbarController.current?.closeContextTool() === false) return;
    // 右键命中范围内的弦格时保留 anchor 和 focus，尤其是反向或跨小节选择。
    // 范围外则走正常选区切换，属性有未处理草稿时由原控制器决定是否接受。
    const inside = resolvedSelection && cell.trackId === resolvedSelection.trackId &&
      cell.string >= resolvedSelection.startString && cell.string <= resolvedSelection.endString &&
      resolvedSelection.beats.some((beat) => beat.measureId === cell.measureId && beat.beatId === cell.beatId);
    if (!inside || activeMusicTextTarget || continuousRange || numberedSelection) {
      const next = inside ? selection : createCollapsedTabCellSelection(cell);
      if (musicTextController.current?.select(next) !== "accepted") return;
    } else clearScoreInteraction();
    clearHover();
    setRhythmPatternScope(null);
    setScoreMenuPanel(null);
    setScoreMenu({ point, sessionKey });
  };

  const handleScoreContextMenu: React.MouseEventHandler<SVGSVGElement> = (event) => {
    if (scoreReadOnly) return;
    event.preventDefault();
    const point = getLayoutPoint(event.currentTarget, event);
    const hit = point && lxmLayout && hitTestLayout(lxmLayout, point);
    if (!hit) return;
    const { trackId, measureId, beatId, string } = hit;
    openScoreMenu({ trackId, measureId, beatId, string }, { x: event.clientX + 8, y: event.clientY + 8 });
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
        const previous = continuousRange ?? (activeMusicTextTarget ? rangeFromTarget(activeMusicTextTarget) : null);
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
      (event.target instanceof Element && event.target.closest("#editor-playback-controls")) ||
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

  const runHistoryAction = (action: "undo" | "redo") => {
    if (modals.isOpen()) return false;
    endFretInput();
    if (
      musicTextController.current?.isTransitionBlocked() ||
      drafts.inspect().pending.some((record) => record.kind === "technique")
    )
      return false;
    const now = session.getState();
    if (action === "undo") now.undo();
    else now.redo();
    return true;
  };

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
    if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
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
      runImmediateEditorAction(() =>
        setSelectedBeatKind(beatKindAction === "setRest" ? "rest" : "notes"),
      );
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
      (target instanceof Node && scoreSvgRef.current?.contains(target))
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
    if (!sidebarCollapsed) {
      closeSidebar();
      return;
    }
    openSidebar();
    requestAnimationFrame(() => musicTextController.current?.restoreSidebarFocus());
  };
  const editorHeader = <EditorHeader
    title={document?.score.title ?? ""}
    status={fileStatus}
    empty={!document || !lxmLayout}
    canUndo={canUndo}
    canRedo={canRedo}
    sidebarCollapsed={sidebarCollapsed}
    zoom={scoreView.zoom}
    onHistory={runHistoryAction}
    onToggleSidebar={toggleSidebar}
    onZoom={scoreView.setZoom}
    onNavigate={requestNavigation}
    onLearning={(trigger) => {
      if (requestNavigation("/guitar-advanced", trigger)) navigateTo("/guitar-advanced");
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
      else if (requestNavigation("/", trigger)) navigateTo("/");
    }}
    exportButtonRef={imageExportButtonRef}
    onExportAction={(mode, trigger) => {
      if (mode === "json") {
        fileFlow.showPanel(mode, trigger);
        return;
      }
      if (isOutputBlocked()) {
        showOutputBlocked(trigger);
        return;
      }
      const state = session.getState();
      if (!state.document) return;
      setImageExportSnapshot({ mode, version: captureEditorVersion(state), document: state.document, density, showChordDiagrams });
    }}
  />;

  if (!document || !lxmLayout)
    return (
      <div ref={editorRootRef} className={styles.editor} data-editor-shell data-layout={layoutMode} style={editorVariables as React.CSSProperties}>
        {messageHolder}
        {editorHeader}
        <div ref={workspaceRef} className={styles.emptyWorkspace}>
          <p className={editorFormStyles.errorMessage} role="alert">{errorMessage ?? "当前没有可编辑的乐谱文档。"}</p>
          <div>
            <Button type="primary" onClick={(event) => fileFlow.showPanel("new", event.currentTarget)}>新建曲谱</Button>
            <Button onClick={(event) => fileFlow.showPanel("import", event.currentTarget)}>导入曲谱</Button>
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
      (command.type === "numbered.event.setRhythm" ||
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
    const numberedTie = action.type === "quickTechnique" && action.technique === "tie" &&
      isNumberedTieTarget(continuousRangeRef.current, activeMusicTextTargetRef.current);
    const tabQuick =
      action.type === "restToggle" || action.type === "quickTechnique" && !numberedTie;
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
    if (numberedTie) {
      if (musicTextController.current?.isNumberedActionBlocked()) {
        setErrorMessage("请先应用或取消当前草稿。");
        return false;
      }
      const now = session.getState();
      if (!now.document) return false;
      const range = continuousRangeRef.current;
      const capturedRange = JSON.stringify(range);
      const target = resolveEditorTieTarget(now.document, now.selection, range, activeMusicTextTargetRef.current);
      if (!target.ok) {
        setErrorMessage(target.message);
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
          now.setNumberedInputRhythm(rhythm);
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
    const command = buildEditorToolCommand(now.document, now.selection, action, now.tabInputRhythmOverrides);
    if (!command) {
      setErrorMessage("当前目标不适用此操作，请重新选择。");
      return false;
    }
    const result = await executeTool(command, "modal", {
      isCurrent: () => intentIsCurrent() &&
        (action.type !== "removeMeasure" || !action.confirmation || action.confirmation.isCurrent()),
      tabOnly: tabQuick,
      ...(action.type === "removeMeasure" && action.confirmation
        ? { confirmedMeasureRemoval: true as const } : {}),
    });
    return result.status === "applied" || result.status === "noop";
  };
  const currentPosition = deriveSidebarContext({
    document,
    selection,
    numberedSelection,
  });
  const rhythmTarget = resolveEditorRhythmPatternTarget(document, selection, continuousRange, activeMusicTextTarget, numberedSelection);
  const contextChord = resolveEditorChordTarget(document, selection, null);
  const contextScope = focusedMeasureContext && resolvedSelection && selection
    ? resolvedSelection.beats.length === 1
      ? `第 ${focusedMeasureContext.measureIndex + 1} 小节第 ${focusedMeasureContext.measure.beats.findIndex((beat) => beat.id === selection.focus.beatId) + 1} 拍`
      : `${resolvedSelection.beats.length} 个拍点 · 当前第 ${focusedMeasureContext.measureIndex + 1} 小节`
    : "";
  const copyCurrentMeasure = async () => {
    const now = session.getState();
    const target = now.selection?.focus;
    if (!now.document || !target) return;
    // 显式指定焦点小节。复用现有复制命令及其影响确认，跨小节选区也只复制当前小节。
    const command = buildEditorToolCommand(now.document, now.selection, { type: "copyMeasures", target });
    if (!command) return;
    const result = await executeTool(command, "modal", {
      isCurrent: captureEditorToolIntent(session.getState, () => activeMusicTextTargetRef.current),
    });
    if (result.status !== "applied") {
      if (result.status === "blocked") setErrorMessage(result.message);
      return;
    }
    const current = session.getState();
    // 命令或确认弹窗返回后，若已换谱或进入播放，不能再把焦点移回旧副本。
    if (current.document !== result.result.document || scoreReadOnlyRef.current) return;
    const measures = current.document.score.tracks.find((track) => track.id === target.trackId)?.measures;
    const index = measures?.findIndex((measure) => measure.id === target.measureId) ?? -1;
    const duplicate = index >= 0 ? measures?.[index + 1] : undefined;
    const beat = duplicate?.beats[0];
    if (duplicate && beat) musicTextController.current?.select(createCollapsedTabCellSelection({
      trackId: target.trackId, measureId: duplicate.id, beatId: beat.id, string: target.string,
    }));
  };
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
        dismissScoreMenu(true);
        void copyCurrentMeasure();
        return;
      }
      const onClose = () => setScoreMenuPanel((active) => active === action ? null : active);
      const accepted = action === "chord"
        ? musicTextController.current?.openContextChord(anchor, onClose)
        : toolbarController.current?.openContextTool(action, anchor, onClose);
      if (accepted) setScoreMenuPanel(action);
      else if (action !== "chord") {
        const reason = toolbarController.current?.getContextToolDisabledReason(action);
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
        onRhythmPatternScopeChange={setRhythmPatternScope}
        sidebarCollapsed={sidebarCollapsed}
        sidebarToggleRef={sidebarToggleRef}
        onToggleSidebar={toggleSidebar}
        playback={{ ...playback, setEnabled: setPlaybackEnabled }}
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
      />
      <div
        ref={workspaceRef}
        className={styles.editorWorkspace}
        data-layout={layoutMode}
        data-history-open={historyOpen}
        data-sidebar-collapsed={sidebarCollapsed}
      >
        <EditorHistoryRail
          open={historyOpen}
          buttonRef={historyTriggerRef}
          onToggle={() => (historyOpen ? closeHistory() : openHistory())}
        />
        <EditorHistoryPanel
          open={historyOpen}
          modal={narrowPanels}
          entries={historyEntries}
          appliedCount={appliedHistoryCount}
          baselineAdvanced={baselineAdvanced}
          sessionKey={sessionKey}
          expandedEntryIds={expandedHistoryIds}
          onExpandedEntryIdsChange={setExpandedHistoryIds}
          onClose={closeHistory}
          onUndo={() => void handleToolbarAction({ type: "undo" })}
          onRedo={() => void handleToolbarAction({ type: "redo" })}
          canUndo={canUndo}
          canRedo={canRedo}
          blocked={chordEntryBlocked}
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
          onPointerDownCapture={(event) => { if (!scoreReadOnly && event.button === 0) setRhythmPatternScope(null); }}
          onPointerDown={handleWorkspacePointerDown}
          onScroll={clearHover}
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
                onPointerDown={handlePointerDown}
                onContextMenu={handleScoreContextMenu}
                onPointerMove={handlePointerMove}
                onPointerLeave={clearHover}
                onBlur={endFretInput}
                onPointerUp={finishPointerDrag}
                onPointerCancel={finishPointerDrag}
                onKeyDown={(event) => {
                  if (scoreReadOnly || event.target !== event.currentTarget) return;
                  setRhythmPatternScope(null);
                  handleScoreKeyDown(event);
                }}
              >
                <MusicTextEditingHints
                  layout={lxmLayout}
                  activeFocus={lyricFocus}
                  hoverFocus={musicTextHoverFocus}
                  beatContext={numberedBeatContext?.bounds ?? null}
                />
                {/* 选区层位于音乐元素下方，且永不参与指针命中。 */}
                <g className={scoreInteractionStyles.selectionLayer} pointerEvents="none">
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
                  {!lyricEditing && strums.length < 2 &&
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
                </g>
                {lyricFocus && (
                  <rect
                    data-paragraph-focus={lyricFocus.kind}
                    data-numbered-event-focus={
                      activeMusicTextTarget?.kind === "numbered"
                        ? activeMusicTextTarget.eventId
                        : undefined
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
                    selectedTechniqueId={selectedTechniqueId}
                    selectedNumberedMarkId={selectedNumberedMarkId}
                    selectedNumberedEventId={
                      activeMusicTextTarget?.kind === "numbered"
                        ? activeMusicTextTarget.eventId
                        : null
                    }
                  />
                )}
                <MeasureNumberLayer
                  layout={lxmLayout}
                  activeMeasureId={continuousRange?.focus.measureId ?? activeMusicTextTarget?.measureId ?? numberedSelection?.measureId ?? selection?.focus.measureId}
                />
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
          strumInspector={strums.length > 0 && canInteractWithStrums && strumTrack ? <StrumRangeInspector
            ranges={strumPreview ? strums.map(t => ({ ...t, [strumPreview.endpoint]: strumPreview.string })) : strums}
            stringCount={strumTrack.tuning.strings.length}
            disabled={!!strumPreview || musicTextEditing}
            onChange={changeStrumEndpoint} /> : undefined}
          continuousRange={continuousRange}
          paragraphPlaceholders={paragraphPlaceholders}
          onRangeChange={setContinuousRange}
          showChordDiagrams={showChordDiagrams}
          onShowChordDiagramsChange={setShowChordDiagrams}
          modal={narrowPanels && !sidebarCollapsed}
          collapsed={sidebarCollapsed}
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
          onTargetChange={setActiveMusicTextTarget}
          onParagraphEditingChange={updateParagraphEditing}
          onScoreFocus={focusScore}
          onPopoverHiddenChange={setMusicTextPopoverHidden}
          onScoreSelection={acceptScoreSelection}
          getFloatingAnchor={getFloatingAnchor}
          getFloatingViewport={getFloatingViewport}
          getFloatingObservedElements={() => [pageViewportRef.current]}
        />
      </div>
      {scoreMenu?.sessionKey === sessionKey && !scoreReadOnly && contextScope && (
        <ScoreContextMenu point={scoreMenu.point} scope={contextScope} active={scoreMenuPanel}
          chordLabel={contextChord.label}
          disabled={{
            chord: contextChord.enabled ? undefined : contextChord.reason,
            beat: !rhythmTarget.ok && scoreMenuPanel !== "chord" ? rhythmTarget.message : undefined,
          }}
          onAction={handleScoreMenuAction} onDismiss={dismissScoreMenu} />
      )}
      <EditorFeedback
        event={feedbackEvent}
        entries={historyEntries}
        appliedCount={appliedHistoryCount}
        sessionKey={sessionKey}
        onOpenHistoryEntry={openHistoryEntry}
        retryKey={`${historyOpen}:${sidebarCollapsed}:${chordEntryBlocked}:${activeModal?.id ?? ""}`}
        hidden={
          !!activeModal ||
          !!imageExportSnapshot ||
          !!fileFlow.panel || !!fileFlow.pending ||
          outputBlockedOpen ||
          (narrowPanels && !sidebarCollapsed)
        }
      />
      <EditorStatusBar
        position={
          strums.length > 1 && !scoreReadOnly ? `已选 ${strums.length} 个扫弦音符` : continuousRange
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
          returnFocus={imageExportButtonRef}
          onClose={() => setImageExportSnapshot(null)}
          onPrint={imageExportSnapshot.mode === "print" ? () => {
            if (!editorRootRef.current?.querySelector('[data-score-print-layer][data-print-ready="true"]')) return false;
            try { window.print(); return true; } catch { return false; }
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
