import { createRoot } from "react-dom/client";
import { createPlaybackPlan, type ILXMTechnique } from "@liuxianmao/lxm-editor";
import { editorStore, EditorWorkspace } from "./editor-workspace.fixture";
import { createBlankScore } from "../../../packages/lxm-editor-react/src/EditorShell/output/new-score";
import "../app/globals.scss";

const score = createBlankScore({
  title: "连续扫弦与琶音",
  arranger: "",
  tonality: { version: 1, tonic: "C", mode: "major" },
  timeSignature: { numerator: 4, denominator: 4 },
});
const track = score.score.tracks[0]!;
const measure = track.measures[0]!;
const traversal: ILXMTechnique[] = [
  { id: "strum-down", beatId: measure.beats[0]!.id, minString: 1, maxString: 4, type: "strum", stroke: "down" },
  { id: "strum-up", beatId: measure.beats[1]!.id, minString: 1, maxString: 4, type: "strum", stroke: "up" },
  { id: "arpeggio-down", beatId: measure.beats[2]!.id, minString: 1, maxString: 4, type: "arpeggio", direction: "ascending" },
  { id: "arpeggio-up", beatId: measure.beats[3]!.id, minString: 1, maxString: 4, type: "arpeggio", direction: "descending" },
];
track.techniques = traversal;
for (const [index, beat] of measure.beats.slice(0, 3).entries()) {
  beat.kind = "notes";
  beat.notes = [{ id: `note-${index}`, string: 2, fret: 3 }];
}
measure.beats[3]!.kind = "rest";
measure.chordSymbols = [{
  id: "chord-c",
  beatId: measure.beats[0]!.id,
  display: "name",
  chord: {
    name: "C",
    diagram: {
      startFret: 1, fretCount: 5, barres: [],
      strings: ([1, 2, 3, 4, 5, 6] as const).map((string) => ({
        string, fret: ([0, 1, 0, 2, 3, "x"] as const)[string - 1]!, finger: null,
      })),
    },
  },
}];
const result = editorStore.getState().replaceDocument(score);
if (!result.ok) throw new Error(result.errors.join("\n"));

Object.assign(window, {
  traversalRangeStore: editorStore,
  planCurrentScore: () => createPlaybackPlan(editorStore.getState().document!),
});
createRoot(document.getElementById("root")!).render(<EditorWorkspace />);
