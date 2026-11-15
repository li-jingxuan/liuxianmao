"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
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
type Selection = { type: "point"; string: ILXMChordString["string"] } | { type: "barre"; index: number };
type Finger = ILXMChordString["finger"];
const number = (value: string) => value.trim() === "" ? Number.NaN : Number(value);
const parseFinger = (value: string): Finger => value === "" ? null : value === "T" ? "T" : number(value) as Finger;
const fromDiagram = (name: string, diagram: ILXMChordDiagram): Buffer => ({ name, startFret: String(diagram.startFret), strings: diagram.strings.map((s) => ({ string: s.string, fret: String(s.fret), finger: s.finger === null ? "" : String(s.finger) })), barres: diagram.barres.map((b) => ({ ...b })) });
const toDiagram = (buffer: Buffer): ILXMChordDiagram => ({ startFret: number(buffer.startFret), fretCount: 5, strings: buffer.strings.map((s) => ({ string: s.string, fret: s.fret === "x" ? "x" : number(s.fret), finger: parseFinger(s.finger) })), barres: buffer.barres.map((b) => ({ ...b })) });
const initialBuffer = (seed: ChordDraft): Buffer => fromDiagram(seed.chord.name, seed.chord.diagram ?? { startFret: 1, fretCount: 5, strings: [1, 2, 3, 4, 5, 6].map((string) => ({ string: string as ILXMChordString["string"], fret: "x", finger: null })), barres: [] });

/** 编辑与历史只属于本次挂载；完成回填父草稿，保存收藏是独立操作。 */
export function ChordDiagramEditorModal({ seed, onComplete, onCancel, onSave, disabled = false }: ChordDiagramEditorModalProps) {
  const [history, setHistory] = useState(() => ({ past: [] as Buffer[], present: initialBuffer(seed), future: [] as Buffer[] }));
  const buffer = history.present;
  const [lastValid, setLastValid] = useState<ILXMChordDiagram | null>(() => seed.chord.diagram && !validateChordDiagramIssues(seed.chord.diagram).length ? cloneChordDiagram(seed.chord.diagram) : null);
  const [tool, setTool] = useState<"note" | "barre" | "erase">("note");
  const [selection, setSelection] = useState<Selection | null>(null);
  // 新建偏好只由未选中时的显式选择设置，选中对象的指号从不写入此处。
  const [nextFinger, setNextFinger] = useState<Finger>(null);
  const [endpoint, setEndpoint] = useState<{ string: ILXMChordString["string"]; fret: number } | null>(null);
  const [actionIssues, setActionIssues] = useState<ChordDiagramIssue[]>([]);
  const [latestField, setLatestField] = useState<"name" | "diagram">("diagram");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [protectedInput, setProtectedInput] = useState(false);
  const [composition] = useState(() => createScoreSettingsComposition(setProtectedInput));
  const [activeCell, setActiveCell] = useState(0);
  const [header, setHeader] = useState<Element | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const savePending = useRef(false);
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    setHeader(root.current?.closest(".ant-modal")?.querySelector("[data-chord-custom-error]") ?? null);
    return () => { mounted.current = false; composition.dispose(); };
  }, [composition]);
  const diagram = toDiagram(buffer);
  const issues = validateChordDiagramIssues(diagram);
  const nameIssue = !buffer.name.trim() || /[\r\n]/.test(buffer.name) || buffer.name.trim().length > 32 ? "和弦名称应为非空单行，最多 32 个字符" : null;
  const canComplete = !disabled && !saving && !protectedInput && !nameIssue && !issues.length && !endpoint;
  const blocked = disabled || saving;
  const rememberValid = (next: Buffer) => {
    const value = toDiagram(next);
    if (!validateChordDiagramIssues(value).length) setLastValid(cloneChordDiagram(value));
  };
  const preview = lastValid ? layoutChordDiagram(lastValid) : null;
  const commit = (next: Buffer, field: "name" | "diagram" = "diagram") => {
    setHistory((current) => JSON.stringify(current.present) === JSON.stringify(next) ? current : { past: [...current.past, current.present], present: next, future: [] });
    rememberValid(next); setLatestField(field); setActionIssues([]); setNotice("");
  };
  const undo = (redo = false) => {
    if (blocked || composition.isComposing()) return;
    setEndpoint(null); setSelection(null); setActionIssues([]); setNotice("");
    const source = redo ? history.future : history.past;
    const next = source.at(-1);
    if (!next) return;
    setHistory(redo ? { past: [...history.past, history.present], present: next, future: history.future.slice(0, -1) } : { past: history.past.slice(0, -1), present: next, future: [...history.future, history.present] });
    rememberValid(next);
  };
  const intent = (value: ChordDiagramEditIntent) => {
    if (blocked || composition.isComposing()) return false;
    const result = editChordDiagram(toDiagram(buffer), value);
    if (!result.ok) { setActionIssues(result.issues); setLatestField("diagram"); setNotice(""); return false; }
    commit(fromDiagram(buffer.name, result.diagram));
    return true;
  };
  const draft = (): ChordDraft => ({ display: seed.display, chord: { name: buffer.name.trim(), diagram: cloneChordDiagram(toDiagram(buffer)) } });
  const complete = () => { if (canComplete && !composition.isComposing()) onComplete(draft()); };
  const save = async () => {
    if (!onSave || !canComplete || composition.isComposing() || savePending.current) return;
    savePending.current = true; setSaving(true);
    try {
      const result = await onSave(draft());
      if (mounted.current) setNotice(result.message ?? (result.ok ? "已存入我的指法" : "保存失败，请重试"));
    } catch { if (mounted.current) setNotice("保存失败，请重试"); }
    finally { savePending.current = false; if (mounted.current) setSaving(false); }
  };
  const selectedFinger = selection?.type === "point" ? diagram.strings.find((s) => s.string === selection.string)?.finger ?? null : selection?.type === "barre" ? diagram.barres[selection.index]?.finger ?? null : nextFinger;
  const setFinger = (finger: Finger) => {
    if (blocked || composition.isComposing()) return;
    if (!selection) { setNextFinger(finger); return; }
    if (selection.type === "point") {
      const s = diagram.strings.find((s) => s.string === selection.string);
      if (s) intent({ type: "set-string", string: s.string, fret: s.fret, finger });
    } else {
      const b = diagram.barres[selection.index];
      if (b) intent({ type: "edit-barre", index: selection.index, barre: { ...b, finger } });
    }
  };
  const startFret = Number.isInteger(diagram.startFret) && diagram.startFret >= 1 && diagram.startFret <= 20 ? diagram.startFret : 1;
  const frets = Array.from({ length: 5 }, (_, i) => startFret + i);
  const selectBarre = (index: number) => {
    if (blocked || composition.isComposing()) return;
    if (tool === "erase") { if (intent({ type: "delete-barre", index })) setSelection(null); }
    else { setEndpoint(null); setSelection(selection?.type === "barre" && selection.index === index ? null : { type: "barre", index }); }
  };
  const activate = (string: ILXMChordString["string"], fret: number | "x") => {
    if (blocked || composition.isComposing()) return;
    if (fret === "x" || fret === 0) { if (intent({ type: "set-string", string, fret })) setSelection(null); return; }
    if (tool === "barre") {
      if (!endpoint || endpoint.fret !== fret) { setSelection(null); setEndpoint({ string, fret }); return; }
      if (endpoint.string === string) return;
      if (intent({ type: "add-barre", barre: { fret, minString: endpoint.string, maxString: string, finger: nextFinger } })) {
        setSelection({ type: "barre", index: diagram.barres.length }); setEndpoint(null); setNextFinger(null);
      }
      return;
    }
    const barreIndex = diagram.barres.findIndex((b) => b.fret === fret && string >= b.minString && string <= b.maxString);
    if (barreIndex >= 0) { selectBarre(barreIndex); return; }
    const current = diagram.strings.find((s) => s.string === string);
    if (tool === "erase") {
      if (current?.fret === fret && intent({ type: "set-string", string, fret: "x" })) setSelection(null);
    } else if (current?.fret === fret) {
      setSelection(selection?.type === "point" && selection.string === string ? null : { type: "point", string });
    } else if (intent({ type: "set-string", string, fret, finger: nextFinger })) {
      setSelection({ type: "point", string }); setNextFinger(null);
    }
  };
  const cellKey = (event: KeyboardEvent<HTMLButtonElement>, index: number, string: ILXMChordString["string"], fret: number | "x") => {
    composition.observeKey(event.nativeEvent);
    if (composition.isComposing()) { event.stopPropagation(); return; }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const row = Math.floor(index / 6), col = index % 6;
      const next = event.key === "ArrowLeft" ? row * 6 + Math.max(0, col - 1) : event.key === "ArrowRight" ? row * 6 + Math.min(5, col + 1) : Math.min(5, Math.max(0, row + (event.key === "ArrowUp" ? -1 : 1))) * 6 + col;
      setActiveCell(next); root.current?.querySelector<HTMLButtonElement>(`[data-chord-cell="${next}"]`)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) activate(string, fret);
    }
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") return;
    event.stopPropagation(); composition.observeKey(event.nativeEvent);
    if (composition.isComposing()) return;
    const target = event.target as HTMLElement;
    const editing = !!target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])");
    if (event.key === "Escape") {
      if (target.tagName === "SELECT") return;
      event.preventDefault();
      if (endpoint) setEndpoint(null);
      else if (!saving) onCancel();
    } else if (editing) {
      if (event.key === "Enter" && target.tagName === "INPUT") { event.preventDefault(); if (!event.repeat) complete(); }
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && /^[0-4tT]$/.test(event.key)) {
      if (selection) { event.preventDefault(); if (!event.repeat) setFinger(event.key === "0" ? null : parseFinger(event.key.toUpperCase())); }
    } else if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
      event.preventDefault(); if (!event.repeat) undo(event.shiftKey || event.key.toLowerCase() === "y");
    }
  };
  const issue = actionIssues.at(-1) ?? issues.at(-1);
  const structureError = issue ? `${issue.string ? `第 ${issue.string} 弦：` : ""}${issue.message}` : null;
  const error = latestField === "name" ? nameIssue ?? structureError : structureError ?? nameIssue;
  const errorTip = <span id={`${id}-error`} role="status" aria-live="polite" className={header ? styles.headerError : styles.inlineError} title={error ?? undefined}>{error}</span>;
  return <div ref={root} className={styles.editor} onKeyDown={handleKey} onCompositionStart={() => composition.start()} onCompositionEnd={() => composition.end()}>
    {header ? createPortal(errorTip, header) : <header className={styles.localHeader}>{errorTip}</header>}
    <div className={styles.body}>
      <div className={styles.columns}>
        <section aria-label="指法编辑网格" className={styles.editBoard} onClick={(event) => { if (event.target === event.currentTarget) setSelection(null); }}>
          <div className={styles.boardHeader}>
            <b title={buffer.name}>{buffer.name || "未命名"}</b>
            <div className={styles.tools} role="group" aria-label="指法工具">
              {([["note", "按弦"], ["barre", "横按"], ["erase", "擦除"]] as const).map(([value, label]) => <button type="button" key={value} disabled={blocked} aria-pressed={tool === value} onClick={() => { setTool(value); setEndpoint(null); setSelection(null); }}>{label}</button>)}
              <button type="button" title="撤销" aria-label="撤销" disabled={blocked || protectedInput || !history.past.length} onClick={() => undo()}>↶</button><button type="button" title="重做" aria-label="重做" disabled={blocked || protectedInput || !history.future.length} onClick={() => undo(true)}>↷</button>
            </div>
            <label className={styles.window}>起始品位<input aria-label="观察窗口起始品位" inputMode="numeric" value={buffer.startFret} disabled={blocked} aria-invalid={issues.some((issue) => issue.field === "startFret")} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { setEndpoint(null); setSelection(null); commit({ ...buffer, startFret: event.target.value }); }} /></label>
          </div>
          <div role="grid" aria-label="六弦品位网格" aria-rowcount={6} aria-colcount={6} className={styles.grid}>
            <div role="row" className={styles.topRow}><span aria-hidden="true" />{[6, 5, 4, 3, 2, 1].map((value, col) => {
              const string = value as ILXMChordString["string"], current = diagram.strings.find((s) => s.string === string), fret = current?.fret === 0 ? "x" : 0;
              return <button type="button" role="gridcell" key={string} data-chord-cell={col} aria-label={`第 ${string} 弦 ${current?.fret === "x" ? "禁奏" : current?.fret === 0 ? "空弦" : `${String(current?.fret)} 品`}，点击切换空弦或禁奏`} aria-selected={current?.fret === 0} tabIndex={activeCell === col ? 0 : -1} disabled={blocked} onFocus={() => setActiveCell(col)} onKeyDown={(event) => cellKey(event, col, string, fret)} onClick={() => activate(string, fret)}>{current?.fret === "x" ? "×" : current?.fret === 0 ? "○" : "●"}</button>;
            })}</div>
            {frets.map((fret, row) => <div role="row" key={fret} className={styles.gridRow}><span className={styles.fretLabel} aria-hidden="true">{fret}</span>{[6, 5, 4, 3, 2, 1].map((value, col) => {
              const string = value as ILXMChordString["string"], index = (row + 1) * 6 + col, current = diagram.strings.find((s) => s.string === string);
              const pressed = current?.fret === fret, selected = pressed && selection?.type === "point" && selection.string === string, pending = endpoint?.string === string && endpoint.fret === fret;
              const covered = diagram.barres.some((b) => b.fret === fret && string >= b.minString && string <= b.maxString);
              return <button type="button" role="gridcell" key={string} data-chord-cell={index} aria-label={`第 ${string} 弦 ${fret} 品`} aria-selected={selected} data-finger={pressed ? current.finger ?? "" : undefined} data-pressed={pressed} data-pending={pending} tabIndex={activeCell === index ? 0 : -1} disabled={blocked} onFocus={() => setActiveCell(index)} onKeyDown={(event) => cellKey(event, index, string, fret)} onClick={() => activate(string, fret)}>{((pressed && !covered) || pending) && <span className={styles.dot}>{pending ? "·" : current?.finger ?? ""}</span>}</button>;
            })}</div>)}
            <div className={styles.stringLabels} aria-hidden="true"><span />{[6, 5, 4, 3, 2, 1].map((string) => <span key={string}>{string} 弦</span>)}</div>
            {diagram.barres.map((b, index) => Number.isInteger(b.fret) && b.fret >= startFret && b.fret < startFret + 5 && b.minString >= 1 && b.maxString <= 6 && b.minString < b.maxString ? <button type="button" key={index} aria-label={`第 ${b.fret} 品横按 ${b.maxString} 至 ${b.minString} 弦`} aria-pressed={selection?.type === "barre" && selection.index === index} disabled={blocked} className={styles.barreLine} style={{ left: 56 + 60 * (6 - b.maxString) - 12, top: 36 + 48 * (b.fret - startFret) + 12, width: 60 * (b.maxString - b.minString) + 24 }} onClick={() => selectBarre(index)}>{b.finger ?? ""}</button> : null)}
          </div>
          <label className={styles.fingerControl}>按弦手指<select aria-label="按弦手指" value={selectedFinger ?? ""} disabled={blocked} onChange={(event) => setFinger(parseFinger(event.target.value))}><option value="">未指定</option>{["食指", "中指", "无名指", "小指"].map((name, index) => <option key={name} value={index + 1}>{index + 1} · {name}</option>)}<option value="T">T · 拇指</option></select></label>
          <p className={styles.shortcuts}>选中按点后 <kbd>1–4</kbd> 手指 <kbd>T</kbd> 拇指 <kbd>0</kbd> 未指定</p>
          {endpoint && <p role="status" className={styles.help}>再选同一品位的另一根弦 · Esc 取消</p>}
        </section>
        <aside className={styles.stack}>
          <label className={styles.name}>和弦名称<input autoFocus aria-label="自定义和弦名称" aria-invalid={!!nameIssue} aria-describedby={nameIssue ? `${id}-error` : undefined} disabled={blocked} value={buffer.name} onChange={(event) => commit({ ...buffer, name: event.target.value }, "name")} /></label>
          <section aria-label="最后有效指法预览" className={styles.preview}>
            <div className={styles.previewHeading}><strong>有效指法预览</strong><span className={issues.length ? styles.help : styles.success}>{issues.length ? "保留上次有效指法" : "指法有效"}</span></div>
            {preview ? <svg role="img" aria-label="指法图预览" width={110} height={150} viewBox={`${preview.bounds.x - 5} ${preview.bounds.y - 5} ${preview.bounds.width + 10} ${preview.bounds.height + 10}`}><ChordDiagramView diagram={preview} /></svg> : <p className={styles.help}>尚无有效指法预览</p>}
          </section>
          {onSave && <button type="button" disabled={!canComplete} onClick={() => void save()}>{saving ? "保存中…" : "另存为我的指法"}</button>}
          {notice && <p role="status" className={styles.help}>{notice}</p>}
        </aside>
      </div>
    </div>
    <footer className={styles.footer}>
      <span className={styles.help}>完成后返回草稿，可继续修改或统一应用。</span>
      <button type="button" disabled={saving || protectedInput} onClick={() => { if (!composition.isComposing()) onCancel(); }}>取消</button><button type="button" className={styles.primary} disabled={!canComplete} onClick={complete}>完成编辑</button>
    </footer>
  </div>;
}
