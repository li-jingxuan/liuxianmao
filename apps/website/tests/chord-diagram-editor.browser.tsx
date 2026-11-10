import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChordDiagramEditorModal } from "../components/EditorShell/ChordDiagramEditorModal";
import type { ChordDraft } from "../components/EditorShell/ChordEditor";

const seed: ChordDraft = { display: "name", chord: { name: "C", diagram: { startFret: 1, fretCount: 5, strings: [1, 2, 3, 4, 5, 6].map((string) => ({ string: string as 1, fret: 0, finger: null })), barres: [] } } };
const state = { completed: [] as ChordDraft[], saved: [] as ChordDraft[], cancelled: 0, backgroundKeys: 0, saveOk: true };
Object.assign(window, { chordDiagramTest: state });
const Harness = () => {
  const [key, setKey] = useState(0);
  return <div onKeyDown={() => { state.backgroundKeys++; }}><button type="button" onClick={() => { state.completed = []; state.saved = []; state.cancelled = 0; state.backgroundKeys = 0; setKey((value) => value + 1); }}>重置测试</button><ChordDiagramEditorModal key={key} seed={seed} tuning={[]} onComplete={(draft) => state.completed.push(draft)} onCancel={() => state.cancelled++} onSave={async (draft) => { state.saved.push(draft); return { ok: state.saveOk, message: state.saveOk ? "已存入我的指法" : "存储失败" }; }} /></div>;
};
createRoot(document.getElementById("root")!).render(<Harness />);
