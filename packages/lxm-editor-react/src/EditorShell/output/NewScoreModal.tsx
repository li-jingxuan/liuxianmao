"use client";

import { Button, ConfigProvider, Form, Input, Select } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  createTuningPreset, LXMScoreSchema,
  type GuitarTuningPreset, type ILXMDocument, type ScoreTonalityV1,
} from "@liuxianmao/lxm-editor";
import { loadEditorDocument } from "../../stores/editor-store";
import { createScoreSettingsComposition } from "../settings/score-settings-composition";
import { createBlankScore, displaySignature, newScoreSignatures, newScoreTonics } from "./new-score";
import { ScoreFileDialog } from "./ScoreFileDialog";
import styles from "./score-file.module.scss";

const tonalityOptions = (["major", "minor"] as const).map((mode) => {
  const label = mode === "major" ? "大调" : "小调";
  return {
    label,
    options: newScoreTonics[mode].map((tonic) => ({ label: `${tonic} ${label}`, value: `${mode}:${tonic}` })),
  };
});
const signatureOptions = newScoreSignatures.map((signature) => {
  const value = displaySignature(signature);
  return { value, label: value };
});
const tuningNames: Record<GuitarTuningPreset, string> = {
  standard: "标准调弦",
  dropD: "Drop D",
  halfStepDown: "降半音调弦",
  openG: "开放 G 调弦",
  dadgad: "DADGAD",
};
const tuningOptions = (Object.keys(tuningNames) as GuitarTuningPreset[]).map((value) => ({
  value,
  label: tuningNames[value],
  pitches: createTuningPreset(value).strings.map(({ pitch }) => pitch).reverse().join(" / ").replaceAll("b", "♭"),
}));

type NewScoreValues = {
  title: string;
  arranger: string;
  tonality: string;
  signature: string;
  tuning: GuitarTuningPreset;
};

const initialValues: NewScoreValues = {
  title: "",
  arranger: "",
  tonality: "major:C",
  signature: "4/4",
  tuning: "standard",
};

const textFormatRule = (field: "title" | "arranger") => ({
  validator: async (_: unknown, value?: string) => {
    const checked = LXMScoreSchema.shape[field].safeParse(value?.trim() ?? "");
    if (!checked.success) throw new Error(checked.error.issues[0]?.message);
  },
});

export function NewScoreModal({ onCancel, onCreate }: {
  onCancel: () => void;
  onCreate: (document: ILXMDocument) => void;
}) {
  const composition = useRef(createScoreSettingsComposition(() => {}));
  const [error, setError] = useState("");
  useEffect(() => {
    const guard = composition.current;
    return () => guard.dispose();
  }, []);

  const close = () => {
    if (!composition.current.isComposing()) onCancel();
  };
  const submit = (values: NewScoreValues) => {
    if (composition.current.isComposing()) return;
    const [mode, tonic] = values.tonality.split(":");
    const tonality: ScoreTonalityV1 = mode === "minor"
      ? { version: 1, mode, tonic: tonic!, minorTonicDegree: 6 }
      : { version: 1, mode: "major", tonic: tonic! };
    const timeSignature = newScoreSignatures.find((option) => displaySignature(option) === values.signature)!;
    const result = loadEditorDocument(createBlankScore({ ...values, tonality, timeSignature }));
    if (result.ok) onCreate(result.document);
    else setError(result.errors[0] ?? "无法创建曲谱，请检查曲谱设置。");
  };

  return (
    <ScoreFileDialog title="新建曲谱" wide onClose={close}>
      <ConfigProvider getPopupContainer={(trigger) => trigger?.closest<HTMLElement>('[role="dialog"]') ?? document.body}>
        <Form<NewScoreValues>
          name="new-score"
          layout="vertical"
          size="large"
          initialValues={initialValues}
          scrollToFirstError={{ focus: true }}
          onValuesChange={() => setError("")}
          onCompositionStart={() => composition.current.start()}
          onCompositionEnd={() => composition.current.end()}
          onKeyDownCapture={(event) => {
            if (event.key === "Escape" && event.target instanceof HTMLElement &&
                event.target.matches('[role="combobox"][aria-expanded="true"]')) event.preventDefault();
          }}
          onKeyDown={(event) => {
            composition.current.observeKey(event.nativeEvent);
            if (event.key === "Enter" && composition.current.isComposing()) event.preventDefault();
          }}
          onFinish={submit}
        >
          <div className={styles.newFields}>
            <Form.Item label="曲名" name="title" className={styles.titleField} validateFirst
              rules={[{ required: true, whitespace: true, message: "请输入曲名" }, textFormatRule("title")]}>
              <Input data-initial-focus placeholder="请输入曲名" maxLength={128} />
            </Form.Item>
            <Form.Item label="编谱作者" name="arranger" rules={[textFormatRule("arranger")]}>
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item label="调性" name="tonality" rules={[{
              required: true, type: "enum", enum: tonalityOptions.flatMap(({ options }) => options.map(({ value }) => value)), message: "请选择调性",
            }]}>
              <Select aria-label="调性" options={tonalityOptions} listHeight={192} virtual={false} />
            </Form.Item>
            <Form.Item label="拍号" name="signature" rules={[{
              required: true, type: "enum", enum: signatureOptions.map(({ value }) => value), message: "请选择拍号",
            }]}>
              <Select aria-label="拍号" options={signatureOptions} virtual={false} />
            </Form.Item>
            <Form.Item label="调弦" name="tuning" rules={[{
              required: true, type: "enum", enum: tuningOptions.map(({ value }) => value), message: "请选择调弦",
            }]}>
              <Select aria-label="调弦" options={tuningOptions} listHeight={196} virtual={false}
                optionRender={({ data }) => (
                  <div>{data.label}<small className={styles.tuningPitches}>{data.pitches}</small></div>
                )} />
            </Form.Item>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button size="middle" onClick={close}>取消</Button>
            <Button size="middle" type="primary" htmlType="submit">创建曲谱</Button>
          </div>
        </Form>
      </ConfigProvider>
    </ScoreFileDialog>
  );
}
