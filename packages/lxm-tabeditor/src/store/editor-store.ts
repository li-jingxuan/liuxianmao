import { create } from "zustand";
import type { EditorMode, RhythmValue, Technique } from "../core/schema";

export interface ActiveBeatPosition {
  measureId: string;
  tick: number;
  string: number;
}

export interface EditorStoreState {
  mode: EditorMode;
  selectedNoteIds: string[];
  selectedMeasureIds: string[];
  activeBeat?: ActiveBeatPosition;
  currentRhythm: RhythmValue;
  currentTechnique?: Technique["type"];
  setMode: (mode: EditorMode) => void;
  setSelectedNoteIds: (ids: string[]) => void;
  setSelectedMeasureIds: (ids: string[]) => void;
  setActiveBeat: (position?: ActiveBeatPosition) => void;
  setCurrentRhythm: (rhythm: RhythmValue) => void;
  setCurrentTechnique: (technique?: Technique["type"]) => void;
  resetEditorState: () => void;
}

const INITIAL_EDITOR_STATE = {
  mode: "note" as const,
  selectedNoteIds: [] as string[],
  selectedMeasureIds: [] as string[],
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
