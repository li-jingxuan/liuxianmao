"use client";
import { Alert, Button, Form, Select, Tooltip } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { useSyncExternalStore } from "react";
import { LXMScoreCommandEnum } from "@liuxianmao/lxm-editor";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import type { BeatPasteController } from "./beat-paste-controller";
import type { EditorCommandAdapter } from "./editor-command-adapter";
import { deriveEditorToolState } from "./editor-tool-state";
import styles from "./index.module.scss";

/** 目录仅发意图，复制偏好/预览/确认均由稳定控制器持有。 */
export const BeatToolbar = ({
  controller,
  execute,
  blocked,
  beforeAction,
  onSuccess,
}: {
  controller: BeatPasteController;
  execute: EditorCommandAdapter;
  blocked: boolean;
  beforeAction: () => void;
  onSuccess: () => void;
}) => {
  const store = useEditorSessionStore();
  const document = useEditorStore((state) => state.document);
  const selection = useEditorStore((state) => state.selection);
  const clipboardVersion = useEditorStore((state) => state.clipboardVersion);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  void clipboardVersion;
  if (!document) return null;
  const tools = deriveEditorToolState(document, selection);
  const clipboard = store.getState().getBeatClipboard();
  const run = async (kind: "split" | "merge") => {
    if (blocked) return;
    beforeAction();
    const now = store.getState(),
      focus = now.selection?.focus;
    const latest =
      now.document && deriveEditorToolState(now.document, now.selection);
    if (
      !focus ||
      !latest?.range ||
      !(kind === "split" ? latest.splitBeat : latest.mergeBeats).enabled
    )
      return;
    const result = await execute(
      kind === "split"
        ? { type: LXMScoreCommandEnum.SplitBeat, ...focus }
        : {
            type: LXMScoreCommandEnum.MergeBeats,
            ...focus,
            startBeatId: latest.range.beats[0]!.beatId,
            endBeatId: latest.range.beats.at(-1)!.beatId,
          },
    );
    if (result.status === "applied" || result.status === "noop") onSuccess();
  };
  const action = (
    label: string,
    enabled: boolean,
    reason: string,
    click: () => void,
    icon?: React.ReactNode,
    actionId?: string,
  ) => (
    <Tooltip title={!enabled ? reason : undefined}>
      <span
        tabIndex={!enabled ? 0 : undefined}
        aria-label={!enabled ? reason : undefined}
      >
        <Button
          data-tool-action={actionId}
          block
          disabled={blocked || !enabled}
          onClick={click}
          icon={icon}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );
  return (
    <div className={styles.toolMenu} aria-label="拍点结构与复用">
      {action(
        "拆分当前拍点",
        tools.splitBeat.enabled,
        tools.splitBeat.reason,
        () => void run("split"),
        undefined,
        "beat-actions",
      )}
      {action(
        "合并所选拍点",
        tools.mergeBeats.enabled,
        tools.mergeBeats.reason,
        () => void run("merge"),
      )}
      <Form.Item label="下次复制的谱层" htmlFor="beat-copy-layers">
        <Select
          id="beat-copy-layers"
          aria-label="拍点复制谱层"
          value={state.layers}
          options={[
            { value: "both", label: "双谱" },
            { value: "tab", label: "仅六线谱" },
          ]}
          onChange={(layers) =>
            void controller.request({ type: "layers", layers })
          }
        />
      </Form.Item>
      {action(
        "复制所选拍点（全部六弦）",
        tools.copyBeats.enabled,
        tools.copyBeats.reason,
        () => {
          if (!selection || !tools.range || blocked) return;
          beforeAction();
          store.getState().copyBeats({
            ...selection.focus,
            startBeatId: tools.range.beats[0]!.beatId,
            endBeatId: tools.range.beats.at(-1)!.beatId,
            layers: state.layers,
          });
        },
        <CopyOutlined />,
      )}
      {action(
        "在目标拍前插入…",
        !!clipboard && !!tools.range,
        "请先复制拍点并选择 TAB 目标。",
        () => void controller.request({ type: "prepare", mode: "insert" }),
        undefined,
        "beat-paste",
      )}
      {action(
        "从目标拍覆盖…",
        !!clipboard && !!tools.range,
        "请先复制拍点并选择 TAB 目标。",
        () => void controller.request({ type: "prepare", mode: "overwrite" }),
      )}
      <p className={styles.settingsHint}>
        当前选中 {tools.range?.beats.length ?? 0} 拍。合并仅允许同小节休止或完整
        Tie 持续音；具体合法性由音乐规则校验。
      </p>
      {blocked && (
        <Alert
          variant="filled"
          type="info"
          title="先完成属性编辑，再修改 TAB。"
        />
      )}
      {clipboard && (
        <p role="status" className={styles.settingsHint}>
          已复制 {clipboard.content.beats.length} 拍 ·{" "}
          {clipboard.layers === "both" ? "双谱" : "仅六线谱"} · 包含全部弦。
        </p>
      )}
      {state.notice && (
        <Alert
          variant="filled"
          showIcon
          type={state.phase === "stale" ? "warning" : "info"}
          title={state.notice}
        />
      )}
    </div>
  );
};
