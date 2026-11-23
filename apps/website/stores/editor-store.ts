import {
  createBeatClipboard,
  type BeatClipboard,
  type BeatClipboardRange,
} from "@liuxianmao/lxm-editor";
/**
 * 网站编辑器状态与受限历史。
 *
 * 领域命令仍由 @liuxianmao/lxm-editor 执行；store 只负责把成功 document 快照串成
 * 会话历史，并管理 selection/error 这类临时 UI 状态。历史数组中的每一项都只有
 * ILXMDocument，绝不保存选区、布局、滚动位置或输入草稿。
 */
import {
  applyScoreCommand,
  createCollapsedTabCellSelection,
  DEFAULT_MOCK_DOCUMENT,
  loadDocument,
  semanticJsonEqual,
  LXMScoreCommandEnum,
  resolveTabCellSelection,
  type ILXMApplyScoreCommandResult,
  type ILXMDocument,
  type ILXMNumberedTarget,
  type ILXMRhythm,
  createNumberedClipboard,
  type NumberedClipboard,
  type NumberedClipboardRange,
  type DocumentLoadResult,
  type ILXMCommandEffect,
  collectNumberedOmissionEffects,
  type ILXMScoreCommand,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { useContext } from "react";
import { EditorStoreContext } from "./editor-context";
import {
  reconcileNumberedSelection,
  reconcileSelection,
  reconcileTechniqueFocus,
  getSelectionCandidateAfterCommand,
} from "./editor-selection";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  createEmptyHistory,
  createHistoryEntry,
  readonlySnapshot,
  retainFeedback,
  toHistoryState,
  transitionHistory,
  type EditorHistory,
  type EditorHistoryView,
  type EditorFeedbackEvent,
  type HistoryEntry,
} from "./editor-history";
export { selectEditorHistory, selectHistoryEntries } from "./editor-history";
export type { HistoryEntry, HistoryTarget, EditorFeedbackEvent, EditorHistoryView } from "./editor-history";

export type ScoreFileStatus = "example" | "imported" | "exported" | "pending";

export interface NumberedAutoAdvance {
  target: Extract<ILXMNumberedTarget, { kind: "numberedTime" }>;
  previousPreference: ILXMRhythm;
}
type NumberedTimeTarget = Extract<ILXMNumberedTarget, { kind: "numberedTime" }>;

export const selectScoreFileStatus = ({ document, fileBaseline }: Pick<EditorStore, "document" | "fileBaseline">): ScoreFileStatus => {
  if (!document) return "example";
  if (!fileBaseline) return "pending";
  // Revision is a command counter. Restoring the same musical content also restores the baseline.
  return semanticJsonEqual(document.score, fileBaseline.document.score) ? fileBaseline.status : "pending";
};

export interface EditorStore {
  document: ILXMDocument | null;
  fileBaseline: { document: ILXMDocument; status: Exclude<ScoreFileStatus, "pending"> } | null;
  recordScoreExport: (document: ILXMDocument, sessionVersion: number) => void;
  stateVersion: number;
  clipboardVersion: number;
  hasBeatClipboard: boolean;
  getBeatClipboard: () => BeatClipboard | null;
  getNumberedClipboard: () => NumberedClipboard | null;
  copyNumberedRange: (range: NumberedClipboardRange) => boolean;
  copyBeats: (range: BeatClipboardRange) => boolean;
  /** 仅用于界面实例身份，不持久化到乐谱。 */
  sessionId: number;
  sessionVersion: number;
  effects: ILXMCommandEffect[];
  pastEntries: readonly HistoryEntry[];
  futureEntries: readonly HistoryEntry[];
  historyEntries: readonly HistoryEntry[];
  baselineAdvanced: boolean;
  historyView: EditorHistoryView;
  feedbackEvent: EditorFeedbackEvent | null;
  /** 旧计时器/关闭回调只能清除它所拥有的事件。 */
  dismissFeedback: (eventId: string) => void;
  replaceDocument: (input: unknown, source?: "file" | "new", filename?: string) => DocumentLoadResult;
  selection: ILXMTabCellSelection | null;
  /** 当前点击的技巧仅属于 UI 焦点，不进入文档历史。 */
  selectedTechniqueId: string | null;
  selectedTraversalIds: readonly string[];
  numberedSelection: ILXMNumberedTarget | null;
  numberedInputRhythm: ILXMRhythm;
  numberedInputRhythmExplicit: boolean;
  numberedInputRhythmTarget: NumberedTimeTarget | null;
  numberedAutoAdvance: NumberedAutoAdvance | null;
  markNumberedAutoAdvance: () => void;
  /** 会话中明确设置过时值的 TAB 拍，首次录入时不再套用对侧默认值。 */
  tabInputRhythmOverrides: readonly string[];
  setNumberedInputRhythm: (rhythm: ILXMRhythm, target?: NumberedTimeTarget) => void;
  selectedNumberedMarkId: string | null;
  setNumberedSelection: (target: ILXMNumberedTarget | null) => void;
  setSelectedNumberedMarkId: (id: string | null) => void;
  errorMessage: string | null;
  errorNoticeVersion: number;
  loadNotice: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** 公开深度用于控件和测试观测；快照内容仍是 store 内部实现细节。 */
  historyDepth: { past: number; future: number };
  execute: (command: ILXMScoreCommand, replaceFretEntryId?: string) => ILXMApplyScoreCommandResult | null;
  setSelection: (selection: ILXMTabCellSelection | null) => void;
  setSelectedTechniqueId: (techniqueId: string | null, traversalIds?: readonly string[]) => void;
  setErrorMessage: (message: string | null) => void;
  undo: () => void;
  redo: () => void;
  /** 回到指定条目提交后的状态；传 null 回到保留范围起点，返回撤销步数。 */
  rollback: (entryId: string | null) => number;
}

export type EditorStoreState = EditorStore & { history: EditorHistory };

/** 初始 fixture 也经过正式 loader，避免页面绕过 schema/语义校验。 */
const loadInitialDocument = (): ILXMDocument | null => {
  const result = loadDocument(JSON.stringify(DEFAULT_MOCK_DOCUMENT));
  return result.ok ? result.document : null;
};

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
    let clipboard: BeatClipboard | null = null;
    let numberedClipboard: NumberedClipboard | null = null;
    const sessionId = ++nextSessionId;
    let nextEntryId = 0;
    let nextFeedbackId = 0;
    const createFeedback = (
      source: EditorFeedbackEvent["source"],
      effects: readonly ILXMCommandEffect[],
      entryId?: string,
    ): EditorFeedbackEvent => readonlySnapshot({
      eventId: `${sessionId}:${get().sessionVersion}:feedback:${++nextFeedbackId}`,
      sessionId,
      sessionVersion: get().sessionVersion,
      source,
      ...(entryId ? { entryId } : {}),
      effects,
    });
    // 宿主回调位于提交之后；宿主异常不能破坏编辑器历史或向调用方抛出。
    const reportError = (message: string) => {
      set((state) => ({ errorMessage: message, errorNoticeVersion: state.errorNoticeVersion + 1 }));
      try {
        options.onError?.({ message });
      } catch {
        /* 宿主错误处理异常不递归上报。 */
      }
    };
    const notifyChange = (event: EditorChangeEvent) => {
      try {
        if (options.onChange) options.onChange({
          ...event,
          // document 沿用宿主契约中的当前已提交对象；可变命令/影响参数单独隔离。
          command: event.command ? structuredClone(event.command) : undefined,
          effects: structuredClone(event.effects),
        });
      } catch {
        reportError("宿主接收编辑结果失败，编辑结果已保留。");
      }
    };
    const undoTo = (state: EditorStoreState, keepCount: number): number => {
      const previous = state.history.past[keepCount];
      if (!state.document || !previous) return 0;
      const undoneCount = state.history.past.length - keepCount;
      const history = transitionHistory(state.history, { type: "undo", document: state.document, keepCount });
      // 单步撤销与批量回退共用一次提交：直接在目标快照上校正选区，宿主只收到最终文档。
      set({
        tabInputRhythmOverrides: [],
        effects: [],
        document: previous,
        numberedSelection: reconcileNumberedSelection(
          previous,
          state.numberedSelection,
        ),
        selectedNumberedMarkId: null,
        stateVersion: state.stateVersion + 1,
        selection: state.selection
          ? reconcileSelection(previous, state.selection)
          : null,
        ...reconcileTechniqueFocus(previous, state.selectedTechniqueId, state.selectedTraversalIds),
        errorMessage: null,
        loadNotice: null,
        ...toHistoryState(history),
      });
      notifyChange({ document: previous, reason: "undo", effects: [] });
      return undoneCount;
    };
    return {
      stateVersion: 0,
      clipboardVersion: 0,
      hasBeatClipboard: false,
      getNumberedClipboard: () =>
        numberedClipboard ? structuredClone(numberedClipboard) : null,
      copyNumberedRange: (range) => {
        const d = get().document;
        if (!d) return false;
        const result = createNumberedClipboard(d, range);
        if (!result.ok) {
          reportError(result.message);
          return false;
        }
        numberedClipboard = structuredClone(result.clipboard);
        const effects = collectNumberedOmissionEffects(
          d, range.trackId, range.measureId, result.clipboard.omissions,
        );
        set({
          clipboardVersion: get().clipboardVersion + 1,
          errorMessage: null,
          effects: structuredClone(effects),
          ...(effects.length ? { feedbackEvent: createFeedback("clipboard", effects) } : {}),
        });
        return true;
      },
      getBeatClipboard: () => (clipboard ? structuredClone(clipboard) : null),
      copyBeats: (range) => {
        const document = get().document;
        if (!document) return false;
        const result = createBeatClipboard(document, range);
        if (!result.ok) {
          set({ effects: [] });
          reportError(result.message);
          return false;
        }
        clipboard = structuredClone(result.clipboard);
        const effects = [
          ...result.clipboard.omissions,
          ...collectNumberedOmissionEffects(
            document, range.trackId, range.measureId, result.clipboard.numberedOmissions,
          ),
        ];
        set({
          hasBeatClipboard: true,
          clipboardVersion: get().clipboardVersion + 1,
          errorMessage: null,
          effects: structuredClone(effects),
          ...(effects.length ? { feedbackEvent: createFeedback("clipboard", effects) } : {}),
        });
        return true;
      },
      sessionId,
      sessionVersion: 0,
      effects: [],
      feedbackEvent: null,
      dismissFeedback: (eventId) => {
        if (get().feedbackEvent?.eventId === eventId) set({ feedbackEvent: null });
      },
      recordScoreExport: (document, sessionVersion) => {
        if (get().sessionVersion === sessionVersion) set({ fileBaseline: { document, status: "exported" } });
      },
      replaceDocument: (input, source, filename) => {
        const result = loadEditorDocument(input);
        if (!result.ok) {
          reportError(result.errors.join("；"));
          return result;
        }
        clipboard = null;
        numberedClipboard = null;
        const firstTrack = result.document.score.tracks[0]!;
        const firstMeasure = firstTrack.measures[0]!;
        const firstBeat = firstMeasure.beats[0];
        // 外部替换即使具有相同文档 ID，也明确开启新会话边界并取消旧草稿。
        set({
          document: result.document,
          fileBaseline: source === "new" ? null : {
            document: result.document, status: source === "file" ? "imported" : "example",
          },
          stateVersion: get().stateVersion + 1,
          hasBeatClipboard: false,
          clipboardVersion: get().clipboardVersion + 1,
          selection: source === "new" && firstBeat ? createCollapsedTabCellSelection({
            trackId: firstTrack.id, measureId: firstMeasure.id, beatId: firstBeat.id, string: 1,
          }) : null,
          selectedTechniqueId: null,
          selectedTraversalIds: [],
          numberedSelection: null,
          numberedInputRhythm: { base: "quarter", dots: 0 },
          numberedInputRhythmExplicit: false,
          numberedInputRhythmTarget: null,
          numberedAutoAdvance: null,
          tabInputRhythmOverrides: [],
          selectedNumberedMarkId: null,
          errorMessage: null,
          loadNotice:
            source === "file"
              ? `已导入「${filename || result.document.score.title || "未命名曲谱"}」。`
              : null,
          effects: [],
          feedbackEvent: null,
          sessionVersion: get().sessionVersion + 1,
          ...toHistoryState(createEmptyHistory()),
        });
        return result;
      },
      document: initialDocument,
      fileBaseline: initialDocument ? { document: initialDocument, status: "example" } : null,
      selection: null,
      selectedTechniqueId: null,
      selectedTraversalIds: [],
      numberedSelection: null,
      numberedInputRhythm: { base: "quarter", dots: 0 },
      numberedInputRhythmExplicit: false,
      numberedInputRhythmTarget: null,
      numberedAutoAdvance: null,
      markNumberedAutoAdvance: () => {
        const { numberedSelection, numberedInputRhythm } = get();
        // 跳到已有音符或持久空格时直接读取事件时值。只有虚拟空格才需要会话标记，
        // 并保留之前的偏好引用，用于区分上格遗留值与到达后新选的时值（两者数值可以相同）。
        if (numberedSelection?.kind === "numberedTime")
          set({ numberedAutoAdvance: { target: numberedSelection, previousPreference: numberedInputRhythm } });
      },
      tabInputRhythmOverrides: [],
      setNumberedInputRhythm: (rhythm, target) =>
        set({
          numberedInputRhythm: { ...rhythm },
          numberedInputRhythmExplicit: true,
          // 同一次编辑有意选了较长时值时保留它，让预览明确报错或确认覆盖。
          // 正文提交只记住偏好，不把本次的选择授权带到下一格。
          numberedInputRhythmTarget: target ?? null,
        }),
      selectedNumberedMarkId: null,
      errorMessage: initialDocument ? null : "无法加载示例乐谱。",
      errorNoticeVersion: 0,
      loadNotice: null,
      ...toHistoryState(createEmptyHistory()),

      execute: (command, replaceFretEntryId) => {
        const state = get();
        if (!state.document) {
          set({ effects: [] });
          reportError("当前没有可编辑的乐谱文档。");
          return null;
        }

        if (command.type === LXMScoreCommandEnum.SetNote && state.tabInputRhythmOverrides.includes(command.beatId))
          command = { ...command, inheritNumberedRhythm: false };
        if (command.type === LXMScoreCommandEnum.SetNotesInRect &&
          command.range.anchor.beatId === command.range.focus.beatId &&
          state.tabInputRhythmOverrides.includes(command.range.focus.beatId))
          command = { ...command, inheritNumberedRhythm: false };
        const result = applyScoreCommand(state.document, command);
        if (!result.ok) {
          set({ effects: [] });
          reportError(result.message);
          return result;
        }
        if (command.type === LXMScoreCommandEnum.SetBeatRhythm && !state.tabInputRhythmOverrides.includes(command.beatId))
          set({ tabInputRhythmOverrides: [...state.tabInputRhythmOverrides, command.beatId] });
        // 成功 no-op 只清理旧错误，不触发 setter 历史语义，也不替换 document。
        if (!result.changed) {
          set({ errorMessage: null, effects: [] });
          return result;
        }

        const latest = state.history.pastEntries.at(-1);
        const previousFret = command.type === LXMScoreCommandEnum.SetNotesInRect &&
          replaceFretEntryId && latest?.id === replaceFretEntryId && !state.canRedo
          ? latest : undefined;
        const entry = createHistoryEntry(
          previousFret?.id ?? `${sessionId}:${state.sessionVersion}:entry:${++nextEntryId}`,
          previousFret ? state.history.past.at(-1)! : state.document,
          command,
          [...(previousFret?.effects ?? []), ...(result.effects ?? [])],
        );
        const history = transitionHistory(state.history, {
          type: "commit", document: state.document, entry, replaceEntry: !!previousFret,
        });
        const selectionCandidate = result.nextFocus
          ? createCollapsedTabCellSelection({
              ...result.nextFocus,
              string: state.selection?.focus.string ?? 1,
            })
          : getSelectionCandidateAfterCommand(
              state.document,
              result.document,
              state.selection,
              command,
            );
        set({
          effects: structuredClone(result.effects ?? []),
          feedbackEvent: result.effects?.length
            ? createFeedback("command", result.effects, entry.id)
            : retainFeedback(state.feedbackEvent, history),
          document: result.document,
          numberedSelection: result.nextNumberedFocus
            ? result.nextNumberedFocus.eventId
              ? { kind: "numberedEvent", ...result.nextNumberedFocus }
              : {
                  kind: "numberedTime",
                  trackId: result.nextNumberedFocus.trackId,
                  measureId: result.nextNumberedFocus.measureId,
                  tick: result.nextNumberedFocus.tick!,
                  endTick: result.nextNumberedFocus.endTick!,
                }
            : reconcileNumberedSelection(
                result.document,
                state.numberedSelection,
              ),
          selectedNumberedMarkId: result.document.score.tracks.some((t) =>
            t.numberedMarks.some((m) => m.id === state.selectedNumberedMarkId),
          )
            ? state.selectedNumberedMarkId
            : null,
          stateVersion: get().stateVersion + 1,
          selection: command.type.startsWith("numbered.")
            ? state.selection
            : reconcileSelection(result.document, selectionCandidate),
          ...reconcileTechniqueFocus(result.document, state.selectedTechniqueId, state.selectedTraversalIds),
          errorMessage: null,
          loadNotice: null,
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

      setNumberedSelection: (numberedSelection) =>
        set({
          // 手动选中另一格再返回时，恢复常规偏好规则，不重复触发上次的自动跳转初始化。
          numberedAutoAdvance: null,
          numberedInputRhythmTarget: null,
          numberedSelection: get().document
            ? reconcileNumberedSelection(get().document!, numberedSelection)
            : null,
        }),
      setSelectedNumberedMarkId: (selectedNumberedMarkId) =>
        set({
          selectedNumberedMarkId: get().document?.score.tracks.some((t) =>
            t.numberedMarks.some((m) => m.id === selectedNumberedMarkId),
          )
            ? selectedNumberedMarkId
            : null,
        }),
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

      setSelectedTechniqueId: (selectedTechniqueId, traversalIds = []) => {
        set({
          ...reconcileTechniqueFocus(get().document, selectedTechniqueId, traversalIds),
          errorMessage: null,
        });
      },

      setErrorMessage: (errorMessage) =>
        errorMessage ? reportError(errorMessage) : set({ errorMessage: null }),

      undo: () => {
        const state = get();
        undoTo(state, state.history.past.length - 1);
      },

      rollback: (entryId) => {
        const state = get();
        if (entryId === null) return undoTo(state, 0);
        // 目标条目仍算作已应用；只查已应用条目，已裁切或位于重做分支的 ID 直接忽略。
        const index = state.history.pastEntries.findIndex((entry) => entry.id === entryId);
        return index < 0 ? 0 : undoTo(state, index + 1);
      },

      redo: () => {
        const state = get();
        const next = state.history.future[0];
        if (!state.document || !next) return;
        const history = transitionHistory(state.history, { type: "redo", document: state.document });
        set({
          tabInputRhythmOverrides: [],
          effects: [],
          document: next,
          feedbackEvent: retainFeedback(state.feedbackEvent, history),
          numberedSelection: reconcileNumberedSelection(
            next,
            state.numberedSelection,
          ),
          selectedNumberedMarkId: null,
          stateVersion: get().stateVersion + 1,
          selection: state.selection
            ? reconcileSelection(next, state.selection)
            : null,
          ...reconcileTechniqueFocus(next, state.selectedTechniqueId, state.selectedTraversalIds),
          errorMessage: null,
          loadNotice: null,
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
