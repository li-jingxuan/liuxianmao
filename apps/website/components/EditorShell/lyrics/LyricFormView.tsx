import { Button, Form, Input, Popover } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import {
  getMeasureCapacityTicks,
  planLyricSequence,
  resolveLyricPosition,
  type ILXMDocument,
} from "@liuxianmao/lxm-editor";
import type { RefCallback } from "react";
import {
  BeatMappingPreview,
  type BeatMappingMeasure,
  type BeatMappingRow,
} from "../music-text/BeatMappingPreview";
import { parseLyricDraftSequence, type MusicTextDraft } from "../music-text/music-text-draft";
import { formatNumberedBeatPosition } from "../numbered/numbered-editor-target";
import { ShortcutHint, ShortcutTooltip } from "../session/EditorShortcutReference";
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
      after: row.item.kind === "clear" ? "" : row.item.text,
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

/** 两个表面共享唯一草稿、输入法保护和命令入口。 */
export const LyricFormView = ({
  presentation = "sidebar", document, draft, plan, issue, disabled = false,
  inputRef, onTextChange, onInspect, onApply, canApply = false,
}: {
  presentation?: "popover" | "sidebar";
  document?: ILXMDocument | null;
  draft: MusicTextDraft;
  plan: ReturnType<typeof planLyricSequence> | null;
  issue: string | null;
  disabled?: boolean;
  inputRef: RefCallback<HTMLTextAreaElement>;
  onTextChange: (value: string) => void;
  onInspect: (index: number) => void;
  onApply?: () => void;
  canApply?: boolean;
}) => {
  const compact = presentation === "popover";
  const fieldId = (field: string) => `lyric-${presentation === "popover" ? "popover-" : ""}${field}`;
  const parsed = parseLyricDraftSequence(draft.text);
  const currentPlan = parsed.ok && plan?.rows.length ? plan : null;
  const mapping = document && currentPlan ? buildLyricMappingPreview(document, currentPlan) : null;
  return (
    <section data-editor-form-section className={`${editorFormStyles.sidebarSection} ${formStyles.form}`} aria-label="歌词属性表单">
      <Form.Item layout="vertical" htmlFor={fieldId("body")} validateStatus={issue ? "error" : undefined}
        label={compact ? undefined : <span className={formStyles.fieldLabel}>歌词内容
          <Popover trigger={["hover", "focus", "click"]} content={<div id={fieldId("help")} className={formStyles.help}>
            <p>空格或换行分词。一个词写入一个位置，自动跳过休止。</p>
            <p><code>_</code> 清空一个位置，空输入清空当前位置。</p>
            <ShortcutHint shortcuts={["lyricNewline", "textNavigate", "applyModified"]} />
          </div>}>
            <button type="button" className={formStyles.helpButton} aria-label="歌词输入规则" aria-describedby={fieldId("help")}><QuestionCircleOutlined /></button>
          </Popover>
        </span>}>
        <Input.TextArea id={fieldId("body")} aria-label="连续歌词" aria-invalid={!!issue}
          title="Enter 换行" rows={2} className={formStyles.input}
          ref={(control) => inputRef(control?.resizableTextArea?.textArea ?? null)} value={draft.text}
          onChange={(event) => onTextChange(event.target.value)} placeholder="例如：风 吹 _ 过 山 谷" />
        <div className={formStyles.actions}>
          <ShortcutTooltip shortcuts={["applyModified"]} disabled={disabled || !!issue || !canApply}>
            <Button aria-label="应用" type="primary" disabled={disabled || !!issue || !canApply} onClick={onApply}>应用</Button>
          </ShortcutTooltip>
        </div>
      </Form.Item>
      {issue && <p className={formStyles.error} role="status">{issue}</p>}
      {!compact && mapping && <BeatMappingPreview compact rows={mapping.rows} measures={mapping.measures} label="音符与歌词映射"
        onInspect={(position) => {
          const row = mapping.rows.find((value) => value.sourcePosition?.trackId === position.trackId && value.sourcePosition.measureId === position.measureId && value.sourcePosition.startTick === position.startTick && value.sourcePosition.endTick === position.endTick);
          if (row) onInspect(Number(row.key));
        }} />}
    </section>
  );
};
