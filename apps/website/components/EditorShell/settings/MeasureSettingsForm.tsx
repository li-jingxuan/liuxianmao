"use client";

import { Alert, Button, Form, Input, Select } from "antd";
import type { SettingsCopyRange, SettingsFormProps } from "./ScoreSettingsForm";
import measureSettingsFormStyles from "./MeasureSettingsForm.module.scss";
import editorFormStyles from "../shared/editor-form.module.scss";
import taskStyles from "../shared/SelectionTaskDetails.module.scss";

/** 小节表面沿用 owner 的原小节 ID，复制参数不作为音乐草稿登记。 */
export const MeasureSettingsForm = ({
  document, value, measureId, selectedMeasureId, dirty, composing, busy,
  issues, groups, copy, inlineActions = true, onChange, onApply, onRestore,
  onCopyChange, onCopy,
}: SettingsFormProps & {
  measureId?: string;
  selectedMeasureId?: string;
  dirty: boolean;
  copy: SettingsCopyRange;
  onCopyChange: (value: SettingsCopyRange) => void;
  onCopy: () => void | Promise<void>;
}) => {
  const measures = document.score.tracks[0]!.measures;
  const index = measures.findIndex((measure) => measure.id === measureId);
  const start = measures.findIndex((measure) => measure.id === copy.start);
  const end = measures.findIndex((measure) => measure.id === copy.end);
  const after = measures.findIndex((measure) => measure.id === copy.after);
  const validCopy = start >= 0 && end >= start && (!copy.after || after >= 0);
  return <div className={`${measureSettingsFormStyles.settingsForms} ${taskStyles.measureForms}`}>
    {issues.all && <Alert type="error" showIcon title={issues.all} />}
    <Form layout="vertical" data-settings-group="label" onFinish={() => onApply("label")} requiredMark={false}>
      <div className={taskStyles.sectionHeading}><h3 tabIndex={-1}>段落标记</h3><span>当前位置</span></div>
      {(index < 0 || (measureId && measureId !== selectedMeasureId)) && <p data-editor-form-hint className={editorFormStyles.settingsHint}>{index >= 0 ? `段落标记作用于第 ${index + 1} 小节` : measureId ? `原目标小节已失效（${measureId}），输入已保留` : "请先选择目标小节"}{measureId && measureId !== selectedMeasureId ? "；正在编辑原位置" : ""}</p>}
      <Form.Item label="段落标记" htmlFor="settings-label"><Input id="settings-label" aria-label="段落标记" placeholder="例如：主歌、副歌" disabled={busy || !measureId} value={value.label} onChange={(event) => onChange("label", event.target.value)} /></Form.Item>
      <p data-editor-form-hint className={editorFormStyles.settingsHint}>段落名称是小节标记，不会新增歌词或简谱行。</p>
      {(issues.label || groups.label.blockedReason) && <Alert type="error" showIcon title={issues.label || groups.label.blockedReason} />}
      {inlineActions && <div className={measureSettingsFormStyles.settingsActions}><Button htmlType="submit" block type="primary" disabled={!groups.label.canApply}>应用段落标记</Button><Button block disabled={composing || busy || !groups.label.dirty} onClick={() => onRestore("label")}>恢复本组</Button></div>}
    </Form>
    <div data-measure-boundary-host />
    <details className={`${taskStyles.disclosure} ${taskStyles.noteDisclosure}`} data-settings-group="copy">
    <summary>复制小节范围<small>{validCopy ? `第 ${start + 1}–${end + 1} 小节 · ${copy.after ? `插入第 ${after + 1} 小节后` : "插入谱首"}` : "请选择有效范围与插入位置"}</small></summary>
    <Form layout="vertical" data-settings-group="copy" onFinish={onCopy} requiredMark={false}>
      <h3 tabIndex={-1}>范围复制</h3>
      <div className={taskStyles.copyFields}>
      {([["复制起始小节", "start"], ["复制结束小节", "end"], ["插入位置", "after"]] as const).map(([label, key]) => {
        const options: { value: string; label: string; disabled?: boolean }[] = [
          ...(key === "after" ? [{ value: "", label: "谱首" }] : []),
          ...measures.map((measure, i) => ({ value: measure.id, label: `第 ${i + 1} 小节${key === "after" ? "后" : ""}` })),
        ];
        if (!options.some((option) => option.value === copy[key])) options.unshift({ value: copy[key], label: "原目标已失效，请重新选择", disabled: true });
        return <Form.Item key={key} label={label} htmlFor={`settings-copy-${key}`}><Select id={`settings-copy-${key}`} aria-label={label} value={copy[key]} options={options} disabled={busy} onChange={(next) => onCopyChange({ ...copy, [key]: next })} /></Form.Item>;
      })}
      </div>
      <p data-editor-form-hint className={editorFormStyles.settingsHint}>{validCopy ? `复制第 ${start + 1}–${end + 1} 小节（共 ${end - start + 1} 小节），插入${copy.after ? `第 ${after + 1} 小节后` : "谱首"}；原小节保留。` : "复制范围或插入位置无效，请重新选择。"}</p>
      {dirty && <p data-editor-form-hint className={editorFormStyles.settingsHint}>请先处理{Object.entries(groups).filter(([, status]) => status.dirty).map(([group]) => ({ info: "歌曲信息", signature: "基础拍号", capo: "Capo", label: "段落标记" })[group]).join("、")}的未应用输入，再复制小节。</p>}
      {issues.copy && <Alert type="error" showIcon title={issues.copy} />}
      {inlineActions && <Button htmlType="submit" block disabled={dirty || composing || busy || !validCopy} loading={busy}>复制小节范围</Button>}
    </Form>
    </details>
  </div>;
};
