/**
 * 网站编辑器状态与受限历史。
 *
 * 领域命令仍由 @liuxianmao/lxm-editor 执行；store 只负责把成功 document 快照串成
 * 会话历史，并管理 selection/error 这类临时 UI 状态。历史数组中的每一项都只有
 * ILXMDocument，绝不保存选区、布局、滚动位置或输入草稿。
 */
import {
  applyScoreCommand,
  buildOrderedBeatIndex,
  createCollapsedTabCellSelection,
  EXAMPLE_MVP_4_DOCUMENT,
  getFirstTabCellReference,
  HISTORY_LIMIT,
  loadDocument,
  LXMScoreCommandEnum,
  resolveTabCellSelection,
  type ILXMApplyScoreCommandResult,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

interface EditorHistory {
  past: ILXMDocument[];
  future: ILXMDocument[];
}

export interface EditorStore {
  document: ILXMDocument | null;
  selection: ILXMTabCellSelection | null;
  errorMessage: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** 公开深度用于控件和测试观测；快照内容仍是 store 内部实现细节。 */
  historyDepth: { past: number; future: number };
  execute: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  setSelection: (selection: ILXMTabCellSelection | null) => void;
  setErrorMessage: (message: string | null) => void;
  undo: () => void;
  redo: () => void;
}

type EditorStoreState = EditorStore & { history: EditorHistory };

/** 初始 fixture 也经过正式 loader，避免页面绕过 schema/语义校验。 */
const loadInitialDocument = (): ILXMDocument | null => {
  const result = loadDocument(JSON.stringify(EXAMPLE_MVP_4_DOCUMENT));
  return result.ok ? result.document : null;
};

/**
 * 保留仍合法的临时选区；端点因节奏重建或历史切换消失时回退首个合法单元格。
 * 这个动作发生在 document 切换之后，因此无需把 selection 写入历史快照。
 */
const reconcileSelection = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
): ILXMTabCellSelection | null => {
  if (selection && resolveTabCellSelection(document, selection).ok)
    return selection;
  const first = getFirstTabCellReference(document);
  return first ? createCollapsedTabCellSelection(first) : null;
};

/**
 * 删除小节前先计算相邻小节首拍，保留 v3 的稳定定位体验。
 *
 * 其他导致端点失效的命令统一由 reconcileSelection 回退首格；只有 measure.remove
 * 能在旧文档中无歧义地知道“被删目标的相邻小节”。
 */
const getSelectionCandidateAfterCommand = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  command: ILXMScoreCommand,
): ILXMTabCellSelection | null => {
  if (
    !selection ||
    command.type !== LXMScoreCommandEnum.RemoveMeasure ||
    (selection.anchor.measureId !== command.measureId &&
      selection.focus.measureId !== command.measureId)
  )
    return selection;

  const track = document.score.tracks.find(
    (candidate) => candidate.id === command.trackId,
  );
  const removedIndex = track?.measures.findIndex(
    (measure) => measure.id === command.measureId,
  );
  if (!track || removedIndex === undefined || removedIndex < 0)
    return selection;
  const fallbackMeasure =
    track.measures[removedIndex + 1] ?? track.measures[removedIndex - 1];
  const fallbackBeat = fallbackMeasure
    ? buildOrderedBeatIndex({ ...track, measures: [fallbackMeasure] })[0]
    : undefined;
  if (!fallbackBeat) return selection;

  const replaceRemovedEndpoint = (
    reference: ILXMTabCellReference,
  ): ILXMTabCellReference =>
    reference.measureId === command.measureId
      ? {
          ...reference,
          measureId: fallbackBeat.measureId,
          beatId: fallbackBeat.beatId,
        }
      : reference;
  return {
    anchor: replaceRemovedEndpoint(selection.anchor),
    focus: replaceRemovedEndpoint(selection.focus),
  };
};

const toHistoryState = (history: EditorHistory) => ({
  history,
  canUndo: history.past.length > 0,
  canRedo: history.future.length > 0,
  historyDepth: {
    past: history.past.length,
    future: history.future.length,
  },
});

/**
 * 创建独立 store，便于测试和未来多文档标签页复用。
 * 页面使用下方单例；测试传入自己的初始文档，互不污染历史。
 */
export const createEditorStore = (
  initialDocument: ILXMDocument | null,
): StoreApi<EditorStoreState> =>
  createStore<EditorStoreState>((set, get) => ({
    document: initialDocument,
    selection: null,
    errorMessage: initialDocument ? null : "无法加载 MVP v4 示例乐谱。",
    history: { past: [], future: [] },
    canUndo: false,
    canRedo: false,
    historyDepth: { past: 0, future: 0 },

    execute: (command) => {
      const state = get();
      if (!state.document) {
        set({ errorMessage: "当前没有可编辑的乐谱文档。" });
        return null;
      }

      const result = applyScoreCommand(state.document, command);
      if (!result.ok) {
        set({ errorMessage: result.message });
        return result;
      }
      // 成功 no-op 只清理旧错误，不触发 setter 历史语义，也不替换 document。
      if (!result.changed) {
        set({ errorMessage: null });
        return result;
      }

      const history: EditorHistory = {
        past: [...state.history.past, state.document].slice(-HISTORY_LIMIT),
        future: [],
      };
      const selectionCandidate = getSelectionCandidateAfterCommand(
        state.document,
        state.selection,
        command,
      );
      set({
        document: result.document,
        selection: reconcileSelection(result.document, selectionCandidate),
        errorMessage: null,
        ...toHistoryState(history),
      });
      return result;
    },

    setSelection: (selection) => {
      const document = get().document;
      if (!selection || !document) {
        set({ selection, errorMessage: null });
        return;
      }
      const resolved = resolveTabCellSelection(document, selection);
      if (!resolved.ok) {
        // 指针拖动越界时保留最后一个合法 focus，避免选区突然消失。
        set({ errorMessage: resolved.message });
        return;
      }
      set({ selection, errorMessage: null });
    },

    setErrorMessage: (errorMessage) => set({ errorMessage }),

    undo: () => {
      const state = get();
      const previous = state.history.past.at(-1);
      if (!state.document || !previous) return;
      const history: EditorHistory = {
        past: state.history.past.slice(0, -1),
        future: [state.document, ...state.history.future],
      };
      set({
        document: previous,
        selection: reconcileSelection(previous, state.selection),
        errorMessage: null,
        ...toHistoryState(history),
      });
    },

    redo: () => {
      const state = get();
      const next = state.history.future[0];
      if (!state.document || !next) return;
      const history: EditorHistory = {
        past: [...state.history.past, state.document].slice(-HISTORY_LIMIT),
        future: state.history.future.slice(1),
      };
      set({
        document: next,
        selection: reconcileSelection(next, state.selection),
        errorMessage: null,
        ...toHistoryState(history),
      });
    },
  }));

export const editorStore = createEditorStore(loadInitialDocument());

/** React 适配器保持 selector API，组件只订阅自己需要的字段。 */
export const useEditorStore = <T>(selector: (state: EditorStore) => T): T =>
  useStore(editorStore, selector);
