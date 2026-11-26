import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ILXMDocument } from "@liuxianmao/lxm-editor-react";
import type { LibraryEntry, ScoreCandidate, ScoreSummary } from "../electron/library-types.cjs";
import { displayName } from "./library-score";

export type ScoreSelection = { mode: "open" | "import" } | { mode: "relocate"; entry: LibraryEntry };
export type Preview = {
  kind: "preview";
  selection: ScoreSelection;
  file: ScoreCandidate;
  document: ILXMDocument;
  summary: ScoreSummary;
  sourceVersion?: number;
};
export type LibraryDialogState = Preview | { kind: "new" } | { kind: "selectError"; selection: ScoreSelection; file?: Pick<ScoreCandidate, "name" | "path"> } |
  { kind: "openError" | "rename" | "remove"; entry: LibraryEntry };

function FileLocation({ file }: { file: { name: string; path: string } }) {
  return <div className="library-file-location"><strong>{file.name}</strong><code>{file.path}</code></div>;
}

function Sheet({ title, busy, error, onClose, onSubmit, children, actions }: {
  title: string;
  busy: boolean;
  error: string;
  onClose(): void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  const element = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = element.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog className="library-sheet" ref={element} aria-labelledby="library-sheet-title" onCancel={(event) => {
    event.preventDefault();
    if (!busy) onClose();
  }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit?.(event); }}>
      <h2 id="library-sheet-title">{title}</h2>
      <div className="library-sheet-body">{children}{error && <p className="library-error" role="alert">{error}</p>}</div>
      <div className="library-sheet-actions">
        <button type="button" className="library-button" disabled={busy} onClick={onClose}>取消</button>
        {actions}
      </div>
    </form>
  </dialog>;
}

export function LibraryDialogs({ state, busy, error, onClose, onNew, onAccept, onChoose, onOpen, onRename, onRemove }: {
  state: LibraryDialogState;
  busy: boolean;
  error: string;
  onClose(): void;
  onNew(title: string, arranger: string): void;
  onAccept(preview: Preview): void;
  onChoose(selection: ScoreSelection): void;
  onOpen(entry: LibraryEntry): void;
  onRename(entry: LibraryEntry, name: string): void;
  onRemove(entry: LibraryEntry): void;
}) {
  const [name, setName] = useState(state.kind === "rename" ? displayName(state.entry) : "");
  const [arranger, setArranger] = useState("");
  const common = { busy, error, onClose };
  if (state.kind === "new") return <Sheet title="新建曲谱" {...common} onSubmit={() => onNew(name.trim(), arranger.trim())}
    actions={<button className="library-button is-primary" disabled={busy} type="submit">开始写谱</button>}>
    <label className="library-field">曲名<input autoFocus required placeholder="输入曲名" maxLength={128} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label className="library-field">编配（选填）<input maxLength={64} value={arranger} onChange={(event) => setArranger(event.target.value)} /></label>
    <p>C 大调、4/4 拍、标准调弦，含 4 个空小节。</p>
  </Sheet>;
  if (state.kind === "preview") {
    const { selection, file, summary, sourceVersion } = state;
    const title = selection.mode === "import" ? "导入曲谱预览" : selection.mode === "relocate" ? "确认新的文件位置" : "打开曲谱预览";
    const action = selection.mode === "import" ? file.registered ? "确认登记" : "加入谱库" : selection.mode === "relocate" ? "更新位置并打开" : "打开曲谱";
    return <Sheet title={title} {...common} actions={<>
      {error && <button type="button" disabled={busy} className="library-button" onClick={() => onChoose(selection)}>重新选择</button>}
      <button type="submit" disabled={busy} className="library-button is-primary">{action}</button>
    </>} onSubmit={() => onAccept(state)}>
      {selection.mode === "import" && <p>{file.registered ? "这份文件已在谱库中，确认后保留一个条目。" : "谱库将登记此文件的位置。以后在编辑器保存时会写回这份原件。"}</p>}
      {selection.mode === "relocate" && <p>将《{displayName(selection.entry)}》的库内条目指向下方文件。请核对曲名与编配。</p>}
      <FileLocation file={file} />
      <dl className="library-preview-facts">
        <dt>谱内曲名</dt><dd>{summary.title.trim() || "未命名曲谱"}</dd>
        <dt>编配</dt><dd>{summary.arranger || "—"}</dd>
        <dt>谱面</dt><dd>{summary.tonality}　{summary.meter} 拍　{summary.measures} 小节</dd>
      </dl>
      {sourceVersion !== undefined && <p className="library-upgrade">v{sourceVersion} 旧谱可升级打开。覆盖原件前会另行确认。</p>}
    </Sheet>;
  }
  if (state.kind === "selectError") return <Sheet title="无法读取曲谱" {...common}
    actions={<button type="button" disabled={busy} className="library-button is-primary" onClick={() => onChoose(state.selection)}>重新选择</button>}>
    {state.file && <FileLocation file={state.file} />}
  </Sheet>;
  const { entry } = state;
  if (state.kind === "openError") return <Sheet title="无法打开曲谱" {...common} actions={<>
    <button type="button" disabled={busy} className="library-button" onClick={() => onOpen(entry)}>重试</button>
    <button type="button" disabled={busy} className="library-button is-primary" onClick={() => onChoose({ mode: "relocate", entry })}>重新定位…</button>
  </>}>
    <p>可接回原件所在磁盘后重试，或为《{displayName(entry)}》选择新的文件位置。</p>
    <FileLocation file={entry} />
  </Sheet>;
  if (state.kind === "rename") return <Sheet title="重命名显示名" {...common} onSubmit={() => onRename(entry, name.trim())}
    actions={<button type="submit" disabled={busy || !name.trim()} className="library-button is-primary">保存显示名</button>}>
    <label className="library-field">库内显示名<input autoFocus required maxLength={128} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <p>此名称只用于这台电脑上的谱库。谱内曲名和磁盘文件名保留原值。</p>
  </Sheet>;
  return <Sheet title="从谱库移除" {...common} actions={<button type="submit" disabled={busy} className="library-button is-danger">仅从谱库移除</button>}
    onSubmit={() => onRemove(entry)}>
    <p>将《{displayName(entry)}》从最近打开和全部曲谱中移除。原件仍保存在以下位置。</p>
    <FileLocation file={entry} />
  </Sheet>;
}
