"use client";
import { Button, Tooltip } from "antd";
import type { ILXMBarlineType, ILXMDocument } from "@liuxianmao/lxm-editor";
import type { MeasureToolTarget, ToolActionHandler } from "./editor-tool-actions";
import styles from "./MeasureControls.module.scss";

export const BARLINES: { value: ILXMBarlineType; label: string; short: string }[] = [
  { value: "single", label: "单小节线", short: "单线" },
  { value: "double", label: "双小节线", short: "双线" },
  { value: "final", label: "终止线", short: "终止线" },
  { value: "repeatStart", label: "开始反复线", short: "开始反复" },
  { value: "repeatEnd", label: "结束反复线", short: "结束反复" },
  { value: "repeatBoth", label: "双向反复线", short: "双向反复" },
];

export const resolveMeasureControlTarget = (document: ILXMDocument, target?: MeasureToolTarget | null) => {
  const track = document.score.tracks.find((item) => item.id === target?.trackId);
  const index = track?.measures.findIndex((item) => item.id === target?.measureId) ?? -1;
  const measure = track?.measures[index];
  return track && measure ? { track, measure, index } : null;
};

/** 控件的谱学示意，不替代核心谱面绘制。 */
export const BarlineSymbol = ({ value }: { value: ILXMBarlineType }) => (
  <svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true" focusable="false">
    {value === "single" ? <path d="M15 4V20" stroke="currentColor" /> : <>
      <path d="M12 4V20" stroke="currentColor" strokeWidth={value === "repeatStart" ? 3 : 1} />
      <path d="M18 4V20" stroke="currentColor" strokeWidth={value === "final" || value === "repeatEnd" ? 3 : 1} />
      {value === "repeatBoth" && <path d="M15 4V20" stroke="currentColor" strokeWidth="3" />}
    </>}
    {(value === "repeatEnd" || value === "repeatBoth") && <><circle cx="7" cy="9" r="1.2" fill="currentColor" /><circle cx="7" cy="15" r="1.2" fill="currentColor" /></>}
    {(value === "repeatStart" || value === "repeatBoth") && <><circle cx="23" cy="9" r="1.2" fill="currentColor" /><circle cx="23" cy="15" r="1.2" fill="currentColor" /></>}
  </svg>
);

export const MeasureBoundary = ({ document, target, blocked, multipleMeasures, onAction }: {
  document: ILXMDocument; target?: MeasureToolTarget | null; blocked: boolean; multipleMeasures?: boolean; onAction: ToolActionHandler;
}) => {
  const resolved = resolveMeasureControlTarget(document, target);
  const atEnd = !!resolved && resolved.index === resolved.track.measures.length - 1;
  const blockedReason = !resolved ? "请选择目标小节。" : blocked ? "请先完成当前编辑或等待提交结束。"
    : multipleMeasures ? "请选择一个小节。" : "";
  return <section className={styles.boundarySection}>
    <h4>小节线</h4>
    <div className={styles.boundaries} role="group" aria-label="小节线与反复">
    {BARLINES.map((barline) => {
      const reason = blockedReason || (atEnd && (barline.value === "repeatStart" || barline.value === "repeatBoth") ? "谱尾右边界没有下一小节，不能开始反复。" : "");
      const pressed = !multipleMeasures && resolved?.measure.barline === barline.value;
      const title = `${barline.label}：设置第 ${resolved ? resolved.index + 1 : "—"} 小节右边界${reason ? `；${reason}` : ""}`;
      return <Tooltip key={barline.value} title={title} trigger={["hover", "focus"]}>
        <span className={styles.boundaryItem} tabIndex={reason ? 0 : undefined} aria-label={reason ? title : undefined}>
          <Button disabled={!!reason} aria-label={barline.label} aria-pressed={pressed} color={pressed ? "primary" : "default"} variant={pressed ? "filled" : "outlined"}
            onClick={() => { if (target && !reason) void onAction({ type: "barline", value: barline.value, target }); }}><BarlineSymbol value={barline.value} /></Button>
          <span className={styles.boundaryLabel}>{barline.short}</span>
        </span>
      </Tooltip>;
    })}
    {(() => {
      const reason = blockedReason || (resolved?.index !== 0 ? "谱首反复仅对第一小节可用。" : "");
      const pressed = !multipleMeasures && resolved?.index === 0 && resolved.track.startBarline === "repeatStart";
      const title = `谱首反复：切换全谱左侧首边界${reason ? `；${reason}` : ""}`;
      return <Tooltip title={title} trigger={["hover", "focus"]}>
        <span className={styles.boundaryItem} tabIndex={reason ? 0 : undefined} aria-label={reason ? title : undefined}>
          <Button disabled={!!reason} aria-label="谱首反复" aria-pressed={pressed} color={pressed ? "primary" : "default"} variant={pressed ? "filled" : "outlined"}
            onClick={() => { if (target && !reason) void onAction({ type: "startRepeat", target }); }}><BarlineSymbol value="repeatStart" /></Button>
          <span className={styles.boundaryLabel}>谱首反复</span>
        </span>
      </Tooltip>;
    })()}
    </div>
  </section>;
};
