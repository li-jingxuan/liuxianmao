"use client";

import { EditorImpactNotice } from "./EditorImpactNotice";

import {
  buildLayout,
  collectMusicTextMeasureRequests,
  createCollapsedTabCellSelection,
  hitTestLayout,
  hitTestMusicText,
  hitTestTechniqueTarget,
  layoutTabCellCaret,
  layoutTabCellSelection,
  LXM_EDITABLE_TIME_SIGNATURES,
  LXM_FRET_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_HALO_WIDTH,
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_ARROW_HEIGHT,
  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
  LXMScoreCommandEnum,
  navigateTabCellSelection,
  resolveTabCellSelection,
  resolveTechniqueSelection,
  type ILXMHitTarget,
  type ILXMBarlineLayout,
  type ILXMBarlineType,
  type ILXMLayout,
  type ILXMLayoutDensity,
  type ILXMRhythm,
  type ILXMFret,
  type ILXMTabCellReference,
  type ILXMTimeSignature,
} from "@liuxianmao/lxm-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import { MusicAssetIcon } from "../MusicAssetIcon";
import {
  createDeferredFretDraftCommit,
  resolveBeatKindShortcut,
  resolveMutedNoteShortcut,
  resolveEditorHistoryShortcut,
} from "./editor-interaction";
import { TupletToolbar } from "./TupletToolbar";
import { TechniqueToolbar } from "./TechniqueToolbar";
import { MusicTextLayer } from "./MusicTextLayer";
import { MusicTextSidebar, type MusicTextController } from "./MusicTextSidebar";
import type { MusicTextTarget } from "./music-text-draft";
import { resolveLyricFocus } from "./music-text-focus";
import { useMusicTextMetrics } from "./music-text-metrics";
import styles from "./index.module.scss";

/** A4 纸张扣除左右各 8mm 页边距后的 194mm 内容区逻辑宽度。 */
const A4_CONTENT_WIDTH = 733;
/** 两位品位输入等待第二个数字的时间，超时后提交一位品位。 */
const FRET_DRAFT_TIMEOUT_MS = 600;

/** 小节线工具完整保留核心已支持的六类领域值，并提供可读中文名称。 */
const BARLINE_OPTIONS: { value: ILXMBarlineType; label: string }[] = [
  { value: "single", label: "单小节线" },
  { value: "double", label: "双小节线" },
  { value: "final", label: "终止线" },
  { value: "repeatStart", label: "开始反复线" },
  { value: "repeatEnd", label: "结束反复线" },
  { value: "repeatBoth", label: "双向反复线" },
];

/** 拍号是值对象；页面只把它格式化为 select 的稳定字符串值。 */
const formatTimeSignature = ({
  numerator,
  denominator,
}: ILXMTimeSignature): string => `${numerator}/${denominator}`;

/**
 * 小节线和行首反复线共享同一份核心几何；页面只区分 line/circle 两种基础图元。
 * 抽成纯渲染函数后，跨 system 投影不会在 JSX 中复制一套容易漂移的规则。
 */
const renderBarlineParts = (barline: ILXMBarlineLayout) =>
  barline.parts.map((part, index) =>
    part.kind === "line" ? (
      <line
        key={index}
        x1={part.x}
        y1={part.y1}
        x2={part.x}
        y2={part.y2}
        stroke="black"
        strokeWidth={part.strokeWidth}
      />
    ) : (
      <circle
        key={index}
        cx={part.cx}
        cy={part.cy}
        r={part.radius}
        fill="black"
      />
    ),
  );

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
  (target instanceof HTMLElement && target.isContentEditable);

export const EditorShell: React.FC = () => {
  const session = useEditorSessionStore();
  const document = useEditorStore((state) => state.document);
  const selection = useEditorStore((state) => state.selection);
  const effects = useEditorStore((state) => state.effects);
  const errorMessage = useEditorStore((state) => state.errorMessage);
  const execute = useEditorStore((state) => state.execute);
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

  const musicTextController = useRef<MusicTextController>(null);
  const [musicTextEditing, setMusicTextEditing] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const pageViewportRef = useRef<HTMLDivElement>(null);
  const returnSidebarFocus = useCallback(
    () => sidebarToggleRef.current?.focus({ preventScroll: true }),
    [],
  );
  const [activeMusicTextTarget, setActiveMusicTextTarget] =
    useState<MusicTextTarget | null>(null);
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
      x: 0,
      y: 0,
      systemWidth: A4_CONTENT_WIDTH,
      density,
      musicTextMetrics,
      showChordDiagrams,
    });
  }, [document, density, musicTextMetrics, showChordDiagrams]);

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
    () => resolveLyricFocus(lxmLayout, activeMusicTextTarget),
    [lxmLayout, activeMusicTextTarget],
  );
  const lyricEditing = activeMusicTextTarget?.kind === "lyric";
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

  /** 单 Beat 工具读取领域 Beat；layout 只负责坐标，不能成为 rhythm 数据源。 */
  const activeBeat = useMemo(() => {
    if (!document || !resolvedSelection || resolvedSelection.beats.length !== 1)
      return null;
    const target = resolvedSelection.beats[0]!;
    return (
      document.score.tracks
        .find((track) => track.id === target.trackId)
        ?.measures.find((measure) => measure.id === target.measureId)
        ?.beats.find((beat) => beat.id === target.beatId) ?? null
    );
  }, [document, resolvedSelection]);
  const selectedMeasureIds = useMemo(
    () => new Set(resolvedSelection?.beats.map((beat) => beat.measureId) ?? []),
    [resolvedSelection],
  );
  const canEditSingleBeat = resolvedSelection?.beats.length === 1;
  const canEditBeatRange = Boolean(resolvedSelection?.beats.length);
  const canEditSingleMeasure = selectedMeasureIds.size === 1;

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
      if (musicTextEditing && !lyricEditing && matrix && selection) {
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
    sidebarVisible,
    musicTextEditing,
    selection,
    lxmLayout,
    lyricFocus,
    lyricEditing,
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

  /** 单 Beat 工具在跨 Beat 选区中不构造命令，避免静默修改 focus。 */
  const getSingleBeatTarget = () => {
    const target = resolvedSelection?.beats[0];
    if (!target || resolvedSelection?.beats.length !== 1) {
      setErrorMessage("节奏与休止工具只支持单个 Beat 选区。");
      return null;
    }
    return {
      trackId: target.trackId,
      measureId: target.measureId,
      beatId: target.beatId,
    };
  };

  const setActiveRhythmBase = (base: ILXMRhythm["base"]) => {
    const target = getSingleBeatTarget();
    if (!target || !activeBeat) return;
    execute({
      type: LXMScoreCommandEnum.SetBeatRhythm,
      ...target,
      rhythm: { base, dots: activeBeat.rhythm.dots },
    });
  };

  const setActiveDots = (dots: 0 | 1 | 2) => {
    const target = getSingleBeatTarget();
    if (!target || !activeBeat) return;
    execute({
      type: LXMScoreCommandEnum.SetBeatRhythm,
      ...target,
      rhythm: { ...activeBeat.rhythm, dots },
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

  /** 小节工具只接受唯一 measure；跨小节选区时按钮禁用。 */
  const getSingleMeasureTarget = () => {
    const target = resolvedSelection?.beats[0];
    if (!target || selectedMeasureIds.size !== 1) {
      setErrorMessage("小节工具只支持位于同一小节内的选区。");
      return null;
    }
    return { trackId: target.trackId, measureId: target.measureId };
  };

  const insertMeasureAfterActive = () => {
    const target = getSingleMeasureTarget();
    if (!target) return;
    execute({
      type: LXMScoreCommandEnum.InsertMeasure,
      trackId: target.trackId,
      afterMeasureId: target.measureId,
    });
  };

  const copyActiveMeasure = () => {
    const target = resolvedSelection?.beats[0];
    const selectedTrack = target
      ? document?.score.tracks.find((track) => track.id === target.trackId)
      : null;
    if (!target || !selectedTrack || selectedMeasureIds.size === 0) {
      setErrorMessage("请先选择需要复制的小节。");
      return;
    }
    const selectedIndexes = selectedTrack.measures
      .map((measure, index) => (selectedMeasureIds.has(measure.id) ? index : -1))
      .filter((index) => index >= 0);
    const start = selectedTrack.measures[selectedIndexes[0]!];
    const end = selectedTrack.measures[selectedIndexes.at(-1)!];
    if (!start || !end || selectedIndexes.at(-1)! - selectedIndexes[0]! + 1 !== selectedIndexes.length) {
      setErrorMessage("多小节复制需要选择连续的小节。");
      return;
    }
    execute({
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: target.trackId,
      sourceStartMeasureId: start.id,
      sourceEndMeasureId: end.id,
      afterMeasureId: end.id,
    });
  };

  const removeActiveMeasure = () => {
    const target = getSingleMeasureTarget();
    if (!target) return;
    execute({ type: LXMScoreCommandEnum.RemoveMeasure, ...target });
  };

  /**
   * 下拉框只表达“focus 小节之后的边界”。字段定位、谱尾合法性、no-op 和 revision
   * 都由核心 barline.setBoundary 命令处理，页面不直接写 ILXMDocument。
   */
  const setFocusedMeasureBarline = (barline: ILXMBarlineType) => {
    if (!focusedMeasureContext) {
      setErrorMessage("请先选择需要设置右边界的小节。");
      return;
    }
    execute({
      type: LXMScoreCommandEnum.SetBarlineBoundary,
      trackId: focusedMeasureContext.track.id,
      boundary: {
        kind: "afterMeasure",
        measureId: focusedMeasureContext.measure.id,
      },
      barline,
    });
  };

  /** 谱首没有前一个 measure，因此通过独立的 trackStart 边界命令开关反复线。 */
  const toggleTrackStartRepeat = () => {
    if (!focusedMeasureContext?.isFirstMeasure) {
      setErrorMessage("谱首反复线只能在选中第一小节时设置。");
      return;
    }
    execute({
      type: LXMScoreCommandEnum.SetBarlineBoundary,
      trackId: focusedMeasureContext.track.id,
      boundary: { kind: "trackStart" },
      barline:
        focusedMeasureContext.track.startBarline === "repeatStart"
          ? "none"
          : "repeatStart",
    });
  };

  /**
   * 页面只提交“目标小节、目标拍号、作用范围”。容量、尾部休止、受影响小节列表
   * 和原子失败均由核心 measure.setTimeSignature 命令处理，避免 React 根据可能已经
   * 过期的 document 快照自行展开范围。
   */
  const setFocusedMeasureTimeSignature = (value: string) => {
    if (!focusedMeasureContext) {
      setErrorMessage("请先选择需要设置拍号的小节。");
      return;
    }
    const timeSignature = LXM_EDITABLE_TIME_SIGNATURES.find(
      (candidate) => formatTimeSignature(candidate) === value,
    );
    if (!timeSignature) {
      setErrorMessage("当前只支持 2/4、3/4、4/4 和 6/8 拍号。");
      return;
    }
    execute({
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: focusedMeasureContext.track.id,
      measureId: focusedMeasureContext.measure.id,
      timeSignature: { ...timeSignature },
      /*
       * 页面固定采用乐谱中最常见的持续拍号语义：新拍号从当前小节生效，并持续到
       * 下一个已经存在的拍号变化点。若只需要临时改变一个小节，用户可在下一小节
       * 再设置回原拍号；核心命令仍保留 measure scope 供测试和未来高级工具使用。
       */
      scope: "untilNextChange",
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

  const handlePointerDown: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    const textPoint = getLayoutPoint(event.currentTarget, event);
    const textTarget =
      textPoint && lxmLayout ? hitTestMusicText(lxmLayout, textPoint) : null;
    if (textTarget) {
      event.preventDefault();
      musicTextController.current?.open({
        trackId: textTarget.trackId,
        measureId: textTarget.measureId,
        beatId: textTarget.beatId,
        string: selection?.focus.string ?? 1,
        kind: textTarget.kind,
        verse: textTarget.verse,
      });
      return;
    }
    if (musicTextEditing) {
      event.preventDefault();
      const cell = hitTestPointer(event.currentTarget, event);
      if (cell) musicTextController.current?.move(cell);
      return;
    }
    event.currentTarget.focus();
    clearFretDraft();

    // 技巧可能位于六线谱上方，不能先走 TAB 单元格命中。跨行技巧的所有 segment
    // 共享同一个 ID，因此点击任意续接段都会选中同一领域对象。
    const point = getLayoutPoint(event.currentTarget, event);
    const techniqueTarget =
      point && lxmLayout ? hitTestTechniqueTarget(lxmLayout, point) : null;
    if (techniqueTarget) {
      dragAnchorRef.current = null;
      activePointerIdRef.current = null;
      setSelectedTechniqueId(techniqueTarget.techniqueId);
      const techniqueSelection = document
        ? resolveTechniqueSelection(
            document,
            techniqueTarget.techniqueId,
            techniqueTarget.focusEndpoint,
          )
        : null;
      setSelection(techniqueSelection);
      setErrorMessage(
        techniqueSelection ? null : "当前技巧无法映射到可编辑的 TAB 单元格。",
      );
      return;
    }

    const target = hitTestPointer(event.currentTarget, event);

    if (!target) {
      if (!event.shiftKey) {
        setSelection(null);
        setSelectedTechniqueId(null);
      }
      setErrorMessage("请点击小节内的弦线和拍点。");
      return;
    }

    // Shift+pointerdown 延续已有 anchor；普通拖动从当前命中格建立新 anchor。
    const anchor = event.shiftKey && selection ? selection.anchor : target;
    dragAnchorRef.current = anchor;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    setSelectedTechniqueId(null);
    setSelection({ anchor, focus: target });
  };

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    if (
      activePointerIdRef.current !== event.pointerId ||
      !dragAnchorRef.current
    )
      return;
    const target = hitTestPointer(event.currentTarget, event);
    // 谱面空白不产生伪坐标，保留最后一个合法 focus。
    if (target) setSelection({ anchor: dragAnchorRef.current, focus: target });
  };

  const finishPointerDrag: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
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
    if (isTextEditingTarget(event.target)) return;

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
      musicTextEditing ||
      isTextEditingTarget(event.target) ||
      event.nativeEvent.isComposing
    )
      return;
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
    if (musicTextEditing) return;
    if (
      event.shiftKey ||
      (target instanceof Node && scoreSvgRef.current?.contains(target))
    )
      return;

    runImmediateEditorAction(() => {
      setSelection(null);
      setSelectedTechniqueId(null);
      setErrorMessage(null);
    });
  };

  if (!document || !lxmLayout)
    return (
      <p className={styles.errorMessage}>
        {errorMessage ?? "当前没有可编辑的乐谱文档。"}
      </p>
    );

  /** 顶栏每个音乐图标都有文字 aria-label，避免只靠符号传达操作含义。 */
  const rhythmButtons: {
    base: ILXMRhythm["base"];
    icon: MusicControlIcon;
    label: string;
  }[] = [
    { base: "whole", icon: "noteWhole", label: "全音符" },
    { base: "half", icon: "noteHalf", label: "二分音符" },
    { base: "quarter", icon: "noteQuarter", label: "四分音符" },
    { base: "eighth", icon: "noteEighth", label: "八分音符" },
    { base: "sixteenth", icon: "noteSixteenth", label: "十六分音符" },
    { base: "thirtySecond", icon: "noteThirtySecond", label: "三十二分音符" },
  ];

  return (
    <div className={styles.editor} onKeyDown={handleEditorKeyDown}>
      <div className={styles.editorControls}>
        <div
          className={styles.editorToolbar}
          role="toolbar"
          aria-label="节奏、小节与历史工具"
        >
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="撤销"
            disabled={!canUndo}
            onClick={() => runImmediateEditorAction(undo)}
          >
            ↶
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="重做"
            disabled={!canRedo}
            onClick={() => runImmediateEditorAction(redo)}
          >
            ↷
          </button>
          <button
            ref={sidebarToggleRef}
            type="button"
            className={styles.toolbarButton}
            aria-label="属性面板"
            aria-expanded={sidebarVisible}
            aria-controls="music-text-sidebar"
            onClick={() =>
              sidebarVisible
                ? musicTextController.current?.requestClose()
                : musicTextController.current?.requestOpenCurrent()
            }
          >
            属性面板
          </button>
          <div className={styles.protectedTools} inert={musicTextEditing}>
            <span className={styles.toolbarSeparator} aria-hidden="true" />
            {rhythmButtons.map((button) => (
              <button
                key={button.base}
                type="button"
                className={styles.toolbarButton}
                aria-label={`设置为${button.label}`}
                disabled={!canEditSingleBeat}
                onClick={() =>
                  runImmediateEditorAction(() =>
                    setActiveRhythmBase(button.base),
                  )
                }
              >
                <MusicAssetIcon
                  assetId={button.icon}
                  className={styles.toolbarIcon}
                />
              </button>
            ))}
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="取消附点"
              disabled={!canEditSingleBeat}
              onClick={() => runImmediateEditorAction(() => setActiveDots(0))}
            >
              无点
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="设置单附点"
              disabled={!canEditSingleBeat}
              onClick={() => runImmediateEditorAction(() => setActiveDots(1))}
            >
              <MusicAssetIcon
                assetId="noteDot"
                className={styles.toolbarIcon}
              />
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="设置双附点"
              disabled={!canEditSingleBeat}
              onClick={() => runImmediateEditorAction(() => setActiveDots(2))}
            >
              <MusicAssetIcon
                assetId="noteDoubleDotted"
                className={styles.toolbarIcon}
              />
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="设置为闷音音符 x"
              title="闷音音符（X）"
              disabled={!selection}
              onClick={() =>
                runImmediateEditorAction(() => setSelectedNotes("x"))
              }
            >
              x
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="将选中 Beat 设为休止并清空全部弦音符"
              title="设为休止（R）"
              disabled={!canEditBeatRange}
              onClick={() =>
                runImmediateEditorAction(() => setSelectedBeatKind("rest"))
              }
            >
              休止
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="取消选中 Beat 的休止状态"
              title="取消休止（Shift+R）"
              disabled={!canEditBeatRange}
              onClick={() =>
                runImmediateEditorAction(() => setSelectedBeatKind("notes"))
              }
            >
              恢复
            </button>
            <span className={styles.toolbarSeparator} aria-hidden="true" />
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="在当前小节后新增小节"
              disabled={!canEditSingleMeasure}
              onClick={() => runImmediateEditorAction(insertMeasureAfterActive)}
            >
              <MusicAssetIcon
                assetId="measureAdd"
                className={styles.toolbarIcon}
              />
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="复制当前小节"
              disabled={!canEditSingleMeasure}
              onClick={() => runImmediateEditorAction(copyActiveMeasure)}
            >
              <MusicAssetIcon
                assetId="actionsCopy"
                className={styles.toolbarIcon}
              />
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="删除当前小节"
              disabled={!canEditSingleMeasure}
              onClick={() => runImmediateEditorAction(removeActiveMeasure)}
            >
              <MusicAssetIcon
                assetId="measureRemove"
                className={styles.toolbarIcon}
              />
            </button>
            <span className={styles.toolbarSeparator} aria-hidden="true" />
            <label className={styles.toolbarField}>
              <span>
                拍号
                {focusedMeasureContext
                  ? `（第 ${focusedMeasureContext.measureIndex + 1} 小节）`
                  : ""}
              </span>
              <select
                className={styles.toolbarSelect}
                aria-label="设置当前焦点小节的拍号"
                disabled={!focusedMeasureContext}
                value={
                  focusedMeasureContext
                    ? formatTimeSignature(
                        focusedMeasureContext.measure.timeSignature,
                      )
                    : ""
                }
                onChange={(event) =>
                  runImmediateEditorAction(() =>
                    setFocusedMeasureTimeSignature(event.currentTarget.value),
                  )
                }
              >
                {!focusedMeasureContext && (
                  <option value="" disabled>
                    未选择小节
                  </option>
                )}
                {focusedMeasureContext &&
                  !LXM_EDITABLE_TIME_SIGNATURES.some(
                    (candidate) =>
                      formatTimeSignature(candidate) ===
                      formatTimeSignature(
                        focusedMeasureContext.measure.timeSignature,
                      ),
                  ) && (
                    // 旧文档可能含白名单外拍号：允许查看当前值，但不能由本工具再次写入。
                    <option
                      value={formatTimeSignature(
                        focusedMeasureContext.measure.timeSignature,
                      )}
                      disabled
                    >
                      {formatTimeSignature(
                        focusedMeasureContext.measure.timeSignature,
                      )}
                      （只读）
                    </option>
                  )}
                {LXM_EDITABLE_TIME_SIGNATURES.map((timeSignature) => {
                  const value = formatTimeSignature(timeSignature);
                  return (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  );
                })}
              </select>
            </label>
            <span className={styles.toolbarSeparator} aria-hidden="true" />
            <label className={styles.toolbarField}>
              <span>右边界</span>
              <select
                className={styles.toolbarSelect}
                aria-label="设置当前焦点小节的右边界"
                disabled={!focusedMeasureContext}
                value={focusedMeasureContext?.measure.barline ?? "single"}
                onChange={(event) =>
                  runImmediateEditorAction(() =>
                    setFocusedMeasureBarline(
                      event.currentTarget.value as ILXMBarlineType,
                    ),
                  )
                }
              >
                {BARLINE_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    // 谱尾没有下一小节，开始反复和双向反复在领域层也会被拒绝。
                    disabled={
                      focusedMeasureContext?.isLastMeasure &&
                      (option.value === "repeatStart" ||
                        option.value === "repeatBoth")
                    }
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="切换谱首开始反复线"
              aria-pressed={
                focusedMeasureContext?.track.startBarline === "repeatStart"
              }
              disabled={!focusedMeasureContext?.isFirstMeasure}
              onClick={() => runImmediateEditorAction(toggleTrackStartRepeat)}
            >
              谱首反复
            </button>
            <TupletToolbar
              document={document}
              selection={selection}
              execute={execute}
            />
            <TechniqueToolbar
              key={selectedTechniqueId ?? "new-technique"}
              document={document}
              selection={selection}
              selectedTechniqueId={selectedTechniqueId}
              execute={execute}
              setSelectedTechniqueId={setSelectedTechniqueId}
              setErrorMessage={setErrorMessage}
            />
          </div>
          <label>
            排版
            <select
              aria-label="谱面排版密度"
              value={density}
              onChange={(event) =>
                setDensity(event.target.value as ILXMLayoutDensity)
              }
            >
              <option value="compact">紧凑</option>
              <option value="comfortable">舒适</option>
            </select>
          </label>
          <label title="控制整张谱面的指法图显示，打印同步；隐藏不会删除指法。">
            <input
              type="checkbox"
              role="switch"
              aria-label="显示和弦指法图"
              checked={showChordDiagrams}
              onChange={(event) => setShowChordDiagrams(event.target.checked)}
            />
            显示和弦指法图
          </label>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="打印乐谱"
            onClick={() => window.print()}
          >
            打印
          </button>
        </div>
        {lxmLayout.width > A4_CONTENT_WIDTH && (
          <p role="status">
            当前谱面超过 A4 内容宽度，可横向滚动；尚不保证 A4 打印完整输出。
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
        <p className={styles.inputHint}>
          点击或拖动选择，Shift 扩展，方向键导航；输入 0–24 批量设置品位，X
          设置闷音音符， Backspace/Delete 批量删除，R 设为休止，Shift+R
          取消休止；技巧可按当前 Note、Beat
          或范围添加，点击技巧图形可更新或删除。
          {resolvedSelection && ` 已选择 ${resolvedSelection.cellCount} 格。`}
          {fretDraft && ` 正在输入：${fretDraft}`}
        </p>
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
              onPointerUp={finishPointerDrag}
              onPointerCancel={finishPointerDrag}
              onKeyDown={handleScoreKeyDown}
            >
              <defs>
                {/* 所有方向型技巧共用一个 SVG marker，路径方向由核心 layout 决定。 */}
                <marker
                  id="technique-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth={LXM_TECHNIQUE_ARROW_WIDTH}
                  markerHeight={LXM_TECHNIQUE_ARROW_HEIGHT}
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                </marker>
              </defs>
              <MusicTextLayer layout={lxmLayout} lyricFocus={lyricFocus} />
              {/* 选区层位于音乐元素下方，且永不参与指针命中。 */}
              <g className={styles.selectionLayer} pointerEvents="none">
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
              {lxmLayout.systems.map((system) => (
                <g key={system.index}>
                  {/*
                  行头先补画六根弦线，再在谱内叠加纵向 T/A/B；这样仍保留必要的
                  谱号列宽，却不会在第一小节前形成与六线谱割裂的空白块。
                */}
                  <g className={styles.systemHeaderLayer} pointerEvents="none">
                    {system.header.strings.map((string) => (
                      <line
                        key={string.index}
                        x1={string.x1}
                        y1={string.y1}
                        x2={string.x2}
                        y2={string.y2}
                        stroke="black"
                        strokeWidth={1}
                      />
                    ))}
                    {system.header.tabLetters.map((letter) => (
                      <text
                        key={letter.text}
                        className={styles.tabLabel}
                        x={letter.x}
                        y={letter.y}
                        fontSize={letter.fontSize}
                        textAnchor={letter.textAnchor}
                      >
                        {letter.text}
                      </text>
                    ))}
                    {system.header.leadingBarline &&
                      renderBarlineParts(system.header.leadingBarline)}
                  </g>
                  {system.measures.map((measure) => (
                    <g key={measure.id}>
                      <g>
                        {measure.strings.map((string) => (
                          <line
                            key={string.index}
                            x1={string.x1}
                            y1={string.y1}
                            x2={string.x2}
                            y2={string.y2}
                            stroke="black"
                            strokeWidth={1}
                          />
                        ))}
                      </g>
                      {measure.timeSignature && (
                        <g
                          className={styles.timeSignatureLayer}
                          pointerEvents="none"
                        >
                          <text
                            x={measure.timeSignature.numerator.x}
                            y={measure.timeSignature.numerator.y}
                            fontSize={measure.timeSignature.numerator.fontSize}
                            textAnchor={
                              measure.timeSignature.numerator.textAnchor
                            }
                          >
                            {measure.timeSignature.numerator.text}
                          </text>
                          <text
                            x={measure.timeSignature.denominator.x}
                            y={measure.timeSignature.denominator.y}
                            fontSize={
                              measure.timeSignature.denominator.fontSize
                            }
                            textAnchor={
                              measure.timeSignature.denominator.textAnchor
                            }
                          >
                            {measure.timeSignature.denominator.text}
                          </text>
                        </g>
                      )}
                      <g className={styles.restLayer} pointerEvents="none">
                        {measure.restMarks.map((rest) => (
                          <text
                            key={rest.id}
                            x={rest.x}
                            y={rest.y}
                            textAnchor="middle"
                          >
                            {rest.glyph}
                          </text>
                        ))}
                      </g>
                      <g>
                        {measure.notes.map((note) => (
                          <text
                            className={styles.fretNoteText}
                            key={note.id}
                            x={note.x}
                            y={note.y + LXM_FRET_TEXT_BASELINE_OFFSET_Y}
                            fontSize={LXM_FRET_TEXT_FONT_SIZE}
                            strokeWidth={LXM_FRET_TEXT_HALO_WIDTH * 2}
                          >
                            {note.fretText}
                          </text>
                        ))}
                      </g>
                      <g>{renderBarlineParts(measure.barline)}</g>
                      <g className={styles.durationLayer} pointerEvents="none">
                        {measure.durationMarks.map((mark) => (
                          <g key={mark.beatId}>
                            {mark.stemVisible && (
                              <line
                                x1={mark.stemX}
                                y1={mark.stemY1}
                                x2={mark.stemX}
                                y2={mark.stemY2}
                                stroke="black"
                                strokeWidth={1}
                              />
                            )}
                            {mark.sustainMarks.map((sustainMark) => (
                              <line
                                key={sustainMark.unitIndex}
                                x1={sustainMark.x1}
                                y1={sustainMark.y}
                                x2={sustainMark.x2}
                                y2={sustainMark.y}
                                stroke="black"
                                strokeWidth={sustainMark.thickness}
                              />
                            ))}
                            {mark.flag && (
                              <text
                                className={styles.durationGlyph}
                                x={mark.flag.x}
                                y={mark.flag.y}
                                fontSize={mark.flag.fontSize}
                              >
                                {mark.flag.glyph}
                              </text>
                            )}
                            {mark.dotAnchors.map((dot, index) => (
                              <circle
                                key={index}
                                cx={dot.x}
                                cy={dot.y}
                                r={1}
                                fill="black"
                              />
                            ))}
                          </g>
                        ))}
                      </g>
                      <g pointerEvents="none" aria-label="连音标注">
                        {measure.tuplets.map((group) => (
                          <g
                            key={group.id}
                            aria-label={`连音标注 ${group.ratio.actual}:${group.ratio.normal}`}
                          >
                            <text
                              x={group.label.x}
                              y={group.label.y}
                              fontSize={group.label.fontSize}
                              textAnchor={group.label.textAnchor}
                            >
                              {group.label.text}
                            </text>
                            {group.bracket?.lines.map((line, index) => (
                              <line
                                key={index}
                                {...line}
                                stroke="black"
                                strokeWidth={group.bracket!.strokeWidth}
                              />
                            ))}
                          </g>
                        ))}
                      </g>
                      <g pointerEvents="none">
                        {measure.beamSegments.map((segment, index) => (
                          <line
                            key={index}
                            x1={segment.x1}
                            y1={segment.y}
                            x2={segment.x2}
                            y2={segment.y}
                            stroke="black"
                            strokeWidth={segment.thickness}
                          />
                        ))}
                      </g>
                    </g>
                  ))}
                  {/* 技巧层只映射核心产出的 path/text/bounds，不在 React 内计算几何。 */}
                  <g className={styles.techniqueLayer}>
                    {system.techniques.map((technique) => (
                      <g
                        key={`${technique.techniqueId}-${technique.segmentIndex}`}
                        className={
                          technique.techniqueId === selectedTechniqueId
                            ? styles.selectedTechnique
                            : styles.techniqueSegment
                        }
                        aria-label={`技巧 ${technique.type}`}
                      >
                        <rect
                          className={styles.techniqueHitArea}
                          x={technique.bounds.x}
                          y={technique.bounds.y}
                          width={technique.bounds.width}
                          height={technique.bounds.height}
                        />
                        {technique.path && (
                          <path
                            d={technique.path.d}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={technique.path.strokeWidth}
                            strokeDasharray={technique.path.dashArray}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            markerEnd={
                              technique.path.markerEnd === "arrow"
                                ? "url(#technique-arrow)"
                                : undefined
                            }
                          />
                        )}
                        {technique.arrowHead && (
                          <polygon
                            points={technique.arrowHead.points
                              .map(([x, y]) => `${x},${y}`)
                              .join(" ")}
                            fill="currentColor"
                          />
                        )}
                        {technique.texts.map((item, index) => (
                          <text
                            key={`${item.text}-${index}`}
                            className={
                              technique.type === "naturalHarmonic"
                                ? styles.fretNoteText
                                : styles.techniqueText
                            }
                            x={item.x}
                            y={item.y}
                            fontSize={item.fontSize}
                            textAnchor={item.textAnchor}
                            fill="currentColor"
                            strokeWidth={
                              (technique.type === "naturalHarmonic"
                                ? LXM_FRET_TEXT_HALO_WIDTH
                                : LXM_TECHNIQUE_TEXT_HALO_WIDTH) * 2
                            }
                          >
                            {item.text}
                          </text>
                        ))}
                      </g>
                    ))}
                  </g>
                </g>
              ))}
            </svg>
          </main>
        </div>
        <MusicTextSidebar
          ref={musicTextController}
          visible={sidebarVisible}
          onVisibleChange={setSidebarVisible}
          onOpen={clearFretDraft}
          onEditingChange={setMusicTextEditing}
          onTargetChange={setActiveMusicTextTarget}
          onClose={returnSidebarFocus}
        />
      </div>
    </div>
  );
};
