import {
  useCallback,
  useState,
  type KeyboardEventHandler,
} from "react";
import {
  createEmptyMeasure,
  GUITAR_STRING_COUNT,
  MAX_FRET,
  useEditorStore,
  useScoreStore,
  type Beat,
  type Measure,
  type RhythmValue,
  type TabNote,
  type TimeSignature,
} from "@liuxianmao/lxm-tabeditor";

const DOUBLE_DIGIT_DELAY_MS = 700;

interface FretDraft {
  value: string;
  updatedAt: number;
}

type Score = ReturnType<typeof useScoreStore.getState>["score"];
type ActiveBeat = ReturnType<typeof useEditorStore.getState>["activeBeat"];
type SetActiveBeat = ReturnType<typeof useEditorStore.getState>["setActiveBeat"];
type SetSelectedNoteIds =
  ReturnType<typeof useEditorStore.getState>["setSelectedNoteIds"];
type ExecuteCommand = ReturnType<typeof useScoreStore.getState>["executeCommand"];

interface UseScorePreviewInputOptions {
  score: Score;
  activeBeat: ActiveBeat;
  activeNote?: TabNote;
  currentRhythm: RhythmValue;
  executeCommand: ExecuteCommand;
  setActiveBeat: SetActiveBeat;
  setSelectedNoteIds: SetSelectedNoteIds;
  createGeneratedId: (prefix: string) => string;
}

/**
 * 新增小节时沿用当前上下文里“最近一次生效的拍号”。
 * 这里保留成纯函数，避免插入逻辑直接散落在 hook 主体中。
 */
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

const getActiveBeat = (score: Score, activeBeat: ActiveBeat) => {
  /*
   * activeBeat 存的是稳定 id，不存对象引用。
   * 每次执行命令前重新从 score 解析，避免 React 旧闭包持有已经被 reducer 替换的 beat。
   */
  if (!activeBeat) return undefined;
  const track = score.tracks.find((item) => item.id === activeBeat.trackId);
  const measure = track?.measures.find(
    (item) => item.id === activeBeat.measureId,
  );
  const beat = measure?.beats.find((item) =>
    activeBeat.beatId ? item.id === activeBeat.beatId : item.tick === activeBeat.tick,
  );
  return track && measure && beat ? { track, measure, beat } : undefined;
};

/**
 * 输入 hook 收口了谱面编辑最容易膨胀的几类交互：
 * - 数字/闷音输入
 * - 方向键导航
 * - 删除 / 休止符切换
 * - 在当前上下文后插入新小节
 *
 * 容器层只负责把 store 状态和命令能力传进来，不再直接承载状态机细节。
 */
export const useScorePreviewInput = ({
  score,
  activeBeat,
  activeNote,
  currentRhythm,
  executeCommand,
  setActiveBeat,
  setSelectedNoteIds,
  createGeneratedId,
}: UseScorePreviewInputOptions): {
  inputIssue?: string;
  handleKeyDown: KeyboardEventHandler<HTMLElement>;
  handleAddMeasure: () => void;
} => {
  const [fretDraft, setFretDraft] = useState<FretDraft>();
  const [inputIssue, setInputIssue] = useState<string>();

  /** 写品位时统一处理“更新已有音符”和“在空位新增音符”两条分支。 */
  const writeFret = useCallback(
    (fret: number | "x") => {
      if (!activeBeat) return;
      const context = getActiveBeat(score, activeBeat);
      // gap cursor 本身没有真实 beat，因此这里只在 beat slot 下尝试读取已有音符。
      const existingNote =
        context && activeBeat.slotKind !== "gap"
          ? getBeatNoteOnString(context.beat, activeBeat.string)
          : undefined;
      /*
       * 同拍同弦只允许一个音符。
       * 已有音符时更新品位；空位置统一走 note.add，并把 currentRhythm 传给命令层。
       * 当光标落在 beat 内部 slot 时，reducer 会据此拆分 covering beat。
       */
      if (existingNote && context) {
        executeCommand({
          type: "note.updateFret",
          payload: {
            ...activeBeat,
            beatId: context.beat.id,
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
        type: "note.add",
        payload: {
          ...activeBeat,
          rhythm: currentRhythm,
          note,
        },
      });
      setSelectedNoteIds([note.id]);
    },
    [
      activeBeat,
      createGeneratedId,
      currentRhythm,
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
      /*
       * 键盘导航按“拍点线性序列 + 弦号上下移动”处理，
       * 不依赖 DOM 焦点在具体哪一个文本节点上，避免 SVG 结构拆分后导航失效。
       */
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
        slotId: `${next.measure.id}-${next.beat.id}-slot-0`,
        slotKind: "beat",
        string: nextString,
      });
      setSelectedNoteIds(note ? [note.id] : []);
    },
    [activeBeat, score.tracks, setActiveBeat, setSelectedNoteIds],
  );

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLElement>>(
    (event) => {
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
        const context = getActiveBeat(score, activeBeat);
        if (!context) return;
        executeCommand({
          type: "note.delete",
          payload: {
            ...activeBeat,
            beatId: context.beat.id,
            noteId: activeNote.id,
          },
        });
        setSelectedNoteIds([]);
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        executeCommand({
          type: "beat.setRest",
          payload: { ...activeBeat, rhythm: currentRhythm },
        });
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
      currentRhythm,
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
    /*
     * 插入点优先跟随当前激活小节；没有选区时才落到最后一小节之后。
     * 这样按钮既可用于尾部追加，也能用于在编辑中的局部位置继续写谱。
     */
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

  return { inputIssue, handleKeyDown, handleAddMeasure };
};
