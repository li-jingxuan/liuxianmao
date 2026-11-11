import { Button, Checkbox, Form, Input, Segmented, Select } from "antd";
import {
  getMeasureCapacityTicks,
  parseLyricSequence,
  planLyricSequence,
  resolveLyricPosition,
  type ILXMDocument,
  type ILXMLyricVerse,
} from "@liuxianmao/lxm-editor";
import type { RefCallback } from "react";
import {
  BeatMappingPreview,
  type BeatMappingMeasure,
  type BeatMappingRow,
} from "../music-text/BeatMappingPreview";
import type { MusicTextDraft } from "../music-text/music-text-draft";
import { formatNumberedBeatPosition } from "../numbered/numbered-editor-target";
import editorFormStyles from "../shared/editor-form.module.scss";
import formStyles from "./LyricFormView.module.scss";

/** 只适配领域规划；顺序号不参与拍位或时间范围计算。 */
export function buildLyricMappingPreview(
  document: ILXMDocument,
  plan: ReturnType<typeof planLyricSequence>,
): { rows: BeatMappingRow[]; measures: BeatMappingMeasure[] } | null {
  const rows: BeatMappingRow[] = [];
  const measureKeys = new Set<string>();
  for (const row of plan.rows) {
    const track = document.score.tracks.find((value) => value.id === row.target?.trackId);
    const measure = track?.measures.find((value) => value.id === row.target?.measureId);
    const position = measure && row.target ? resolveLyricPosition(measure, row.target) : undefined;
    // 有目标但已无法解析时，整批旧规划失效；超谱尾行仍保留其领域错误。
    if (row.target && (!measure || !position)) return null;
    const sourcePosition = row.target && position ? {
      trackId: row.target.trackId,
      measureId: row.target.measureId,
      startTick: position.tick,
      endTick: position.endTick,
    } : null;
    if (measure) measureKeys.add(measure.id);
    const event = measure?.numberedVoice.events.find((value) => value.id === position?.eventId);
    const beatLabel = measure && position ? formatNumberedBeatPosition(position.tick, measure.timeSignature.denominator) : null;
    const measureNumber = track?.measures.findIndex((value) => value.id === measure?.id);
    rows.push({
      key: String(row.index),
      before: row.previous ?? "空",
      after: row.item.kind === "skip" ? "保留原词" : row.item.text,
      positionLabel: measure && position ? `${measureNumber! + 1} 小节 / ${beatLabel}${!event || event.kind === "gap" ? `～${formatNumberedBeatPosition(position.endTick, measure.timeSignature.denominator)}` : ""}` : "超出谱尾",
      status: row.status,
      sourcePosition,
      plannedPosition: sourcePosition,
      canInspect: !!sourcePosition,
      rhythm: event?.kind === "notes" ? `音符 ${event.items.map((item) => item.token).join("+")}` : sourcePosition ? "空白位置" : undefined,
      music: event?.kind === "notes" ? event.items.map((item) => item.token).join("+") : "—",
      impactLabel: row.status === "change" ? "覆盖已有歌词" : undefined,
    });
  }
  const measures = document.score.tracks.flatMap((track) => track.measures.flatMap((measure, index) => measureKeys.has(measure.id) ? [{
    key: measure.id,
    label: `${index + 1} 小节 · ${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`,
    durationTicks: getMeasureCapacityTicks(measure.timeSignature),
    beatTicks: 3840 / measure.timeSignature.denominator,
  }] : []));
  return { rows, measures };
}

/** 纯呈现：草稿、输入法、目标保护和音乐命令仍由 Sidebar 唯一持有。 */
export const LyricFormView = ({
  presentation = "sidebar",
  document,
  draft,
  plan,
  issue,
  inspection,
  existingText,
  nextLocation,
  inputRef,
  sequenceInputRef,
  onModeChange,
  onVerseChange,
  onTextChange,
  onOverwriteChange,
  onInspect,
}: {
  presentation?: "popover" | "sidebar";
  document?: ILXMDocument | null;
  draft: MusicTextDraft;
  plan: ReturnType<typeof planLyricSequence> | null;
  issue: string | null;
  inspection: number;
  existingText?: string;
  nextLocation?: string;
  inputRef: RefCallback<HTMLInputElement>;
  sequenceInputRef: RefCallback<HTMLTextAreaElement>;
  onModeChange: (mode: MusicTextDraft["lyricMode"]) => void;
  onVerseChange: (verse: ILXMLyricVerse) => void;
  onTextChange: (value: string) => void;
  onOverwriteChange: (value: boolean) => void;
  onInspect: (index: number) => void;
}) => {
  const sequence = draft.lyricMode === "sequence";
  const compact = presentation === "popover";
  const fieldId = (field: string) => `lyric-${compact ? "popover-" : ""}${field}`;
  const parsed = sequence ? parseLyricSequence(draft.text) : null;
  const currentPlan = parsed?.ok && plan?.rows.length ? plan : null;
  const mapping = document && currentPlan ? buildLyricMappingPreview(document, currentPlan) : null;
  const visiblePlan = document === null || (document && !mapping) ? null : currentPlan;
  return (
    <section data-editor-form-section className={`${editorFormStyles.sidebarSection} ${formStyles.form}`} aria-label="歌词属性表单">
      <div hidden={compact} inert={compact}>
        <Form.Item className={formStyles.verseRow} label="歌词段号" htmlFor={fieldId("verse")}>
          <Select
            id={fieldId("verse")}
            aria-label="歌词段号"
            value={draft.target.verse}
            onChange={onVerseChange}
            options={([1, 2, 3, 4] as const).map((value) => ({
              value,
              label: `第 ${value} 段`,
            }))}
          />
        </Form.Item>
        <div className={formStyles.modeRow}>
          <span>填写方式</span>
          <Segmented size="small" id={fieldId("mode")} aria-label="歌词录入方式" value={draft.lyricMode}
            options={[{ value: "single", label: "单个位置" }, { value: "sequence", label: "连续填词" }]}
            onChange={(value) => onModeChange(value as MusicTextDraft["lyricMode"])} />
        </div>
      </div>
      {!sequence && !compact && <p className={formStyles.context}>原词：{existingText ?? `此音符暂无第 ${draft.target.verse} 段歌词。`}</p>}
      <div hidden={!compact} inert={!compact} className={formStyles.lyricModeSwitch}>
        <Segmented size="small" aria-label="歌词录入方式" value={draft.lyricMode}
          options={[{value: "single", label: "单点"}, {value: "sequence", label: "连续"}]}
          onChange={(value) => onModeChange(value as MusicTextDraft["lyricMode"])} />
      </div>
      <Form.Item
        layout="vertical"
        label={compact ? undefined : sequence ? "连续歌词" : "歌词"}
        htmlFor={fieldId("body")}
        validateStatus={issue ? "error" : undefined}
      >
        {sequence ? (
          <Input.TextArea
            id={fieldId("body")}
            aria-label="连续歌词"
             aria-describedby={fieldId("sequence-tips")}
             aria-invalid={!!issue}
            rows={2}
            title="Enter 应用连续歌词"
            ref={(control) =>
              sequenceInputRef(control?.resizableTextArea?.textArea ?? null)
            }
            value={draft.text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder="例如：风 吹 _ 过 山 谷"
          />
        ) : (
          <Input
            id={fieldId("body")}
             aria-label="歌词文本"
             title="Enter 应用并下一处；Shift+Enter 仅应用"
             aria-invalid={!!issue}
            ref={(control) => inputRef(control?.input ?? null)}
            value={draft.text}
            onChange={(event) => onTextChange(event.target.value)}
          />
        )}
      </Form.Item>
      {issue && <p className={formStyles.error} role="status">{issue}</p>}
      {sequence ? (
        <>
          <p id={fieldId("sequence-tips")} className={formStyles.hint} hidden={compact} inert={compact}>
            空格分词；<code>_</code> 保留一个位置。按简谱对齐，自动跳过休止。Enter 应用。
          </p>
          {visiblePlan && (
            <div data-editor-form-sequence-preview className={formStyles.sequencePreview} aria-label="歌词对应预览">
              <p role="status" className={compact ? formStyles.compactSummary : undefined}>
                {compact ? "" : "对应预览 · "}写入 {visiblePlan.changes} 项 · 覆盖 {visiblePlan.overwrites} 项
              </p>
              {!compact && mapping && <BeatMappingPreview
                rows={mapping.rows}
                measures={mapping.measures}
                label="音符与歌词映射"
                onInspect={(position) => {
                  const row = mapping.rows.find((value) => value.sourcePosition?.trackId === position.trackId && value.sourcePosition.measureId === position.measureId && value.sourcePosition.startTick === position.startTick && value.sourcePosition.endTick === position.endTick);
                  if (row) onInspect(Number(row.key));
                }}
              />}
              {visiblePlan.overwrites > 0 && !draft.allowOverwrite && <p hidden={compact} inert={compact} className={formStyles.hint}>待允许覆盖，整批尚未应用。</p>}
              <details className={formStyles.disclosure} hidden={compact} inert={compact}>
                <summary>覆盖与逐项预览 <span>{visiblePlan.rows.length} 个字词 · 第 {draft.target.verse} 段{visiblePlan.overwrites > 0 ? draft.allowOverwrite ? " · 已允许覆盖" : " · 待允许覆盖" : ""}</span></summary>
              <div className={formStyles.overwrite}><Checkbox
                checked={draft.allowOverwrite}
                onChange={(event) => onOverwriteChange(event.target.checked)}
              >
                允许替换预览中标记的已有歌词（{visiblePlan.overwrites} 项）
              </Checkbox>
                <p className={formStyles.hint}>仅替换预览中标记的已有歌词；逐项查看原词与新词，点击位置可定位到谱面。</p>
              </div>
                <div className={formStyles.tableScroll}>
                <table>
                  <thead>
                    <tr>
                      <th>序号 / 位置</th>
                      <th>原词 → 新词</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePlan.rows.map((row) => (
                      <tr
                        key={row.index}
                        aria-selected={inspection === row.index}
                      >
                        <td>
                          <Button
                            size="small"
                            type="text"
                            disabled={!row.target || (!!document && !mapping?.rows.find((value) => value.key === String(row.index))?.canInspect)}
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => onInspect(row.index)}
                          >
                            {row.index + 1} ·{" "}
                            {row.target
                              ? mapping?.rows.find((value) => value.key === String(row.index))?.positionLabel ?? `${row.measureNumber} 小节 / 歌词位置待解析`
                              : "超出谱尾"}
                          </Button>
                        </td>
                        <td>
                          {row.previous ?? "空"} →{" "}
                          {row.item.kind === "skip"
                            ? "保留原词"
                            : row.item.text}
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
              </details>
            </div>
          )}
          <details className={formStyles.disclosure} hidden={compact} inert={compact}>
            <summary>连续填词规则 <span>空格、留空与休止</span></summary>
            <p className={formStyles.hint}>半角与全角空格均可分隔，首尾空格忽略。每项最多64字，每批最多256个位置；不接受换行或制表符，超出谱尾整批拒绝。英文空格也会拆词，同一位置的短句请用单音符编辑。第1–4段分别填写。</p>
          </details>
        </>
      ) : (
        <div hidden={compact} inert={compact}>
          <p className={formStyles.context}>
            下一歌词位置：{nextLocation ?? "已到最后一个歌词位置"}
          </p>
          <p className={formStyles.hint}>
            Enter 应用并移到下一个歌词位置；Shift+Enter
            仅应用。每个音符单行，支持第1–4段歌词。
          </p>
        </div>
      )}
    </section>
  );
};
