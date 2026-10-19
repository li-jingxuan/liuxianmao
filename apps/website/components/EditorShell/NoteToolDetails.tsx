"use client";
import { Button, Segmented } from "antd";
import {
  DeleteOutlined,
  InfoCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import type {
  ILXMDocument,
  ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { deriveEditorToolState } from "./editor-tool-state";
import type { ToolActionHandler } from "./editor-tool-actions";
import styles from "./index.module.scss";

/** 详情只读真实选区，按钮与顶部工具发送同一动作。 */
export const NoteToolDetails = ({
  document,
  selection,
  blocked,
  onAction,
}: {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  blocked: boolean;
  onAction: ToolActionHandler;
}) => {
  const tools = deriveEditorToolState(document, selection);
  const beats =
    tools.range?.beats.flatMap(
      (ref) =>
        document.score.tracks
          .find((track) => track.id === ref.trackId)
          ?.measures.find((measure) => measure.id === ref.measureId)
          ?.beats.filter((beat) => beat.id === ref.beatId) ?? [],
    ) ?? [];
  const rests = beats.filter((beat) => beat.kind === "rest").length;
  const selectedNotes = beats.flatMap((beat) =>
    beat.notes.filter(
      (note) =>
        tools.range &&
        note.string >= tools.range.startString &&
        note.string <= tools.range.endString,
    ),
  );
  const mixedNotes =
    selectedNotes.some((note) => note.fret === "x") &&
    selectedNotes.some((note) => note.fret !== "x");
  const beat = beats.length === 1 ? beats[0] : null;
  return (
    <section className={styles.toolDetails} aria-label="音符与休止详情">
      <h3 tabIndex={-1}>音符与休止</h3>
      <div className={styles.toolTarget}>
        {tools.focused
          ? `第 ${tools.focused.index + 1} 小节 · 已选 ${beats.length} 拍`
          : "尚未选择 TAB 拍点"}
      </div>
      {/* 选区说明采用紧凑图文，保留状态与操作影响，避免提示卡片挤占操作空间。 */}
      <p className={styles.selectionTip}>
        <InfoCircleOutlined aria-hidden="true" />
        <span>
          {!beats.length
            ? "尚未选择拍点"
            : rests && rests === beats.length
              ? "当前拍为休止"
              : rests
                ? "选区为混合状态"
                : mixedNotes
                  ? "选区含普通音符与闷音的混合状态"
                  : "当前拍为音符"}
          。休止属于整拍；取消休止不会恢复已清空的原音符。
        </span>
      </p>
      <Button
        type="primary"
        block
        disabled={blocked || !tools.beatRange.enabled}
        onClick={() =>
          void onAction({
            type: rests === beats.length && rests > 0 ? "restore" : "rest",
          })
        }
      >
        {rests === beats.length && rests > 0
          ? "取消休止（Shift+R）"
          : "设为休止（R）"}
      </Button>
      {rests > 0 && rests < beats.length && (
        <Button
          block
          disabled={blocked}
          onClick={() => void onAction({ type: "restore" })}
        >
          取消选区休止
        </Button>
      )}
      <Button
        block
        disabled={blocked || !tools.note.enabled}
        onClick={() => void onAction({ type: "muted" })}
      >
        设置闷音音符 x
      </Button>
      <Button
        block
        icon={<DeleteOutlined />}
        disabled={blocked || !tools.note.enabled}
        onClick={() => void onAction({ type: "removeNotes" })}
      >
        删除所选音符
      </Button>
      <h3 tabIndex={-1}>附点</h3>
      <Segmented
        block
        aria-label="音符附点"
        disabled={blocked || !tools.rhythm.enabled}
        value={beat?.rhythm.dots ?? -1}
        options={[
          { value: 0, label: "无附点" },
          { value: 1, label: "单附点" },
          { value: 2, label: "双附点" },
        ]}
        onChange={(dots) =>
          void onAction({ type: "dots", dots: dots as 0 | 1 | 2 })
        }
      />
      {!tools.rhythm.enabled && (
        <p className={styles.settingsHint}>{tools.rhythm.reason}</p>
      )}
      <p className={styles.selectionTip}>
        <ExclamationCircleOutlined aria-hidden="true" />
        <span>删除只清所选弦；休止清整拍全部弦。恢复原内容请使用撤销。</span>
      </p>
    </section>
  );
};
