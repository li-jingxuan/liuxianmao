import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EXAMPLE_MVP_5_1_DOCUMENT, LXMScoreCommandEnum as C, applyScoreCommand, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { TupletToolDetails } from "../components/EditorShell/tools/TupletToolDetails";
import type { EditorCommandAdapter, EditorCommandResult } from "../components/EditorShell/session/editor-command-adapter";
import { createEditorStore, useEditorStore } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const store = createEditorStore(structuredClone(EXAMPLE_MVP_5_1_DOCUMENT));
const commands: ILXMScoreCommand[] = [];
let mode: "normal" | "blocked" | "cancelled" | "deferred" = "normal";
let finish: (() => void) | undefined;
const select = (index: number) => {
  const track = store.getState().document!.score.tracks[0]!;
  const measure = track.measures[index]!;
  const group = measure.tuplets[0]!;
  store.getState().setSelection({
    anchor: { trackId: track.id, measureId: measure.id, beatId: group.beatIds[0]!, string: 1 },
    focus: { trackId: track.id, measureId: measure.id, beatId: group.beatIds.at(-1)!, string: 6 },
  });
};
select(3);
const Harness = () => {
  const document = useEditorStore((state) => state.document)!;
  const selection = useEditorStore((state) => state.selection);
  const [message, setMessage] = useState("");
  const execute: EditorCommandAdapter = async (command) => {
    commands.push(command);
    setMessage("");
    if (mode === "blocked" || mode === "cancelled") {
      setMessage(mode === "blocked" ? "模拟核心拒绝" : "已取消修改");
      return { status: mode, message: mode };
    }
    if (mode === "deferred") {
      const result = applyScoreCommand(document, command);
      if (!result.ok) throw new Error(result.message);
      return new Promise<EditorCommandResult>((resolve) => { finish = () => resolve({ status: "noop", result }); });
    }
    const result = store.getState().execute(command)!;
    if (!result.ok) {
      setMessage(result.message);
      return { status: "blocked", message: result.message };
    }
    return { status: result.changed ? "applied" : "noop", result };
  };
  useEffect(() => {
    Object.assign(window, { tupletTest: {
      select,
      mode: (next: typeof mode) => { mode = next; },
      finish: () => finish?.(),
      commands: () => commands,
      document: () => store.getState().document,
      history: () => store.getState().historyDepth,
      undo: () => store.getState().undo(),
      overflow: () => {
        // 真实核心路径：三连音压缩出的尾休止转为音乐，删除时无法再腾出容量。
        const next = structuredClone(EXAMPLE_MVP_5_1_DOCUMENT);
        const track = next.score.tracks[0]!;
        track.techniques = [];
        track.numberedMarks = [];
        const measure = track.measures[0]!;
        track.measures = [measure];
        measure.timeSignature = { numerator: 4, denominator: 4 };
        measure.tuplets = [];
        measure.lyrics = [];
        measure.chordSymbols = [];
        measure.numberedVoice = { events: [], tuplets: [] };
        measure.beats = [0, 960, 1920, 2880].map((tick, i) => ({
          id: `full-${i}`, tick, rhythm: { base: "quarter", dots: 0 }, kind: "notes", notes: [],
        }));
        const result = applyScoreCommand(next, { type: C.SetTuplet, trackId: track.id, measureId: measure.id,
          startBeatId: "full-0", endBeatId: "full-2", ratio: { actual: 3, normal: 2 } });
        if (!result.ok) throw new Error(result.message);
        const full = applyScoreCommand(result.document, { type: C.SetBeatKind, trackId: track.id,
          measureId: measure.id, beatId: result.document.score.tracks[0]!.measures[0]!.beats.at(-1)!.id, kind: "notes" });
        if (!full.ok) throw new Error(full.message);
        const loaded = store.getState().replaceDocument(full.document);
        if (!loaded.ok) throw new Error("容量夹具无效");
        mode = "normal";
        select(0);
      },
    } });
  }, []);
  return <><TupletToolDetails document={document} selection={selection} blocked={false} execute={execute} />
    {message && <output role="alert">{message}</output>}</>;
};
createRoot(globalThis.document.getElementById("root")!).render(<EditorStoreContext.Provider value={store}><Harness /></EditorStoreContext.Provider>);
