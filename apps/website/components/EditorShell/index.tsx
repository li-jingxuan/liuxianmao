"use client";
import type { ILXMScoreCommand } from "@liuxianmao/lxm-editor";

import { EditorImpactNotice } from "./EditorImpactNotice";

import {
  buildLayout,
  A4_CONTENT_WIDTH,
  collectMusicTextMeasureRequests,
  createCollapsedTabCellSelection,
  hitTestLayout,
  hitTestMusicText,
  hitTestTechniqueTarget,
  layoutTabCellCaret,
  layoutTabCellSelection,
  LXMScoreCommandEnum,
  navigateTabCellSelection,
  resolveTabCellSelection,
  type ILXMHitTarget,
  type ILXMLayout,
  type ILXMLayoutDensity,
  type ILXMFret,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { theme } from "antd";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import {
  createDeferredFretDraftCommit,
  resolveBeatKindShortcut,
  resolveMutedNoteShortcut,
  resolveEditorHistoryShortcut,
} from "./editor-interaction";
import { ScoreMusicLayer } from "./ScoreMusicLayer";
import { buildScoreScene } from "./score-scene";
import { ScoreImagePreview } from "./ScoreImagePreview";
import { ScorePrintLayer } from "./ScorePrintLayer";
import { ScoreFileControls } from "./ScoreFileControls";
import { MusicTextSidebar, type MusicTextController } from "./MusicTextSidebar";
import type { MusicTextTarget } from "./music-text-draft";
import { resolveParagraphFocus } from "./music-text-focus";
import { MusicTextEditingHints } from "./MusicTextEditingHints";
import { useMusicTextMetrics } from "./music-text-metrics";
import { resolveScorePointerAction } from "./editor-object-selection";
import {
  resolveMusicTextHoverTarget,
  sameMusicTextTarget,
} from "./music-text-hover";
import styles from "./index.module.scss";
import {
  useEditorDraftRecords,
  useEditorRuntime,
} from "./EditorSessionRuntime";
import {
  captureEditorVersion,
  sameEditorSession,
} from "./editor-session-version";
import { EditorStatusBar } from "./EditorStatusBar";
import { EditorHeader } from "./EditorHeader";
import { EditorToolbar, type EditorToolbarAction } from "./EditorToolbar";
import { createEditorCommandAdapter, type EditorCommandAdapter } from "./editor-command-adapter";
import { buildEditorToolCommand } from "./editor-tool-actions";
import { editorShortcutHelp } from "./editor-shortcuts";

/** 两位品位输入等待第二个数字的时间，超时后提交一位品位。 */
const FRET_DRAFT_TIMEOUT_MS = 600;

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
  const toolExecute = useMemo(() => createEditorCommandAdapter(session, modals), [session, modals]);
  const document = useEditorStore((state) => state.document);
  const selection = useEditorStore((state) => state.selection);
  const effects = useEditorStore((state) => state.effects);
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
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);

  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [fileFeedbackHost, setFileFeedbackHost] =
    useState<HTMLDivElement | null>(null);
  /** 宿主替换或历史变化立即关闭旧输出，晚到回调不能发布旧谱。 */
  useEffect(
    () =>
      session.subscribe((state, previous) => {
        if (state.document !== previous.document) setImagePreviewOpen(false);
      }),
    [session],
  );
  const musicTextController = useRef<MusicTextController>(null);
  const [musicTextEditing, setMusicTextEditing] = useState(false);
  const pageViewportRef = useRef<HTMLDivElement>(null);
  const [activeMusicTextTarget, setActiveMusicTextTarget] =
    useState<MusicTextTarget | null>(null);
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
  const [showChordDiagrams, setShowChordDiagrams] = useState(true);
  const musicTextMetrics = useMusicTextMetrics(document, showChordDiagrams);

  /** 品位草稿是瞬时输入状态，不进入 document 或历史。 */
  const [fretDraft, setFretDraft] = useState("");
  /** 排版密度只影响视觉，不进入文档或撤销历史。 */
  const [density, setDensity] = useState<ILXMLayoutDensity>("compact");
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
  }, [
    document,
    density,
    musicTextMetrics,
    showChordDiagrams,
    activeMusicTextTarget,
  ]);

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
  const musicTextHoverFocus = useMemo(() => {
    if (!hoveredMusicText || hoveredMusicText.layout !== lxmLayout) return null;
    const target = hoveredMusicText.target;
    // 当前对象已有选中框，不再叠加同一对象的悬停描边。
    if (sameMusicTextTarget(activeMusicTextTarget, target)) return null;
    const focus = resolveParagraphFocus(lxmLayout, target);
    // 同拍多个简谱音虽有不同事件 ID，但共享一个激活框。
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
  /** 选拍或草稿确认结束后保留谱面焦点，不触发浏览器默认滚动。 */
  const focusScore = useCallback(
    () => scoreSvgRef.current?.focus({ preventScroll: true }),
    [],
  );
  const focusCaret = useMemo(
    () =>
      lxmLayout && selection
        ? layoutTabCellCaret(
            lxmLayout,
            activeMusicTextTarget?.kind === "lyric"
              ? activeMusicTextTarget
              : selection.focus,
          )
        : null,
    [lxmLayout, selection, activeMusicTextTarget],
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
    if (!viewport) return;
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
    clearFretDraft();
    action();
  };

  /** 将合法品位作为一条原子矩形命令提交，整个选区只产生一条历史。 */
  const setSelectedNotes = (fret: ILXMFret) => {
    if (!selection) {
      setErrorMessage("请先选择谱面中的 TAB 单元格，再输入品位。");
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

  /** 删除同样是一条批量命令，页面绝不循环发送 note.remove。 */
  const removeSelectedNotes = () => {
    if (!selection) {
      setErrorMessage("请先选择谱面中的 TAB 单元格，再删除音符。");
      return;
    }
    execute({
      type: LXMScoreCommandEnum.RemoveNotesInRect,
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
    });
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

  useEditorDraftRecords(
    fretDraft && selection
      ? [
          {
            id: `fret:${selection.focus.trackId}/${selection.focus.measureId}/${selection.focus.beatId}/${selection.focus.string}`,
            kind: "fret",
            targetKey: `${selection.focus.trackId}/${selection.focus.measureId}/${selection.focus.beatId}/${selection.focus.string}`,
            label: `品位输入 ${fretDraft}`,
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

  const isOutputBlocked = () =>
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
    if (!action) return;
    event.preventDefault();
    if (action.type === "target") {
      musicTextController.current?.open(action.target);
      return;
    }
    if (action.type !== "selection") return;
    const result = musicTextController.current?.select(
      action.selection,
      action.techniqueId,
    );
    // 有草稿时只记录待选区，不捕获原 PointerEvent，也不重放已松开的拖动。
    if (result !== "accepted" || !action.selection || action.techniqueId)
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
    runImmediateEditorAction(action === "undo" ? undo : redo);
  };

  /**
   * 谱面键盘入口只处理导航和 Note 输入，避免 Toolbar 上的方向键被谱面劫持。
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
    const beatKindAction = resolveBeatKindShortcut(event);
    if (beatKindAction && selection) {
      event.preventDefault();
      runImmediateEditorAction(() =>
        setSelectedBeatKind(beatKindAction === "setRest" ? "rest" : "notes"),
      );
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      if (!selection) return;
      event.preventDefault();
      clearFretDraft();
      removeSelectedNotes();
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

    musicTextController.current?.select(null);
  };

  if (!document || !lxmLayout)
    return (
      <div className={styles.editorControls}>
        <ScoreFileControls session={session} isBlocked={isOutputBlocked} />
        <p className={styles.errorMessage} role="alert">
          {errorMessage ?? "当前没有可编辑的乐谱文档。"}
        </p>
      </div>
    );

  /** 所有工具提交都先清计时草稿并核对属性保护；粘贴允许自己的 Modal。 */
  const executeTool: EditorCommandAdapter = async (command, impact = "modal") => {
    clearFretDraft();
    if (musicTextController.current?.isOutputBlocked()) return { status: "blocked", message: "请先应用或取消属性草稿，再修改音乐。" };
    const modal = modals.getSnapshot();
    if (modal && !(impact === "caller" && modal.request.kind === "beat-paste")) return { status: "blocked", message: "请先完成当前弹层操作。" };
    return toolExecute(command, impact);
  };
  /** 菜单/详情共享最新目标和最终确认结果，不捕获旧 render 的音乐对象。 */
  const handleToolbarAction = async (action: EditorToolbarAction): Promise<boolean> => {
    if (modals.isOpen()) return false;
    clearFretDraft();
    if (action.type === "undo" || action.type === "redo") {
      const now = session.getState();
      if (action.type === "undo") now.undo(); else now.redo();
      return true;
    }
    if (musicTextController.current?.isOutputBlocked()) {
      setErrorMessage("请先应用或取消属性草稿，再修改音乐。");
      return false;
    }
    const now = session.getState();
    if (!now.document) return false;
    const command = buildEditorToolCommand(now.document, now.selection, action);
    if (!command) { setErrorMessage("当前目标不适用此操作，请重新选择。"); return false; }
    const result = await executeTool(command);
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

  return (
    <div
      className={styles.editor}
      style={{ ...editorVariables, color: token.colorText }}
      onKeyDown={handleEditorKeyDown}
    >
      <EditorHeader
        title={document.score.title}
        density={density}
        showChordDiagrams={showChordDiagrams}
        onDensityChange={setDensity}
        onChordDiagramsChange={setShowChordDiagrams}
        helpDisabled={!!fretDraft}
        onHelp={() =>
          modals.open({
            kind: "keyboard-help",
            title: "编辑快捷键",
            message: editorShortcutHelp(),
          })
        }
        fileControls={
          <ScoreFileControls
            session={session}
            className={styles.headerNativeAction}
            feedbackContainer={fileFeedbackHost}
            isBlocked={isOutputBlocked}
          />
        }
        onImageExport={() => {
          if (isOutputBlocked()) {
            setErrorMessage("请先完成当前输入并应用或取消修改，再导出图片。");
            return;
          }
          setImagePreviewOpen(true);
        }}
      />
      <EditorToolbar
        blocked={musicTextEditing}
        onAction={handleToolbarAction}
        beforeAction={clearFretDraft}
        execute={executeTool}
        onNavigate={(destination) => musicTextController.current?.navigateTool(destination) ?? "blocked"}
      />
      <div className={styles.editorControls}>
        <div ref={setFileFeedbackHost} />
        {loadNotice && <p role="status">{loadNotice}</p>}
        {lxmLayout.width > A4_CONTENT_WIDTH + 1 && (
          <p role="status">
            当前谱面超过 A4 内容宽度，可横向滚动；请调整内容后再导出 A4 图片。
          </p>
        )}
        {musicTextMetrics &&
          collectMusicTextMeasureRequests(document, showChordDiagrams).some(
            (r) => !musicTextMetrics[r.key],
          ) && (
            <p role="status">
              部分文字暂使用保守估算排版，真实字体边界尚未全部确认。
            </p>
          )}
        <EditorImpactNotice effects={effects} />
        {errorMessage && (
          <p className={styles.errorMessage} role="alert">
            {errorMessage}
          </p>
        )}
      </div>
      <div className={styles.editorWorkspace}>
        <div
          ref={pageViewportRef}
          className={styles.pageViewport}
          onPointerDown={handleWorkspacePointerDown}
          onScroll={clearHover}
        >
          <main className={styles.paper} aria-label="A4 乐谱页面">
            <svg
              ref={scoreSvgRef}
              className={styles.scoreSvg}
              viewBox={`0 0 ${lxmLayout.width} ${lxmLayout.height}`}
              style={{
                width: `${Math.max(1, lxmLayout.width / A4_CONTENT_WIDTH) * 100}%`,
              }}
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
              />
              {/* 选区层位于音乐元素下方，且永不参与指针命中。 */}
              <g className={styles.selectionLayer} pointerEvents="none">
                {tabCellHoverCaret && (
                  <rect
                    data-tab-cell-hover={`${tabCellHoverCaret.measureId}/${tabCellHoverCaret.beatId}/${tabCellHoverCaret.string}`}
                    className={styles.tabCellHover}
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
                      className={styles.selectionRange}
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
                      lyricEditing ? styles.emptyLyricCaret : styles.focusCaret
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
                  className={styles.lyricFocus}
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
                />
              )}
            </svg>
          </main>
        </div>
        <MusicTextSidebar
          getSystemMeasureIds={(measureId) =>
            lxmLayout.systems
              .find((s) => s.measures.some((m) => m.id === measureId))
              ?.measures.map((m) => m.id) ?? []
          }
          ref={musicTextController}
          onToolAction={handleToolbarAction}
          executeTool={executeTool}
          onOpen={clearScoreInteraction}
          onEditingChange={setMusicTextEditing}
          onTargetChange={setActiveMusicTextTarget}
          onScoreFocus={focusScore}
          onScoreSelection={acceptScoreSelection}
        />
      </div>
      <EditorStatusBar
        position={
          selection && focusedMeasureContext
            ? `当前位置：第 ${focusedMeasureContext.measureIndex + 1} 小节，第 ${focusedMeasureContext.measure.beats.findIndex((beat) => beat.id === selection.focus.beatId) + 1} 拍点，第 ${selection.focus.string} 弦。`
            : "请在谱面选择编辑位置。"
        }
        cellCount={resolvedSelection?.cellCount ?? 0}
        fretDraft={fretDraft}
        viewLabel={`${density === "compact" ? "紧凑" : "舒适"}排版 · ${showChordDiagrams ? "指法图显示" : "指法图隐藏"}`}
      />
      <ScorePrintLayer
        score={document}
        density={density}
        showChordDiagrams={showChordDiagrams}
      />
      {imagePreviewOpen && (
        <ScoreImagePreview
          score={document}
          density={density}
          showChordDiagrams={showChordDiagrams}
          onClose={() => setImagePreviewOpen(false)}
          isCurrent={() => session.getState().document === document}
        />
      )}
    </div>
  );
};
