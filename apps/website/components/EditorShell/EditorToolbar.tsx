"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Popover, Tooltip } from "antd";
import {
  DeleteOutlined,
  DownOutlined,
  RedoOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  LXM_EDITABLE_TIME_SIGNATURES,
  type ILXMApplyScoreCommandResult,
  type ILXMBarlineType,
  type ILXMRhythm,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import { useEditorStore } from "../../stores/editor-store";
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
import styles from "./index.module.scss";

export type EditorToolbarAction =
  | {
      type:
        | "undo"
        | "redo"
        | "muted"
        | "removeNotes"
        | "rest"
        | "restore"
        | "insertMeasure"
        | "copyMeasures"
        | "removeMeasure"
        | "startRepeat";
    }
  | { type: "rhythm"; base: ILXMRhythm["base"] }
  | { type: "dots"; dots: 0 | 1 | 2 }
  | { type: "signature"; value: string }
  | { type: "barline"; value: ILXMBarlineType };

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
const BARLINES: { value: ILXMBarlineType; label: string }[] = [
  { value: "single", label: "单小节线" },
  { value: "double", label: "双小节线" },
  { value: "final", label: "终止线" },
  { value: "repeatStart", label: "开始反复线" },
  { value: "repeatEnd", label: "结束反复线" },
  { value: "repeatBoth", label: "双向反复线" },
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
    <span className={styles.toolButtonWrap}>
      <Button
        size="small"
        aria-label={label}
        aria-pressed={pressed}
        disabled={!availability.enabled}
        onClick={onClick}
        className={styles.musicToolButton}
      >
        {children}
      </Button>
    </span>
  </Tooltip>
);

/** 各高级组始终属于同一个 Popover，首次打开后保留内容，断点不换 owner。 */
const ToolGroup = ({
  label,
  blocked,
  children,
}: {
  label: string;
  blocked: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={open && !blocked}
      onOpenChange={(next) => {
        setOpen(!blocked && next);
        // 预览取消会移除当前按钮；此时 Esc 由 portal 接收，也要恢复可见触发器。
        const active = document.activeElement;
        if (
          !next &&
          (active === document.body || content.current?.contains(active))
        )
          trigger.current?.focus();
      }}
      destroyOnHidden={false}
      content={
        <div
          ref={content}
          className={styles.toolPopover}
          inert={blocked}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <h3>{label}</h3>
          {children}
        </div>
      }
    >
      <Button
        ref={trigger}
        size="small"
        disabled={blocked}
        aria-label={`${label}工具`}
        aria-expanded={open && !blocked}
      >
        {label}
        <DownOutlined />
      </Button>
    </Popover>
  );
};

/** 入口条件来自文档与核心解析；命令回调复用谱面已有实现。 */
export const EditorToolbar = ({
  blocked,
  onAction,
  beforeAction,
  execute,
}: {
  blocked: boolean;
  onAction: (action: EditorToolbarAction) => void;
  beforeAction: () => void;
  execute: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
}) => {
  const document = useEditorStore((state) => state.document);
  const selection = useEditorStore((state) => state.selection);
  const stateVersion = useEditorStore((state) => state.stateVersion);
  const clipboardVersion = useEditorStore((state) => state.clipboardVersion);
  const canUndo = useEditorStore((state) => state.canUndo),
    canRedo = useEditorStore((state) => state.canRedo);
  const selectedTechniqueId = useEditorStore(
    (state) => state.selectedTechniqueId,
  );
  const setSelectedTechniqueId = useEditorStore(
    (state) => state.setSelectedTechniqueId,
  );
  const setErrorMessage = useEditorStore((state) => state.setErrorMessage);
  if (!document) return null;
  const tools = deriveEditorToolState(document, selection);
  const run = (action: EditorToolbarAction) => {
    beforeAction();
    onAction(action);
  };
  const commit = (command: ILXMScoreCommand) => {
    beforeAction();
    return execute(command);
  };
  const focus = tools.focused;
  const currentSignature = focus
    ? `${focus.measure.timeSignature.numerator}/${focus.measure.timeSignature.denominator}`
    : "";
  const activeBeat =
    tools.range?.beats.length === 1
      ? document.score.tracks
          .find((track) => track.id === tools.range!.trackId)
          ?.measures.find(
            (measure) => measure.id === tools.range!.beats[0]!.measureId,
          )
          ?.beats.find((beat) => beat.id === tools.range!.beats[0]!.beatId)
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
            enabled: canUndo,
            reason: canUndo ? "" : "没有可撤销的修改。",
          }}
          onClick={() => run({ type: "undo" })}
        >
          <UndoOutlined />
        </ToolButton>
        <ToolButton
          label="重做"
          title={editorShortcutLabel("redo")}
          availability={{
            enabled: canRedo,
            reason: canRedo ? "" : "没有可重做的修改。",
          }}
          onClick={() => run({ type: "redo" })}
        >
          <RedoOutlined />
        </ToolButton>
      </div>
      <div
        className={styles.toolbarGroup}
        role="group"
        aria-label="音符与节奏"
        inert={blocked}
      >
        {RHYTHMS.map((rhythm) => (
          <ToolButton
            key={rhythm.base}
            label={`设置为${rhythm.label}`}
            availability={tools.rhythm}
            pressed={activeBeat?.rhythm.base === rhythm.base}
            onClick={() => run({ type: "rhythm", base: rhythm.base })}
          >
            <MusicAssetIcon
              assetId={rhythm.icon}
              className={styles.toolbarIcon}
            />
          </ToolButton>
        ))}
        <ToolButton
          label="取消附点"
          availability={tools.rhythm}
          pressed={activeBeat?.rhythm.dots === 0}
          onClick={() => run({ type: "dots", dots: 0 })}
        >
          无点
        </ToolButton>
        <ToolButton
          label="设置单附点"
          availability={tools.rhythm}
          pressed={activeBeat?.rhythm.dots === 1}
          onClick={() => run({ type: "dots", dots: 1 })}
        >
          ·
        </ToolButton>
        <ToolButton
          label="设置双附点"
          availability={tools.rhythm}
          pressed={activeBeat?.rhythm.dots === 2}
          onClick={() => run({ type: "dots", dots: 2 })}
        >
          ··
        </ToolButton>
        <ToolButton
          label="设置为闷音音符 x"
          title={editorShortcutLabel("muted")}
          availability={tools.note}
          onClick={() => run({ type: "muted" })}
        >
          X
        </ToolButton>
        <ToolButton
          label="将选中 Beat 设为休止并清空全部弦音符"
          title={editorShortcutLabel("rest")}
          availability={tools.beatRange}
          onClick={() => run({ type: "rest" })}
        >
          休止
        </ToolButton>
        <ToolButton
          label="取消选中 Beat 的休止状态"
          title={editorShortcutLabel("restore")}
          availability={tools.beatRange}
          onClick={() => run({ type: "restore" })}
        >
          恢复
        </ToolButton>
        <ToolButton
          label="删除所选音符"
          title={editorShortcutLabel("remove")}
          availability={tools.note}
          onClick={() => run({ type: "removeNotes" })}
        >
          <DeleteOutlined />
        </ToolButton>
      </div>
      <div
        className={styles.toolbarGroup}
        role="group"
        aria-label="小节、拍点、连音与技巧"
      >
        <ToolGroup label="小节" blocked={blocked}>
          <div className={styles.toolPopoverRow}>
            <ToolButton
              label="在当前小节后新增小节"
              availability={tools.singleMeasure}
              onClick={() => run({ type: "insertMeasure" })}
            >
              新增
            </ToolButton>
            <ToolButton
              label="复制选中小节范围"
              availability={tools.copyMeasures}
              onClick={() => run({ type: "copyMeasures" })}
            >
              复制范围
            </ToolButton>
            <ToolButton
              label="删除当前小节"
              availability={tools.removeMeasure}
              onClick={() => run({ type: "removeMeasure" })}
            >
              删除小节
            </ToolButton>
          </div>
          <label className={styles.toolbarField}>
            当前小节拍号
            <select
              className={styles.toolbarSelect}
              aria-label="设置当前焦点小节的拍号"
              disabled={!focus}
              value={currentSignature}
              onChange={(event) =>
                run({ type: "signature", value: event.currentTarget.value })
              }
            >
              {!focus && <option value="">未选择小节</option>}
              {focus &&
                !LXM_EDITABLE_TIME_SIGNATURES.some(
                  (time) =>
                    `${time.numerator}/${time.denominator}` ===
                    currentSignature,
                ) && (
                  <option value={currentSignature} disabled>
                    {currentSignature}（只读）
                  </option>
                )}
              {LXM_EDITABLE_TIME_SIGNATURES.map((time) => (
                <option key={`${time.numerator}/${time.denominator}`}>
                  {time.numerator}/{time.denominator}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.toolbarField}>
            右边界
            <select
              className={styles.toolbarSelect}
              aria-label="设置当前焦点小节的右边界"
              disabled={!focus}
              value={focus?.measure.barline ?? "single"}
              onChange={(event) =>
                run({
                  type: "barline",
                  value: event.currentTarget.value as ILXMBarlineType,
                })
              }
            >
              {BARLINES.map((barline) => (
                <option
                  key={barline.value}
                  value={barline.value}
                  disabled={
                    focus?.isLast &&
                    (barline.value === "repeatStart" ||
                      barline.value === "repeatBoth")
                  }
                >
                  {barline.label}
                </option>
              ))}
            </select>
          </label>
          <ToolButton
            label="切换谱首开始反复线"
            availability={tools.startRepeat}
            pressed={focus?.track.startBarline === "repeatStart"}
            onClick={() => run({ type: "startRepeat" })}
          >
            谱首反复
          </ToolButton>
        </ToolGroup>
        <ToolGroup label="拍点" blocked={blocked}>
          <BeatToolbar
            key={`${stateVersion}/${clipboardVersion}/${selection?.anchor.measureId}/${selection?.anchor.beatId}/${selection?.focus.measureId}/${selection?.focus.beatId}`}
            beforeAction={beforeAction}
          />
        </ToolGroup>
        <ToolGroup label="连音" blocked={blocked}>
          <TupletToolbar
            document={document}
            selection={selection}
            execute={commit}
          />
        </ToolGroup>
        <ToolGroup label="技巧" blocked={blocked}>
          <TechniqueToolbar
            key={selectedTechniqueId ?? "new-technique"}
            document={document}
            selection={selection}
            selectedTechniqueId={selectedTechniqueId}
            execute={commit}
            setSelectedTechniqueId={setSelectedTechniqueId}
            setErrorMessage={setErrorMessage}
          />
        </ToolGroup>
      </div>
      <span id="editor-tool-reason" className={styles.toolbarHint}>
        {blocked
          ? "先完成属性编辑，再修改 TAB。"
          : tools.rhythm.reason || "当前选区可编辑音符与节奏。"}
      </span>
    </div>
  );
};
