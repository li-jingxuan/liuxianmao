import { Button, Form, Input, Popover, Select, Tooltip } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import {
  getLyricVerseCount,
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
  inputRef, onVerseChange, onAddVerse, onTextChange, onInspect,
}: {
  presentation?: "popover" | "sidebar";
  document?: ILXMDocument | null;
  draft: MusicTextDraft;
  plan: ReturnType<typeof planLyricSequence> | null;
  issue: string | null;
  disabled?: boolean;
  inputRef: RefCallback<HTMLInputElement>;
  onVerseChange: (verse: ILXMLyricVerse) => void;
  onAddVerse: () => void;
  onTextChange: (value: string) => void;
  onInspect: (index: number) => void;
}) => {
  const compact = presentation === "popover";
  const fieldId = (field: string) => `lyric-${presentation === "popover" ? "popover-" : ""}${field}`;
  const parsed = parseLyricSequence(draft.text);
  const currentPlan = parsed.ok && plan?.rows.length ? plan : null;
  const mapping = document && currentPlan ? buildLyricMappingPreview(document, currentPlan) : null;
  const verseCount = document ? getLyricVerseCount(document) : 1;
  const atLimit = verseCount >= 4;
  return (
    <section data-editor-form-section className={`${editorFormStyles.sidebarSection} ${formStyles.form}`} aria-label="歌词属性表单">
      {!compact && <div className={formStyles.verseRow}>
        <label htmlFor={fieldId("verse")}>段落</label>
        <Select id={fieldId("verse")} aria-label="歌词段落" value={draft.target.verse}
          disabled={disabled} onChange={onVerseChange}
          options={([1, 2, 3, 4] as const).slice(0, verseCount).map((value) => ({ value, label: `第${["一", "二", "三", "四"][value - 1]}段` }))} />
        <Tooltip title={atLimit ? "最多支持四段歌词" : undefined}>
          <span tabIndex={atLimit ? 0 : undefined} aria-label={atLimit ? "最多支持四段歌词" : undefined}>
            <Button disabled={disabled || atLimit} onClick={onAddVerse}>添加段落</Button>
          </span>
        </Tooltip>
      </div>}
      <Form.Item layout="vertical" htmlFor={fieldId("body")} validateStatus={issue ? "error" : undefined}
        label={compact ? undefined : <span className={formStyles.fieldLabel}>歌词内容
          <Popover trigger={["hover", "focus", "click"]} content={<div id={fieldId("help")} className={formStyles.help}>
            <p>空格分词；一个词写入一个位置，自动跳过休止。</p>
            <p><code>_</code> 清空一个位置；空输入清空当前位置。</p>
            <p>Enter 应用，停留当前位置。</p>
          </div>}>
            <button type="button" className={formStyles.helpButton} aria-label="歌词输入规则" aria-describedby={fieldId("help")}><QuestionCircleOutlined /></button>
          </Popover>
          <span className={formStyles.continuous}>连续录入</span>
        </span>}>
        <Input id={fieldId("body")} aria-label="连续歌词" aria-invalid={!!issue}
          title="Enter 应用，停留当前位置"
          ref={(control) => inputRef(control?.input ?? null)} value={draft.text}
          onChange={(event) => onTextChange(event.target.value)} placeholder="例如：风 吹 _ 过 山 谷" />
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
