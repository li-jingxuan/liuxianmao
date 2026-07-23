"use client";

import {
  applyScoreCommand,
  buildLayout,
  EXAMPLE,
  hitTestLayout,
  loadDocument,
  LXMScoreCommandEnum,
  type ILXMDocument,
  type ILXMHitTarget,
  type ILXMLayout,
} from "@liuxianmao/lxm-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./index.module.scss";

/** MVP v2 固定每行四个普通小节；后续可由编辑器视口状态替换。 */
const MVP_V2_SYSTEM_WIDTH = 345 * 4;
/** 两位品位输入等待第二个数字的时间，超时后提交一位品位。 */
const FRET_DRAFT_TIMEOUT_MS = 600;

/** 从规范 fixture 加载初始文档，失败时返回 null 供页面显示错误状态。 */
const loadInitialDocument = (): ILXMDocument | null => {
  const result = loadDocument(JSON.stringify(EXAMPLE.EXAMPLE_MVP_1.default));
  // const result = loadDocument(JSON.stringify(EXAMPLE.EXAMPLE_MVP_2.default));
  console.log(result);
  return result.ok ? result.document : null;
};

export const EditorShell: React.FC = () => {
  /** 持久化乐谱状态；所有更新都通过 applyScoreCommand 产生。 */
  const [document, setDocument] = useState<ILXMDocument | null>(
    loadInitialDocument,
  );
  /** 临时光标不写入 ILXMDocument，也不会影响后续撤销历史。 */
  const [activeCursor, setActiveCursor] = useState<ILXMHitTarget | null>(null);
  /** 品位数字草稿用于把连续输入的 1 + 2 合并为一次 12 品命令。 */
  const [fretDraft, setFretDraft] = useState("");
  /** 命令和输入错误展示在编辑器附近，便于用户理解未生效原因。 */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fretDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** document 变化后重新生成 system、命中索引和所有 SVG 几何数据。 */
  const lxmLayout = useMemo<ILXMLayout | null>(() => {
    if (!document) return null;

    return buildLayout(document, {
      x: 0,
      y: 0,
      systemWidth: MVP_V2_SYSTEM_WIDTH,
    });
  }, [document]);

  console.log(lxmLayout)
  /** 组件卸载时取消延迟提交，避免异步回调写入已卸载组件。 */
  useEffect(
    () => () => {
      if (fretDraftTimerRef.current) clearTimeout(fretDraftTimerRef.current);
    },
    [],
  );

  /** 清理当前品位草稿和对应的延时提交。 */
  const clearFretDraft = () => {
    if (fretDraftTimerRef.current) clearTimeout(fretDraftTimerRef.current);
    fretDraftTimerRef.current = null;
    setFretDraft("");
  };

  /** 将一个合法数值品位写入当前光标位置。 */
  const setActiveNote = (fret: number) => {
    if (!document || !activeCursor) {
      setErrorMessage("请先点击谱面中的弦和拍点，再输入品位。");
      return;
    }

    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetNote,
      ...activeCursor,
      fret,
    });
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    setDocument(result.document);
    setErrorMessage(null);
  };

  /** 删除当前光标弦上的音符；重复删除由核心命令安全地处理为 no-op。 */
  const removeActiveNote = () => {
    if (!document || !activeCursor) {
      setErrorMessage("请先点击谱面中的弦和拍点，再删除音符。");
      return;
    }

    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.RemoveNote,
      ...activeCursor,
    });
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    setDocument(result.document);
    setErrorMessage(null);
  };

  /** 将草稿转换为品位并交给命令层；非法草稿不会修改文档。 */
  const commitFretDraft = (draft: string) => {
    clearFretDraft();
    if (draft.length === 0) return;

    const fret = Number(draft);
    if (!Number.isInteger(fret) || fret < 0 || fret > 24) {
      setErrorMessage("品位必须在 0 到 24 之间。");
      return;
    }

    setActiveNote(fret);
  };

  /**
   * 将浏览器 client 坐标转换为 SVG viewBox 逻辑坐标。
   * 不能直接使用 offsetX/offsetY，因为 SVG 在缩放或滚动后两者不再等价。
   */
  const handlePointerDown: React.PointerEventHandler<SVGSVGElement> = (
    event,
  ) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix || !lxmLayout) return;

    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    const target = hitTestLayout(lxmLayout, { x: point.x, y: point.y });

    event.currentTarget.focus();
    clearFretDraft();
    setActiveCursor(target);
    setErrorMessage(target ? null : "请点击小节内的弦线和拍点。");
  };

  /** 处理数字品位、删除和取消草稿等 MVP v2 最小键盘操作。 */
  const handleKeyDown: React.KeyboardEventHandler<SVGSVGElement> = (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;

    // 取消
    if (event.key === "Escape") {
      event.preventDefault();
      clearFretDraft();
      setErrorMessage(null);
      return;
    }
    // 删除
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      clearFretDraft();
      removeActiveNote();
      return;
    }
    if (!/^\d$/.test(event.key)) return;

    event.preventDefault();
    if (!activeCursor) {
      setErrorMessage("请先点击谱面中的弦和拍点，再输入品位。");
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
    // 0 或 3–9 不能组成合法两位品位；1、2 留出输入 10–24 的窗口。
    if (nextDraft.length === 2 || event.key === "0" || Number(event.key) >= 3) {
      commitFretDraft(nextDraft);
      return;
    }
    fretDraftTimerRef.current = setTimeout(
      () => commitFretDraft(nextDraft),
      FRET_DRAFT_TIMEOUT_MS,
    );
  };

  if (!lxmLayout)
    return <p className={styles.errorMessage}>无法加载 MVP v2 示例乐谱。</p>;

  const activeMeasure = activeCursor
    ? lxmLayout.systems
        .flatMap((system) => system.measures)
        .find((measure) => measure.id === activeCursor.measureId)
    : undefined;
  const activeBeat = activeMeasure?.beats.find(
    (beat) => beat.id === activeCursor?.beatId,
  );
  const activeString = activeMeasure?.strings.find(
    (string) => string.index === activeCursor?.string,
  );
  // const firstString = activeMeasure?.strings[0];
  // const lastString = activeMeasure?.strings[activeMeasure.strings.length - 1];

  return (
    <div className={styles.editor}>
      <p className={styles.inputHint}>
        点击弦线和拍点后输入 0–24；Backspace/Delete 删除当前弦音符。
        {fretDraft && ` 正在输入：${fretDraft}`}
      </p>
      {errorMessage && (
        <p className={styles.errorMessage} role="alert">
          {errorMessage}
        </p>
      )}
      <svg
        className={styles.scoreSvg}
        viewBox={`0 0 ${lxmLayout.width} ${lxmLayout.height}`}
        width={lxmLayout.width}
        height={lxmLayout.height}
        tabIndex={0}
        role="application"
        aria-label="六线谱编辑器"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        {activeMeasure &&
          activeBeat &&
          activeString && (
            <g className={styles.cursorLayer} pointerEvents="none">
              <rect
                className={styles.activeCursor}
                x={activeBeat.x - 11}
                y={activeString.y1 - 9.5}
                width={22}
                height={18}
              />
            </g>
          )}
        {lxmLayout.systems.map((system) => (
          <g key={system.index}>
            {system.measures.map((measure) => (
              <g key={measure.id}>
                <g>
                  {/* 绘制六条弦线；相邻小节直接相接，不额外插入外部间距。 */}
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
                <g>
                  {/* 品位数字使用 layout 给出的坐标；页面层不重新计算其位置。 */}
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
                  {/* 小节线由单小节 layout 决定类型与坐标。 */}
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
                <g>
                  {/* 删除最后一个音符后，对应的符干与附点会随最新 layout 自动消失。 */}
                  {measure.durationMarks.map((mark) => (
                    <g key={mark.beatId}>
                      <line
                        x1={mark.stemX}
                        y1={mark.stemY1}
                        x2={mark.stemX}
                        y2={mark.stemY2}
                        stroke="black"
                        strokeWidth={1}
                      />
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
                <g>
                  {/* 连梁段已在核心包完成分组，页面只负责绘制。 */}
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
    </div>
  );
};
