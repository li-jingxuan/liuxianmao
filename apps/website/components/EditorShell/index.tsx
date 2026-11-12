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
  A4_CONTENT_WIDTH,
  createCollapsedTabCellSelection,
  hitTestLayout,
  hitTestMusicText,
  hitTestTechniqueTarget,
  layoutTabCellCaret,
  layoutTabCellSelection,
  layoutNumberedBeatContext,
  LXMScoreCommandEnum,
  navigateTabCellSelection,
  resolveTabCellSelection,
  type ILXMHitTarget,
  type ILXMLayout,
  type ILXMFret,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
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
import { Button, Dropdown, theme } from "antd";
import { DownOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import {
  createDeferredFretDraftCommit,
  resolveBeatKindShortcut,
  resolveMutedNoteShortcut,
  resolveTabContinuationShortcut,
  resolveEditorHistoryShortcut,
} from "./session/editor-interaction";
import { ScoreMusicLayer } from "./score/ScoreMusicLayer";
import { buildScoreScene } from "@liuxianmao/lxm-editor";
import { OutputBlockedModal } from "./output/OutputBlockedModal";
import { ImageExportModal } from "./output/ImageExportModal";
import type { ImageExportSnapshot } from "./output/image-export-controller";
import { ScorePrintLayer } from "./output/ScorePrintLayer";
import { ScoreFileControls } from "./output/ScoreFileControls";
import { MusicTextSidebar, type MusicTextController } from "./music-text/MusicTextSidebar";
import { deriveSidebarContext, type SidebarLocation } from "./music-text/sidebar-context";
import type { MusicTextTarget } from "./music-text/music-text-draft";
import { resolveChordFocus, resolveParagraphFocus } from "./score/music-text-focus";
import { MusicTextEditingHints } from "./score/MusicTextEditingHints";
import { useMusicTextMetrics } from "./score/music-text-metrics";
import { resolveScoreDeleteCommand, resolveScorePointerAction } from "./session/editor-object-selection";
import {
  resolveMusicTextHoverTarget,
  sameMusicTextTarget,
} from "./music-text/music-text-hover";
import editorHeaderStyles from "./workspace/EditorHeader.module.scss";
import styles from "./index.module.scss";
import editorFormStyles from "./shared/editor-form.module.scss";
import scoreInteractionStyles from "./score/score-interaction.module.scss";
import {
  useEditorDraftRecords,
  useEditorRuntime,
} from "./session/EditorSessionRuntime";
import {
  captureEditorVersion,
  sameEditorSession,
  sameEditorVersion,
} from "./session/editor-session-version";
import { EditorStatusBar } from "./workspace/EditorStatusBar";
import { EditorHeader } from "./workspace/EditorHeader";
import { EditorToolbar, type EditorToolbarAction } from "./workspace/EditorToolbar";
import {
  createEditorCommandAdapter,
  type EditorCommandAdapter,
} from "./session/editor-command-adapter";
import { buildEditorToolCommand } from "./tools/editor-tool-actions";
import { resolveEditorRhythmTarget } from "./tools/editor-rhythm-target";
import {
  captureEditorToolIntent,
  editorToolSubmissionReason,
  tabToolTargetReason,
} from "./tools/editor-tool-guard";

/** 两位品位输入等待第二个数字的时间，超时后提交一位品位。 */
const FRET_DRAFT_TIMEOUT_MS = 600;

/** 编辑、图片导出和打印统一使用固定的默认排版。 */
const density = "compact";
const showChordDiagrams = true;

/** layout 命中结果含视觉 systemIndex；selection 只保留稳定业务 ID。 */
const toCellReference = (target: ILXMHitTarget): ILXMTabCellReference => ({
  trackId: target.trackId,
  measureId: target.measureId,
  beatId: target.beatId,
  string: target.string,
});

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

export const EditorShell: React.FC = () => {
  const session = useEditorSessionStore();
  const { token } = theme.useToken();
  const { drafts, modals } = useEditorRuntime();
  const activeModal = useSyncExternalStore(
    modals.subscribe,
    modals.getSnapshot,
    () => null,
  );
  const activeMusicTextTargetRef = useRef<MusicTextTarget | null>(null);
  const musicTextController = useRef<MusicTextController>(null);
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
  const selection = useEditorStore((state) => state.selection);
  const numberedSelection = useEditorStore((state) => state.numberedSelection);
  const selectedNumberedMarkId = useEditorStore(
    (state) => state.selectedNumberedMarkId,
  );
  const errorMessage = useEditorStore((state) => state.errorMessage);
  const loadNotice = useEditorStore((state) => state.loadNotice);
  const executeInStore = useEditorStore((state) => state.execute);
  /** 公共结构确认绑定真实会话快照，不在第一次失败后写任何历史。 */
  const execute = (command: ILXMScoreCommand) => {
    const snapshot = session.getState();
    const result = executeInStore(command);
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
    useState<ImageExportSnapshot | null>(null);
  const [outputBlockedOpen, setOutputBlockedOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const { width: hostWidth, mode: layoutMode } =
    useEditorHostWidth(editorRootRef);
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
  const [fileFeedbackHost, setFileFeedbackHost] =
    useState<HTMLDivElement | null>(null);
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
  useLayoutEffect(() => {
    activeMusicTextTargetRef.current = activeMusicTextTarget;
  }, [activeMusicTextTarget]);
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

  /** 品位草稿是瞬时输入状态，不进入 document 或历史。 */
  const [fretDraft, setFretDraft] = useState("");
  const deferredFretDraftCommit = useMemo(
    () => createDeferredFretDraftCommit(FRET_DRAFT_TIMEOUT_MS),
    [],
  );
  /** 同步取消旧会话计时器，覆盖替换完成到 React 重挂载之间的短暂窗口。 */
  useEffect(
    () =>
      session.subscribe((state, previous) => {
        if (state.sessionVersion !== previous.sessionVersion)
          deferredFretDraftCommit.cancel();
      }),
    [session, deferredFretDraftCommit],
  );
  /** drag anchor 用 ref 保存，避免 pointermove 读取到尚未提交的 React/store 状态。 */
  const dragAnchorRef = useRef<ILXMTabCellReference | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const focusCaretRef = useRef<SVGRectElement | null>(null);
  const scoreSvgRef = useRef<SVGSVGElement | null>(null);
  const imageExportButtonRef = useRef<HTMLButtonElement | null>(null);

  /** document 变化后重新生成 system、命中索引和所有 SVG 几何数据。 */
  const lxmLayout = useMemo<ILXMLayout | null>(() => {
    if (!document) return null;

    return buildLayout(document, {
      purpose: "editing",
      x: 0,
      y: 0,
      systemWidth: A4_CONTENT_WIDTH,
      density,
      musicTextMetrics,
      showChordDiagrams,
      paragraphEditing:
        activeMusicTextTarget?.kind === "lyric" ||
        activeMusicTextTarget?.kind === "numbered"
          ? { ...activeMusicTextTarget, kind: activeMusicTextTarget.kind }
          : undefined,
    });
  }, [document, musicTextMetrics, activeMusicTextTarget]);

  const onScoreGeometryChange = useCallback(() => {
    const svg = scoreSvgRef.current;
    const pointer = activePointerIdRef.current;
    if (svg && pointer !== null && svg.hasPointerCapture(pointer))
      svg.releasePointerCapture(pointer);
    activePointerIdRef.current = null;
    dragAnchorRef.current = null;
    clearHover();
    // transform 不会触发 ResizeObserver；浮层必须在同一次实际矩阵变化后重定位。
    window.dispatchEvent(new Event("resize"));
  }, [clearHover]);
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

  /**
   * 页面只消费核心范围解析结果。
   * 这里不通过 measure/beat 数组下标推导范围，保证重排后仍使用同一业务选区。
   */
  const resolvedSelection = useMemo(() => {
    if (!document || !selection) return null;
    const result = resolveTabCellSelection(document, selection);
    return result.ok ? result.range : null;
  }, [document, selection]);
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

  /** 组件卸载时取消延迟提交，避免异步回调写入已卸载组件。 */
  useEffect(
    () => () => deferredFretDraftCommit.cancel(),
    [deferredFretDraftCommit],
  );

  /** 只滚动谱面视口，文本编辑期间也能跟随目标；不会滚动侧栏输入区。 */
  useEffect(() => {
    const viewport = pageViewportRef.current;
    // 气泡隐藏时保留用户滚动位置，未提交草稿也不能把视口拉回。
    if (!viewport || (activeMusicTextTarget && musicTextPopoverHidden)) return;
    const revealTarget = () => {
      const caret = focusCaretRef.current;
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
  ]);

  /** 清理当前品位草稿和对应的延时提交。 */
  const clearFretDraft = useCallback(() => {
    deferredFretDraftCommit.cancel();
    setFretDraft("");
  }, [deferredFretDraftCommit]);

  /** 所有立即生效的编辑动作都先使等待中的品位草稿失效。 */
  const runImmediateEditorAction = (action: () => void): void => {
    if (musicTextController.current?.isTransitionBlocked()) return;
    clearFretDraft();
    action();
  };

  /** 将品位或弦格标记作为一条原子矩形命令提交，选区只产生一条历史。 */
  const setSelectedNotes = (fret: ILXMFret) => {
    if (!selection) {
      setErrorMessage("请先选择谱面中的 TAB 单元格，再输入品位或标记。");
      return;
    }
    execute({
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
    });
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

  /** 将草稿转换为品位；两位数字最终仍只提交一次命令。 */
  const commitFretDraft = (draft: string) => {
    clearFretDraft();
    if (draft.length === 0) return;
    const fret = Number(draft);
    if (!Number.isInteger(fret) || fret < 0 || fret > 24) {
      setErrorMessage("品位必须在 0 到 24 之间。");
      return;
    }
    setSelectedNotes(fret);
  };

  const fretDraftLocation = (() => {
    if (!selection || !document) return undefined;
    const track = document.score.tracks.find(
      (item) => item.id === selection.focus.trackId,
    );
    const measureIndex =
      track?.measures.findIndex(
        (item) => item.id === selection.focus.measureId,
      ) ?? -1;
    if (!track || measureIndex < 0) return undefined;
    const beatIndex = track.measures[measureIndex]!.beats.findIndex(
      (beat) => beat.id === selection.focus.beatId,
    );
    return [
      `第 ${measureIndex + 1} 小节`,
      ...(beatIndex >= 0 ? [`第 ${beatIndex + 1} 拍`] : []),
      `第 ${selection.focus.string} 弦`,
    ].join(" · ");
  })();
  useEditorDraftRecords(
    fretDraft && selection
      ? [
          {
            id: `fret:${selection.focus.trackId}/${selection.focus.measureId}/${selection.focus.beatId}/${selection.focus.string}`,
            kind: "fret",
            targetKey: `${selection.focus.trackId}/${selection.focus.measureId}/${selection.focus.beatId}/${selection.focus.string}`,
            label: `品位输入 ${fretDraft}`,
            location: fretDraftLocation,
            dirty: true,
            composing: false,
            canApply: false,
            error: null,
            version: captureEditorVersion(session.getState()),
            focus: () => {
              focusScore();
              return true;
            },
            // 品位继续使用既有 600ms 提交器，协调器不另建一条提交路径。
            apply: () => "blocked",
            discard: () => {
              clearFretDraft();
              return true;
            },
          },
        ]
      : [],
  );

  // 输出和离开页面共用即时检查：已登记草稿之外，还要覆盖品位延迟提交、
  // 文字编辑控制器和仍占用会话的弹层。这里仅判断，不自动应用或丢弃输入。
  const isOutputBlocked = () =>
    !!imageExportSnapshot ||
    modals.isOpen() ||
    drafts.isOutputBlocked() ||
    !!fretDraft ||
    !!musicTextController.current?.isOutputBlocked();

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
    if (!point || !lxmLayout) return null;
    const target = hitTestLayout(lxmLayout, point);
    return target ? toCellReference(target) : null;
  };

  /** 接受对象切换后清理旧输入与 pointer capture，文字激活和 beat 选择共用。 */
  const clearScoreInteraction = () => {
    clearFretDraft();
    clearHover();
    const svg = scoreSvgRef.current;
    const pointerId = activePointerIdRef.current;
    if (svg && pointerId !== null && svg.hasPointerCapture(pointerId))
      svg.releasePointerCapture(pointerId);
    dragAnchorRef.current = null;
    activePointerIdRef.current = null;
  };

  /** 确认期间不修改选区，只有接受请求后才更新六线谱对象与焦点。 */
  const acceptScoreSelection = (
    next: ILXMTabCellSelection | null,
    techniqueId: string | null,
  ) => {
    clearScoreInteraction();
    setActiveMusicTextTarget(null);
    setSelection(next);
    setSelectedTechniqueId(techniqueId);
    setErrorMessage(
      techniqueId && !next ? "当前技巧无法映射到可编辑的 TAB 单元格。" : null,
    );
    focusScore();
  };

  const handlePointerDown: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    clearHover();
    if (!document || !lxmLayout) return;
    const point = getLayoutPoint(event.currentTarget, event);
    if (!point) return;
    const action = resolveScorePointerAction(
      document,
      lxmLayout,
      point,
      selection,
      event.shiftKey,
    );
    if (!action) {
      if (!event.shiftKey) musicTextController.current?.dismissCleanPopover();
      return;
    }
    event.preventDefault();
    if (action.type === "target") {
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
      action.techniqueId ||
      action.startDrag === false
    )
      return;
    dragAnchorRef.current = action.selection.anchor;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
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
    if (target) setSelection({ anchor: dragAnchorRef.current, focus: target });
  };

  const finishPointerDrag: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    clearHover();
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    activePointerIdRef.current = null;
    dragAnchorRef.current = null;
  };

  /** 编辑器级历史快捷键在 SVG 或 Toolbar 持有焦点时都生效。 */
  const handleEditorKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (modals.isOpen()) return;
    if (isTextEditingTarget(event.target)) return;
    if (
      event.target instanceof Element &&
      event.target.closest('dialog, [role="dialog"], [role="alertdialog"]')
    )
      return;

    const action = resolveEditorHistoryShortcut(event, { canUndo, canRedo });
    if (!action) return;

    event.preventDefault();
    void handleToolbarAction({ type: action });
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
    // 段落活动对象上的 Esc 也走草稿保护，不能被文字输入锁提前拦住。
    if (event.key === "Escape" && activeMusicTextTarget) {
      event.preventDefault();
      musicTextController.current?.returnToScore();
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
        clearFretDraft();
        setSelection(result.selection);
      } else if (!result.ok) setErrorMessage(result.message);
      return;
    }

    if (event.key === "Escape") {
      if (!selection && !fretDraft) return;
      event.preventDefault();
      clearFretDraft();
      if (selection)
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
      clearFretDraft();
      void removeScoreSelection();
      return;
    }
    if (!/^\d$/.test(event.key)) return;

    event.preventDefault();
    if (!selection) {
      setErrorMessage("请先选择谱面中的 TAB 单元格，再输入品位。");
      return;
    }
    const nextDraft = `${fretDraft}${event.key}`;
    if (nextDraft.length > 2 || Number(nextDraft) > 24) {
      clearFretDraft();
      setErrorMessage("品位必须在 0 到 24 之间。");
      return;
    }

    setFretDraft(nextDraft);
    // 0 或 3–9 不可能成为合法两位品位前缀；1、2 等待第二位数字。
    if (nextDraft.length === 2 || event.key === "0" || Number(event.key) >= 3) {
      commitFretDraft(nextDraft);
      return;
    }
    deferredFretDraftCommit.schedule(nextDraft, commitFretDraft);
  };

  /** 点击 SVG 外的 A4 空白或灰色工作区时清空临时选区。 */
  const handleWorkspacePointerDown: React.PointerEventHandler<
    HTMLDivElement
  > = (event) => {
    const target = event.target;
    if (
      event.shiftKey ||
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

  if (!document || !lxmLayout)
    return (
      <div className={styles.editorControls}>
        <ScoreFileControls
          session={session}
          isBlocked={isOutputBlocked}
          onBlocked={() => { if (!modals.isOpen()) setOutputBlockedOpen(true); }}
        />
        <p className={editorFormStyles.errorMessage} role="alert">
          {errorMessage ?? "当前没有可编辑的乐谱文档。"}
        </p>
      </div>
    );

  /** 所有工具提交都先清计时草稿并核对属性保护；粘贴允许自己的 Modal。 */
  const executeTool: EditorCommandAdapter = async (
    command,
    impact = "modal",
    submission,
  ) => {
    clearFretDraft();
    const reason = editorToolSubmissionReason(
      session.getState(),
      activeMusicTextTargetRef.current,
      drafts,
      command,
      submission,
    );
    if (reason) return { status: "blocked", message: reason };
    if (
      command.type === "numbered.event.setRhythm"
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
  /** 菜单/详情共享最新目标和最终确认结果，不捕获旧 render 的音乐对象。 */
  const handleToolbarAction = async (
    action: EditorToolbarAction,
  ): Promise<boolean> => {
    if (modals.isOpen()) return false;
    clearFretDraft();
    if (action.type === "undo" || action.type === "redo") {
      if (
        musicTextController.current?.isTransitionBlocked() ||
        drafts.inspect().pending.some((record) => record.kind === "technique")
      )
        return false;
      const now = session.getState();
      if (action.type === "undo") now.undo();
      else now.redo();
      return true;
    }
    const tabQuick =
      action.type === "restToggle" || action.type === "quickTechnique";
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
          timeline: "editTimeline",
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
      isCurrent: intentIsCurrent,
      tabOnly: tabQuick,
    });
    return result.status === "applied" || result.status === "noop";
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
  const currentPosition = deriveSidebarContext({
    document,
    selection,
    numberedSelection,
  });

  return (
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
      onKeyDown={handleEditorKeyDown}
    >
      <EditorHeader
        title={document.score.title}
        canNavigateToLearning={() => {
          // 学习路由会卸载编辑器 UI，未应用的表单输入不能随之消失。
          // 先处理现有弹层/输出任务，避免叠加草稿提示；草稿处理后也不自动续跳，
          // 由用户再次点击并检查最新状态，避免使用确认期间已过期的导航请求。
          if (!isOutputBlocked()) return true;
          if (modals.isOpen() || imageExportSnapshot) {
            setErrorMessage("请先完成当前弹层或图片导出，再进入吉他进阶。");
          } else {
            setOutputBlockedOpen(true);
          }
          return false;
        }}
        fileControls={
          <ScoreFileControls
            session={session}
            className={editorHeaderStyles.headerNativeAction}
            feedbackContainer={fileFeedbackHost}
            isBlocked={isOutputBlocked}
            onBlocked={() => { if (!modals.isOpen()) setOutputBlockedOpen(true); }}
          />
        }
        imageExportButtonRef={imageExportButtonRef}
        onImageExport={() => {
          if (modals.isOpen()) {
            setErrorMessage("请先完成当前弹层操作，再导出图片。");
            return;
          }
          if (isOutputBlocked()) {
            if (drafts.inspect().pending.length) setOutputBlockedOpen(true);
            else
              setErrorMessage("请先完成当前输入并应用或取消修改，再导出图片。");
            return;
          }
          const state = session.getState();
          if (!state.document) return;
          setImageExportSnapshot({
            version: captureEditorVersion(state),
            document: state.document,
            density,
            showChordDiagrams,
          });
        }}
      />
      <EditorToolbar
        sidebarCollapsed={sidebarCollapsed}
        sidebarToggleRef={sidebarToggleRef}
        onToggleSidebar={() => {
          if (!sidebarCollapsed) {
            closeSidebar();
            return;
          }
          openSidebar();
          requestAnimationFrame(() =>
            musicTextController.current?.restoreSidebarFocus(),
          );
        }}
        activeTarget={activeMusicTextTarget}
        blocked={musicTextEditing}
        numberedBlocked={numberedActionBlocked}
        chordEntryBlocked={chordEntryBlocked}
        onOpenChord={(target) => musicTextController.current?.open(target)}
        onAction={handleToolbarAction}
        beforeAction={clearFretDraft}
        execute={executeTool}
        onNavigate={(destination) =>
          musicTextController.current?.navigateTool(destination) ?? "blocked"
        }
      />
      <div className={styles.editorControls}>
        <div ref={setFileFeedbackHost} />
        {loadNotice && <p role="status">{loadNotice}</p>}
        {lxmLayout.width > A4_CONTENT_WIDTH + 1 && (
          <p role="status">
            当前谱面超过 A4 内容宽度，可横向滚动；请调整内容后再导出 A4 图片。
          </p>
        )}
        {hasMissingMetrics && (
          <p role="status">
            部分文字暂使用保守估算排版，真实字体边界尚未全部确认。
          </p>
        )}
        {errorMessage && (
          <p className={editorFormStyles.errorMessage} role="alert">
            {errorMessage}
          </p>
        )}
      </div>
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
                viewBox={`0 0 ${lxmLayout.width} ${lxmLayout.height}`}
                style={scoreView.svgStyle}
                width={lxmLayout.width}
                height={lxmLayout.height}
                tabIndex={0}
                role="application"
                aria-label="六线谱编辑器"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerLeave={clearHover}
                onPointerUp={finishPointerDrag}
                onPointerCancel={finishPointerDrag}
                onKeyDown={handleScoreKeyDown}
              >
                <MusicTextEditingHints
                  layout={lxmLayout}
                  activeFocus={lyricFocus}
                  hoverFocus={musicTextHoverFocus}
                  beatContext={numberedBeatContext?.bounds ?? null}
                />
                {/* 选区层位于音乐元素下方，且永不参与指针命中。 */}
                <g className={scoreInteractionStyles.selectionLayer} pointerEvents="none">
                  {chordFocus && (
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
                  {!lyricEditing &&
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
                    selectedTechniqueId={selectedTechniqueId}
                    selectedNumberedMarkId={selectedNumberedMarkId}
                    selectedNumberedEventId={
                      activeMusicTextTarget?.kind === "numbered"
                        ? activeMusicTextTarget.eventId
                        : null
                    }
                  />
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
          showChordDiagrams={showChordDiagrams}
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
          onScoreFocus={focusScore}
          onPopoverHiddenChange={setMusicTextPopoverHidden}
          onScoreSelection={acceptScoreSelection}
          getFloatingAnchor={getFloatingAnchor}
          getFloatingViewport={getFloatingViewport}
          getFloatingObservedElements={() => [pageViewportRef.current]}
        />
      </div>
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
          outputBlockedOpen ||
          (narrowPanels && !sidebarCollapsed)
        }
      />
      <EditorStatusBar
        position={
          numberedSelection && currentPosition.valid
            ? `${currentPosition.title}：${currentPosition.position}${currentPosition.scope ? ` · ${currentPosition.scope}` : ""}`
            : selection && focusedMeasureContext
              ? `当前位置：第 ${focusedMeasureContext.measureIndex + 1} 小节，第 ${focusedMeasureContext.measure.beats.findIndex((beat) => beat.id === selection.focus.beatId) + 1} 拍点，第 ${selection.focus.string} 弦。`
              : "请在谱面选择编辑位置。"
        }
        cellCount={resolvedSelection?.cellCount ?? 0}
        fretDraft={fretDraft}
      />
      <ScorePrintLayer
        score={document}
        density={density}
        showChordDiagrams={showChordDiagrams}
      />
      <OutputBlockedModal
        open={outputBlockedOpen}
        drafts={drafts}
        onClose={() => setOutputBlockedOpen(false)}
        onBlocked={setErrorMessage}
      />
      {imageExportSnapshot && (
        <ImageExportModal
          snapshot={imageExportSnapshot}
          returnFocus={imageExportButtonRef}
          onClose={() => setImageExportSnapshot(null)}
          isCurrent={() =>
            sameEditorVersion(
              captureEditorVersion(session.getState()),
              imageExportSnapshot.version,
            )
          }
        />
      )}
    </div>
  );
};
