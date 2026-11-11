"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { layoutChordDiagram, cloneChordDiagram, validateChordDiagramIssues, editChordDiagram, type ILXMChordDiagram, type ILXMChordBarre, type ILXMChordString, type ChordDiagramIssue, type ChordDiagramEditIntent } from "@liuxianmao/lxm-editor";
import type { ChordDraft } from "./ChordEditor";
import { ChordDiagramView } from "../score/MusicTextLayer";
import { createScoreSettingsComposition } from "../settings/score-settings-composition";
import styles from "./ChordDiagramEditorModal.module.scss";

export interface ChordDiagramEditorModalProps {
  seed: ChordDraft;
  tuning: readonly { pitch: string; midi: number }[];
  onComplete: (draft: ChordDraft) => void;
  onCancel: () => void;
  onSave?: (draft: ChordDraft) => { ok: boolean; message?: string } | Promise<{ ok: boolean; message?: string }>;
  disabled?: boolean;
}
type Buffer = {
  name: string;
  startFret: string;
  strings: { string: ILXMChordString["string"]; fret: string; finger: string }[];
  barres: ILXMChordBarre[];
};
type BarreForm = { index: number | null; fret: string; minString: string; maxString: string; finger: string };
const number = (value: string) => value.trim() === "" ? Number.NaN : Number(value);
const fromDiagram = (name: string, diagram: ILXMChordDiagram): Buffer => ({ name, startFret: String(diagram.startFret), strings: diagram.strings.map((s) => ({ string: s.string, fret: String(s.fret), finger: s.finger === null ? "" : String(s.finger) })), barres: diagram.barres.map((b) => ({ ...b })) });
const toDiagram = (buffer: Buffer): ILXMChordDiagram => ({ startFret: number(buffer.startFret), fretCount: 5, strings: buffer.strings.map((s) => ({ string: s.string, fret: s.fret === "x" ? "x" : number(s.fret), finger: s.finger === "" ? null : number(s.finger) as ILXMChordString["finger"] })), barres: buffer.barres.map((b) => ({ ...b })) });
const initialBuffer = (seed: ChordDraft): Buffer => fromDiagram(seed.chord.name, seed.chord.diagram ?? { startFret: 1, fretCount: 5, strings: [1, 2, 3, 4, 5, 6].map((string) => ({ string: string as ILXMChordString["string"], fret: "x", finger: null })), barres: [] });

/** 单个宿主 Modal 的正文和底栏；全部编辑只保存在本次挂载的局部历史中。 */
export function ChordDiagramEditorModal({ seed, tuning, onComplete, onCancel, onSave, disabled = false }: ChordDiagramEditorModalProps) {
  const [history, setHistory] = useState(() => ({ past: [] as Buffer[], present: initialBuffer(seed), future: [] as Buffer[] }));
  const buffer = history.present;
  const [lastValid, setLastValid] = useState<ILXMChordDiagram | null>(() => seed.chord.diagram && !validateChordDiagramIssues(seed.chord.diagram).length ? cloneChordDiagram(seed.chord.diagram) : null);
  const [tool, setTool] = useState<"note" | "barre" | "erase">("note");
  const [finger, setFinger] = useState<ILXMChordBarre["finger"]>(1);
  const [pointFinger, setPointFinger] = useState<ILXMChordString["finger"]>(null);
  const [endpoint, setEndpoint] = useState<{ string: ILXMChordString["string"]; fret: number } | null>(null);
  const [barreForm, setBarreForm] = useState<BarreForm | null>(null);
  const [actionIssues, setActionIssues] = useState<ChordDiagramIssue[]>([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [protectedInput, setProtectedInput] = useState(false);
  const [composition] = useState(() => createScoreSettingsComposition(setProtectedInput));
  const [activeCell, setActiveCell] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const savePending = useRef(false);
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; composition.dispose(); };
  }, [composition]);
  const diagram = toDiagram(buffer);
  const issues = validateChordDiagramIssues(diagram);
  const nameIssue = !buffer.name.trim() || /[\r\n]/.test(buffer.name) || buffer.name.trim().length > 32 ? "和弦名称应为非空单行，最多 32 个字符" : null;
  const canComplete = !disabled && !saving && !protectedInput && !nameIssue && !issues.length && !barreForm && !endpoint;
  const blocked = disabled || saving;
  const rememberValid = (next: Buffer) => {
    const value = toDiagram(next);
    if (!validateChordDiagramIssues(value).length) setLastValid(cloneChordDiagram(value));
  };
  const preview = lastValid ? layoutChordDiagram(lastValid) : null;
  const commit = (next: Buffer) => {
    setHistory((current) => JSON.stringify(current.present) === JSON.stringify(next) ? current : { past: [...current.past, current.present], present: next, future: [] });
    rememberValid(next);
    setActionIssues([]);
    setNotice("");
  };
  const undo = (redo = false) => {
    if (blocked || composition.isComposing()) return;
    setEndpoint(null); setBarreForm(null); setActionIssues([]); setNotice("");
    const source = redo ? history.future : history.past;
    const next = source.at(-1);
    if (!next) return;
    setHistory(redo ? { past: [...history.past, history.present], present: next, future: history.future.slice(0, -1) } : { past: history.past.slice(0, -1), present: next, future: [...history.future, history.present] });
    rememberValid(next);
  };
  const intent = (value: ChordDiagramEditIntent) => {
    if (blocked || composition.isComposing()) return false;
    const result = editChordDiagram(toDiagram(buffer), value);
    if (!result.ok) { setActionIssues(result.issues); setNotice(""); return false; }
    commit(fromDiagram(buffer.name, result.diagram));
    if (result.clearedStrings.length) setNotice(`已保留品位，第 ${result.clearedStrings.join("、")} 弦相关重复手指改为未指定`);
    return true;
  };
  const draft = (): ChordDraft => ({ display: seed.display, chord: { name: buffer.name.trim(), diagram: cloneChordDiagram(toDiagram(buffer)) } });
  const complete = () => { if (canComplete && !composition.isComposing()) onComplete(draft()); };
  const save = async () => {
    if (!onSave || !canComplete || composition.isComposing() || savePending.current) return;
    savePending.current = true; setSaving(true);
    try {
      const result = await onSave(draft());
      if (mounted.current) setNotice(result.message ?? (result.ok ? "已存入我的指法；完成编辑后才会回填和弦草稿" : "保存失败，请重试"));
    } catch { if (mounted.current) setNotice("保存失败，请重试"); }
    finally { savePending.current = false; if (mounted.current) setSaving(false); }
  };
  const startFret = Number.isInteger(diagram.startFret) && diagram.startFret >= 1 && diagram.startFret <= 20 ? diagram.startFret : 1;
  const frets = Array.from({ length: 5 }, (_, i) => startFret + i);
  const activate = (string: ILXMChordString["string"], fret: number | "x") => {
    if (blocked || composition.isComposing()) return;
    if (barreForm) { setNotice("请先应用或取消横按表单"); return; }
    if (fret === "x" || fret === 0) { intent({ type: "set-string", string, fret }); return; }
    if (tool === "barre") {
      if (!endpoint) { setEndpoint({ string, fret }); return; }
      if (endpoint.fret !== fret || endpoint.string === string) { setNotice("请选择同一品位的另一根弦作为横按终点"); return; }
      if (intent({ type: "add-barre", barre: { fret, minString: endpoint.string, maxString: string, finger } })) setEndpoint(null);
      return;
    }
    if (tool === "erase") {
      const index = diagram.barres.findIndex((b) => b.fret === fret && string >= b.minString && string <= b.maxString);
      if (index >= 0) intent({ type: "delete-barre", index });
      else if (diagram.strings.find((s) => s.string === string)?.fret === fret) intent({ type: "set-string", string, fret: "x" });
    } else intent({ type: "set-string", string, fret, finger: pointFinger });
  };
  const cellKey = (event: KeyboardEvent<HTMLButtonElement>, index: number, string: ILXMChordString["string"], fret: number | "x") => {
    composition.observeKey(event.nativeEvent);
    if (composition.isComposing()) { event.stopPropagation(); return; }
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 };
    if (event.key in moves) {
      event.preventDefault(); event.stopPropagation();
      const row = Math.floor(index / 6), col = index % 6;
      const next = event.key === "ArrowLeft" ? row * 6 + Math.max(0, col - 1) : event.key === "ArrowRight" ? row * 6 + Math.min(5, col + 1) : Math.min(5, Math.max(0, row + (event.key === "ArrowUp" ? -1 : 1))) * 6 + col;
      setActiveCell(next); root.current?.querySelector<HTMLButtonElement>(`[data-chord-cell="${next}"]`)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); composition.observeKey(event.nativeEvent);
      if (!event.repeat && !composition.isComposing()) activate(string, fret);
    }
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") return; // 宿主保留焦点圈定。
    event.stopPropagation();
    composition.observeKey(event.nativeEvent);
    if (composition.isComposing()) return;
    const target = event.target as HTMLElement;
    if (event.key === "Escape") {
      // 原生 select 的 Escape 由浏览器关闭选项，不能同时关闭主 Modal。
      if (target.tagName === "SELECT") return;
      event.preventDefault();
      if (endpoint) setEndpoint(null);
      else if (barreForm) setBarreForm(null);
      else if (!saving) onCancel();
    } else if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
      if (target.matches("input,textarea,[contenteditable=true]")) return;
      event.preventDefault(); if (!event.repeat) undo(event.shiftKey || event.key.toLowerCase() === "y");
    } else if (event.key === "Enter" && target.tagName === "INPUT") {
      event.preventDefault(); if (!event.repeat) complete();
    }
  };
  const shownIssues = [...issues, ...actionIssues];
  const fieldInvalid = (string: number, field: string) => shownIssues.some((issue) => issue.string === string && issue.field === field);
  const focusIssue = (event: MouseEvent<HTMLButtonElement>) => {
    const issue = shownIssues[Number(event.currentTarget.dataset.issueIndex)];
    if (!issue) return;
    const label = issue.code === "outside-window" || issue.field === "startFret"
      ? "观察窗口起始品位"
      : issue.string ? `${issue.string}弦${issue.field === "finger" ? "手指" : "品位"}` : null;
    if (label) {
      const control = root.current?.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
      const disclosure = control?.closest("details");
      if (disclosure) disclosure.open = true;
      control?.focus();
    } else if (issue.barreIndex !== undefined) {
      const b = buffer.barres[issue.barreIndex];
      if (b) {
        setEndpoint(null);
        setBarreForm({ index: issue.barreIndex, fret: String(b.fret), minString: String(b.minString), maxString: String(b.maxString), finger: String(b.finger) });
        const disclosure = root.current?.querySelector('[aria-label="横按表单"]')?.closest("details");
        if (disclosure) disclosure.open = true;
      }
    }
  };
  return <div ref={root} className={styles.editor} onKeyDown={handleKey} onCompositionStart={() => composition.start()} onCompositionEnd={() => composition.end()}>
    <div className={styles.body}>
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section aria-label="指法编辑网格" className={styles.editBoard}>
            <div className={styles.boardHeader}><b>{buffer.name || "未命名"}</b><label className={styles.window}>起始品位<input aria-label="观察窗口起始品位" title="只改变观察范围，不移动实际品位" inputMode="numeric" value={buffer.startFret} disabled={blocked} aria-invalid={issues.some((issue) => issue.field === "startFret")} onChange={(event) => { setEndpoint(null); commit({ ...buffer, startFret: event.target.value }); }} /></label></div>
            <div className={styles.tools} role="group" aria-label="指法工具">
              {([["note", "按弦"], ["barre", "横按"], ["erase", "擦除"]] as const).map(([value, label]) => <button type="button" key={value} disabled={blocked} aria-pressed={tool === value} onClick={() => { setTool(value); setEndpoint(null); }}>{label}</button>)}
              <button type="button" disabled={blocked || protectedInput || !history.past.length} onClick={() => undo()}>撤销</button><button type="button" disabled={blocked || protectedInput || !history.future.length} onClick={() => undo(true)}>重做</button>
            </div>
            <div role="grid" aria-label="六弦品位网格" aria-describedby={`${id}-board-help`} aria-rowcount={6} aria-colcount={6} className={styles.grid}>
              <div role="row" className={styles.topRow}><span aria-hidden="true" />{[6, 5, 4, 3, 2, 1].map((value, col) => {
                const string = value as ILXMChordString["string"], current = diagram.strings.find((s) => s.string === string), fret = current?.fret === 0 ? "x" : 0;
                return <button type="button" role="gridcell" key={string} data-chord-cell={col} aria-label={`第 ${string} 弦 ${current?.fret === "x" ? "禁奏" : current?.fret === 0 ? "空弦" : `${String(current?.fret)} 品`}，点击切换空弦或禁奏`} aria-selected={current?.fret === 0} tabIndex={activeCell === col ? 0 : -1} disabled={blocked} onFocus={() => setActiveCell(col)} onKeyDown={(event) => cellKey(event, col, string, fret)} onClick={() => activate(string, fret)}>{current?.fret === "x" ? "×" : current?.fret === 0 ? "○" : "●"}</button>;
              })}</div>
              {frets.map((fret, row) => <div role="row" key={fret} className={styles.gridRow}><span className={styles.fretLabel} aria-hidden="true">{fret}</span>{[6, 5, 4, 3, 2, 1].map((value, col) => {
                const string = value as ILXMChordString["string"], index = (row + 1) * 6 + col, current = diagram.strings.find((s) => s.string === string);
                const selected = current?.fret === fret, pending = endpoint?.string === string && endpoint.fret === fret;
                return <button type="button" role="gridcell" key={string} data-chord-cell={index} aria-label={`第 ${string} 弦 ${fret} 品`} aria-selected={selected} aria-invalid={shownIssues.some((issue) => issue.string === string)} data-pending={pending} tabIndex={activeCell === index ? 0 : -1} disabled={blocked} onFocus={() => setActiveCell(index)} onKeyDown={(event) => cellKey(event, index, string, fret)} onClick={() => activate(string, fret)}>{(selected || pending) && <span className={styles.dot}>{pending ? "·" : current?.finger ?? ""}</span>}</button>;
              })}</div>)}
              <div className={styles.stringLabels} aria-hidden="true"><span />{[6, 5, 4, 3, 2, 1].map((string) => <span key={string}>{string} 弦</span>)}</div>
              {diagram.barres.filter((b) => Number.isInteger(b.fret) && b.fret >= startFret && b.fret < startFret + 5 && b.minString >= 1 && b.maxString <= 6 && b.minString < b.maxString).map((b, index) => <span key={index} aria-hidden="true" className={styles.barreLine} style={{ left: 45 + 38 * (6 - b.maxString), top: 45 + 38 * (b.fret - startFret), width: 38 * (b.maxString - b.minString) }} />)}
            </div>
            <label className={styles.fingerControl}>新按点的手指<select aria-label="新按点的手指" value={pointFinger ?? ""} disabled={blocked} onChange={(event) => setPointFinger(event.target.value === "" ? null : Number(event.target.value) as ILXMChordString["finger"])}><option value="">未指定</option>{["食指", "中指", "无名指", "小指"].map((name, index) => <option key={name} value={index + 1}>{index + 1} {name}</option>)}</select></label>
            {tool === "barre" && <label className={styles.fingerControl}>横按手指<select aria-label="横按工具手指" value={finger} disabled={blocked} onChange={(event) => setFinger(Number(event.target.value) as ILXMChordBarre["finger"])}>{[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v} 指</option>)}</select></label>}
            <p id={`${id}-board-help`} className={styles.help} aria-live="polite">{tool === "barre" ? endpoint ? "再点同一品位的另一根弦，完成横按。按 Esc 取消。" : "在同一品位依次点两个端点，添加横按。" : tool === "erase" ? "点按点移除为禁奏；点横按保留品位并移除横按。" : "点品格放置按点；点弦顶切换空弦 / 禁奏。"}</p>
          </section>
          <div id={`${id}-issues`} role="status" aria-live="polite" className={shownIssues.length ? styles.error : styles.success}>{shownIssues.length ? shownIssues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.string ? `第 ${issue.string} 弦：` : ""}{issue.barreIndex !== undefined ? `横按 ${issue.barreIndex + 1}：` : ""}{issue.message}{issue.code === "outside-window" && issue.string ? `（实际 ${String(diagram.strings.find((s) => s.string === issue.string)?.fret)} 品）` : ""}{(issue.string || issue.barreIndex !== undefined || issue.field === "startFret") && <button className={styles.issueLink} type="button" disabled={blocked} data-issue-index={index} onClick={focusIssue}>{issue.code === "outside-window" ? "调整窗口" : "定位字段"}</button>}</p>) : "✓ 指法结构有效"}</div>
          <section aria-label="最后有效指法预览" className={styles.preview}>
            <p className={styles.help}>{issues.length > 0 ? "显示上次有效指法；当前修改尚未通过校验" : "当前有效指法预览"}</p>
            {preview ? <svg role="img" aria-label="指法图预览" width={100} height={114} viewBox={`${preview.bounds.x - 5} ${preview.bounds.y - 5} ${preview.bounds.width + 10} ${preview.bounds.height + 10}`}><ChordDiagramView diagram={preview} /></svg> : <p className={styles.help}>尚无有效指法预览</p>}
          </section>
        </div>
        <div className={styles.stack}>
          <label className={styles.name}>和弦名称<input autoFocus aria-label="自定义和弦名称" aria-invalid={!!nameIssue} aria-describedby={nameIssue ? `${id}-name-error` : undefined} disabled={blocked} value={buffer.name} onChange={(event) => commit({ ...buffer, name: event.target.value })} /></label>
          {nameIssue && <p id={`${id}-name-error`} className={styles.error}>{nameIssue}</p>}
          <section aria-label="谱面缩小示意" className={styles.scoreExample}><strong>谱面缩小示意</strong><div className={styles.previewScale}><div className={styles.scoreSmall}>{preview ? <svg role="img" aria-label="谱面指法图示意" width={42} height={48} viewBox={`${preview.bounds.x - 5} ${preview.bounds.y - 5} ${preview.bounds.width + 10} ${preview.bounds.height + 10}`}><ChordDiagramView diagram={preview} /></svg> : <span>暂无有效图</span>}</div><p>编辑预览保持可读尺寸；谱面示例缩小只影响显示，不改变弦号、品位或指号。</p></div>{seed.display === "name" && <p className={styles.help}>指法已保留，谱面当前仅显示名称</p>}</section>
          <p className={styles.help}>从左到右为第 6 → 1 弦。手指可留空，不必逐弦填写。{tuning.length > 0 && <span className={styles.tuning}>调弦：{[...tuning].reverse().map((s) => s.pitch).join(" ")}</span>}</p>
          <div className={styles.summaryLines}><b>当前按弦</b><p>{[...buffer.strings].sort((a, b) => b.string - a.string).map((s) => s.fret === "x" ? "×" : s.fret || "—").join("  ·  ")}{"　（6 → 1 弦）"}</p><p>{buffer.barres.length ? buffer.barres.map((b) => `${b.fret} 品 · ${b.maxString} → ${b.minString} 弦 · ${b.finger} 指横按`).join("；") : "尚无横按"}</p></div>
          <details><summary>精细编辑 · 六弦与手指</summary><div className={styles.detailsBody}><p className={styles.help}>品位可填 x、0 或 1–24；窗口仅改变观察范围。</p>{[...buffer.strings].sort((a, b) => b.string - a.string).map((s) => <div key={s.string} className={styles.stringForm}><span>{s.string} 弦</span><input aria-label={`${s.string}弦品位`} disabled={blocked} value={s.fret} aria-invalid={fieldInvalid(s.string, "fret")} aria-describedby={`${id}-issues`} onChange={(event) => commit({ ...buffer, strings: buffer.strings.map((v) => v.string === s.string ? { ...v, fret: event.target.value, finger: event.target.value === "x" || event.target.value === "0" ? "" : v.finger } : v) })} /><select aria-label={`${s.string}弦手指`} disabled={blocked || s.fret === "x" || s.fret === "0"} value={s.finger} aria-invalid={fieldInvalid(s.string, "finger")} onChange={(event) => commit({ ...buffer, strings: buffer.strings.map((v) => v.string === s.string ? { ...v, finger: event.target.value } : v) })}><option value="">未指定</option>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} 指</option>)}</select></div>)}</div></details>
          <details><summary>横按设置</summary><section aria-label="横按表单" className={styles.detailsBody}><p className={styles.help}>横按 {buffer.barres.length}/4</p>
            {buffer.barres.map((b, index) => <div key={index} className={styles.barreRow}><span>{b.fret} 品 · {b.maxString} → {b.minString} 弦 · {b.finger} 指</span><button type="button" aria-label={`编辑横按 ${index + 1}`} disabled={blocked || !!barreForm} onClick={() => { setEndpoint(null); setBarreForm({ index, fret: String(b.fret), minString: String(b.minString), maxString: String(b.maxString), finger: String(b.finger) }); }}>编辑</button><button type="button" aria-label={`删除横按 ${index + 1}`} disabled={blocked || !!barreForm} onClick={() => intent({ type: "delete-barre", index })}>删除</button></div>)}
            <button type="button" disabled={blocked || !!barreForm || buffer.barres.length >= 4} onClick={() => { setEndpoint(null); setBarreForm({ index: null, fret: String(startFret), minString: "6", maxString: "1", finger: String(finger) }); }}>添加横按</button>
            {barreForm && <fieldset className={styles.barreForm} disabled={blocked}><legend>{barreForm.index === null ? "添加横按" : `修改横按 ${barreForm.index + 1}`}</legend>{([["fret", "品位"], ["minString", "起弦"], ["maxString", "止弦"], ["finger", "手指"]] as const).map(([field, label]) => <label key={field}>{label}<input inputMode="numeric" aria-label={`横按${label}`} value={barreForm[field]} onChange={(event) => setBarreForm({ ...barreForm, [field]: event.target.value })} /></label>)}<button type="button" onClick={() => { const b = { fret: number(barreForm.fret), minString: number(barreForm.minString), maxString: number(barreForm.maxString), finger: number(barreForm.finger) as ILXMChordBarre["finger"] }; if (intent(barreForm.index === null ? { type: "add-barre", barre: b } : { type: "edit-barre", index: barreForm.index, barre: b })) setBarreForm(null); }}>应用横按</button><button type="button" onClick={() => { setBarreForm(null); setActionIssues([]); }}>取消横按修改</button></fieldset>}
          </section></details>
          {onSave && <button type="button" disabled={!canComplete} onClick={() => void save()}>{saving ? "保存中…" : "另存为我的指法"}</button>}
          <p className={styles.help}>名称由你确认；编辑指法不会自动推断和弦名。</p>
          {notice && <p role="status" className={styles.help}>{notice}</p>}
        </div>
      </div>
    </div>
    <footer className={styles.footer}>
      <span className={styles.help}>完成后返回草稿，可继续修改或统一应用。</span>
      <button type="button" disabled={saving || protectedInput} onClick={() => { if (!composition.isComposing()) onCancel(); }}>取消</button><button type="button" className={styles.primary} disabled={!canComplete} onClick={complete}>完成编辑</button>
    </footer>
  </div>;
}
