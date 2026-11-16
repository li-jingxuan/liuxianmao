import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChordDiagramEditorModal, replaceChordDiagramEditorSnapshot, type ChordDiagramEditorSnapshot } from "../components/EditorShell/chords/ChordDiagramEditorModal";
import type { ChordDraft } from "../components/EditorShell/chords/ChordEditor";
import type { EditorModalCloseSource } from "../components/EditorShell/session/editor-modal-controller";

const seed: ChordDraft = { display: "name", chord: { name: "C", diagram: { startFret: 1, fretCount: 5, strings: [1, 2, 3, 4, 5, 6].map((string) => ({ string: string as 1, fret: 0, finger: null })), barres: [] } } };
const state = { completed: [] as ChordDraft[], saved: [] as ChordDraft[], cancelled: 0, backgroundKeys: 0, saveOk: true, snapshot: null as ChordDiagramEditorSnapshot | null };
Object.assign(window, { chordDiagramTest: state });
const Harness = () => {
  const [key, setKey] = useState(0);
  const [snapshot, setSnapshot] = useState<ChordDiagramEditorSnapshot | undefined>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const requestCloseRef = useRef<((source?: EditorModalCloseSource) => void) | null>(null);
  const returnToEditor = (replace = false) => {
    setSnapshot(replace ? replaceChordDiagramEditorSnapshot(state.snapshot!, { ...seed, chord: { ...seed.chord, name: "库选用" } }) : state.snapshot!);
    setLibraryOpen(false);
    setKey((value) => value + 1);
  };
  return <div className="ant-modal" style={{ position: "relative", width: 1120, maxWidth: "100%", margin: "0 auto", fontFamily: "sans-serif" }} onKeyDown={() => { state.backgroundKeys++; }}><button type="button" onClick={() => { state.completed = []; state.saved = []; state.cancelled = 0; state.backgroundKeys = 0; state.snapshot = null; setSnapshot(undefined); setLibraryOpen(false); setKey((value) => value + 1); }}>重置测试</button><button type="button" onClick={() => requestCloseRef.current?.("cancel")} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestCloseRef.current?.("escape"); } }}>模拟宿主关闭</button><header className="ant-modal-header"><h2 style={{ marginRight: 20 }}>自定义指法</h2><span data-chord-custom-error /></header>{libraryOpen ? <div><p>我的指法测试替身</p><button type="button" onClick={() => returnToEditor()}>返回暂存</button><button type="button" onClick={() => returnToEditor(true)}>确认替换测试指法</button></div> : <ChordDiagramEditorModal key={key} seed={seed} initialSnapshot={snapshot} requestCloseRef={requestCloseRef} tuning={[]} onOpenLibrary={(value) => { state.snapshot = value; setLibraryOpen(true); }} onComplete={(draft) => state.completed.push(draft)} onCancel={() => state.cancelled++} onSave={async (draft) => { state.saved.push(draft); return { ok: state.saveOk, message: state.saveOk ? "已存入我的指法" : "存储失败" }; }} />}</div>;
};
createRoot(document.getElementById("root")!).render(<Harness />);
