import { createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EXAMPLE_MVP_6_DOCUMENT } from "@liuxianmao/lxm-editor";
import { MusicTextSidebar, type MusicTextController } from "../components/EditorShell/music-text/MusicTextSidebar";
import { EditorSessionRuntime } from "../components/EditorShell/session/EditorSessionRuntime";
import { EditorStoreContext } from "../stores/editor-context";
import { createEditorSession } from "../stores/editor-store";
import "../app/globals.scss";

const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
document.score.meta.lyricVerseCount = 1;
document.score.tracks.forEach((track) => track.measures.forEach((measure) => { measure.lyrics = []; }));
const track = document.score.tracks[0]!;
const measure = track.measures[0]!;
measure.lyrics = measure.numberedVoice.events.slice(0, 3).map((event, index) => ({ id: `word-${index}`, eventId: event.id, verse: 1, text: ["原词", "旧词", "末词"][index]! }));
const session = createEditorSession(document);
const controller = createRef<MusicTextController>();
const noop = () => {};
const target = (index = 0, verse: 1 | 2 | 3 | 4 = 1) => ({ kind: "lyric" as const, trackId: track.id, measureId: measure.id, eventId: measure.numberedVoice.events[index]!.id, verse });
const Harness = () => {
  const [collapsed, setCollapsed] = useState(false);
  Object.assign(window, { lyricTest: { session, controller, target, collapse: setCollapsed } });
  return <EditorStoreContext.Provider value={session}><EditorSessionRuntime session={session}>
    <div style={{ display: "flex", height: 850 }}>
      <main style={{ flex: 1 }}><button id="score-focus">谱面位置</button></main>
      <MusicTextSidebar ref={controller} collapsed={collapsed} onOpen={noop} onEditingChange={noop} onPopoverHiddenChange={noop}
        onNumberedActionBlockedChange={noop} onTargetChange={(value) => { Object.assign(window, { lyricActive: value }); }}
        onScoreFocus={() => globalThis.document.getElementById("score-focus")?.focus()}
        onScoreSelection={noop} getNumberedBeatEventIds={() => []}
        getFloatingAnchor={() => ({ left: 240, top: 130, right: 280, bottom: 160, width: 40, height: 30 })}
        getFloatingViewport={() => ({ left: 0, top: 0, right: 1000, bottom: 850, width: 1000, height: 850 })} />
    </div>
  </EditorSessionRuntime></EditorStoreContext.Provider>;
};
createRoot(globalThis.document.getElementById("root")!).render(<Harness />);
