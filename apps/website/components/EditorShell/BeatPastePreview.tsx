"use client";
import { Alert, Checkbox, ConfigProvider, Segmented, Table, theme } from "antd";
import { useState, useSyncExternalStore } from "react";
import type { BeatPasteController } from "./beat-paste-controller";
import { EditorImpactNotice } from "./EditorImpactNotice";
import styles from "./index.module.scss";

/** 完整展示核心规划结果；源遗漏和目标清理分别表达，不重复计算音乐时长。 */
export const BeatPastePreview = ({
  controller,
}: {
  controller: BeatPasteController;
}) => {
  const { token } = theme.useToken();
  const live = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  // 退出动画仅保留最后的呈现快照；业务提交始终读取控制器，不给旧摘要新的有效期。
  const [display, setDisplay] = useState(live);
  if (live.candidate && live !== display) setDisplay(live);
  const state = live.candidate ? live : display;
  const candidate = state.candidate;
  if (!candidate)
    return (
      <Alert variant="filled" type="warning" title="预览已失效，请重新预览。" />
    );
  const plan = candidate.plan;
  const track = candidate.version.document!.score.tracks.find(
    (item) => item.id === candidate.target.trackId,
  )!;
  const index = track.measures.findIndex(
    (item) => item.id === candidate.target.measureId,
  );
  const beat = track.measures[index]!.beats.findIndex(
    (item) => item.id === candidate.target.beatId,
  );
  const busy = state.phase === "applying";
  const omitted =
    candidate.clipboard.omissions.length +
    candidate.clipboard.numberedOmissions.length;
  return (
    <div id="beat-paste-preview" tabIndex={-1} className={styles.pastePreview}>
      <p className={styles.settingsHint}>
        剪贴板：{candidate.clipboard.content.beats.length} 拍 ·{" "}
        {candidate.clipboard.layers === "both" ? "双谱" : "仅六线谱"} ·
        包含全部六弦。
      </p>
      <ConfigProvider
        theme={{
          components: {
            Segmented: {
              trackBg: token.colorBgContainer,
              itemSelectedBg: token.colorPrimaryBg,
              itemSelectedColor: token.colorPrimary,
            },
          },
        }}
      >
        <Segmented
          block
          aria-label="粘贴方式"
          value={state.mode}
          disabled={busy}
          options={[
            { value: "insert", label: "在目标拍前插入" },
            { value: "overwrite", label: "从目标拍覆盖" },
          ]}
          onChange={(mode) =>
            void controller.request({
              type: "mode",
              mode: mode as "insert" | "overwrite",
            })
          }
        />
      </ConfigProvider>
      <Alert
        variant="filled"
        showIcon
        type="info"
        title={`目标 · ${track.name} · 第 ${index + 1} 小节 / 第 ${beat + 1} 拍`}
        description={
          plan
            ? `${state.mode === "insert" ? "插入" : "覆盖"} ${plan.count} 拍，时值合计 ${plan.durationLabel}。`
            : "当前模式不可用，请调整模式或重新预览。"
        }
      />
      {plan && (
        <Table
          aria-label="粘贴影响统计"
          rowKey="key"
          size="small"
          showHeader={false}
          pagination={false}
          columns={[
            { key: "label", dataIndex: "label" },
            { key: "value", dataIndex: "value", align: "right", width: 120 },
          ]}
          dataSource={[
            {
              key: "beats",
              label: "将替换拍点",
              value: `${plan.replacedBeats} 拍`,
            },
            {
              key: "lyrics",
              label: "已有歌词 / 独立简谱",
              value: `${plan.replacedLyrics} 项 / ${plan.replacedNumbered} 项`,
            },
            {
              key: "chords",
              label: "已有和弦",
              value: `${plan.replacedChords} 个`,
            },
            {
              key: "techniques",
              label: "将清理 TAB 技巧",
              value: `${plan.removedTechniques} 个`,
            },
            {
              key: "marks",
              label: "将清理简谱记号",
              value: `${plan.removedNumberedMarks} 个`,
            },
          ]}
        />
      )}
      {plan && <EditorImpactNotice effects={plan.effects} preview />}
      {omitted > 0 && (
        <Alert
          variant="filled"
          type="warning"
          showIcon
          title="源范围连接未复制"
          description={`未带入 ${candidate.clipboard.omissions.length} 个跨范围 TAB 技巧、${candidate.clipboard.numberedOmissions.length} 个简谱连接；这不是目标删除数量。`}
        />
      )}
      {!!candidate.removedIds.length && (
        <Alert
          variant="filled"
          type="warning"
          showIcon
          title={`公共结构还将移除 ${candidate.removedIds.length} 个简谱记号`}
          description="请重新核对并勾选确认；与粘贴内容一起提交、一起撤销。"
        />
      )}
      {state.error && (
        <Alert
          variant="filled"
          type={state.phase === "needs-impact" ? "warning" : "error"}
          showIcon
          title={state.error}
        />
      )}
      {(plan?.requiresConfirmation ||
        candidate.removedIds.length > 0 ||
        candidate.changedIds.length > 0) && (
        <Checkbox
          checked={state.confirmed}
          disabled={busy}
          onChange={(event) =>
            void controller.request({
              type: "confirm",
              checked: event.target.checked,
            })
          }
        >
          我已核对并确认覆盖及以上关联影响
        </Checkbox>
      )}
    </div>
  );
};
