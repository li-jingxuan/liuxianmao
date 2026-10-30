import { Alert, Button, Checkbox, Form, Input, Select } from "antd";
import { planLyricSequence, type ILXMLyricVerse } from "@liuxianmao/lxm-editor";
import type { RefCallback } from "react";
import type { MusicTextDraft } from "./music-text-draft";
import styles from "./index.module.scss";

/** 纯呈现：草稿、输入法、目标保护和音乐命令仍由 Sidebar 唯一持有。 */
export const LyricFormView = ({
  draft,
  plan,
  issue,
  inspection,
  existingText,
  inputRef,
  sequenceInputRef,
  onModeChange,
  onVerseChange,
  onTextChange,
  onOverwriteChange,
  onInspect,
}: {
  draft: MusicTextDraft;
  plan: ReturnType<typeof planLyricSequence> | null;
  issue: string | null;
  inspection: number;
  existingText?: string;
  inputRef: RefCallback<HTMLInputElement>;
  sequenceInputRef: RefCallback<HTMLTextAreaElement>;
  onModeChange: (mode: MusicTextDraft["lyricMode"]) => void;
  onVerseChange: (verse: ILXMLyricVerse) => void;
  onTextChange: (value: string) => void;
  onOverwriteChange: (value: boolean) => void;
  onInspect: (index: number) => void;
}) => {
  const sequence = draft.lyricMode === "sequence";
  return (
    <section className={styles.sidebarSection} aria-label="歌词属性表单">
      <h3>歌词设置</h3>
      <div className={styles.propertyGrid}>
        <Form.Item layout="vertical" label="录入方式" htmlFor="lyric-mode">
          <Select
            id="lyric-mode"
            aria-label="歌词录入方式"
            value={draft.lyricMode}
            onChange={onModeChange}
            options={[
              { value: "single", label: "单音符编辑" },
              { value: "sequence", label: "连续填词" },
            ]}
          />
        </Form.Item>
        <Form.Item layout="vertical" label="段号" htmlFor="lyric-verse">
          <Select
            id="lyric-verse"
            aria-label="歌词段号"
            value={draft.target.verse}
            onChange={onVerseChange}
            options={([1, 2, 3, 4] as const).map((value) => ({
              value,
              label: `第 ${value} 段`,
            }))}
          />
        </Form.Item>
      </div>
      <Form.Item
        layout="vertical"
        label={sequence ? "连续歌词" : "歌词"}
        htmlFor="lyric-body"
        validateStatus={issue ? "error" : undefined}
        help={issue ?? undefined}
      >
        {sequence ? (
          <Input.TextArea
            id="lyric-body"
            aria-label="连续歌词"
            aria-describedby="lyric-sequence-tips"
            rows={4}
            ref={(control) =>
              sequenceInputRef(control?.resizableTextArea?.textArea ?? null)
            }
            value={draft.text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder="例如：风 吹 _ 过 山 谷"
          />
        ) : (
          <Input
            id="lyric-body"
            aria-label="歌词文本"
            ref={(control) => inputRef(control?.input ?? null)}
            value={draft.text}
            onChange={(event) => onTextChange(event.target.value)}
          />
        )}
      </Form.Item>
      {sequence ? (
        <>
          <div id="lyric-sequence-tips" className={styles.sidebarTip}>
            <strong>连续填词规则</strong>
            <p>
              用空格分词，每项依次对应一个音符或空白位置，自动跳过休止。用{" "}
              <code>_</code> 跳过一个位置并保留原词。
            </p>
            <p>
              默认允许替换已有歌词。先核对对应预览，再应用全部；整批可一次撤销。
            </p>
            <details>
              <summary>详细规则</summary>
              半角与全角空格均可分隔，首尾空格忽略。每项最多64字，每批最多256个位置；不接受换行或制表符，超出谱尾整批拒绝。英文空格也会拆词，同一位置的短句请用单音符编辑。
            </details>
          </div>
          <Checkbox
            checked={draft.allowOverwrite}
            onChange={(event) => onOverwriteChange(event.target.checked)}
          >
            允许替换预览中标记的已有歌词（{plan?.overwrites ?? 0} 项）
          </Checkbox>
          {issue && (
            <Alert
              type="error"
              showIcon
              title="整批尚未应用"
              description={issue}
            />
          )}
          {plan && (
            <div className={styles.sequencePreview} aria-label="歌词对应预览">
              <h4>
                对应预览 · 写入 {plan.changes} 项 · 覆盖 {plan.overwrites} 项
              </h4>
              <table>
                <thead>
                  <tr>
                    <th>序号 / 位置</th>
                    <th>原词 → 新词</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr
                      key={row.index}
                      aria-selected={inspection === row.index}
                    >
                      <td>
                        <Button
                          size="small"
                          type="text"
                          disabled={!row.target}
                          onClick={() => onInspect(row.index)}
                        >
                          {row.index + 1} ·{" "}
                          {row.target
                            ? `${row.measureNumber} 小节 / 简谱位置 ${row.beatNumber}`
                            : "超出谱尾"}
                        </Button>
                      </td>
                      <td>
                        {row.previous ?? "空"} →{" "}
                        {row.item.kind === "skip" ? "保留原词" : row.item.text}
                      </td>
                      <td>
                        {
                          {
                            add: "新增",
                            change: "覆盖",
                            same: "未变化",
                            skip: "跳过",
                            error: "错误",
                          }[row.status]
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <p className={styles.sidebarTip}>
            原词：
            {existingText ?? `此音符暂无第 ${draft.target.verse} 段歌词。`}
          </p>
          <p className={styles.sidebarTip}>
            Enter 应用并移到下一个歌词位置；Shift+Enter
            仅应用。每个音符单行，支持第1–4段歌词。
          </p>
        </>
      )}
    </section>
  );
};
