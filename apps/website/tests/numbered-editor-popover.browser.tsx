import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import {
  NumberedEditor,
  type NumberedEditorController,
  type NumberedEditorDraft,
} from "../components/EditorShell/NumberedEditor";
import { createEditorSession, useEditorStore } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const fixture = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
const track = fixture.score.tracks[0]!;
const measure = track.measures[0]!;
const event = measure.numberedVoice.events[0]!;
const scenario = new URLSearchParams(location.search).get("scenario");
measure.numberedVoice.tuplets = [];
track.numberedMarks = [];
if (scenario === "blank") {
  measure.numberedVoice.events = [];
  measure.lyrics = [];
}
if (scenario === "double-dot") event.rhythm = { base: "eighth", dots: 2 };
const session = createEditorSession(fixture);
const commands: ILXMScoreCommand[] = [];
const requests: ("content" | "rhythm" | "itemPitch" | undefined)[] = [];
const initial =
  scenario === "blank" ? "" : event.items.map((item) => item.token).join("+");
const savedDraft: NumberedEditorDraft | undefined =
  scenario === "custom"
    ? {
        selectedId: event.id,
        start: 0,
        end: 960,
        raw: "1 2 3",
        initial,
        overwrite: true,
        base: event.rhythm.base,
        dots: event.rhythm.dots,
        template: "custom",
        fixedRange: true,
        templateBase: "eighth",
        templateDots: 0,
        itemId: event.items[0]!.id,
        destination: "",
        ratioIndex: 1,
        customRhythms: [
          { base: "eighth", dots: 0 },
          { base: "sixteenth", dots: 0 },
          { base: "sixteenth", dots: 0 },
        ],
        itemDraft: "#1",
      }
    : undefined;

const Harness = () => {
  const document = useEditorStore((state) => state.document)!;
  const [presentation, setPresentation] = useState<"popover" | "sidebar">(
    "popover",
  );
  const [mode, setMode] = useState<"single" | "sequence">(
    scenario === "blank" || scenario === "custom" ? "sequence" : "single",
  );
  const controller = useRef<NumberedEditorController>(null);
  Object.assign(window, {
    numberedTest: {
      commands,
      requests,
      focus: (group: "content" | "rhythm" | "itemPitch") =>
        controller.current!.focus(group),
      snapshot: () => controller.current!.snapshot(),
      groups: () => controller.current!.groups,
      applyGroup: (group: "content" | "rhythm" | "itemPitch") =>
        controller.current!.applyGroup(group),
      surface: (next: "popover" | "sidebar") => setPresentation(next),
      document: () => session.getState().document,
      version: () => session.getState().document!.documentRevision,
    },
  });
  return (
    <div style={{ width: presentation === "popover" ? 336 : 440, padding: 12 }}>
      <button
        onClick={() =>
          setPresentation(presentation === "popover" ? "sidebar" : "popover")
        }
      >
        切换测试表面
      </button>
      <NumberedEditor
        ref={controller}
        document={document}
        presentation={presentation}
        onRequestSidebar={(group) => {
          requests.push(group);
          setPresentation("sidebar");
        }}
        target={{
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          ...(scenario === "blank"
            ? { tick: 0, endTick: 960 }
            : { eventId: event.id }),
        }}
        mode={mode}
        onModeChange={setMode}
        savedDraft={savedDraft}
        commit={(command) => {
          commands.push(command);
          return session.getState().execute(command);
        }}
        onDirty={() => {}}
        onInputActive={() => {}}
        onPreviewTargetChange={() => {}}
        onActivate={() => {}}
        onCanApply={() => {}}
        onSelectTarget={() => {}}
        onCancel={() => {}}
        getClipboard={() => null}
        copyRange={() => false}
        selectedMarkId={null}
      />
    </div>
  );
};

createRoot(document.getElementById("root")!).render(
  <EditorStoreContext.Provider value={session}>
    <Harness />
  </EditorStoreContext.Provider>,
);
