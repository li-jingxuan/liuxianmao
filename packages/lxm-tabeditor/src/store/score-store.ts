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
  /** 当前正在编辑的乐谱快照，是页面渲染和命令写入的唯一事实来源。 */
  score: Score;
  /** 文档修订号；从外部文档加载时读取，用于持久化或协作层对比版本。 */
  documentRevision: number;
  /** 最近一次命令执行失败产生的问题列表，供页面提示用户。 */
  lastCommandIssues: ValidationIssue[];
  /** 执行单条领域命令，并在成功时写入下一份 score。 */
  executeCommand: (command: ScoreCommand) => CommandResult<Score>;
  /** 以事务方式顺序执行多条命令，成功时只提交一次状态。 */
  executeTransaction: (commands: ScoreCommand[]) => CommandResult<Score>;
  /** 用磁盘/网络中的完整文档替换当前编辑态。 */
  loadDocument: (document: LxmScoreDocument) => void;
}

/**
 * 乐谱唯一写入入口。partialize 只返回 score，修订号和错误提示不会污染撤销历史。
 */
export const useScoreStore = create<ScoreStoreState>()(
  temporal<ScoreStoreState, [], [], Pick<ScoreStoreState, "score">>(
    (set, get) => ({
      /** 新建 store 时总是从一份合法的空白乐谱启动。 */
      score: createEmptyScore(),
      /** 0 表示本地新文档，未继承外部 revision。 */
      documentRevision: 0,
      /** 初始没有命令错误。 */
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
