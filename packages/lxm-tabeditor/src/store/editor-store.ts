import { create } from "zustand";
import type { EditorMode, RhythmValue, Technique } from "../core/schema";

/** 当前光标命中的拍点位置。页面用它驱动键盘输入和选区高亮。 */
export interface ActiveBeatPosition {
  /** 光标所在轨道 id。 */
  trackId: string;
  /** 光标所在小节 id。 */
  measureId: string;
  /** 光标所在拍点 id。 */
  beatId: string;
  /** 当前拍点在小节时间线中的 tick。 */
  tick: number;
  /** 当前活跃弦序号，范围 1..6。 */
  string: number;
}

export interface EditorStoreState {
  /** 当前编辑模式，决定工具栏与交互语义。 */
  mode: EditorMode;
  /** 当前被选中的音符 id 集合。 */
  selectedNoteIds: string[];
  /** 当前被选中的小节 id 集合。 */
  selectedMeasureIds: string[];
  /** 当前键盘输入和点击命中的拍点位置。 */
  activeBeat?: ActiveBeatPosition;
  /** 新写入音符默认采用的时值。 */
  currentRhythm: RhythmValue;
  /** 当前技巧工具栏选中的技巧类型。 */
  currentTechnique?: Technique["type"];
  /** 切换编辑模式。 */
  setMode: (mode: EditorMode) => void;
  /** 整体替换音符选区。 */
  setSelectedNoteIds: (ids: string[]) => void;
  /** 整体替换小节选区。 */
  setSelectedMeasureIds: (ids: string[]) => void;
  /** 更新当前活跃拍点；传空表示清空光标。 */
  setActiveBeat: (position?: ActiveBeatPosition) => void;
  /** 更新默认写入时值。 */
  setCurrentRhythm: (rhythm: RhythmValue) => void;
  /** 更新当前技巧工具。 */
  setCurrentTechnique: (technique?: Technique["type"]) => void;
  /** 重置所有临时编辑态，但不影响实际乐谱内容。 */
  resetEditorState: () => void;
}

const INITIAL_EDITOR_STATE = {
  /** 默认进入音符录入模式。 */
  mode: "note" as const,
  /** 初始无选中音符。 */
  selectedNoteIds: [] as string[],
  /** 初始无选中小节。 */
  selectedMeasureIds: [] as string[],
  /** 默认写入四分音符。 */
  currentRhythm: { base: "quarter", dots: 0 } as RhythmValue,
};

/** 临时编辑状态独立于 score store，因此不会进入 zundo 历史。 */
export const useEditorStore = create<EditorStoreState>((set) => ({
  ...INITIAL_EDITOR_STATE,
  setMode: (mode) => set({ mode }),
  setSelectedNoteIds: (selectedNoteIds) => set({ selectedNoteIds }),
  setSelectedMeasureIds: (selectedMeasureIds) => set({ selectedMeasureIds }),
  setActiveBeat: (activeBeat) => set({ activeBeat }),
  setCurrentRhythm: (currentRhythm) => set({ currentRhythm }),
  setCurrentTechnique: (currentTechnique) => set({ currentTechnique }),
  resetEditorState: () =>
    set({
      ...INITIAL_EDITOR_STATE,
      activeBeat: undefined,
      currentTechnique: undefined,
    }),
}));
