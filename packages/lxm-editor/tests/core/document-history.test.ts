import { describe, expect, it } from "vitest";
import {
  createDocumentHistory,
  HISTORY_LIMIT,
  transitionDocumentHistory,
  type DocumentHistory,
} from "../../src/public";
import source from "../../example/example-mvp4.json";

const snapshot = (revision: number) => ({ ...source, documentRevision: revision });
const revisions = (documents: DocumentHistory<unknown>["past"]) => documents.map((document) => document.documentRevision);

describe("文档快照历史", () => {
  it("合并连续提交后，跨多条回退与逐步重做仍保持快照和条目对应", () => {
    let history = createDocumentHistory<string>();
    for (const revision of [1, 2, 3]) {
      history = transitionDocumentHistory(history, { type: "commit", document: snapshot(revision), entry: `第 ${revision} 步` });
    }
    const previous = history;
    history = transitionDocumentHistory(history, {
      type: "commit", document: snapshot(4), entry: "第 3 步合并", replaceEntry: true,
    });
    expect(history.past).toBe(previous.past);
    expect(history.pastEntries).toEqual(["第 1 步", "第 2 步", "第 3 步合并"]);

    history = transitionDocumentHistory(history, { type: "undo", document: snapshot(5), keepCount: 1 });
    expect(revisions(history.past)).toEqual([1]);
    expect(revisions(history.future)).toEqual([3, 5]);
    expect(history.futureEntries).toEqual(["第 2 步", "第 3 步合并"]);
    expect(Object.isFrozen(history.futureEntries)).toBe(true);

    history = transitionDocumentHistory(history, { type: "redo", document: snapshot(2) });
    expect(revisions(history.past)).toEqual([1, 2]);
    expect(revisions(history.future)).toEqual([5]);
    expect(history.pastEntries).toEqual(["第 1 步", "第 2 步"]);
    expect(history.futureEntries).toEqual(["第 3 步合并"]);

    history = transitionDocumentHistory(history, { type: "commit", document: snapshot(3), entry: "新分支" });
    expect(history.future).toEqual([]);
    expect(history.futureEntries).toEqual([]);
  });

  it("快照和条目同步裁切，所有值均可作条目，重置后可开启新会话", () => {
    let history = createDocumentHistory<number | undefined>();
    const empty = history;
    expect(transitionDocumentHistory(history, { type: "redo", document: snapshot(1) })).toBe(empty);
    expect(transitionDocumentHistory(history, {
      type: "commit", document: snapshot(1), entry: 0, replaceEntry: true,
    })).toBe(empty);
    for (let index = 0; index <= HISTORY_LIMIT; index++) {
      history = transitionDocumentHistory(history, {
        type: "commit", document: snapshot(index + 1), entry: index === 1 ? undefined : index,
      });
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]?.documentRevision).toBe(2);
    expect(history.pastEntries).toHaveLength(HISTORY_LIMIT);
    expect(history.baselineAdvanced).toBe(true);
    expect(transitionDocumentHistory(history, { type: "undo", document: snapshot(102), keepCount: -1 })).toBe(history);

    history = transitionDocumentHistory(history, { type: "undo", document: snapshot(102), keepCount: 0 });
    expect(history.futureEntries).toHaveLength(HISTORY_LIMIT);
    expect(history.futureEntries[0]).toBeUndefined();
    expect(history.future[0]?.documentRevision).toBe(3);
    history = transitionDocumentHistory(history, { type: "redo", document: snapshot(2) });
    expect(history.pastEntries).toEqual([undefined]);
    expect(history.baselineAdvanced).toBe(true);
    expect(transitionDocumentHistory(history, { type: "reset" })).toEqual(empty);
  });
});
