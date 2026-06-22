"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
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
  layoutScore,
  MAX_FRET,
  useEditorStore,
  useScoreStore,
  useViewportStore,
  type Beat,
  type Measure,
  type RhythmValue,
  type TabNote,
  type Technique,
  type TimeSignature,
  type TupletGroup,
} from "@liuxianmao/lxm-tabeditor";
import { BRAVURA_SYMBOLS, STAFF_STRINGS } from "./editor-data";
import styles from "./EditorShell.module.scss";

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
  const currentRhythm = useEditorStore((state) => state.currentRhythm);
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

  const setCurrentBeatRhythm = useCallback(
    (rhythm: RhythmValue) => {
      if (!activeBeat) return;
      executeCommand({
        type: "beat.setRhythm",
        payload: { ...activeBeat, rhythm },
      });
    },
    [activeBeat, executeCommand],
  );

  const handleSetDots = useCallback(
    (dots: RhythmValue["dots"]) => {
      if (!activeBeat) return;
      const context = getActiveBeat(score, activeBeat);
      setCurrentBeatRhythm({
        ...(context?.beat.rhythm ?? currentRhythm),
        dots,
      });
    },
    [activeBeat, currentRhythm, score, setCurrentBeatRhythm],
  );

  const handleSetTuplet = useCallback(
    (actualNotes: TupletGroup["actualNotes"]) => {
      const track = score.tracks[0];
      if (!track || !activeBeat) return;
      const measure = track.measures.find((item) => item.id === activeBeat.measureId);
      if (!measure) return;
      const startIndex = measure.beats.findIndex(
        (beat) => beat.id === activeBeat.beatId,
      );
      const beatIds = measure.beats
        .slice(startIndex, startIndex + actualNotes)
        .map((beat) => beat.id);
      /*
       * 连音组只允许连续拍点参与。
       * 这里从当前光标向右取 actualNotes 个 beat，保证 beatIds 顺序与时间顺序一致。
       */
      if (beatIds.length !== actualNotes) {
        setInputIssue(`${actualNotes} 连音需要从当前拍点开始选择连续 ${actualNotes} 个拍点。`);
        return;
      }
      setInputIssue(undefined);
      executeCommand({
        type: "tuplet.set",
        payload: {
          trackId: track.id,
          measureId: measure.id,
          tuplet: {
            id: createGeneratedId("tuplet"),
            actualNotes,
            /*
             * schema 允许 normalNotes 为 2/3/4。
             * 五、六连音在 MVP 中先压到 4 个普通音符的时值框架里，容量是否合法由语义校验决定。
             */
            normalNotes: (actualNotes === 2
              ? 3
              : Math.min(4, actualNotes - 1)) as TupletGroup["normalNotes"],
            beatIds,
            bracket: "show",
          },
        },
      });
    },
    [activeBeat, createGeneratedId, executeCommand, score.tracks],
  );

  const handleClearTuplet = useCallback(() => {
    const track = score.tracks[0];
    if (!track || !activeBeat) return;
    const measure = track.measures.find((item) => item.id === activeBeat.measureId);
    const tuplet = measure?.tuplets.find((group) =>
      group.beatIds.includes(activeBeat.beatId),
    );
    if (!measure || !tuplet) {
      setInputIssue("当前拍点不属于连音组。");
      return;
    }
    setInputIssue(undefined);
    executeCommand({
      type: "tuplet.clear",
      payload: {
        trackId: track.id,
        measureId: measure.id,
        tupletId: tuplet.id,
      },
    });
  }, [activeBeat, executeCommand, score.tracks]);

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

  const cloneMeasureForDuplicate = useCallback(
    (measure: Measure): Measure => {
      const beatIdByOldId = new Map<string, string>();
      const noteIdByOldId = new Map<string, string>();

      const remapTechnique = (technique: Technique): Technique => {
        if (!("targetNoteId" in technique) || !technique.targetNoteId) {
          return technique;
        }
        return {
          ...technique,
          targetNoteId:
            noteIdByOldId.get(technique.targetNoteId) ?? technique.targetNoteId,
        };
      };

      /*
       * 复制小节必须重写小节、拍点、音符和局部标记 id。
       * 连音组引用的是 beatId，因此先建立旧 beatId 到新 beatId 的映射，再回填 tuplet.beatIds。
       */
      const beats = measure.beats.map((beat) => {
        const nextBeatId = createGeneratedId("beat");
        beatIdByOldId.set(beat.id, nextBeatId);
        if (beat.kind === "rest") return { ...beat, id: nextBeatId };
        const notes = beat.notes.map((note) => {
          const nextNoteId = createGeneratedId("note");
          noteIdByOldId.set(note.id, nextNoteId);
          return { ...note, id: nextNoteId };
        });
        return { ...beat, id: nextBeatId, notes };
      });
      const remappedBeats = beats.map((beat) => {
        if (beat.kind === "rest") return beat;
        return {
          ...beat,
          notes: beat.notes.map((note) => ({
            ...note,
            tie: note.tie
              ? {
                  targetNoteId:
                    noteIdByOldId.get(note.tie.targetNoteId) ??
                    note.tie.targetNoteId,
                }
              : undefined,
            techniques: note.techniques.map(remapTechnique),
          })),
        };
      });
      return {
        ...measure,
        id: createGeneratedId("measure"),
        beats: remappedBeats,
        tuplets: measure.tuplets.map((tuplet) => ({
          ...tuplet,
          id: createGeneratedId("tuplet"),
          beatIds: tuplet.beatIds.map((beatId) => beatIdByOldId.get(beatId)!),
        })),
        chordSymbols: measure.chordSymbols.map((symbol) => ({
          ...symbol,
          id: createGeneratedId("chord-symbol"),
        })),
        lyrics: measure.lyrics.map((lyric) => ({
          ...lyric,
          id: createGeneratedId("lyric"),
        })),
      };
    },
    [createGeneratedId],
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

  const handleDuplicateMeasure = useCallback(() => {
    const track = score.tracks[0];
    if (!track || !activeBeat) return;
    const measure = track.measures.find((item) => item.id === activeBeat.measureId);
    if (!measure) return;
    executeCommand({
      type: "measure.duplicate",
      payload: {
        trackId: track.id,
        measureId: measure.id,
        measure: cloneMeasureForDuplicate(measure),
      },
    });
  }, [activeBeat, cloneMeasureForDuplicate, executeCommand, score.tracks]);

  const handleDeleteMeasure = useCallback(() => {
    const track = score.tracks[0];
    if (!track || !activeBeat) return;
    executeCommand({
      type: "measure.delete",
      payload: {
        trackId: track.id,
        measureId: activeBeat.measureId,
        fallbackMeasure: createMeasureForInsert("final"),
      },
    });
    setActiveBeat(undefined);
    setSelectedNoteIds([]);
  }, [
    activeBeat,
    createMeasureForInsert,
    executeCommand,
    score.tracks,
    setActiveBeat,
    setSelectedNoteIds,
  ]);

  return (
    <main
      className={styles["canvas-panel"]}
      aria-label="乐谱编辑区域"
      onKeyDown={handleKeyDown}
      ref={panelRef}
      tabIndex={0}
    >
      <div className={styles["tempo-row"]}>
        <span className={`${styles["tempo-note"]} ${styles["music-icon"]}`}>
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
                <g
                  className={styles["measure-svg"]}
                  key={measure.id}
                  aria-label={`第 ${measure.number} 小节`}
                >
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
                  {measure.rests.map((rest) => (
                    <g key={rest.id}>
                      <text
                        className={`${styles["rest-svg"]} ${styles["music-icon"]}`}
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
                  {measure.tuplets.map((tuplet) => (
                    <g className={styles["tuplet-svg"]} key={tuplet.id}>
                      <path
                        d={`M ${tuplet.x1} ${tuplet.y} L ${tuplet.x1} ${
                          tuplet.y - 8
                        } L ${tuplet.x2} ${tuplet.y - 8} L ${tuplet.x2} ${
                          tuplet.y
                        }`}
                      />
                      <text x={(tuplet.x1 + tuplet.x2) / 2} y={tuplet.y - 12}>
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

      <div className={styles["measure-actions"]}>
        <button
          className={styles["add-measure-button"]}
          onClick={handleAddMeasure}
          type="button"
        >
          <Plus aria-hidden="true" size={15} /> 添加小节
        </button>
        <button
          className={styles["add-measure-button"]}
          disabled={!activeBeat}
          onClick={handleDuplicateMeasure}
          type="button"
        >
          <Copy aria-hidden="true" size={15} /> 复制小节
        </button>
        <button
          className={styles["add-measure-button"]}
          disabled={!activeBeat}
          onClick={handleDeleteMeasure}
          type="button"
        >
          <Trash2 aria-hidden="true" size={15} /> 删除小节
        </button>
        <button
          className={styles["add-measure-button"]}
          disabled={!activeBeat}
          onClick={() => setCurrentBeatRhythm(currentRhythm)}
          type="button"
        >
          应用当前时值
        </button>
        <button
          className={styles["add-measure-button"]}
          disabled={!activeBeat}
          onClick={() => handleSetDots(1)}
          type="button"
        >
          附点
        </button>
        <button
          className={styles["add-measure-button"]}
          disabled={!activeBeat}
          onClick={() => handleSetDots(2)}
          type="button"
        >
          双附点
        </button>
        <button
          className={styles["add-measure-button"]}
          disabled={!activeBeat}
          onClick={() => handleSetDots(0)}
          type="button"
        >
          取消附点
        </button>
        {([2, 3, 4, 5, 6] as const).map((actualNotes) => (
          <button
            className={styles["add-measure-button"]}
            disabled={!activeBeat}
            key={actualNotes}
            onClick={() => handleSetTuplet(actualNotes)}
            type="button"
          >
            {actualNotes}连音
          </button>
        ))}
        <button
          className={styles["add-measure-button"]}
          disabled={!activeBeat}
          onClick={handleClearTuplet}
          type="button"
        >
          取消连音
        </button>
      </div>
    </main>
  );
};
