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
  EXAMPLE_MVP_6_DOCUMENT,
  getFirstTabCellReference,
  HISTORY_LIMIT,
  loadDocument,
  LXMScoreCommandEnum,
  resolveTabCellSelection,
  type ILXMApplyScoreCommandResult,
  type ILXMDocument,
  type DocumentLoadResult,
  type ILXMCommandEffect,
  type ILXMScoreCommand,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { useContext } from "react";
import { EditorStoreContext } from "./editor-context";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

interface EditorHistory {
  past: ILXMDocument[];
  future: ILXMDocument[];
}

export interface EditorStore {
  document: ILXMDocument | null;
  /** 仅用于界面实例身份，不持久化到乐谱。 */
  sessionId: number;
  sessionVersion: number;
  effects: ILXMCommandEffect[];
  replaceDocument: (input: unknown) => DocumentLoadResult;
  selection: ILXMTabCellSelection | null;
  /** 当前点击的技巧仅属于 UI 焦点，不进入文档历史。 */
  selectedTechniqueId: string | null;
  errorMessage: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** 公开深度用于控件和测试观测；快照内容仍是 store 内部实现细节。 */
  historyDepth: { past: number; future: number };
  execute: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  setSelection: (selection: ILXMTabCellSelection | null) => void;
  setSelectedTechniqueId: (techniqueId: string | null) => void;
  setErrorMessage: (message: string | null) => void;
  undo: () => void;
  redo: () => void;
}

export type EditorStoreState = EditorStore & { history: EditorHistory };

/** 初始 fixture 也经过正式 loader，避免页面绕过 schema/语义校验。 */
const loadInitialDocument = (): ILXMDocument | null => {
  const result = loadDocument(JSON.stringify(EXAMPLE_MVP_6_DOCUMENT));
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

  /*
   * undo/redo 可能在“旧尾部休止 ID”和“新尾部休止 ID”之间切换。虽然 Beat ID
   * 失效，measure ID 与弦号通常仍然有效；先把每个失效端点局部回退到原小节首拍，
   * 可以让拍号工具继续指向用户刚才编辑的小节，而不是跳到整首谱开头。
   *
   * 小节本身已被删除时这个局部候选不存在，最后才使用全谱首格兜底。正常的
   * measure.remove 命令仍会在进入此函数前提供相邻小节候选。
   */
  if (selection) {
    const reconcileEndpointInMeasure = (
      reference: ILXMTabCellReference,
    ): ILXMTabCellReference | null => {
      const track = document.score.tracks.find(
        (candidate) => candidate.id === reference.trackId,
      );
      const measure = track?.measures.find(
        (candidate) => candidate.id === reference.measureId,
      );
      const beat = measure
        ? [...measure.beats].sort((left, right) => left.tick - right.tick)[0]
        : undefined;
      return track && measure && beat
        ? { ...reference, measureId: measure.id, beatId: beat.id }
        : null;
    };
    const anchor = reconcileEndpointInMeasure(selection.anchor);
    const focus = reconcileEndpointInMeasure(selection.focus);
    const localCandidate = anchor && focus ? { anchor, focus } : null;
    if (localCandidate && resolveTabCellSelection(document, localCandidate).ok)
      return localCandidate;
  }

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
  previousDocument: ILXMDocument,
  nextDocument: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  command: ILXMScoreCommand,
): ILXMTabCellSelection | null => {
  if (!selection) return null;

  if (command.type === LXMScoreCommandEnum.SetTimeSignature) {
    const targetTrack = nextDocument.score.tracks.find(
      (candidate) => candidate.id === command.trackId,
    );
    const targetMeasure = targetTrack?.measures.find(
      (measure) => measure.id === command.measureId,
    );
    const firstTargetBeat = targetMeasure
      ? [...targetMeasure.beats].sort(
          (left, right) => left.tick - right.tick,
        )[0]
      : undefined;
    if (!targetTrack || !targetMeasure || !firstTargetBeat) return selection;

    /**
     * 拍号协调只会删除并重建尾部容量休止，真实内容 Beat ID 会保持稳定。因此逐个
     * 检查端点：仍存在的端点原样保留；只有落在被替换休止上的端点才回到命令目标
     * 小节首拍。多小节范围也统一回到用户最初操作的小节，避免突然跳到后续小节或
     * 整首谱第一格。弦号属于用户的垂直编辑位置，回退时继续保留。
     */
    const reconcileTimeSignatureEndpoint = (
      reference: ILXMTabCellReference,
    ): ILXMTabCellReference => {
      const beatStillExists = nextDocument.score.tracks
        .find((track) => track.id === reference.trackId)
        ?.measures.find((measure) => measure.id === reference.measureId)
        ?.beats.some((beat) => beat.id === reference.beatId);
      return beatStillExists
        ? reference
        : {
            ...reference,
            trackId: targetTrack.id,
            measureId: targetMeasure.id,
            beatId: firstTargetBeat.id,
          };
    };
    return {
      anchor: reconcileTimeSignatureEndpoint(selection.anchor),
      focus: reconcileTimeSignatureEndpoint(selection.focus),
    };
  }

  if (
    command.type !== LXMScoreCommandEnum.RemoveMeasure ||
    (selection.anchor.measureId !== command.measureId &&
      selection.focus.measureId !== command.measureId)
  )
    return selection;

  const track = previousDocument.score.tracks.find(
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
let nextSessionId = 0;

export const createEditorStore = (
  initialDocument: ILXMDocument | null,
  options: EditorSessionOptions = {},
): StoreApi<EditorStoreState> =>
  createStore<EditorStoreState>((set, get) => {
    // 宿主回调位于提交之后；宿主异常不能破坏编辑器历史或向调用方抛出。
    const reportError = (message: string) => {
      set({ errorMessage: message });
      try {
        options.onError?.({ message });
      } catch {
        /* 宿主错误处理异常不递归上报。 */
      }
    };
    const notifyChange = (event: EditorChangeEvent) => {
      try {
        options.onChange?.(event);
      } catch {
        reportError("宿主接收编辑结果失败，编辑结果已保留。");
      }
    };
    return {
      sessionId: ++nextSessionId,
      sessionVersion: 0,
      effects: [],
      replaceDocument: (input) => {
        const result = loadEditorDocument(input);
        if (!result.ok) {
          reportError(result.errors.join("；"));
          return result;
        }
        // 外部替换即使具有相同文档 ID，也明确开启新会话边界并取消旧草稿。
        set({
          document: result.document,
          selection: null,
          selectedTechniqueId: null,
          errorMessage: null,
          effects: [],
          sessionVersion: get().sessionVersion + 1,
          ...toHistoryState({ past: [], future: [] }),
        });
        return result;
      },
      document: initialDocument,
      selection: null,
      selectedTechniqueId: null,
      errorMessage: initialDocument ? null : "无法加载 MVP v6 示例乐谱。",
      history: { past: [], future: [] },
      canUndo: false,
      canRedo: false,
      historyDepth: { past: 0, future: 0 },

      execute: (command) => {
        const state = get();
        if (!state.document) {
          set({ effects: [] });
          reportError("当前没有可编辑的乐谱文档。");
          return null;
        }

        const result = applyScoreCommand(state.document, command);
        if (!result.ok) {
          set({ effects: [] });
          reportError(result.message);
          return result;
        }
        // 成功 no-op 只清理旧错误，不触发 setter 历史语义，也不替换 document。
        if (!result.changed) {
          set({ errorMessage: null, effects: [] });
          return result;
        }

        const history: EditorHistory = {
          past: [...state.history.past, state.document].slice(-HISTORY_LIMIT),
          future: [],
        };
        const selectionCandidate = getSelectionCandidateAfterCommand(
          state.document,
          result.document,
          state.selection,
          command,
        );
        set({
          effects: result.effects ?? [],
          document: result.document,
          selection: reconcileSelection(result.document, selectionCandidate),
          selectedTechniqueId: result.document.score.tracks.some((track) =>
            track.techniques.some(
              (technique) => technique.id === state.selectedTechniqueId,
            ),
          )
            ? state.selectedTechniqueId
            : null,
          errorMessage: null,
          ...toHistoryState(history),
        });
        notifyChange({
          document: result.document,
          reason: "command",
          command,
          effects: result.effects ?? [],
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
          reportError(resolved.message);
          return;
        }
        set({ selection, errorMessage: null });
      },

      setSelectedTechniqueId: (selectedTechniqueId) => {
        const document = get().document;
        const exists = document?.score.tracks.some((track) =>
          track.techniques.some(
            (technique) => technique.id === selectedTechniqueId,
          ),
        );
        set({
          selectedTechniqueId:
            selectedTechniqueId === null || exists ? selectedTechniqueId : null,
          errorMessage: null,
        });
      },

      setErrorMessage: (errorMessage) =>
        errorMessage ? reportError(errorMessage) : set({ errorMessage: null }),

      undo: () => {
        const state = get();
        const previous = state.history.past.at(-1);
        if (!state.document || !previous) return;
        const history: EditorHistory = {
          past: state.history.past.slice(0, -1),
          future: [state.document, ...state.history.future],
        };
        set({
          effects: [],
          document: previous,
          selection: reconcileSelection(previous, state.selection),
          selectedTechniqueId: previous.score.tracks.some((track) =>
            track.techniques.some(
              (technique) => technique.id === state.selectedTechniqueId,
            ),
          )
            ? state.selectedTechniqueId
            : null,
          errorMessage: null,
          ...toHistoryState(history),
        });
        notifyChange({ document: previous, reason: "undo", effects: [] });
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
          effects: [],
          document: next,
          selection: reconcileSelection(next, state.selection),
          selectedTechniqueId: next.score.tracks.some((track) =>
            track.techniques.some(
              (technique) => technique.id === state.selectedTechniqueId,
            ),
          )
            ? state.selectedTechniqueId
            : null,
          errorMessage: null,
          ...toHistoryState(history),
        });
        notifyChange({ document: next, reason: "redo", effects: [] });
      },
    };
  });

export const editorStore = createEditorStore(loadInitialDocument());

/** React 适配器保持 selector API，组件只订阅自己需要的字段。 */
export const useEditorStore = <T>(selector: (state: EditorStore) => T): T =>
  useStore(useEditorSessionStore(), selector);

/** 会话上下文同时服务 React 订阅和侧栏的命令/订阅入口。 */
export const useEditorSessionStore = (): StoreApi<EditorStoreState> =>
  useContext(EditorStoreContext) ?? editorStore;

export interface EditorChangeEvent {
  document: ILXMDocument;
  reason: "command" | "undo" | "redo";
  command?: ILXMScoreCommand;
  effects: ILXMCommandEffect[];
}
export interface EditorSessionOptions {
  onChange?: (event: EditorChangeEvent) => void;
  onError?: (event: { message: string }) => void;
}

/** 宿主输入经过正式加载器，再收紧到本版支持的单轨、非空小节。 */
export const loadEditorDocument = (input: unknown): DocumentLoadResult => {
  let result: DocumentLoadResult;
  try {
    result = loadDocument(
      typeof input === "string" ? input : JSON.stringify(input),
    );
  } catch {
    return { ok: false, errors: ["文档无法序列化为 JSON。"] };
  }
  if (!result.ok) return result;
  const tracks = result.document.score.tracks;
  if (tracks.length !== 1 || tracks[0]!.measures.length === 0)
    return { ok: false, errors: ["当前编辑器仅支持包含小节的单轨六线谱。"] };
  return result;
};

/** 初始化独立会话；无效宿主输入不会退回或覆盖默认示例。 */
export const createEditorSession = (
  input: unknown,
  options: EditorSessionOptions = {},
) => {
  // 初始快照直接包含合法文档，确保 Zustand 的 SSR 快照与首次客户端快照一致。
  const loaded = loadEditorDocument(input);
  const session = createEditorStore(
    loaded.ok ? loaded.document : null,
    options,
  );
  if (!loaded.ok) session.getState().replaceDocument(input);
  return session;
};
