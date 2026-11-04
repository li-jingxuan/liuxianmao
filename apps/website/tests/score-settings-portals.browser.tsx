import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EXAMPLE_MVP_7_2_DOCUMENT, LXMScoreCommandEnum, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { ScoreSettings, type ScoreSettingsController } from "../components/EditorShell/ScoreSettings";
import { MeasureToolDetails } from "../components/EditorShell/MeasureToolDetails";
import { EditorSessionRuntime, useEditorRuntime } from "../components/EditorShell/EditorSessionRuntime";
import { createEditorSession, useEditorStore } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";
import type { EditorCommandResult } from "../components/EditorShell/editor-command-adapter";

const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
const trackId = session.getState().document!.score.tracks[0]!.id;
const measureIds = session.getState().document!.score.tracks[0]!.measures.map((measure) => measure.id);
const commands: ILXMScoreCommand[] = [];
let finishCopy: ((result: EditorCommandResult) => void) | undefined;
const noop = () => {};
const Harness = () => {
  const document = useEditorStore((state) => state.document)!;
  const runtime = useEditorRuntime();
  const controller = useRef<ScoreSettingsController>(null);
  const measureController = useRef<{ focusBoundary: () => boolean }>(null);
  const [songHost, setSongHost] = useState<HTMLDivElement | null>(null);
  const [measureHost, setMeasureHost] = useState<HTMLDivElement | null>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [activeSurface, setSurface] = useState<"song" | "measure" | null>("song");
  const [requestedMeasureId, setMeasure] = useState(measureIds[0]);
  useEffect(() => {
    Object.assign(window, { settingsTest: {
      status: () => controller.current!.readStatus(),
      boundary: () => measureController.current!.focusBoundary(),
      apply: (group: "info" | "label" | "capo" | "signature") => controller.current!.applyGroup(group),
      restore: (group: "info" | "label" | "capo" | "signature") => controller.current!.restoreGroup(group),
      focus: (group: "info" | "label" | "copy" | "capo") => controller.current!.focus(group),
      discard: () => controller.current!.discard(),
      pending: () => runtime.drafts.inspect().pending.map((record) => ({ label: record.label, dirty: record.dirty })),
      surface: setSurface,
      measure: (index: number) => setMeasure(measureIds[index]),
      commands: () => commands,
      document: () => session.getState().document,
      history: () => session.getState().historyDepth.past,
      external: (title: string) => session.getState().execute({ type: LXMScoreCommandEnum.SetNotationInfo, title, arranger: session.getState().document!.score.arranger, keySignature: session.getState().document!.score.keySignature }),
      externalCapo: (capo: number) => session.getState().execute({ type: LXMScoreCommandEnum.SetCapo, trackId, capo }),
      remove: () => session.getState().execute({ type: LXMScoreCommandEnum.RemoveMeasure, trackId, measureId: requestedMeasureId! }),
      undo: () => session.getState().undo(),
      finishCopy: () => finishCopy?.({ status: "cancelled", message: "已取消复制" }),
    } });
  }, [runtime.drafts, requestedMeasureId]);
  return <>
    <div hidden={activeSurface !== "song"}><div ref={setSongHost} /></div>
    <div hidden={activeSurface !== "measure"}><MeasureToolDetails ref={measureController} document={document} selection={null} target={{ trackId, measureId: requestedMeasureId! }} blocked={false} onAction={async () => false} navigate={noop} measureHost={setMeasureHost} /></div>
    <div ref={setActionsHost} />
    <ScoreSettings ref={controller} document={document} requestedMeasureId={requestedMeasureId} songHost={songHost} measureHost={measureHost} actionsHost={actionsHost} activeSurface={activeSurface} onDirty={noop} onFocusRequest={(group) => { setSurface(group === "label" || group === "copy" ? "measure" : "song"); return true; }} executeTool={(command) => { commands.push(command); return new Promise((resolve) => { finishCopy = resolve; }); }} commit={(command) => { commands.push(command); return session.getState().execute(command); }} />
  </>;
};
createRoot(globalThis.document.getElementById("root")!).render(<EditorStoreContext.Provider value={session}><EditorSessionRuntime session={session}><Harness /></EditorSessionRuntime></EditorStoreContext.Provider>);
