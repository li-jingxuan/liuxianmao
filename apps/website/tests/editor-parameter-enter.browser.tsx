import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EXAMPLE_MVP_7_2_DOCUMENT, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { ScoreSettings, type ScoreSettingsController } from "../components/EditorShell/settings/ScoreSettings";
import { TechniqueToolbar } from "../components/EditorShell/tools/TechniqueToolbar";
import { EditorSessionRuntime, useEditorRuntime } from "../components/EditorShell/session/EditorSessionRuntime";
import { createEditorCommandAdapter, type EditorCommandAdapter } from "../components/EditorShell/session/editor-command-adapter";
import { createEditorSession, useEditorStore } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const fixture = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
fixture.score.tracks[0]!.techniques = [];
const session = createEditorSession(fixture);
const track = session.getState().document!.score.tracks[0]!;
const measure = track.measures[0]!;
const beat = measure.beats.find((item) => item.notes.some((note) => typeof note.fret === "number"))!;
const cell = { trackId: track.id, measureId: measure.id, beatId: beat.id, string: beat.notes.find((note) => typeof note.fret === "number")!.string };
session.getState().setSelection({ anchor: cell, focus: cell });
const commands: ILXMScoreCommand[] = [];
let hold = false;
let finish: (() => void) | undefined;
const noop = () => {};
const Harness = () => {
  const document = useEditorStore((state) => state.document)!;
  const selection = useEditorStore((state) => state.selection);
  const selectedTechniqueId = useEditorStore((state) => state.selectedTechniqueId);
  const runtime = useEditorRuntime();
  const settings = useRef<ScoreSettingsController>(null);
  const [songHost, setSongHost] = useState<HTMLDivElement | null>(null);
  const [measureHost, setMeasureHost] = useState<HTMLDivElement | null>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const adapter = createEditorCommandAdapter(session, runtime.modals);
  const execute: EditorCommandAdapter = async (...args) => {
    commands.push(args[0]);
    if (hold) await new Promise<void>((resolve) => { finish = resolve; });
    return adapter(...args);
  };
  useEffect(() => {
    Object.assign(window, { parameterEnterTest: {
      document: () => session.getState().document,
      commands: () => commands,
      status: () => settings.current!.readStatus(),
      hold: () => { hold = true; },
      finish: () => { hold = false; finish?.(); },
      blocked: setBlocked,
    } });
  }, []);
  return <>
    <div ref={setSongHost} /><div ref={setMeasureHost} /><div ref={setActionsHost} />
    <ScoreSettings ref={settings} document={document} requestedMeasureId={measure.id} songHost={songHost} measureHost={measureHost} actionsHost={actionsHost} activeSurface="measure" onDirty={noop}
      commit={(command) => { commands.push(command); return session.getState().execute(command); }} />
    <TechniqueToolbar document={document} selection={selection} selectedTechniqueId={selectedTechniqueId} execute={execute} blocked={blocked}
      onShowParameters={noop} onSuccess={noop} setSelectedTechniqueId={session.getState().setSelectedTechniqueId} setErrorMessage={session.getState().setErrorMessage} />
  </>;
};
createRoot(globalThis.document.getElementById("root")!).render(<EditorStoreContext.Provider value={session}><EditorSessionRuntime session={session}><Harness /></EditorSessionRuntime></EditorStoreContext.Provider>);
