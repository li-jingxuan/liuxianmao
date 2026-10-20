"use client";

import { PlusOutlined } from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Form,
  Input,
  Select,
  type InputRef,
} from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import type {
  ILXMLyricVerse,
  ILXMTabCellReference,
  LyricSequenceRow,
} from "@liuxianmao/lxm-editor";
import type { Ref } from "react";
import type { MusicTextDraft } from "./music-text-draft";
import styles from "./index.module.scss";

type LyricTarget = ILXMTabCellReference & {
  kind: "lyric";
  verse: ILXMLyricVerse;
};
export type LyricDraft = Omit<MusicTextDraft, "target"> & {
  target: LyricTarget;
};

/** 歌词表单的纯呈现输入，复杂状态仍由 MusicTextSidebar 这个唯一 owner 持有。 */
export interface LyricFormViewProps {
  draft: LyricDraft;
  sequence: boolean;
  plan: {
    rows: LyricSequenceRow[];
    issue: string | null;
    changes: number;
    overwrites: number;
  } | null;
  issue: string | null;
  inspection: number;
  existing: { id: string } | undefined;
  inputRef: Ref<InputRef>;
  sequenceInputRef: Ref<TextAreaRef>;
  onTextChange: (text: string) => void;
  onModeChange: (mode: MusicTextDraft["lyricMode"]) => void;
  onVerseChange: (verse: ILXMLyricVerse) => void;
  onAllowOverwriteChange: (allowOverwrite: boolean) => void;
  onInspectionChange: (index: number) => void;
  onAddParagraph: () => void;
}

/**
 * 歌词视图只负责字段、预览和帮助信息的渲染；它不读取 store，也不直接提交命令。
 * 这样切换阶段 3 的视觉稿时不会复制草稿、目标或异步提交状态。
 */
export const LyricFormView = ({
  draft,
  sequence,
  plan,
  issue,
  inspection,
  existing,
  inputRef,
  sequenceInputRef,
  onTextChange,
  onModeChange,
  onVerseChange,
  onAllowOverwriteChange,
  onInspectionChange,
  onAddParagraph,
}: LyricFormViewProps) => (
  <section className={styles.sidebarSection}>
    <div className={styles.sectionHeading}>
      <h3>歌词设置</h3>
      <Button
        type="text"
        shape="circle"
        icon={<PlusOutlined />}
        aria-label="添加歌词行"
        title="添加歌词行"
        onClick={onAddParagraph}
      />
    </div>
    <Checkbox
      checked={draft.allowOverwrite}
      onChange={(event) => onAllowOverwriteChange(event.target.checked)}
    >
      允许替换预览中标记的已有歌词（{plan?.overwrites ?? 0} 项）
    </Checkbox>
    <div className={styles.propertyGrid}>
      <Form.Item layout="vertical" label="录入方式" htmlFor="editor-field-歌词录入方式">
        <Select
          id="editor-field-歌词录入方式"
          aria-label="歌词录入方式"
          value={draft.lyricMode}
          onChange={(value) => onModeChange(value as MusicTextDraft["lyricMode"])}
          style={{ width: "100%" }}
          options={[
            { value: "single", label: "单拍编辑" },
            { value: "sequence", label: "连续填词" },
          ]}
        />
      </Form.Item>
      <Form.Item layout="vertical" label="段号" htmlFor="editor-field-歌词段号">
        <Select
          id="editor-field-歌词段号"
          aria-label="歌词段号"
          value={draft.target.verse}
          onChange={(value) => onVerseChange(value as ILXMLyricVerse)}
          style={{ width: "100%" }}
          options={[1, 2, 3, 4].map((value) => ({
            value,
            label: `第 ${value} 段`,
          }))}
        />
      </Form.Item>
    </div>
    {sequence ? (
      <>
        <Form.Item layout="vertical" label="连续歌词" htmlFor="editor-field-连续歌词">
          <Input.TextArea
            id="editor-field-连续歌词"
            ref={sequenceInputRef}
            aria-label="连续歌词"
            aria-invalid={!!issue}
            aria-describedby="lyric-sequence-tips"
            rows={4}
            placeholder="例如：风 吹 _ 过 山 谷"
            value={draft.text}
            onChange={(event) => onTextChange(event.target.value)}
          />
        </Form.Item>
        {plan && (
          <div className={styles.sequencePreview} aria-label="连续歌词修改预览">
            <table>
              <thead>
                <tr>
                  <th>位置</th>
                  <th>原词 → 新词</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={row.index} aria-selected={inspection === row.index}>
                    <td>
                      <Button
                        disabled={!row.target}
                        onClick={() => onInspectionChange(row.index)}
                      >
                        {row.target
                          ? `${row.measureNumber} 小节 / ${row.beatNumber} 拍${row.rest ? "（休止）" : ""}`
                          : `第 ${row.index + 1} 项（超出谱尾）`}
                      </Button>
                    </td>
                    <td>
                      {row.previous ?? "空"} → {row.item.kind === "skip" ? "保留原词" : row.item.text}
                    </td>
                    <td>
                      {{
                        add: "新增",
                        change: "覆盖",
                        same: "未变化",
                        skip: "跳过",
                        error: "错误",
                      }[row.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div id="lyric-sequence-tips" className={styles.sidebarTip}>
          <strong>连续填词规则</strong>
          <p>用空格分词，每项依次对应一拍，休止拍也占一格。多个空格按一个分隔处理。</p>
          <p>
            用 <code>_</code> 跳过一拍并保留原歌词，例如 <code>风 _ 过</code>。
          </p>
          <p>
            英文短句按空格拆词；要把 <code>a song</code> 放在同一拍，请切到单拍编辑。
          </p>
          <p>先核对下方对应预览，再应用全部。默认允许替换已有歌词，可取消下方勾选以保留原词。</p>
          <details>
            <summary>详细规则</summary>
            半角与全角空格均可分隔，首尾空格忽略；仅独立 _ 表示跳过。每项最多 64 字，每批最多 256 拍。
            不接受换行或制表符；谱尾位置不足时整批拒绝；整批可一次撤销。
          </details>
        </div>
      </>
    ) : (
      <>
        <Form.Item layout="vertical" label="歌词" htmlFor="editor-field-歌词文本">
          <Input
            id="editor-field-歌词文本"
            ref={inputRef}
            aria-label="歌词文本"
            aria-invalid={!!issue}
            value={draft.text}
            onChange={(event) => onTextChange(event.target.value)}
          />
        </Form.Item>
        {existing ? <small>将修改已有歌词。</small> : <small>此拍暂无第 {draft.target.verse} 段歌词。</small>}
        <div className={styles.sidebarTip}>
          Enter 应用并下一拍；Shift+Enter 仅应用。
          <br />
          每拍单行，支持第 1–4 段歌词。
        </div>
      </>
    )}
  </section>
);
