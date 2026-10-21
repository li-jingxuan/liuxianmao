"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Alert, Button, Popover, Select, Tooltip } from "antd";
import {
  CopyOutlined,
  LinkOutlined,
  PauseOutlined,
  DeleteOutlined,
  RedoOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { createNumberedRhythmContext, getMeasureCapacityTicks, type ILXMRhythm, type ILXMNumberedTarget, type ILXMDocument } from "@liuxianmao/lxm-editor";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import { MusicAssetIcon } from "../MusicAssetIcon";
import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";
import {
  deriveEditorToolState,
  type ToolAvailability,
} from "./editor-tool-state";
import { editorShortcutLabel } from "./editor-shortcuts";
import { BeatToolbar } from "./BeatToolbar";
import { TupletToolbar } from "./TupletToolbar";
import { TechniqueToolbar } from "./TechniqueToolbar";
import {
  EditorToolPanelHost,
  type EditorToolPanelController,
} from "./EditorToolPanelHost";
import { createBeatPasteController } from "./beat-paste-controller";
import { formatNumberedBeatPosition } from "./numbered-editor-target";
import { useEditorRuntime } from "./EditorSessionRuntime";
import type { EditorCommandAdapter } from "./editor-command-adapter";
import type { ToolActionHandler } from "./editor-tool-actions";
import type { ToolNavigation } from "./editor-tool-catalog";
import type { SelectionRequestResult } from "./editor-object-selection";
import styles from "./index.module.scss";
export type { EditorToolbarAction } from "./editor-tool-actions";

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
const ToolButton = ({
  label,
  availability,
  onClick,
  children,
  pressed,
  title,
}: {
  label: string;
  availability: ToolAvailability;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  title?: string;
}) => (
  <Tooltip title={availability.reason || title || label}>
    <span
      className={styles.toolButtonWrap}
      tabIndex={!availability.enabled ? 0 : undefined}
      aria-label={!availability.enabled ? availability.reason : undefined}
    >
      <Button
        aria-label={label}
        aria-pressed={pressed}
        disabled={!availability.enabled}
        onClick={onClick}
        color={pressed ? "primary" : "default"}
        variant={pressed ? "filled" : "text"}
        className={styles.musicToolButton}
      >
        {children}
      </Button>
    </span>
  </Tooltip>
);

/** 简谱快捷技巧只提供显式端点选择；音乐规则继续由核心 numbered command 校验。 */
const NumberedQuickTechniques = ({
  document,
  target,
  blocked,
  getBlocked,
  execute,
}: {
  document: ILXMDocument;
  target: ILXMNumberedTarget | null;
  blocked: boolean;
  getBlocked: () => boolean;
  execute: EditorCommandAdapter;
}) => {
  const session = useEditorSessionStore();
  const [kind, setKind] = useState<"tie" | "slur" | null>(null);
  const [destination, setDestination] = useState<string>();
  const resolved = useMemo(() => {
    if (!target) return null;
    const track = document.score.tracks.find((item) => item.id === target.trackId);
    if (!track) return null;
    const measure = track.measures.find((item) => item.id === target.measureId);
    if (!measure) return null;
    const event = target.kind === "numberedEvent"
      ? measure.numberedVoice.events.find((item) => item.id === target.eventId)
      : measure.numberedVoice.events.find((item) => item.tick <= target.tick && item.tick < target.endTick);
    if (!event || event.kind !== "notes") return null;
    const item = target.kind === "numberedEvent" && target.itemId
      ? event.items.find((candidate) => candidate.id === target.itemId) ?? event.items[0]
      : event.items[0];
    return { track, measure, event, item };
  }, [document, target]);
  const blockedReason = blocked ? "先完成当前简谱草稿或确认操作。" : !resolved ? "请先选择简谱音符。" : "";
  const enabled = !!resolved && !blocked;
  const options = useMemo(() => {
    if (!resolved || !kind) return [];
    if (kind === "tie") {
      const orderedItems = resolved.track.measures.flatMap((measure, measureIndex) => {
        const measureOffset = resolved.track.measures
          .slice(0, measureIndex)
          .reduce((sum, previous) => sum + getMeasureCapacityTicks(previous.timeSignature), 0);
        const rhythm = createNumberedRhythmContext(measure.numberedVoice);
        const items = measure.numberedVoice.events.flatMap((event) => {
          const duration = rhythm.getEventDurationTicks(event);
          return event.kind === "notes" && duration.ok
            ? event.items.map((item) => ({
                value: item.id,
                label: `${measureIndex + 1}小节 · ${formatNumberedBeatPosition(event.tick, measure.timeSignature.denominator)} · ${item.token}`,
                token: item.token,
                start: measureOffset + event.tick,
                end: measureOffset + event.tick + duration.ticks,
              }))
            : [];
        });
        return items;
      });
      const origin = orderedItems.find((item) => item.value === resolved.item.id);
      return origin
        ? orderedItems
            .filter((candidate) => candidate.start === origin.end && candidate.token.replace(/^n/, "") === resolved.item.token.replace(/^n/, ""))
            .map(({ value, label }) => ({ value, label }))
        : [];
    }
    const originMeasureIndex = resolved.track.measures.indexOf(resolved.measure);
    const originOrder = resolved.measure.numberedVoice.events.indexOf(resolved.event);
    return resolved.track.measures.flatMap((measure, measureIndex) =>
      measure.numberedVoice.events
        .filter((event) => event.kind === "notes" && (measureIndex > originMeasureIndex || measureIndex === originMeasureIndex && measure.numberedVoice.events.indexOf(event) > originOrder))
        .map((event) => ({ value: event.id, label: `${measureIndex + 1}小节 · ${formatNumberedBeatPosition(event.tick, measure.timeSignature.denominator)} · ${event.items.map((item) => item.token).join("+")}` })),
    );
  }, [kind, resolved]);
  const choose = (next: "tie" | "slur") => {
    setDestination(undefined);
    setKind(next);
  };
  const apply = async () => {
    if (!resolved || !kind || !destination || getBlocked()) return;
    const liveTarget = session.getState().numberedSelection;
    if (JSON.stringify(liveTarget) !== JSON.stringify(target)) {
      setKind(null);
      return;
    }
    const result = await execute({
      type: "numbered.mark.add",
      trackId: resolved.track.id,
      mark: kind === "tie"
        ? { type: "tie", fromItemId: resolved.item.id, toItemId: destination }
        : { type: "slur", fromEventId: resolved.event.id, toEventId: destination },
    });
    if (result.status === "applied" || result.status === "noop") setKind(null);
  };
  const popover = (type: "tie" | "slur") => (
    <div className={styles.toolMenu} aria-label={type === "tie" ? "添加简谱延音线" : "添加简谱连音线"}>
      <div className={styles.toolTarget}>起点：{resolved ? `${resolved.event.items.map((item) => item.token).join("+")} · ${resolved.item.token}` : "未选择简谱音符"}</div>
      <label className={styles.toolbarField}>
        <span>连接终点</span>
        <Select
          aria-label={type === "tie" ? "简谱延音线终点" : "简谱连音线终点"}
          value={kind === type ? destination : undefined}
          onChange={setDestination}
          style={{ width: 230 }}
          options={options}
          placeholder="请选择后续音符"
          disabled={!enabled || kind !== type}
        />
      </label>
      <Button type="primary" disabled={!enabled || kind !== type || !destination} onClick={() => void apply()}>
        添加{type === "tie" ? "延音线" : "连音线"}
      </Button>
    </div>
  );
  const toggleFermata = async () => {
    if (!resolved || !enabled || getBlocked()) return;
    const liveTarget = session.getState().numberedSelection;
    if (JSON.stringify(liveTarget) !== JSON.stringify(target)) return;
    const existing = resolved.track.numberedMarks.find((mark) => mark.type === "fermata" && mark.eventId === resolved.event.id);
    await execute(existing
      ? { type: "numbered.mark.remove", trackId: resolved.track.id, markId: existing.id }
      : { type: "numbered.mark.add", trackId: resolved.track.id, mark: { type: "fermata", eventId: resolved.event.id } });
  };
  if (!target) return null;
  const hasFermata = !!resolved?.track.numberedMarks.some((mark) => mark.type === "fermata" && mark.eventId === resolved.event.id);
  return (
    <div className={styles.toolbarGroup} role="group" aria-label="简谱技巧快捷操作">
      {(["tie", "slur"] as const).map((type) => (
        <Popover key={type} trigger="click" open={kind === type} onOpenChange={(open) => setKind(open ? type : null)} content={popover(type)}>
          <span>
            <ToolButton label={type === "tie" ? "添加简谱延音线" : "添加简谱连音线"} availability={{ enabled, reason: blockedReason }} onClick={() => choose(type)}>
              <LinkOutlined />{type === "tie" ? " 延音" : " 连音"}
            </ToolButton>
          </span>
        </Popover>
      ))}
      <ToolButton label={hasFermata ? "移除简谱延长记号" : "添加简谱延长记号"} pressed={hasFermata} availability={{ enabled, reason: blockedReason }} onClick={() => void toggleFermata()}>
        <PauseOutlined /> 延长
      </ToolButton>
    </div>
  );
};

/** 菜单和更多工具只改变入口；预览控制器随会话存活，不再按版本/选区 key 重建。 */
export const EditorToolbar = ({
  blocked,
  numberedBlocked,
  getNumberedBlocked,
  onAction,
  beforeAction,
  execute,
  onNavigate,
}: {
  blocked: boolean;
  numberedBlocked: boolean;
  getNumberedBlocked: () => boolean;
  onAction: ToolActionHandler;
  beforeAction: () => void;
  execute: EditorCommandAdapter;
  onNavigate: (destination: ToolNavigation) => SelectionRequestResult;
}) => {
  const session = useEditorSessionStore();
  const { drafts, modals } = useEditorRuntime();
  const document = useEditorStore((state) => state.document),
    selection = useEditorStore((state) => state.selection),
    numberedSelection = useEditorStore((state) => state.numberedSelection);
  const canUndo = useEditorStore((state) => state.canUndo),
    canRedo = useEditorStore((state) => state.canRedo);
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
  const protectedDraft = drafts
    .inspect()
    .pending.some((item) => item.kind !== "beatPaste" && item.kind !== "fret");
  const editingBlocked = blocked || protectedDraft;
  const live = useRef({ editingBlocked, beforeAction, execute });
  const executeLatest: EditorCommandAdapter = useCallback(
    (command, impact) => live.current.execute(command, impact),
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
  const reason = editingBlocked
    ? "先完成属性编辑，再修改 TAB；可继续浏览工具说明。"
    : null;
  const available = (value: ToolAvailability): ToolAvailability =>
    modal || editingBlocked
      ? { enabled: false, reason: modal ? "请先完成当前弹层操作。" : reason! }
      : value;
  const run: ToolActionHandler = async (action) => {
    beforeAction();
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
  const beat =
    tools.range?.beats.length === 1
      ? tools.focused?.measure.beats.find(
          (item) => item.id === tools.range!.beats[0]!.beatId,
        )
      : null;
  return (
    <div
      className={styles.editorToolbar}
      role="toolbar"
      aria-label="节奏、小节与历史工具"
      aria-describedby="editor-tool-reason"
    >
      <div className={styles.toolbarGroup} role="group" aria-label="历史">
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
          <UndoOutlined />
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
          <RedoOutlined />
        </ToolButton>
      </div>
      <div className={styles.toolbarGroup} role="group" aria-label="音符与节奏">
        {RHYTHMS.map((rhythm) => (
          <ToolButton
            key={rhythm.base}
            label={`设置为${rhythm.label}`}
            availability={available(tools.rhythm)}
            pressed={beat?.rhythm.base === rhythm.base}
            onClick={() => void run({ type: "rhythm", base: rhythm.base })}
          >
            <MusicAssetIcon
              assetId={rhythm.icon}
              className={styles.toolbarIcon}
            />
          </ToolButton>
        ))}
        {([0, 1, 2] as const).map((dots) => (
          <ToolButton
            key={dots}
            label={
              dots === 0 ? "取消附点" : dots === 1 ? "设置单附点" : "设置双附点"
            }
            availability={available(tools.rhythm)}
            pressed={beat?.rhythm.dots === dots}
            onClick={() => void run({ type: "dots", dots })}
          >
            {dots === 0 ? "无点" : dots === 1 ? "·" : "··"}
          </ToolButton>
        ))}
        <ToolButton
          label="设置为闷音音符 x"
          title={editorShortcutLabel("muted")}
          availability={available(tools.note)}
          onClick={() => void run({ type: "muted" })}
        >
          X
        </ToolButton>
        <ToolButton
          label="将选中 Beat 设为休止并清空全部弦音符"
          title={editorShortcutLabel("rest")}
          availability={available(tools.beatRange)}
          onClick={() => void run({ type: "rest" })}
        >
          休止
        </ToolButton>
        <ToolButton
          label="取消选中 Beat 的休止状态"
          title={editorShortcutLabel("restore")}
          availability={available(tools.beatRange)}
          onClick={() => void run({ type: "restore" })}
        >
          恢复
        </ToolButton>
        <ToolButton
          label="删除所选音符"
          title={editorShortcutLabel("remove")}
          availability={available(tools.note)}
          onClick={() => void run({ type: "removeNotes" })}
        >
          <DeleteOutlined />
        </ToolButton>
      </div>
      <NumberedQuickTechniques
        document={document}
        target={numberedSelection}
        blocked={numberedBlocked || !!modal}
        getBlocked={getNumberedBlocked}
        execute={executeLatest}
      />
      <EditorToolPanelHost
        ref={host}
        beforeOpen={beforeAction}
        blocked={!!modal}
        reason={reason}
      >
        {{
          measure: (
            <div className={styles.toolMenu} aria-label="小节工具菜单">
              <div className={styles.toolTarget}>
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
              <p className={styles.settingsHint}>
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
                <p className={styles.settingsHint}>
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
              <p className={styles.settingsHint}>
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
            <div className={styles.toolMenu}>
              <TupletToolbar
                document={document}
                selection={selection}
                execute={execute}
                blocked={editingBlocked}
                onSuccess={() => host.current?.close(true)}
              />
              <Button block onClick={() => navigate("tuplet")}>
                连音比例与选区详情…
              </Button>
            </div>
          ),
          technique: (
            <TechniqueToolbar
              document={document}
              selection={selection}
              selectedTechniqueId={selectedTechniqueId}
              execute={execute}
              blocked={editingBlocked}
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
      <span id="editor-tool-reason" className={styles.toolbarHint}>
        {reason || tools.rhythm.reason || "当前选区可编辑音符与节奏。"}
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
      className={styles.toolbarNotice}
      type={state.phase === "stale" ? "warning" : "info"}
      title={state.notice}
      showIcon
    />
  ) : null;
};
