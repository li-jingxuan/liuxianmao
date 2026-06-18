import { create } from "zustand";
import { temporal } from "zundo";
import { HISTORY_LIMIT } from "../core/constants";
import type { LxmScoreDocument, Score } from "../core/schema";
import { createEmptyScore } from "../core/score-factory";
import type { ValidationIssue } from "../core/validation-types";
import {
  reduceScoreCommand,
  reduceScoreTransaction,
} from "../commands/score-command-reducer";
import type { CommandResult, ScoreCommand } from "../commands/command-types";

export interface ScoreStoreState {
  score: Score;
  documentRevision: number;
  lastCommandIssues: ValidationIssue[];
  executeCommand: (command: ScoreCommand) => CommandResult<Score>;
  executeTransaction: (commands: ScoreCommand[]) => CommandResult<Score>;
  loadDocument: (document: LxmScoreDocument) => void;
}

/**
 * 乐谱唯一写入入口。partialize 只返回 score，修订号和错误提示不会污染撤销历史。
 */
export const useScoreStore = create<ScoreStoreState>()(
  temporal<ScoreStoreState, [], [], Pick<ScoreStoreState, "score">>(
    (set, get) => ({
      score: createEmptyScore(),
      documentRevision: 0,
      lastCommandIssues: [],
      executeCommand: (command) => {
        const result = reduceScoreCommand(get().score, command);
        if (!result.ok) {
          set({ lastCommandIssues: result.issues });
          return result;
        }
        set({ score: result.value, lastCommandIssues: [] });
        return result;
      },
      executeTransaction: (commands) => {
        // 事务先在内存中完成，成功后只调用一次 set，因此只产生一个历史快照。
        const result = reduceScoreTransaction(get().score, commands);
        if (!result.ok) {
          set({ lastCommandIssues: result.issues });
          return result;
        }
        set({ score: result.value, lastCommandIssues: [] });
        return result;
      },
      loadDocument: (document) => {
        set({
          score: document.score,
          documentRevision: document.documentRevision,
          lastCommandIssues: [],
        });
        // 新文档不能撤销回上一份文档。
        useScoreStore.temporal.getState().clear();
      },
    }),
    {
      limit: HISTORY_LIMIT,
      partialize: (state) => ({ score: state.score }),
      equality: (pastState, currentState) =>
        pastState.score === currentState.score,
    },
  ),
);

export const undoScore = (): void => useScoreStore.temporal.getState().undo();
export const redoScore = (): void => useScoreStore.temporal.getState().redo();
export const pauseScoreHistory = (): void =>
  useScoreStore.temporal.getState().pause();
export const resumeScoreHistory = (): void =>
  useScoreStore.temporal.getState().resume();
export const clearScoreHistory = (): void =>
  useScoreStore.temporal.getState().clear();
