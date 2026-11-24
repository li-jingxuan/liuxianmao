import { HISTORY_LIMIT } from "../constants";
import type { ILXMDocument } from "../types";

export interface DocumentHistory<Entry> {
  past: ILXMDocument[];
  future: ILXMDocument[];
  pastEntries: readonly Entry[];
  futureEntries: readonly Entry[];
  baselineAdvanced: boolean;
}

export type DocumentHistoryAction<Entry> =
  | { type: "reset" }
  | { type: "commit"; document: ILXMDocument; entry: Entry; replaceEntry?: boolean }
  | { type: "undo"; document: ILXMDocument; keepCount: number }
  | { type: "redo"; document: ILXMDocument };

/** 每个编辑会话持有自己的历史。快照数组沿用原有可变数组类型，条目序列只读。 */
export const createDocumentHistory = <Entry>(): DocumentHistory<Entry> => ({
  past: [],
  future: [],
  pastEntries: Object.freeze([]),
  futureEntries: Object.freeze([]),
  baselineAdvanced: false,
});

/**
 * 快照和条目一起移动、裁切。action.document 始终是转换前的当前文档。
 * 宿主先按旧历史取出要恢复的快照，再同时更新当前文档和历史；转换只保留引用，
 * 因此宿主应将传入的文档和条目视为快照，避免后续原地修改。
 */
export const transitionDocumentHistory = <Entry>(
  history: DocumentHistory<Entry>,
  action: DocumentHistoryAction<Entry>,
): DocumentHistory<Entry> => {
  if (action.type === "reset") return createDocumentHistory<Entry>();
  if (action.type === "undo") {
    const { keepCount } = action;
    // 以索引是否存在判断边界，允许宿主使用 false、0、undefined 等任意条目值。
    if (!Number.isInteger(keepCount) || keepCount < 0 || keepCount >= history.pastEntries.length) return history;
    // past[keepCount] 是首个被撤销条目的提交前快照，也是本次恢复的文档。
    // 它后面的快照与操作前的当前文档组成新重做队列，排在旧队列之前。
    return {
      ...history,
      past: history.past.slice(0, keepCount),
      future: [...history.past.slice(keepCount + 1), action.document, ...history.future],
      pastEntries: Object.freeze(history.pastEntries.slice(0, keepCount)),
      futureEntries: Object.freeze([...history.pastEntries.slice(keepCount), ...history.futureEntries]),
    };
  }
  if (action.type === "redo" && !history.futureEntries.length) return history;
  const entry = action.type === "commit" ? action.entry : history.futureEntries[0]!;
  if (action.type === "commit" && action.replaceEntry) {
    // 连续编辑合并为同一条记录时，保留第一次编辑前的快照，只更新最后一条元数据。
    if (!history.pastEntries.length) return history;
    return { ...history, pastEntries: Object.freeze([...history.pastEntries.slice(0, -1), entry]) };
  }
  // 普通提交清空重做分支。超过上限后同步丢弃最早的快照和条目，并保留基线推进标记至重置。
  return {
    past: [...history.past, action.document].slice(-HISTORY_LIMIT),
    future: action.type === "commit" ? [] : history.future.slice(1),
    pastEntries: Object.freeze([...history.pastEntries, entry].slice(-HISTORY_LIMIT)),
    futureEntries: Object.freeze(action.type === "commit" ? [] : history.futureEntries.slice(1)),
    baselineAdvanced: history.baselineAdvanced || history.past.length >= HISTORY_LIMIT,
  };
};
