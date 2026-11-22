"use client";
import {
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Alert, Button, Tooltip } from "antd";
import {
  DeleteOutlined,
  RedoOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Headphones } from "lucide-react";
import { LXMScoreCommandEnum, LXM_TUPLET_RATIOS, type ILXMRhythm, type MusicTextRange, type RhythmPatternTarget } from "@liuxianmao/lxm-editor";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../../stores/editor-store";
import { MusicAssetIcon } from "../../MusicAssetIcon";
import type { MusicControlIcon } from "../../../assets/svg/svg-assets-manifest";
import {
  deriveEditorToolState,
  type ToolAvailability,
} from "../tools/editor-tool-state";
import { ShortcutHint } from "../session/EditorShortcutReference";
import { RhythmPatternPanel, useSharedRhythmPatternBusy } from "../tools/RhythmPatternPanel";
import { MeasureBoundary, resolveMeasureControlTarget } from "../tools/MeasureBoundary";
import { MeasureActions } from "../tools/MeasureActions";
import measureStyles from "../tools/MeasureControls.module.scss";
import { resolveEditorRhythmPatternTarget } from "../tools/editor-rhythm-pattern-target";
import { resolveTupletToolbarTarget, TupletToolbar } from "../tools/TupletToolbar";
import { TechniqueToolbar, type TechniqueToolbarController } from "../tools/TechniqueToolbar";
import { TECHNIQUE_OPTIONS } from "../tools/technique-catalog";
import { techniquesInToolbarSelection, toolbarTechniqueAvailability } from "../tools/technique-toolbar-model";
import {
  EditorToolPanelHost,
  type EditorToolPanelController,
} from "../tools/EditorToolPanelHost";
import { createBeatPasteController } from "../tools/beat-paste-controller";
import { useEditorRuntime } from "../session/EditorSessionRuntime";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import type { ToolActionHandler } from "../tools/editor-tool-actions";
import type { ToolNavigation } from "../tools/editor-tool-catalog";
import type { SelectionRequestResult } from "../session/editor-object-selection";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import { resolveEditorRhythmTarget } from "../tools/editor-rhythm-target";
import { resolveEditorChordTarget } from "../chords/editor-chord-target";
import { resolveQuickTechnique } from "../tools/editor-technique-target";
import { tabToolTargetReason } from "../tools/editor-tool-guard";
import { isNumberedTieTarget, resolveEditorTieTarget } from "../tools/editor-tie-target";
import { EditorToolSymbolButton, TechniqueSymbol } from "../tools/EditorToolSymbolButton";
import symbolStyles from "../tools/EditorToolSymbolButton.module.scss";
import toolbarStyles from "./EditorToolbar.module.scss";
import { PlaybackToolbar } from "../playback/PlaybackToolbar";
import type { ScorePlaybackControls } from "../playback/controller";

export type { EditorToolbarAction } from "../tools/editor-tool-actions";

const RHYTHMS: {
  base: ILXMRhythm["base"];
  icon: MusicControlIcon;
  label: string;
}[] = [
  { base: "whole", icon: "noteWhole", label: "全音符" },
  { base: "half", icon: "noteHalf", label: "二分音符" },
  { base: "quarter", icon: "noteQuarter", label: "四分音符" },
  { base: "eighth", icon: "noteEighth", label: "八分音符" },
  { base: "sixteenth", icon: "noteSixteenth", label: "十六分音符" },
  { base: "thirtySecond", icon: "noteThirtySecond", label: "三十二分音符" },
];
const ToolButton = EditorToolSymbolButton;

/** 桌面菜单只组织入口；预览控制器随会话存活。 */
export const EditorToolbar = ({
  activeTarget,
  continuousRange = null,
  blocked,
  numberedBlocked,
  onAction,
  beforeAction,
  beforeRhythmPatternAction,
  execute,
  onOpenChord,
  onRhythmPatternScopeChange,
  chordEntryBlocked = false,
  sidebarCollapsed,
  onToggleSidebar,
  sidebarToggleRef,
  playback,
  isPlaybackEntryBlocked,
}: {
  activeTarget: MusicTextTarget | null;
  continuousRange?: MusicTextRange | null;
  blocked: boolean;
  numberedBlocked: boolean;
  onAction: ToolActionHandler;
  beforeAction: () => void;
  beforeRhythmPatternAction?: () => void;
  execute: EditorCommandAdapter;
  onNavigate: (destination: ToolNavigation) => SelectionRequestResult;
  onOpenChord?: (target: MusicTextTarget) => void;
  onRhythmPatternScopeChange?: (scope: RhythmPatternTarget | null) => void;
  chordEntryBlocked?: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  sidebarToggleRef: Ref<HTMLButtonElement>;
  playback: ScorePlaybackControls;
  isPlaybackEntryBlocked: () => boolean;
}) => {
  const session = useEditorSessionStore();
  const { drafts, modals } = useEditorRuntime();
  const document = useEditorStore((state) => state.document),
    selection = useEditorStore((state) => state.selection),
    numberedSelection = useEditorStore((state) => state.numberedSelection);
  const canUndo = useEditorStore((state) => state.canUndo),
    canRedo = useEditorStore((state) => state.canRedo);
  const inputRhythm = useEditorStore((state) => state.numberedInputRhythm);
  const tabInputRhythmOverrides = useEditorStore((state) => state.tabInputRhythmOverrides);
  const inputRhythmExplicit = useEditorStore(
    (state) => state.numberedInputRhythmExplicit,
  );
  const selectedTechniqueId = useEditorStore(
    (state) => state.selectedTechniqueId,
  );
  const setSelectedTechniqueId = useEditorStore(
      (state) => state.setSelectedTechniqueId,
    ),
    setErrorMessage = useEditorStore((state) => state.setErrorMessage);
  const modal = useSyncExternalStore(
    modals.subscribe,
    modals.getSnapshot,
    () => null,
  );
  useSyncExternalStore(
    drafts.subscribe,
    drafts.getSnapshot,
    drafts.getSnapshot,
  );
  const host = useRef<EditorToolPanelController>(null);
  const playbackToggleRef = useRef<HTMLButtonElement>(null);
  const [playbackEntryNotice, setPlaybackEntryNotice] = useState("");
  const sharedRhythmBusy = useSharedRhythmPatternBusy();
  const immediateBusyRef = useRef(false);
  const [, setImmediateBusyState] = useState(false);
  const setImmediateBusy = useCallback((busy: boolean) => { immediateBusyRef.current = busy; setImmediateBusyState(busy); }, []);
  const rhythmBusyRef = useRef(false);
  const [, setRhythmBusy] = useState(false);
  const setRhythmProtection = useCallback((busy: boolean) => {
    rhythmBusyRef.current = busy;
    setRhythmBusy(busy);
  }, []);
  const techniquePanel = useRef<TechniqueToolbarController>(null);
  const activeTargetRef = useRef(activeTarget);
  useLayoutEffect(() => { activeTargetRef.current = activeTarget; }, [activeTarget]);
  const getActiveTarget = useCallback(() => activeTargetRef.current, []);
  const protectedDraft = drafts
    .inspect()
    .pending.some((item) => item.kind !== "beatPaste");
  const editingBlocked = blocked || protectedDraft || drafts.inspect().busy;
  const numberedEditingBlocked = numberedBlocked || protectedDraft || drafts.inspect().busy;
  const techniqueBlocked = blocked || drafts.inspect().pending.some(
    (item) => item.kind !== "beatPaste" && item.kind !== "technique",
  );
  const live = useRef({ editingBlocked, numberedEditingBlocked, continuousRange, modal, beforeAction, execute });
  const executeLatest: EditorCommandAdapter = useCallback(
    (command, impact, submission) => live.current.execute(command, impact, submission),
    [],
  );
  const beforeLatest = useCallback(() => live.current.beforeAction(), []);
  const getRhythmPatternTarget = useCallback(() => {
    const now = session.getState();
    return now.document
      ? resolveEditorRhythmPatternTarget(now.document, now.selection, live.current.continuousRange, getActiveTarget(), now.numberedSelection)
      : { ok: false as const, message: "当前没有可编辑的乐谱。" };
  }, [session, getActiveTarget]);
  const getSelectionIdentity = useCallback(() => {
    const now = session.getState();
    return JSON.stringify({ selection: now.selection, numberedSelection: now.numberedSelection, continuousRange: live.current.continuousRange, activeTarget: getActiveTarget() });
  }, [session, getActiveTarget]);
  const blockedReason = useCallback(
    () => (live.current.editingBlocked ? "先完成属性编辑，再修改 TAB。" : null),
    [],
  );
  const restorePaste = useCallback(() => host.current?.restore("beat"), []);
  // 构造函数只保存以下延迟回调，不会在 render 中读取 ref；读取发生于用户意图或订阅通知。
  // eslint-disable-next-line react-hooks/refs
  const [paste] = useState(() =>
    createBeatPasteController({
      session,
      drafts,
      modals,
      execute: executeLatest,
      beforeAction: beforeLatest,
      getBlockedReason: blockedReason,
      restoreFocus: restorePaste,
    }),
  );
  useEffect(() => paste.start(), [paste]);
  useLayoutEffect(() => {
    live.current = { editingBlocked, numberedEditingBlocked, continuousRange, modal, beforeAction, execute };
    paste.invalidate();
  }, [paste, editingBlocked, numberedEditingBlocked, continuousRange, modal, beforeAction, execute]);
  useEffect(() => {
    if (modal && modal.request.kind !== "rhythm-pattern-discard" && modal.request.kind !== "shortcuts") host.current?.close();
  }, [modal]);
  if (!document) return null;
  const rhythmPatternTarget = resolveEditorRhythmPatternTarget(document, selection, continuousRange, activeTarget, numberedSelection);
  const rhythmPatternBlocked = (rhythmPatternTarget.ok && rhythmPatternTarget.target.layer === "numbered"
    ? numberedEditingBlocked : editingBlocked) || !!modal || drafts.inspect().pending.length > 0;
  const tools = deriveEditorToolState(document, selection);
  const measureFocus = activeTarget ?? numberedSelection ?? selection?.focus;
  const measureTarget = continuousRange
    ? { trackId: continuousRange.trackId, measureId: continuousRange.focus.measureId }
    : measureFocus ? { trackId: measureFocus.trackId, measureId: measureFocus.measureId } : null;
  const measureControlTarget = resolveMeasureControlTarget(document, measureTarget);
  const tabReason = tabToolTargetReason(session.getState(), activeTarget);
  const tabPanelReason = activeTarget || continuousRange ? "请先选择 TAB 目标。" : tabReason;
  const tabPanelSelection = tabPanelReason ? null : selection;
  const tupletTarget = resolveTupletToolbarTarget(document, tabPanelSelection);
  const canUseTuplet = !!tupletTarget.range?.group || LXM_TUPLET_RATIOS.some(({ actual }) => !tupletTarget.ratioReason(actual));
  const canUseTechnique = !tabPanelReason && (
    document.score.tracks.some(track => track.techniques.some(item => item.id === selectedTechniqueId)) ||
    TECHNIQUE_OPTIONS.some(({ value }) => !toolbarTechniqueAvailability(document, selection, value, null)) ||
    techniquesInToolbarSelection(document, selection).length > 0
  );
  const toolTargetReasons = {
    measure: measureControlTarget ? null : "请选择目标小节。",
    beat: rhythmPatternTarget.ok ? null : rhythmPatternTarget.message,
    tuplet: canUseTuplet ? null : tabPanelReason || tupletTarget.reason || "请选择同小节内符合连音比例的连续拍点，或选中已有连音组。",
    technique: canUseTechnique ? null : tabPanelReason || "当前 TAB 选区没有可用的技巧。",
  };
  const tieTarget = resolveEditorTieTarget(document, selection, continuousRange, activeTarget);
  const tieAvailability: ToolAvailability = tieTarget.kind === "numbered"
    ? modal || numberedEditingBlocked
      ? { enabled: false, reason: "请先完成当前草稿或确认操作。" }
      : { enabled: tieTarget.ok, reason: tieTarget.ok ? "" : tieTarget.message }
    : { enabled: tieTarget.ok && !tabReason, reason: tabReason ?? (tieTarget.ok ? "" : tieTarget.message) };
  const chordTarget = resolveEditorChordTarget(document, selection, activeTarget, !!numberedSelection || !!continuousRange);
  const chordAvailability: ToolAvailability = modal || chordEntryBlocked
    ? { enabled: false, reason: "请先完成当前输入或弹层操作。" }
    : !onOpenChord
      ? { enabled: false, reason: "和弦编辑入口暂不可用。" }
      : { enabled: chordTarget.enabled, reason: chordTarget.reason };
  // 干净的和弦气泡会锁住 TAB 工具，但不应锁住自身的删除入口。
  const chordDeletionAvailability: ToolAvailability = protectedDraft || drafts.inspect().busy
    ? { enabled: false, reason: "请先应用或取消当前草稿。" }
    : chordAvailability;
  const chordActive = activeTarget?.kind === "chord" && !!chordTarget.target &&
    activeTarget.trackId === chordTarget.target.trackId &&
    activeTarget.measureId === chordTarget.target.measureId &&
    activeTarget.beatId === chordTarget.target.beatId;
  const reason = editingBlocked
    ? "先完成属性编辑，再修改 TAB；可继续浏览工具说明。"
    : null;
  const available = (value: ToolAvailability): ToolAvailability =>
    modal || editingBlocked
      ? { enabled: false, reason: modal ? "请先完成当前弹层操作。" : reason! }
      : value;
  const restAvailability = available(tabReason ? { enabled: false, reason: tabReason } : tools.beatRange);
  const run: ToolActionHandler = async (action) => {
    beforeAction();
    if (action.type === "quickTechnique" && action.technique === "tie" &&
      isNumberedTieTarget(live.current.continuousRange, getActiveTarget())) {
      const now = session.getState();
      if (live.current.modal || live.current.numberedEditingBlocked || !now.document ||
        !resolveEditorTieTarget(now.document, now.selection, live.current.continuousRange, getActiveTarget()).ok)
        return false;
      const success = await onAction(action);
       return success;
    }
    if ((action.type === "restToggle" || action.type === "quickTechnique") &&
      tabToolTargetReason(session.getState(), getActiveTarget())) return false;
    if (
      action.type !== "undo" &&
      action.type !== "redo" &&
      live.current.editingBlocked
    )
      return false;
    const success = await onAction(action);
    if (success && !("target" in action) && action.type !== "quickTechnique") host.current?.close(true);
    return success;
  };
  const rhythmTarget = resolveEditorRhythmTarget(
    document,
    selection,
    activeTarget,
    inputRhythm,
    inputRhythmExplicit,
    tabInputRhythmOverrides,
  );
  const rhythmAvailability: ToolAvailability =
    modal ||
    (rhythmTarget.kind === "numbered" ? numberedBlocked : editingBlocked)
      ? { enabled: false, reason: "请先完成当前草稿或确认操作。" }
      : { enabled: rhythmTarget.enabled, reason: rhythmTarget.reason };
  const runRhythm: ToolActionHandler = async (action) => {
    beforeAction();
    if (!rhythmAvailability.enabled) return false;
    return onAction(action);
  };
  const exitPlayback = () => {
    playback.setEnabled(false);
    playbackToggleRef.current?.focus({ preventScroll: true });
  };
  const togglePlayback = () => {
    if (playback.enabled) {
      exitPlayback();
      return;
    }
    const protection = drafts.inspect();
    if (modals.isOpen() || protection.composing || protection.busy || isPlaybackEntryBlocked() ||
      protection.pending.some((item) => item.kind === "technique" || item.kind === "beatPaste") ||
      host.current?.prepareHide() === false) {
      setPlaybackEntryNotice("请先完成当前输入或处理编辑工具中的草稿，再切换至试听。");
      return;
    }
    setPlaybackEntryNotice("");
    beforeAction();
    playback.setEnabled(true);
  };
  return (
    <div
      className={toolbarStyles.root}
      role="toolbar"
      aria-label={playback.enabled ? "木吉他试听" : "节奏、小节与历史工具"}
      aria-describedby={playback.enabled ? "editor-playback-description" : "editor-tool-reason"}
    >
      {playback.enabled ? <PlaybackToolbar playback={playback} onExit={exitPlayback} /> : <div className={toolbarStyles.content}>
      <div className={`${toolbarStyles.row} ${toolbarStyles.primary}`} data-toolbar-row="rhythm">
      <div className={toolbarStyles.toolbarGroup} role="group" aria-label="历史">
        <ToolButton
          label="撤销"
          title={<ShortcutHint shortcuts={["undo"]} />}
          disabledTitle={modal ? undefined : <ShortcutHint shortcuts={["undo"]} note="没有可撤销的修改。" />}
          availability={{
            enabled: canUndo && !modal,
            reason: modal
              ? "请先完成当前弹层操作。"
              : canUndo
                ? ""
                : "没有可撤销的修改。",
          }}
          onClick={() => void run({ type: "undo" })}
        >
          <UndoOutlined className={symbolStyles.historyIcon} />
        </ToolButton>
        <ToolButton
          label="重做"
          title={<ShortcutHint shortcuts={["redo"]} />}
          disabledTitle={modal ? undefined : <ShortcutHint shortcuts={["redo"]} note="没有可重做的修改。" />}
          availability={{
            enabled: canRedo && !modal,
            reason: modal
              ? "请先完成当前弹层操作。"
              : canRedo
                ? ""
                : "没有可重做的修改。",
          }}
          onClick={() => void run({ type: "redo" })}
        >
          <RedoOutlined className={symbolStyles.historyIcon} />
        </ToolButton>
      </div>
      <div
        className={toolbarStyles.toolbarGroup}
        role="group"
        aria-label="基础时值"
      >
        {RHYTHMS.map((rhythm) => (
          <ToolButton
            key={rhythm.base}
            label={`设置为${rhythm.label}`}
            availability={rhythmAvailability}
            pressed={rhythmTarget.rhythm?.base === rhythm.base}
            onClick={() =>
              void runRhythm({ type: "rhythm", base: rhythm.base })
            }
          >
            <MusicAssetIcon
              assetId={rhythm.icon}
              className={editorToolPanelStyles.toolbarIcon}
            />
          </ToolButton>
        ))}
      </div>
      <div
        className={toolbarStyles.toolbarGroup}
        role="group"
        aria-label="附点与休止"
      >
        {([1, 2] as const).map((dots) => (
          <ToolButton
            key={dots}
            label={dots === 1 ? "单附点" : "双附点"}
            title={`${dots === 1 ? "单附点：原时值的 1.5 倍" : "双附点：原时值的 1.75 倍"}；再次点击取消附点`}
            availability={rhythmAvailability}
            pressed={rhythmTarget.rhythm?.dots === dots}
            onClick={() =>
              void runRhythm({
                type: "dots",
                // 与时值共用当前谱层的目标；重复点击恢复普通时值。
                dots: rhythmTarget.rhythm?.dots === dots ? 0 : dots,
              })
            }
          >
            <MusicAssetIcon
              assetId={dots === 1 ? "noteDot" : "noteDoubleDotted"}
              className={editorToolPanelStyles.toolbarIcon}
            />
          </ToolButton>
        ))}
        <ToolButton label="切换休止" availability={restAvailability}
          pressed={tools.restState === "all"}
          title={<ShortcutHint shortcuts={["rest", "restore"]} note={tools.restState === "mixed" ? "点击将混合选区统一设为休止。" : "取消休止后得到空拍。"} />}
          disabledTitle={modal ? undefined : <ShortcutHint shortcuts={["rest", "restore"]} note={restAvailability.reason} />}
          onClick={() => void run({ type: "restToggle" })}><TechniqueSymbol kind="rest" /></ToolButton>
      </div>
      </div>
      <div className={`${toolbarStyles.row} ${toolbarStyles.secondary}`} data-toolbar-row="techniques">
      <EditorToolPanelHost
        ref={host}
        quickTechniques={(["hammerOn", "pullOff", "slide", "tie", "strumDown", "strumUp", "arpeggioDown", "arpeggioUp"] as const).map((quick) => {
          const result = quick === "tie" ? tieTarget : resolveQuickTechnique(document, selection, quick);
          const labels = { hammerOn: "击弦 H", pullOff: "勾弦 P", slide: "滑音", tie: "延音线", strumDown: "下扫：从低音弦到高音弦，箭头向上", strumUp: "上扫：从高音弦到低音弦，箭头向下", arpeggioDown: "下琶音：从低音弦到高音弦，箭头向上", arpeggioUp: "上琶音：从高音弦到低音弦，箭头向下" };
          return <ToolButton key={quick} label={quick === "tie" && tieTarget.kind === "numbered" ? "简谱延音线" : labels[quick]}
            availability={quick === "tie" && tieTarget.kind === "numbered" ? tieAvailability : available(tabReason ? { enabled: false, reason: tabReason } : { enabled: result.ok, reason: result.ok ? "" : result.message })}
            pressed={result.ok && result.pressed}
            onClick={() => void run({ type: "quickTechnique", technique: quick })}>
            {quick === "hammerOn" ? "H" : quick === "pullOff" ? "P" : quick === "slide" ? "S" : <TechniqueSymbol kind={quick} />}
          </ToolButton>;
        })}
        beforeOpen={(group) => { if (group === "beat") beforeRhythmPatternAction?.(); else beforeAction(); }}
        blocked={!!modal}
        preserveOnBlock={modal?.request.kind === "rhythm-pattern-discard" || modal?.request.kind === "shortcuts"}
        targetReasons={toolTargetReasons}
        canHide={() => !rhythmBusyRef.current && !sharedRhythmBusy && !immediateBusyRef.current && (techniquePanel.current?.canHide() ?? true)}
        onHideTechnique={() => techniquePanel.current?.discard()}
        subscribeProtection={drafts.subscribe}
        onTechniqueIntent={(intent) => techniquePanel.current?.openTechnique(intent) ?? false}
        beatTargetIdentity={rhythmPatternTarget.ok ? JSON.stringify(rhythmPatternTarget.target) : null}
        getBeatTargetIdentity={() => {
          const target = getRhythmPatternTarget();
          return target.ok ? JSON.stringify(target.target) : null;
        }}
      >
        {{
          measure: (
            <div aria-label="小节工具菜单">
              <div className={measureStyles.header}>
                <h3>小节工具</h3><span>{measureControlTarget ? `第 ${measureControlTarget.index + 1} 小节` : "未选择小节"}</span>
                <Button type="text" aria-label="关闭小节工具" onClick={() => host.current?.close(true)}>×</Button>
              </div>
              <div className={measureStyles.measureMenu}>
                <MeasureBoundary document={document} target={measureTarget} blocked={editingBlocked || !!modal} onAction={run} />
                <MeasureActions document={document} target={measureTarget} blocked={editingBlocked || !!modal} onAction={run}
                  getDocument={() => session.getState().document}
                  getTargetIdentity={getSelectionIdentity}
                  onBusyChange={setImmediateBusy} />
              </div>
            </div>
          ),
          beat: (
            <RhythmPatternPanel
              session={session}
              document={document}
              targetResult={rhythmPatternTarget}
              targetIdentity={JSON.stringify({ selection, numberedSelection, continuousRange, activeTarget })}
              getTargetResult={getRhythmPatternTarget}
              getTargetIdentity={getSelectionIdentity}
              beforeAction={() => beforeRhythmPatternAction?.()}
              execute={executeLatest}
              blocked={rhythmPatternBlocked}
              getBlocked={() => {
                const target = getRhythmPatternTarget();
                return !!live.current.modal || (target.ok && target.target.layer === "numbered"
                  ? live.current.numberedEditingBlocked : live.current.editingBlocked) || drafts.inspect().busy || drafts.inspect().pending.length > 0;
              }}
              onBusyChange={setRhythmProtection}
              onScopeChange={onRhythmPatternScopeChange}
              onClose={() => host.current?.close(true)}
              onHandoff={() => host.current?.close()}
              onSuccess={(scope) => { onRhythmPatternScopeChange?.(scope); host.current?.close(true); }}
            />
          ),
          tuplet: (
            <div>
              <div className={measureStyles.header}><h3>连音工具</h3><Button type="text" aria-label="关闭连音工具" onClick={() => host.current?.close(true)}>×</Button></div>
                <TupletToolbar
                  document={document}
                  selection={tabPanelSelection}
                  execute={execute}
                  blocked={editingBlocked}
                  blockedReason={tabPanelReason ?? undefined}
                  onBusyChange={setImmediateBusy}
                />
            </div>
          ),
          technique: (
            <TechniqueToolbar
              ref={techniquePanel}
              document={document}
              selection={selection}
              selectedTechniqueId={selectedTechniqueId}
              execute={execute}
              blocked={techniqueBlocked || !!tabPanelReason}
              beforeAction={beforeAction}
              getActiveTarget={getActiveTarget}
              setSelectedTechniqueId={setSelectedTechniqueId}
              setErrorMessage={setErrorMessage}
              onShowParameters={() =>
                host.current?.open(
                  "technique",
                  '[data-technique-parameters] input, [data-technique-parameters] button, [data-technique-parameters] [role="combobox"]',
                )
              }
              onClose={() => host.current?.close(true)}
              onSuccess={() => {}}
            />
          ),
        }}
      </EditorToolPanelHost>
      <div className={toolbarStyles.toolbarGroup} role="group" aria-label="和弦">
        <ToolButton
          label={chordTarget.label}
          title={chordTarget.title}
          availability={chordAvailability}
          pressed={chordActive}
          expanded={chordActive}
          onClick={() => {
            if (!chordAvailability.enabled || !chordTarget.target) return;
            onOpenChord?.(chordTarget.target);
            host.current?.close();
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 4v16M8 4v16M12 4v16M16 4v16M4 5h12M4 10h12M4 15h12M4 20h12" />
            <circle cx="8" cy="10" r="2" fill="currentColor" />
            {!chordTarget.chord && <path d="M20 3v6m-3-3h6" />}
          </svg>
        </ToolButton>
        {chordTarget.chord && chordTarget.target && (
          <ToolButton
            label="删除和弦"
            title={`删除当前拍的和弦名称与指法 · ${chordTarget.chord.chord.name}`}
            availability={chordDeletionAvailability}
            onClick={async () => {
              if (!chordDeletionAvailability.enabled || !chordTarget.target || !chordTarget.chord) return;
              beforeAction();
              const result = await execute({
                type: LXMScoreCommandEnum.RemoveChordSymbol,
                ...chordTarget.target,
                chordSymbolId: chordTarget.chord.id,
              });
              if (result.status === "applied" || result.status === "noop") host.current?.close(true);
              else if ("message" in result) setErrorMessage(result.message);
            }}
          >
            <DeleteOutlined />
          </ToolButton>
        )}
      </div>
      </div>
      </div>}
      <div className={toolbarStyles.viewControls} role="group" aria-label="工作区布局" data-editor-associated-panel="music-text-sidebar" data-editor-panel-control>
        <Tooltip title={playback.enabled ? "退出木吉他试听" : "进入木吉他试听"} trigger={["hover", "focus"]} placement="bottomRight">
          <button
            ref={playbackToggleRef}
            type="button"
            className={toolbarStyles.panelToggle}
            aria-label="木吉他试听"
            aria-controls={playback.enabled ? "editor-playback-controls" : undefined}
            aria-pressed={playback.enabled}
            data-playback-toggle
            onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }}
            onClick={togglePlayback}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !playback.enabled || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.stopPropagation();
              exitPlayback();
            }}
          >
            <Headphones size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip title={sidebarCollapsed ? "展开编辑面板" : "收起编辑面板"} trigger={["hover", "focus"]} placement="bottomRight">
        <button
          ref={sidebarToggleRef}
          type="button"
          className={toolbarStyles.panelToggle}
          aria-label="编辑面板"
          aria-controls="music-text-sidebar"
          aria-expanded={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
            {!sidebarCollapsed && <path d="M17 7h2v10h-2z" fill="currentColor" stroke="none" />}
          </svg>
        </button>
        </Tooltip>
      </div>
      <span id="editor-tool-reason" className={toolbarStyles.hint}>
        {rhythmAvailability.reason || reason || "当前选区可编辑音符与节奏。"}
      </span>
      {playbackEntryNotice && <Alert className={toolbarStyles.toolbarNotice} type="warning" title={playbackEntryNotice} showIcon closable onClose={() => setPlaybackEntryNotice("")} />}
      <PasteNotice controller={paste} />
    </div>
  );
};
const PasteNotice = ({
  controller,
}: {
  controller: ReturnType<typeof createBeatPasteController>;
}) => {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return state.notice ? (
    <Alert
      className={toolbarStyles.toolbarNotice}
      type={state.phase === "stale" ? "warning" : "info"}
      title={state.notice}
      showIcon
    />
  ) : null;
};
