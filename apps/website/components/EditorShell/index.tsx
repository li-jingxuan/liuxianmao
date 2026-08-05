"use client";

import {
  buildLayout,
  createCollapsedTabCellSelection,
  hitTestLayout,
  layoutTabCellCaret,
  layoutTabCellSelection,
  LXMScoreCommandEnum,
  navigateTabCellSelection,
  resolveTabCellSelection,
  type ILXMHitTarget,
  type ILXMLayout,
  type ILXMRhythm,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";
import { useEditorStore } from "../../stores/editor-store";
import { MusicAssetIcon } from "../MusicAssetIcon";
import styles from "./index.module.scss";

/** A4 纸张扣除左右各 8mm 页边距后的 194mm 内容区逻辑宽度。 */
const A4_CONTENT_WIDTH = 733;
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
  (target instanceof HTMLElement && target.isContentEditable);

export const EditorShell: React.FC = () => {
  const document = useEditorStore((state) => state.document);
  const selection = useEditorStore((state) => state.selection);
  const errorMessage = useEditorStore((state) => state.errorMessage);
  const execute = useEditorStore((state) => state.execute);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setErrorMessage = useEditorStore((state) => state.setErrorMessage);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);

  /** 品位草稿是瞬时输入状态，不进入 document 或历史。 */
  const [fretDraft, setFretDraft] = useState("");
  const fretDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** drag anchor 用 ref 保存，避免 pointermove 读取到尚未提交的 React/store 状态。 */
  const dragAnchorRef = useRef<ILXMTabCellReference | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const focusCaretRef = useRef<SVGRectElement | null>(null);

  /** document 变化后重新生成 system、命中索引和所有 SVG 几何数据。 */
  const lxmLayout = useMemo<ILXMLayout | null>(() => {
    if (!document) return null;
    return buildLayout(document, {
      x: 0,
      y: 0,
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact",
    });
  }, [document]);

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
  const focusCaret = useMemo(
    () =>
      lxmLayout && selection
        ? layoutTabCellCaret(lxmLayout, selection.focus)
        : null,
    [lxmLayout, selection],
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
  const canEditSingleMeasure = selectedMeasureIds.size === 1;

  /** 组件卸载时取消延迟提交，避免异步回调写入已卸载组件。 */
  useEffect(
    () => () => {
      if (fretDraftTimerRef.current) clearTimeout(fretDraftTimerRef.current);
    },
    [],
  );

  /** selection/layout 改变后只滚动 focus caret，不滚动整个范围的左上角。 */
  useEffect(() => {
    focusCaretRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [focusCaret]);

  /** 清理当前品位草稿和对应的延时提交。 */
  const clearFretDraft = () => {
    if (fretDraftTimerRef.current) clearTimeout(fretDraftTimerRef.current);
    fretDraftTimerRef.current = null;
    setFretDraft("");
  };

  /** 将合法品位作为一条原子矩形命令提交，整个选区只产生一条历史。 */
  const setSelectedNotes = (fret: number) => {
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

  const setActiveBeatKind = (kind: "notes" | "rest") => {
    const target = getSingleBeatTarget();
    if (!target) return;
    execute({ type: LXMScoreCommandEnum.SetBeatKind, ...target, kind });
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
    const target = getSingleMeasureTarget();
    if (!target) return;
    execute({ type: LXMScoreCommandEnum.CopyMeasure, ...target });
  };

  const removeActiveMeasure = () => {
    const target = getSingleMeasureTarget();
    if (!target) return;
    execute({ type: LXMScoreCommandEnum.RemoveMeasure, ...target });
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
  const hitTestPointer = (
    svg: SVGSVGElement,
    event: Pick<React.PointerEvent<SVGSVGElement>, "clientX" | "clientY">,
  ): ILXMTabCellReference | null => {
    const matrix = svg.getScreenCTM();
    if (!matrix || !lxmLayout) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    const target = hitTestLayout(lxmLayout, { x: point.x, y: point.y });
    return target ? toCellReference(target) : null;
  };

  const handlePointerDown: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    const target = hitTestPointer(event.currentTarget, event);
    event.currentTarget.focus();
    clearFretDraft();

    if (!target) {
      if (!event.shiftKey) setSelection(null);
      setErrorMessage("请点击小节内的弦线和拍点。");
      return;
    }

    // Shift+pointerdown 延续已有 anchor；普通拖动从当前命中格建立新 anchor。
    const anchor = event.shiftKey && selection ? selection.anchor : target;
    dragAnchorRef.current = anchor;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    console.log({ anchor, focus: target })
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

  /**
   * 谱面键盘入口。
   *
   * 只有实际执行的快捷键才 preventDefault；边界处 changed:false 的方向键继续保留
   * 浏览器默认行为，符合核心导航函数的显式 no-op 契约。
   */
  const handleKeyDown: React.KeyboardEventHandler<SVGSVGElement> = (event) => {
    if (isTextEditingTarget(event.target)) return;

    const isPrimaryModifier = event.metaKey || event.ctrlKey;
    if (isPrimaryModifier && event.key.toLowerCase() === "z") {
      const shouldRedo = event.shiftKey;
      if ((shouldRedo && canRedo) || (!shouldRedo && canUndo)) {
        event.preventDefault();
        clearFretDraft();
        if (shouldRedo) redo();
        else undo();
      }
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "y") {
      if (canRedo) {
        event.preventDefault();
        clearFretDraft();
        redo();
      }
      return;
    }

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
    if (event.key === "Backspace" || event.key === "Delete") {
      if (!selection) return;
      event.preventDefault();
      clearFretDraft();
      removeSelectedNotes();
      return;
    }
    if (!/^\d$/.test(event.key) || isPrimaryModifier) return;

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

    if (fretDraftTimerRef.current) clearTimeout(fretDraftTimerRef.current);
    setFretDraft(nextDraft);
    // 0 或 3–9 不可能成为合法两位品位前缀；1、2 等待第二位数字。
    if (nextDraft.length === 2 || event.key === "0" || Number(event.key) >= 3) {
      commitFretDraft(nextDraft);
      return;
    }
    fretDraftTimerRef.current = setTimeout(
      () => commitFretDraft(nextDraft),
      FRET_DRAFT_TIMEOUT_MS,
    );
  };

  if (!document || !lxmLayout)
    return <p className={styles.errorMessage}>无法加载 MVP v4 示例乐谱。</p>;

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
    <div className={styles.editor}>
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
            onClick={undo}
          >
            ↶
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="重做"
            disabled={!canRedo}
            onClick={redo}
          >
            ↷
          </button>
          <span className={styles.toolbarSeparator} aria-hidden="true" />
          {rhythmButtons.map((button) => (
            <button
              key={button.base}
              type="button"
              className={styles.toolbarButton}
              aria-label={`设置为${button.label}`}
              disabled={!canEditSingleBeat}
              onClick={() => setActiveRhythmBase(button.base)}
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
            onClick={() => setActiveDots(0)}
          >
            无点
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="设置单附点"
            disabled={!canEditSingleBeat}
            onClick={() => setActiveDots(1)}
          >
            <MusicAssetIcon assetId="noteDot" className={styles.toolbarIcon} />
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="设置双附点"
            disabled={!canEditSingleBeat}
            onClick={() => setActiveDots(2)}
          >
            <MusicAssetIcon
              assetId="noteDoubleDotted"
              className={styles.toolbarIcon}
            />
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="设为休止"
            disabled={!canEditSingleBeat}
            onClick={() => setActiveBeatKind("rest")}
          >
            休止
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="取消休止"
            disabled={!canEditSingleBeat}
            onClick={() => setActiveBeatKind("notes")}
          >
            恢复
          </button>
          <span className={styles.toolbarSeparator} aria-hidden="true" />
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label="在当前小节后新增小节"
            disabled={!canEditSingleMeasure}
            onClick={insertMeasureAfterActive}
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
            onClick={copyActiveMeasure}
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
            onClick={removeActiveMeasure}
          >
            <MusicAssetIcon
              assetId="measureRemove"
              className={styles.toolbarIcon}
            />
          </button>
        </div>
        <p className={styles.inputHint}>
          点击或拖动选择，Shift 扩展，方向键导航；输入 0–24 批量设置品位，
          Backspace/Delete 批量删除。
          {resolvedSelection && ` 已选择 ${resolvedSelection.cellCount} 格。`}
          {fretDraft && ` 正在输入：${fretDraft}`}
        </p>
        {errorMessage && (
          <p className={styles.errorMessage} role="alert">
            {errorMessage}
          </p>
        )}
      </div>
      <div className={styles.pageViewport}>
        <main className={styles.paper} aria-label="A4 乐谱页面">
          <svg
            className={styles.scoreSvg}
            viewBox={`0 0 ${lxmLayout.width} ${lxmLayout.height}`}
            width={lxmLayout.width}
            height={lxmLayout.height}
            tabIndex={0}
            role="application"
            aria-label="六线谱编辑器"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerDrag}
            onPointerCancel={finishPointerDrag}
            onKeyDown={handleKeyDown}
          >
            {/* 选区层位于音乐元素下方，且永不参与指针命中。 */}
            <g className={styles.selectionLayer} pointerEvents="none">
              {selectionRects.map((rect) => (
                <rect
                  key={`${rect.measureId}-${rect.beatIds.join("-")}`}
                  className={styles.selectionRange}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                />
              ))}
              {focusCaret && (
                <rect
                  ref={focusCaretRef}
                  className={styles.focusCaret}
                  x={focusCaret.x}
                  y={focusCaret.y}
                  width={focusCaret.width}
                  height={focusCaret.height}
                />
              )}
            </g>
            {lxmLayout.systems.map((system) => (
              <g key={system.index}>
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
                          y={note.y + 4}
                        >
                          {note.fretText}
                        </text>
                      ))}
                    </g>
                    <g>
                      {measure.barline.parts.map((part, index) =>
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
                      )}
                    </g>
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
              </g>
            ))}
          </svg>
        </main>
      </div>
    </div>
  );
};
