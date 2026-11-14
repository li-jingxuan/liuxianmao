import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EXAMPLE_MVP_7_2_DOCUMENT, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { NumberedEditor, type NumberedEditorController } from "../components/EditorShell/numbered/NumberedEditor";
import { createEditorSession, useEditorStore } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const scenario = new URLSearchParams(location.search).get("scenario");
const fixture = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
const track = fixture.score.tracks[0]!;
track.measures = [track.measures[0]!]; track.numberedMarks = []; track.techniques = [];
const measure = track.measures[0]!;
measure.chordSymbols = []; measure.lyrics = []; measure.tuplets = [];
measure.beats = Array.from({ length: 16 }, (_, i) => ({ id: `tab-${i}`, tick: i * 240, kind: "rest", notes: [], rhythm: { base: "sixteenth", dots: 0 } }));
measure.numberedVoice = { events: scenario === "blank" ? [] : [{ id: "first", tick: 0, kind: "notes", rhythm: { base: scenario === "explicit" ? "quarter" : "sixteenth", dots: 0 }, items: [{ id: "first-item", token: "1" }] }, { id: "later", tick: 960, kind: "notes", rhythm: { base: "quarter", dots: 0 }, items: [{ id: "later-item", token: "7" }] }], tuplets: [] };
if (scenario === "selection") measure.numberedVoice.events.splice(1, 0, { id: "middle", tick: 480, kind: "notes", rhythm: { base: "sixteenth", dots: 0 }, items: [{ id: "middle-item", token: "3" }] });
// Start empty so choosing the overwrite duration is a preference change, while
// the later event still belongs to the draft's external dependency window.
if (scenario === "dependency") measure.numberedVoice.events.shift();
if (scenario === "properties") {
  const first = measure.numberedVoice.events[0]!;
  if (first.kind === "notes") first.items.push({ id: "second-item", token: "3" });
}
if (scenario === "confirmation") {
  measure.numberedVoice.events[0]!.rhythm = { base: "quarter", dots: 0 };
  track.numberedMarks = [{ id: "property-slur", type: "slur", fromEventId: "first", toEventId: "later" }];
}
if (scenario === "dots") {
  measure.numberedVoice.events = [0, 240, 480, 720, 960].map(tick => ({ id: `dot-${tick}`, tick, kind: "notes", rhythm: { base: "sixteenth", dots: 0 }, items: [{ id: `dot-item-${tick}`, token: "3" }] }));
  measure.lyrics = [{ id: "dot-lyric", eventId: "dot-480", verse: 1, text: "词" }];
  track.numberedMarks = [{ id: "dot-slur", type: "slur", fromEventId: "dot-0", toEventId: "dot-720" }];
}
const session = createEditorSession(fixture);
const commands: ILXMScoreCommand[] = [];
const selections: unknown[] = [];
const Harness = () => {
  const document = useEditorStore(state => state.document)!;
  const controller = useRef<NumberedEditorController>(null);
  const [presentation, setPresentation] = useState<"popover" | "sidebar">(scenario === "properties" ? "sidebar" : "popover");
  const [popoverContainer, setPopoverContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    Object.assign(window, { numberedSequenceTest: {
      commands, selections, document: () => session.getState().document,
      snapshot: () => controller.current!.snapshot(), groups: () => controller.current!.groups,
      discard: () => controller.current!.discard(),
      surface: setPresentation, undo: () => session.getState().undo(), redo: () => session.getState().redo(),
      externalLater: () => session.getState().execute({ type: "numbered.event.set", trackId: track.id, measureId: measure.id, eventId: "later", tokens: ["6"] }),
      externalRemoveFirst: () => session.getState().execute({ type: "numbered.event.remove", trackId: track.id, measureId: measure.id, eventId: "first" }),
    } });
  }, []);
  return <><div data-testid="numbered-portal" ref={setPopoverContainer} /><NumberedEditor ref={controller} document={document} presentation={presentation}
    popoverContainer={scenario === "properties" ? popoverContainer : null}
    target={{ kind: "numbered", trackId: track.id, measureId: measure.id, ...(scenario === "dots" ? { eventId: `dot-${new URLSearchParams(location.search).get("tick") ?? 0}` } : scenario === "blank" || scenario === "dependency" ? { tick: 0, endTick: 240 } : scenario === "selection" ? { beatId: "tab-3" } : { eventId: "first", ...(scenario === "properties" ? { itemId: "second-item" } : {}) }) }}
    selection={scenario === "selection" ? { anchor: { trackId: track.id, measureId: measure.id, beatId: "tab-0", string: 1 }, focus: { trackId: track.id, measureId: measure.id, beatId: "tab-3", string: 1 } } : null}
    mode="sequence" onModeChange={() => {}} commit={command => { commands.push(command); return session.getState().execute(command); }}
    onDirty={() => {}} onInputActive={() => {}} onPreviewTargetChange={() => {}} onActivate={() => {}} onCanApply={() => {}} onSelectTarget={target => selections.push(target)} onCancel={() => {}} getClipboard={() => null} copyRange={() => false} selectedMarkId={null} /></>;
};
createRoot(document.getElementById("root")!).render(<EditorStoreContext.Provider value={session}><Harness /></EditorStoreContext.Provider>);
