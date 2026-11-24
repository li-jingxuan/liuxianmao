import { createRoot } from "react-dom/client";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { EditorSession } from "../../../packages/lxm-editor-react/src/EditorShell/session/EditorSession";
import { createEditorSessionStore as createEditorSession } from "../../../packages/lxm-editor-react/src/stores/editor-store";
import "../app/globals.scss";

const fixture = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
const track = fixture.score.tracks[0]!;
track.measures = [track.measures[0]!];
track.numberedMarks = [];
track.techniques = [];
const measure = track.measures[0]!;
measure.chordSymbols = [];
measure.tuplets = [];
measure.beats = Array.from({ length: 4 }, (_, index) => ({
  id: `approved-tab-${index}`, tick: index * 960, kind: "rest" as const,
  notes: [], rhythm: { base: "quarter" as const, dots: 0 },
}));
measure.numberedVoice = {
  events: [["1"], ["2"], ["1", "3"], ["5"]].map((tokens, index) => ({
    id: `approved-event-${index}`, tick: index * 960, kind: "notes" as const,
    rhythm: { base: "quarter" as const, dots: 0 },
    items: tokens.map((token, member) => ({ id: `approved-item-${index}-${member}`, token })),
  })), tuplets: [],
};
measure.lyrics = ["风", "吹", "过"].map((text, index) => ({
  id: `approved-lyric-${index}`, eventId: `approved-event-${index}`, verse: 1 as const, text,
}));
fixture.score.meta = { ...fixture.score.meta, lyricVerseCount: 1 };
const session = createEditorSession(fixture);
Object.assign(window, { approvedEditor: session });
createRoot(document.getElementById("root")!).render(<div style={{ height: "100dvh" }}><EditorSession session={session} /></div>);
