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
  CopyOutlined,
  DeleteOutlined,
  RedoOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { LXMScoreCommandEnum, type ILXMRhythm } from "@liuxianmao/lxm-editor";
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
import { editorShortcutLabel } from "../session/editor-shortcuts";
import { BeatToolbar } from "../tools/BeatToolbar";
import { TupletToolbar } from "../tools/TupletToolbar";
import { TechniqueToolbar, type TechniqueToolbarController } from "../tools/TechniqueToolbar";
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
import editorFormStyles from "../shared/editor-form.module.scss";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import { resolveEditorRhythmTarget } from "../tools/editor-rhythm-target";
import { resolveEditorChordTarget } from "../chords/editor-chord-target";
import { currentChordTechniqueDirection, resolveQuickTechnique } from "../tools/editor-technique-target";
import { tabToolTargetReason } from "../tools/editor-tool-guard";
import { EditorToolSymbolButton, TechniqueSymbol } from "../tools/EditorToolSymbolButton";
import symbolStyles from "../tools/EditorToolSymbolButton.module.scss";
import toolbarStyles from "./EditorToolbar.module.scss";
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
  blocked,
  numberedBlocked,
  onAction,
  beforeAction,
  execute,
  onNavigate,
  onOpenChord,
  chordEntryBlocked = false,
  sidebarCollapsed,
  onToggleSidebar,
  sidebarToggleRef,
}: {
  activeTarget: MusicTextTarget | null;
  blocked: boolean;
  numberedBlocked: boolean;
  onAction: ToolActionHandler;
  beforeAction: () => void;
  execute: EditorCommandAdapter;
  onNavigate: (destination: ToolNavigation) => SelectionRequestResult;
  onOpenChord?: (target: MusicTextTarget) => void;
  chordEntryBlocked?: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  sidebarToggleRef: Ref<HTMLButtonElement>;
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
  const techniquePanel = useRef<TechniqueToolbarController>(null);
  const activeTargetRef = useRef(activeTarget);
  useLayoutEffect(() => { activeTargetRef.current = activeTarget; }, [activeTarget]);
  const getActiveTarget = useCallback(() => activeTargetRef.current, []);
  const protectedDraft = drafts
    .inspect()
    .pending.some((item) => item.kind !== "beatPaste" && item.kind !== "fret");
  const editingBlocked = blocked || protectedDraft || drafts.inspect().busy;
  const techniqueBlocked = blocked || drafts.inspect().pending.some(
    (item) => item.kind !== "beatPaste" && item.kind !== "fret" && item.kind !== "technique",
  );
  const live = useRef({ editingBlocked, beforeAction, execute });
  const executeLatest: EditorCommandAdapter = useCallback(
    (command, impact, submission) => live.current.execute(command, impact, submission),
    [],
  );
  const beforeLatest = useCallback(() => live.current.beforeAction(), []);
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
    live.current = { editingBlocked, beforeAction, execute };
    paste.invalidate();
  }, [paste, editingBlocked, beforeAction, execute]);
  useEffect(() => {
    if (modal) host.current?.close();
  }, [modal]);
  if (!document) return null;
  const tools = deriveEditorToolState(document, selection);
  const tabReason = tabToolTargetReason(session.getState(), activeTarget);
  const chordTarget = resolveEditorChordTarget(document, selection, activeTarget, !!numberedSelection);
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
  const run: ToolActionHandler = async (action) => {
    beforeAction();
    if ((action.type === "restToggle" || action.type === "quickTechnique") &&
      tabToolTargetReason(session.getState(), getActiveTarget())) return false;
    if (
      action.type !== "undo" &&
      action.type !== "redo" &&
      live.current.editingBlocked
    )
      return false;
    const success = await onAction(action);
    if (success) host.current?.close(true);
    return success;
  };
  const navigate = (destination: ToolNavigation) => {
    const result = onNavigate(destination);
    if (result !== "blocked") host.current?.close();
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
  return (
    <div
      className={toolbarStyles.root}
      role="toolbar"
      aria-label="节奏、小节与历史工具"
      aria-describedby="editor-tool-reason"
    >
      <div className={toolbarStyles.content}>
      <div className={`${toolbarStyles.row} ${toolbarStyles.primary}`} data-toolbar-row="rhythm">
      <div className={toolbarStyles.toolbarGroup} role="group" aria-label="历史">
        <ToolButton
          label="撤销"
          title={editorShortcutLabel("undo")}
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
          title={editorShortcutLabel("redo")}
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
        aria-label={rhythmTarget.kind === "numbered" ? "简谱时值" : "六线谱时值"}
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
        aria-label={rhythmTarget.kind === "numbered" ? "简谱附点" : "六线谱附点"}
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
      </div>
      </div>
      <div className={`${toolbarStyles.row} ${toolbarStyles.secondary}`} data-toolbar-row="techniques">
      <div className={symbolStyles.quickGroup} role="group" aria-label="休止与吉他技巧快捷">
        <ToolButton label="切换休止" availability={available(tabReason ? { enabled: false, reason: tabReason } : tools.beatRange)}
          pressed={tools.restState === "all"}
          title={`切换休止（${editorShortcutLabel("rest")}）；${tools.restState === "mixed" ? "当前为混合状态，点击统一设为休止。" : ""}休止影响整拍全部弦并清空音符；取消休止仅得到空普通拍，恢复音符请撤销。`}
          onClick={() => void run({ type: "restToggle" })}><TechniqueSymbol kind="rest" /></ToolButton>
        {(["hammerOn", "pullOff", "slide", "tie", "strumDown", "strumUp", "arpeggioDown", "arpeggioUp"] as const).map((quick) => {
          const result = resolveQuickTechnique(document, selection, quick);
          const labels = { hammerOn: "击弦 H", pullOff: "勾弦 P", slide: "滑音", tie: "延音线", strumDown: "下扫：从低音弦到高音弦，箭头向上", strumUp: "上扫：从高音弦到低音弦，箭头向下", arpeggioDown: "下琶音：从低音弦到高音弦，箭头向上", arpeggioUp: "上琶音：从高音弦到低音弦，箭头向下" };
          return <ToolButton key={quick} label={labels[quick]}
            title={quick === "tie" ? "延音线：连接相邻拍上的同弦同品位音符；单选起音连接同弦下一音。" : undefined}
            availability={available(tabReason ? { enabled: false, reason: tabReason } : { enabled: result.ok, reason: result.ok ? "" : result.message })}
            pressed={quick === "strumDown" || quick === "strumUp" || quick === "arpeggioDown" || quick === "arpeggioUp"
              ? currentChordTechniqueDirection(document, selection, quick.startsWith("strum") ? "strum" : "arpeggio") === (quick.endsWith("Down") ? "down" : "up")
              : quick === "tie" && result.ok ? result.pressed : undefined}
            onClick={() => void run({ type: "quickTechnique", technique: quick })}>
            {quick === "hammerOn" ? "H" : quick === "pullOff" ? "P" : quick === "slide" ? "S" : <TechniqueSymbol kind={quick} />}
          </ToolButton>;
        })}
      </div>
      <EditorToolPanelHost
        ref={host}
        beforeOpen={beforeAction}
        blocked={!!modal}
        reason={reason}
        canHide={() => techniquePanel.current?.canHide() ?? true}
        onHideTechnique={() => techniquePanel.current?.discard()}
        subscribeProtection={drafts.subscribe}
        onTechniqueIntent={(intent) => techniquePanel.current?.openTechnique(intent) ?? false}
      >
        {{
          measure: (
            <div className={editorToolPanelStyles.toolMenu} aria-label="小节工具菜单">
              <div className={editorToolPanelStyles.toolTarget}>
                {tools.focused
                  ? `目标：第 ${tools.focused.index + 1} 小节`
                  : "尚未选择目标小节"}
              </div>
              <Button
                data-tool-action="measure-actions"
                block
                disabled={!available(tools.singleMeasure).enabled}
                onClick={() => void run({ type: "insertMeasure" })}
              >
                在当前小节后新增
              </Button>
              <Button
                block
                icon={<CopyOutlined />}
                disabled={!available(tools.copyMeasures).enabled}
                onClick={() => void run({ type: "copyMeasures" })}
              >
                {new Set(tools.range?.beats.map((item) => item.measureId))
                  .size > 1
                  ? "直接复制所选连续小节范围"
                  : "复制当前小节"}
              </Button>
              <p data-editor-form-hint className={editorFormStyles.settingsHint}>
                新副本插入到所选范围末小节之后。
              </p>
              <Button block onClick={() => navigate("copy")}>
                配置小节范围复制…
              </Button>
              <Button
                block
                danger
                icon={<DeleteOutlined />}
                disabled={!available(tools.removeMeasure).enabled}
                onClick={() => void run({ type: "removeMeasure" })}
              >
                删除当前小节
              </Button>
              {!tools.removeMeasure.enabled && (
                <p data-editor-form-hint className={editorFormStyles.settingsHint}>
                  {tools.removeMeasure.reason}
                </p>
              )}
              <Button
                data-tool-action="measure-properties"
                block
                onClick={() => navigate("measure")}
              >
                小节属性…
              </Button>
              <Button block onClick={() => navigate("barline")}>
                六类小节线…
              </Button>
              <Button block onClick={() => navigate("section")}>
                段落标记（仅元数据）…
              </Button>
              <p data-editor-form-hint className={editorFormStyles.settingsHint}>
                当前段落：{tools.focused?.measure.sectionLabel || "未设置"}
              </p>
            </div>
          ),
          beat: (
            <BeatToolbar
              controller={paste}
              beforeAction={beforeAction}
              execute={execute}
              blocked={editingBlocked}
              onSuccess={() => host.current?.close(true)}
            />
          ),
          tuplet: (
            <div className={editorToolPanelStyles.toolMenu}>
              {!numberedSelection && (
                <TupletToolbar
                  document={document}
                  selection={selection}
                  execute={execute}
                  blocked={editingBlocked}
                  onSuccess={() => host.current?.close(true)}
                />
              )}
              <Button block onClick={() => navigate("tuplet")}>
                连音比例与选区详情…
              </Button>
              {numberedSelection && (
                <Button block onClick={() => navigate("note")}>
                  简谱时值与连接…
                </Button>
              )}
            </div>
          ),
          technique: (
            <TechniqueToolbar
              ref={techniquePanel}
              document={document}
              selection={selection}
              selectedTechniqueId={selectedTechniqueId}
              execute={execute}
              blocked={techniqueBlocked || !!tabReason}
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
              onSuccess={() => host.current?.close(true)}
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
      </div>
      <div className={toolbarStyles.viewControls} role="group" aria-label="工作区布局" data-editor-associated-panel="music-text-sidebar" data-editor-panel-control>
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
