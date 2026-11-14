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
  const commit = (command: ILXMScoreCommand): EditorCommandResult => {
    const result = store.getState().execute(command)!;
    if (!result.ok) {
      setMessage(result.message);
      return { status: "blocked", message: result.message };
    }
    return { status: result.changed ? "applied" : "noop", result };
  };
  const execute: EditorCommandAdapter = async (command) => {
    commands.push(command);
    setMessage("");
    if (mode === "blocked" || mode === "cancelled") {
      setMessage(mode === "blocked" ? "模拟核心拒绝" : "已取消修改");
      return { status: mode, message: mode };
    }
    if (mode === "deferred") {
      // 保留已捕获的命令；完成时通过真实核心写入原目标。
      return new Promise<EditorCommandResult>((resolve) => { finish = () => {
        finish = undefined;
        resolve(commit(command));
      }; });
    }
    return commit(command);
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
      overflow: (actual: 3 | 5 = 3) => {
        // 真实核心路径：压缩出的尾休止转为音乐，扩张比例或删除时无法再腾出容量。
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
        measure.beats = Array.from({ length: actual === 3 ? 4 : 8 }, (_, i) => ({
          id: `full-${i}`, tick: i * (actual === 3 ? 960 : 480),
          rhythm: { base: actual === 3 ? "quarter" : "eighth", dots: 0 }, kind: "notes", notes: [],
        }));
        const result = applyScoreCommand(next, { type: C.SetTuplet, trackId: track.id, measureId: measure.id,
          startBeatId: "full-0", endBeatId: `full-${actual - 1}`,
          ratio: actual === 3 ? { actual: 3, normal: 2 } : { actual: 5, normal: 3 } });
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
