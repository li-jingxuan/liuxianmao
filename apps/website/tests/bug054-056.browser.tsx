import { createRoot } from "react-dom/client";
import { EditorWorkspace } from "../app/editor/EditorWorkspace";
import { editorStore } from "../stores/editor-store";
import "../app/globals.scss";

const score = structuredClone(editorStore.getState().document!);
const track = score.score.tracks[0]!;
const measure = track.measures[0]!;
score.score.keySignature = "C";
score.score.meta = {};
score.score.tracks = [track];
track.measures = [measure];
track.techniques = [];
track.numberedMarks = [];
Object.assign(measure, {
  timeSignature: { numerator: 4, denominator: 4 },
  beats: [0, 960, 1920, 2880].map((tick, index) => ({
    id: `beat-${index}`, tick, kind: "notes", rhythm: { base: "quarter", dots: 0 },
    notes: index === 0 ? [{ id: "old-fret", string: 1, fret: 10 }] : [],
  })),
  tuplets: [], chordSymbols: [], lyrics: [], numberedVoice: { events: [], tuplets: [] },
});
const result = editorStore.getState().replaceDocument(score);
if (!result.ok) throw new Error(result.errors.join("\n"));
const cell = { trackId: track.id, measureId: measure.id, beatId: "beat-0", string: 1 };
editorStore.getState().setSelection({ anchor: cell, focus: cell });

Object.assign(window, { bugFixStore: editorStore });
createRoot(document.getElementById("root")!).render(<EditorWorkspace />);
