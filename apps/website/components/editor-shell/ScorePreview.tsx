"use client";

import { Plus } from "lucide-react";
import type React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  createEmptyMeasure,
  GUITAR_STRING_COUNT,
  hitTestScoreLayout,
  isLaidOutPartialBeam,
  isLaidOutSharedBeam,
  layoutScore,
  MAX_FRET,
  useEditorStore,
  useScoreStore,
  useViewportStore,
  type Beat,
  type Measure,
  type TabNote,
  type TimeSignature,
} from "@liuxianmao/lxm-tabeditor";
import { BRAVURA_SYMBOLS, STAFF_STRINGS } from "./editor-data";
import sharedStyles from "./shared.module.scss";
import styles from "./ScorePreview.module.scss";

const DOUBLE_DIGIT_DELAY_MS = 700;

interface FretDraft {
  value: string;
  updatedAt: number;
}

const getActiveMeasureTimeSignature = (
  measures: Measure[],
  measureIndex: number,
  fallback: TimeSignature = { numerator: 4, denominator: 4 },
) => {
  let active = fallback;
  for (let index = 0; index <= measureIndex; index += 1) {
    const timeSignature = measures[index]?.timeSignature;
    if (timeSignature) active = timeSignature;
  }
  return active;
};

const getBeatNoteOnString = (
  beat: Beat | undefined,
  string: number,
): TabNote | undefined =>
  beat?.kind === "notes"
    ? beat.notes.find((note) => note.string === string)
    : undefined;

const getActiveBeat = (
  score: ReturnType<typeof useScoreStore.getState>["score"],
  activeBeat: ReturnType<typeof useEditorStore.getState>["activeBeat"],
) => {
  /*
   * activeBeat 存的是稳定 id，不存对象引用。
   * 每次执行命令前重新从 score 解析，避免 React 旧闭包持有已经被 reducer 替换的 beat。
   */
  if (!activeBeat) return undefined;
  const track = score.tracks.find((item) => item.id === activeBeat.trackId);
  const measure = track?.measures.find(
    (item) => item.id === activeBeat.measureId,
  );
  const beat = measure?.beats.find((item) => item.id === activeBeat.beatId);
  return track && measure && beat ? { track, measure, beat } : undefined;
};

/**
 * Bravura 只用于 SMuFL 音乐符号。这里显式探测字体加载状态，
 * 避免字体失败时用户看到私用区乱码却没有任何提示。
 */
const useBravuraFontStatus = (): "loading" | "ready" | "failed" => {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    if (!("fonts" in document)) {
      queueMicrotask(() => setStatus("failed"));
      return;
    }

    let mounted = true;
    document.fonts
      .load("16px Bravura")
      .then((fonts) => {
        if (!mounted) return;
        setStatus(fonts.length > 0 ? "ready" : "failed");
      })
      .catch(() => {
        if (mounted) setStatus("failed");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return status;
};

export const ScorePreview: React.FC = () => {
  const panelRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const generatedIdRef = useRef(0);
  const score = useScoreStore((state) => state.score);
  const lastCommandIssues = useScoreStore((state) => state.lastCommandIssues);
  const executeCommand = useScoreStore((state) => state.executeCommand);
  const zoom = useViewportStore((state) => state.zoom);
  const activeBeat = useEditorStore((state) => state.activeBeat);
  const setActiveBeat = useEditorStore((state) => state.setActiveBeat);
  const setSelectedNoteIds = useEditorStore((state) => state.setSelectedNoteIds);
  const fontStatus = useBravuraFontStatus();
  const [fretDraft, setFretDraft] = useState<FretDraft>();
  const [inputIssue, setInputIssue] = useState<string>();
  const layout = useMemo(
    () =>
      /**
       * MVP 固定按 720p 桌面基线排版，页面层不再把容器宽度传入 layout。
       * 这样只读谱面的换行结果稳定，后续编辑命中索引不会因为窗口变化而漂移。
       */
      layoutScore(score, {
        zoom,
      }),
    [score, zoom],
  );

  const activeContext = getActiveBeat(score, activeBeat);
  const activeNote = getBeatNoteOnString(
    activeContext?.beat,
    activeBeat?.string ?? 1,
  );

  const createGeneratedId = useCallback((prefix: string) => {
    generatedIdRef.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${generatedIdRef.current}`;
  }, []);

  /**
   * 指针命中分两步完成：
   * 1. DOM client 坐标按 SVG 当前渲染尺寸反算回 viewBox 坐标；
   * 2. layout 层根据小节 bounds、拍点 x 和弦线 y 找到最近编辑位置。
   */
  const handlePointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      const track = score.tracks[0];
      if (!svg || !track) return;
      const rect = svg.getBoundingClientRect();
      const point = {
        x: ((event.clientX - rect.left) / rect.width) * layout.width,
        y: ((event.clientY - rect.top) / rect.height) * layout.height,
      };
      const hit = hitTestScoreLayout(layout, point);
      if (!hit) return;
      const nextActiveBeat = { trackId: track.id, ...hit };
      const beat = track.measures
        .find((measure) => measure.id === hit.measureId)
        ?.beats.find((item) => item.id === hit.beatId);
      const note = getBeatNoteOnString(beat, hit.string);
      setActiveBeat(nextActiveBeat);
      setSelectedNoteIds(note ? [note.id] : []);
      panelRef.current?.focus();
    },
    [layout, score.tracks, setActiveBeat, setSelectedNoteIds],
  );

  const writeFret = useCallback(
    (fret: number | "x") => {
      if (!activeBeat) return;
      const context = getActiveBeat(score, activeBeat);
      if (!context) return;
      const existingNote = getBeatNoteOnString(context.beat, activeBeat.string);
      /*
       * 同拍同弦只允许一个音符。
       * 已有音符时更新品位；空位置则根据 beat.kind 选择 clearRest 或 note.add。
       */
      if (existingNote) {
        executeCommand({
          type: "note.updateFret",
          payload: {
            ...activeBeat,
            noteId: existingNote.id,
            fret,
          },
        });
        setSelectedNoteIds([existingNote.id]);
        return;
      }
      const note: TabNote = {
        id: createGeneratedId("note"),
        string: activeBeat.string,
        fret,
        techniques: [],
      };
      executeCommand({
        type: context.beat.kind === "rest" ? "beat.clearRest" : "note.add",
        payload: {
          ...activeBeat,
          note,
        },
      });
      setSelectedNoteIds([note.id]);
    },
    [
      activeBeat,
      createGeneratedId,
      executeCommand,
      score,
      setSelectedNoteIds,
    ],
  );

  const moveActiveBeat = useCallback(
    (direction: "left" | "right" | "up" | "down") => {
      if (!activeBeat) return;
      const track = score.tracks.find((item) => item.id === activeBeat.trackId);
      if (!track) return;
      const allBeats = track.measures.flatMap((measure) =>
        measure.beats.map((beat) => ({ measure, beat })),
      );
      const currentIndex = allBeats.findIndex(
        (item) =>
          item.measure.id === activeBeat.measureId &&
          item.beat.id === activeBeat.beatId,
      );
      if (currentIndex < 0) return;
      const nextString =
        direction === "up"
          ? Math.max(1, activeBeat.string - 1)
          : direction === "down"
            ? Math.min(GUITAR_STRING_COUNT, activeBeat.string + 1)
            : activeBeat.string;
      const nextIndex =
        direction === "left"
          ? Math.max(0, currentIndex - 1)
          : direction === "right"
            ? Math.min(allBeats.length - 1, currentIndex + 1)
            : currentIndex;
      const next = allBeats[nextIndex];
      if (!next) return;
      const note = getBeatNoteOnString(next.beat, nextString);
      setActiveBeat({
        trackId: track.id,
        measureId: next.measure.id,
        beatId: next.beat.id,
        tick: next.beat.tick,
        string: nextString,
      });
      setSelectedNoteIds(note ? [note.id] : []);
    },
    [activeBeat, score.tracks, setActiveBeat, setSelectedNoteIds],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!activeBeat) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        const now = Date.now();
        /*
         * 两位品位不是等用户按回车确认，而是在短时间窗口内合并两次数字输入。
         * 例如先按 1 再按 2，会先写入 1，再在 700ms 内覆盖成 12。
         */
        const nextValue =
          fretDraft && now - fretDraft.updatedAt <= DOUBLE_DIGIT_DELAY_MS
            ? `${fretDraft.value}${event.key}`
            : event.key;
        const fret = Number(nextValue);
        if (Number.isInteger(fret) && fret <= MAX_FRET) {
          setInputIssue(undefined);
          writeFret(fret);
          setFretDraft({ value: nextValue, updatedAt: now });
        } else {
          setInputIssue(`品位必须在 0 至 ${MAX_FRET} 之间。`);
        }
        return;
      }
      if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        setFretDraft(undefined);
        writeFret("x");
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        setFretDraft(undefined);
        if (!activeNote) return;
        executeCommand({
          type: "note.delete",
          payload: {
            ...activeBeat,
            noteId: activeNote.id,
          },
        });
        setSelectedNoteIds([]);
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        executeCommand({ type: "beat.setRest", payload: activeBeat });
        setSelectedNoteIds([]);
        return;
      }
      const directionByKey = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      } as const;
      const direction =
        directionByKey[event.key as keyof typeof directionByKey];
      if (direction) {
        event.preventDefault();
        setFretDraft(undefined);
        moveActiveBeat(direction);
      }
    },
    [
      activeBeat,
      activeNote,
      executeCommand,
      fretDraft,
      moveActiveBeat,
      setSelectedNoteIds,
      writeFret,
    ],
  );

  const createMeasureForInsert = useCallback(
    (barline?: Measure["barline"]) => {
      const track = score.tracks[0];
      const measures = track?.measures ?? [];
      const activeIndex = activeBeat
        ? measures.findIndex((measure) => measure.id === activeBeat.measureId)
        : measures.length - 1;
      const sourceIndex = activeIndex >= 0 ? activeIndex : measures.length - 1;
      return createEmptyMeasure({
        id: createGeneratedId("measure"),
        beatIdPrefix: createGeneratedId("beat"),
        timeSignature: getActiveMeasureTimeSignature(
          measures,
          Math.max(0, sourceIndex),
          score.meta.timeSignature,
        ),
        barline,
      });
    },
    [activeBeat, createGeneratedId, score.meta.timeSignature, score.tracks],
  );

  const handleAddMeasure = useCallback(() => {
    const track = score.tracks[0];
    if (!track) return;
    const afterMeasureId = activeBeat?.measureId ?? track.measures.at(-1)?.id;
    executeCommand({
      type: "measure.add",
      payload: {
        trackId: track.id,
        afterMeasureId,
        measure: createMeasureForInsert("final"),
      },
    });
  }, [activeBeat, createMeasureForInsert, executeCommand, score.tracks]);

  return (
    <main
      className={styles["canvas-panel"]}
      aria-label="乐谱编辑区域"
      onKeyDown={handleKeyDown}
      ref={panelRef}
      tabIndex={0}
    >
      <div className={styles["tempo-row"]}>
        <span className={`${styles["tempo-note"]} ${sharedStyles["music-icon"]}`}>
          {BRAVURA_SYMBOLS.noteQuarter}
        </span>
        <span>= {layout.tempo}</span>
      </div>
      {fontStatus === "failed" ? (
        <p className={styles["font-warning"]}>
          Bravura 字体加载失败，休止符等音乐符号可能显示异常。
        </p>
      ) : null}
      {inputIssue || lastCommandIssues.length > 0 ? (
        <div className={styles["command-issues"]} role="status">
          {inputIssue ?? lastCommandIssues[0]?.message}
        </div>
      ) : null}

      <div className={styles["score-sheet"]}>
        <svg
          className={styles["score-svg"]}
          onPointerDown={handlePointerDown}
          ref={svgRef}
          role="img"
          aria-label={score.title}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width * layout.zoom}
          height={layout.height * layout.zoom}
        >
          {layout.systems.map((system) => (
            /*
             * layout 已经产出绝对 SVG 坐标，React 层只消费坐标结果。
             * 这里不再做额外 transform，避免命中坐标和实际绘制位置产生偏移。
             */
            <g key={system.index}>
              <text className={styles["tab-prefix-svg"]} x={18} y={58}>
                <tspan x={18} dy={0}>
                  T
                </tspan>
                <tspan x={18} dy={18}>
                  A
                </tspan>
                <tspan x={18} dy={18}>
                  B
                </tspan>
              </text>
              {system.measures.map((measure) => (
                <g key={measure.id} aria-label={`第 ${measure.number} 小节`}>
                  {/* TODO 这里到时候放和弦图 */}
                  <text
                    className={styles["measure-number-svg"]}
                    x={measure.x + measure.width / 2}
                    y={measure.y + 18}
                  >
                    {measure.number} 
                  </text>
                  {measure.showTimeSignature ? (
                    <text
                      className={styles["time-signature-svg"]}
                      x={measure.x - 28}
                      y={measure.y + measure.staffTop + 15}
                    >
                      <tspan x={measure.x - 28} dy={0}>
                        {measure.timeSignature.numerator}
                      </tspan>
                      <tspan x={measure.x - 28} dy={22}>
                        {measure.timeSignature.denominator}
                      </tspan>
                    </text>
                  ) : null}
                  {/* 弦 部分 */}
                  {STAFF_STRINGS.map((stringIndex) => (
                    <line
                      className={styles["staff-line-svg"]}
                      key={`${measure.id}-${stringIndex}`}
                      x1={measure.x}
                      x2={measure.x + measure.width}
                      y1={
                        measure.y +
                        measure.staffTop +
                        (stringIndex - 1) * measure.stringSpacing
                      }
                      y2={
                        measure.y +
                        measure.staffTop +
                        (stringIndex - 1) * measure.stringSpacing
                      }
                    />
                  ))}
                  
                  {/* 激活输入框部分 */}
                  {activeBeat?.measureId === measure.id ? (
                    <rect
                      className={styles["active-cell-svg"]}
                      x={
                        (measure.beats.find(
                          (beat) => beat.id === activeBeat.beatId,
                        )?.x ?? measure.x) - 13
                      }
                      y={
                        measure.y +
                        measure.staffTop +
                        (activeBeat.string - 1) * measure.stringSpacing -
                        9
                      }
                      width={26}
                      height={18}
                      rx={5}
                    />
                  ) : null}

                  {/* 小节部分 */}
                  <line
                    className={styles["barline-svg"]}
                    x1={measure.x}
                    x2={measure.x}
                    y1={measure.y + measure.staffTop}
                    y2={measure.y + measure.staffTop + measure.staffHeight}
                  />
                  <line
                    className={
                      measure.barline === "final"
                        ? `${styles["barline-svg"]} ${styles["barline-final-svg"]}`
                        : styles["barline-svg"]
                    }
                    x1={measure.x + measure.width}
                    x2={measure.x + measure.width}
                    y1={measure.y + measure.staffTop}
                    y2={measure.y + measure.staffTop + measure.staffHeight}
                  />

                  {/* 音符时值部分：直接消费 layout 层产出的几何，不在 React 里重复排版。 */}
                  {measure.beamSegments.map((beamSegment) => {
                    const key = isLaidOutSharedBeam(beamSegment)
                      ? `${measure.id}-beam-shared-${beamSegment.level}-${beamSegment.beatIds.join("-")}`
                      : `${measure.id}-beam-partial-${beamSegment.beatId}-${beamSegment.level}`;

                    return (
                      <rect
                        className={styles["duration-beam-svg"]}
                        height={2}
                        key={key}
                        width={Math.max(0, beamSegment.x2 - beamSegment.x1)}
                        x={beamSegment.x1}
                        y={beamSegment.y - 1.2}
                      />
                    );
                  })}
                  
                  {/* 竖线部分 */}
                  {measure.durationMarks.map((mark) => {
                    const coveredBeamLevels = new Set(
                      measure.beamSegments
                        .filter(
                          (beamSegment) =>
                            (isLaidOutSharedBeam(beamSegment) &&
                              beamSegment.beatIds.includes(mark.beatId)) ||
                            (isLaidOutPartialBeam(beamSegment) &&
                              beamSegment.beatId === mark.beatId),
                        )
                        .map((beamSegment) => beamSegment.level),
                    );

                    return (
                      <g key={`${measure.id}-duration-${mark.beatId}`}>
                        {mark.hasStem ? (
                          <line
                            className={styles["duration-stem-svg"]}
                            x1={mark.stemX}
                            x2={mark.stemX}
                            y1={mark.stemTopY}
                            y2={mark.stemBottomY}
                          />
                        ) : null}
                        
                        {/* 音符尾巴部分 */}
                        {Array.from({ length: mark.flagCount }, (_, index) => {
                          const level = (index + 1) as 1 | 2 | 3;
                          if (coveredBeamLevels.has(level)) return null;
                          const flagY = mark.stemBaseY - index * 4;
                          return (
                            <path
                              className={styles["duration-flag-svg"]}
                              d={`
                                M ${mark.stemX} ${flagY}
                                Q ${mark.stemX + 4} ${flagY - 2} ${mark.stemX + 8} ${flagY - 6}
                                Q ${mark.stemX + 8.5} ${flagY - 8} ${mark.stemX + 8} ${flagY - 10}
                              `}
                              key={`${mark.beatId}-flag-${level}`}
                            />
                          );
                        })}
                        {/* 附点部分 */}
                        {mark.dots > 0 ? (
                          <text
                            className={styles["duration-dots-svg"]}
                            x={mark.x + 12}
                            y={mark.stemBaseY - 6}
                          >
                            {".".repeat(mark.dots)}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}

                  {/* 音符部分 */}
                  {measure.notes.map((note) => (
                    <g key={note.id}>
                      {note.tied ? (
                        <path
                          className={styles["tie-svg"]}
                          d={`M ${note.x - 14} ${note.y - 11} Q ${note.x} ${
                            note.y - 22
                          } ${note.x + 14} ${note.y - 11}`}
                        />
                      ) : null}
                      <text
                        className={
                          note.id === activeNote?.id
                            ? `${styles["fret-note-svg"]} ${styles["active-note-svg"]}`
                            : note.ghost
                              ? `${styles["fret-note-svg"]} ${styles["ghost-note-svg"]}`
                              : styles["fret-note-svg"]
                        }
                        x={note.x}
                        y={note.y + 4}
                      >
                        {note.fret}
                      </text>
                    </g>
                  ))}

                  {/* 目前只有休止符部分 */}  
                  {measure.rests.map((rest) => (
                    <g key={rest.id}>
                      <text
                        className={`${styles["rest-svg"]} ${sharedStyles["music-icon"]}`}
                        x={rest.x}
                        y={rest.y + 8}
                      >
                        {rest.symbol}
                      </text>
                      {rest.rhythm.dots > 0 ? (
                        <text
                          className={styles["duration-dots-svg"]}
                          x={rest.x + 15}
                          y={rest.y + 2}
                        >
                          {".".repeat(rest.rhythm.dots)}
                        </text>
                      ) : null}
                    </g>
                  ))}
                  
                  {/* 连音括号部分 */}
                  {measure.tuplets.map((tuplet) => (
                    <g className={styles["tuplet-svg"]} key={tuplet.id}>
                      <path
                        d={`
                          M ${tuplet.x1} ${tuplet.y}
                          L ${tuplet.x1} ${tuplet.y + 4}
                          L ${tuplet.x2} ${tuplet.y + 4}
                          L ${tuplet.x2} ${tuplet.y}`
                        }
                      />
                      <text x={(tuplet.x1 + tuplet.x2) / 2} y={tuplet.y + 15}>
                        {tuplet.number}
                      </text>
                    </g>
                  ))}
                </g>
              ))}
            </g>
          ))}
        </svg>
      </div>

      <div className={styles["score-add-measure-row"]}>
        <button
          className={`${styles["add-measure-button"]} ${styles["score-add-measure-button"]}`}
          onClick={handleAddMeasure}
          type="button"
        >
          <Plus aria-hidden="true" size={15} /> 添加小节
        </button>
      </div>
    </main>
  );
};
