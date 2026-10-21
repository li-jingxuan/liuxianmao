"use client";

import { Alert, Button, Form, Input, InputNumber, Select } from "antd";
import {
  LXM_KEY_SIGNATURES,
  LXM_EDITABLE_TIME_SIGNATURES,
  type ILXMDocument,
  type ILXMKeySignature,
} from "@liuxianmao/lxm-editor";
import type { ScoreSettingsDraft, SettingsGroup } from "./score-settings-draft";
import styles from "./index.module.scss";

export interface SettingsCopyRange {
  start: string;
  end: string;
  after: string;
}
interface ScoreSettingsFormProps {
  document: ILXMDocument;
  value: ScoreSettingsDraft;
  measureId?: string;
  selectedMeasureId?: string;
  dirty: boolean;
  composing: boolean;
  issues: Partial<Record<SettingsGroup | "copy" | "all", string>>;
  copy: SettingsCopyRange;
  onChange: <K extends keyof ScoreSettingsDraft>(
    key: K,
    value: ScoreSettingsDraft[K],
  ) => void;
  onApply: (group: SettingsGroup) => void;
  onDiscard: () => void;
  onCopyChange: (value: SettingsCopyRange) => void;
  onCopy: () => void | Promise<void>;
}

/** 只渲染受控草稿；Form 不以 name/initialValues 再维护另一份音乐内容。 */
export const ScoreSettingsForm = ({
  document,
  value,
  measureId,
  selectedMeasureId,
  dirty,
  composing,
  issues,
  copy,
  onChange,
  onApply,
  onDiscard,
  onCopyChange,
  onCopy,
}: ScoreSettingsFormProps) => {
  const track = document.score.tracks[0]!;
  const first = track.measures[0]!;
  const change = track.measures.findIndex(
    (measure, index) =>
      index > 0 &&
      (measure.timeSignature.numerator !== first.timeSignature.numerator ||
        measure.timeSignature.denominator !== first.timeSignature.denominator),
  );
  const targetIndex = track.measures.findIndex(
    (measure) => measure.id === measureId,
  );
  const signatureOptions: {
    value: string;
    label: string;
    disabled?: boolean;
  }[] = LXM_EDITABLE_TIME_SIGNATURES.map((time) => ({
    value: `${time.numerator}/${time.denominator}`,
    label: `${time.numerator}/${time.denominator}`,
  }));
  if (!signatureOptions.some((option) => option.value === value.signature))
    signatureOptions.unshift({
      value: value.signature,
      label: `${value.signature}（当前，只读）`,
      disabled: true,
    });
  const measureOptions = track.measures.map((measure, index) => ({
    value: measure.id,
    label: `第 ${index + 1} 小节`,
  }));
  const error = (group: SettingsGroup | "copy" | "all") =>
    issues[group] && <Alert type="error" showIcon title={issues[group]} />;
  return (
    <div className={styles.settingsForms}>
      {error("all")}
      <Form
        layout="vertical"
        onFinish={() => onApply("info")}
        requiredMark={false}
      >
        <h3>歌曲信息</h3>
        <Form.Item label="歌曲名称" htmlFor="settings-title">
          <Input
            id="settings-title"
            aria-label="歌曲名称"
            value={value.title}
            onChange={(event) => onChange("title", event.target.value)}
          />
        </Form.Item>
        <Form.Item label="编谱作者" htmlFor="settings-arranger">
          <Input
            id="settings-arranger"
            aria-label="编谱作者"
            value={value.arranger}
            onChange={(event) => onChange("arranger", event.target.value)}
          />
        </Form.Item>
        <Form.Item label="调性" htmlFor="settings-key">
          <Select<ILXMKeySignature | "">
            id="settings-key"
            aria-label="调性"
            value={value.keySignature ?? ""}
            options={[
              { value: "", label: "未设置" },
              ...LXM_KEY_SIGNATURES.map((key) => ({
                value: key,
                label: `1=${key}`,
              })),
            ]}
            onChange={(key) => onChange("keySignature", key || null)}
          />
        </Form.Item>
        {error("info")}
        <Button htmlType="submit" type="primary" block disabled={composing}>
          应用歌曲信息
        </Button>
      </Form>
      <Form
        layout="vertical"
        onFinish={() => onApply("signature")}
        requiredMark={false}
      >
        <h3>基础拍号</h3>
        <Form.Item label="基础拍号" htmlFor="settings-signature">
          <Select
            id="settings-signature"
            aria-label="基础拍号"
            value={value.signature}
            options={signatureOptions}
            onChange={(signature) => onChange("signature", signature)}
          />
        </Form.Item>
        <p className={styles.settingsHint}>
          作用于第 1–{change < 0 ? track.measures.length : change}{" "}
          小节；局部变化请在小节工具中操作。
        </p>
        {error("signature")}
        <Button htmlType="submit" block disabled={composing}>
          应用基础拍号
        </Button>
      </Form>
      <Form
        layout="vertical"
        onFinish={() => onApply("capo")}
        requiredMark={false}
      >
        <h3>变调夹</h3>
        <Form.Item
          label="Capo"
          htmlFor="settings-capo"
          validateStatus={issues.capo ? "error" : undefined}
        >
          <InputNumber<string>
            id="settings-capo"
            aria-label="Capo"
            stringMode
            min="0"
            max="12"
            step="1"
            changeOnBlur={false}
            value={value.capo}
            onInput={(raw) => onChange("capo", raw)}
            onStep={(next) => onChange("capo", String(next))}
            style={{ width: "100%" }}
          />
        </Form.Item>
        <p className={styles.settingsHint}>0–12 的整数；0 表示不使用变调夹。</p>
        {error("capo")}
        <Button htmlType="submit" block disabled={composing}>
          应用 Capo
        </Button>
      </Form>
      <Form
        layout="vertical"
        onFinish={() => onApply("label")}
        requiredMark={false}
      >
        <h3>当前小节</h3>
        <p className={styles.settingsHint}>
          {targetIndex >= 0
            ? `段落标记作用于第 ${targetIndex + 1} 小节`
            : "请先选择目标小节"}
          {measureId && measureId !== selectedMeasureId
            ? "；草稿仍绑定原小节"
            : ""}
        </p>
        <Form.Item label="段落标记" htmlFor="settings-label">
          <Input
            id="settings-label"
            aria-label="段落标记"
            disabled={targetIndex < 0}
            value={value.label}
            onChange={(event) => onChange("label", event.target.value)}
          />
        </Form.Item>
        {error("label")}
        <Button htmlType="submit" block disabled={targetIndex < 0 || composing}>
          应用段落标记
        </Button>
      </Form>
      <Form layout="vertical" onFinish={onCopy} requiredMark={false}>
        <h3>小节复用</h3>
        {(
          [
            ["复制起始小节", "start"],
            ["复制结束小节", "end"],
            ["插入位置", "after"],
          ] as const
        ).map(([label, key]) => {
          const options: {
            value: string;
            label: string;
            disabled?: boolean;
          }[] =
            key === "after"
              ? [
                  { value: "", label: "谱首" },
                  ...measureOptions.map((option) => ({
                    ...option,
                    label: `${option.label}后`,
                  })),
                ]
              : [...measureOptions];
          if (!options.some((option) => option.value === copy[key]))
            options.unshift({
              value: copy[key],
              label: "原目标已失效，请重新选择",
              disabled: true,
            });
          return (
            <Form.Item key={key} label={label} htmlFor={`settings-copy-${key}`}>
              <Select
                id={`settings-copy-${key}`}
                aria-label={label}
                value={copy[key]}
                options={options}
                onChange={(next) => onCopyChange({ ...copy, [key]: next })}
              />
            </Form.Item>
          );
        })}
        {dirty && (
          <p className={styles.settingsHint}>
            请先应用或放弃设置草稿，再复制小节。
          </p>
        )}
        {error("copy")}
        <Button htmlType="submit" block disabled={dirty || composing}>
          复制小节范围
        </Button>
      </Form>
      {dirty && (
        <div className={styles.settingsActions}>
          <Button block disabled={composing} onClick={onDiscard}>
            放弃设置草稿
          </Button>
        </div>
      )}
    </div>
  );
};
