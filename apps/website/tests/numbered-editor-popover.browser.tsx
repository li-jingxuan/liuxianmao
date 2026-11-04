import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import {
  NumberedEditor,
  type NumberedEditorController,
} from "../components/EditorShell/NumberedEditor";
import type { MusicTextTarget } from "../components/EditorShell/music-text-draft";
import { createEditorSession, useEditorStore } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const fixture = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
const track = fixture.score.tracks[0]!;
const measure = track.measures[0]!;
const event = measure.numberedVoice.events[0]!;
const parameters = new URLSearchParams(location.search);
const scenario = parameters.get("scenario");
measure.numberedVoice.tuplets = [];
track.numberedMarks = [];
if (scenario === "blank") {
  measure.numberedVoice.events = [];
  measure.lyrics = [];
}
if (scenario === "double-dot") event.rhythm = { base: "eighth", dots: 2 };
if (scenario === "gap") {
  event.kind = "gap";
  event.items = [];
}
if (scenario === "members" && event.kind === "notes") event.items.push({ ...event.items[0]!, id: "member-test-second", token: "3" });
const session = createEditorSession(fixture);
const commands: ILXMScoreCommand[] = [];
const selections: unknown[] = [];
const requests: ("content" | "rhythm" | "itemPitch" | undefined)[] = [];
const targetRequests: MusicTextTarget[] = [];

const Harness = () => {
  const document = useEditorStore((state) => state.document)!;
  const [presentation, setPresentation] = useState<"popover" | "sidebar">(
    "popover",
  );
  const [mode, setMode] = useState<"single" | "sequence">(
    scenario === "blank" || scenario === "custom" ? "sequence" : "single",
  );
  const controller = useRef<NumberedEditorController>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    // Optional fixture input exercises React's actual field event path after
    // score-derived initialization; it is never passed as editor state.
    const value = parameters.get("input");
    if (value === null) return;
    const control = globalThis.document.querySelector<HTMLInputElement>(
      '[data-presentation="popover"] input[aria-label="单音组简谱"], [data-presentation="popover"] input[aria-label="连续简谱"]',
    );
    if (!control) throw new Error("Missing numbered fixture input");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);
  useEffect(() => {
    Object.assign(window, {
    numberedTest: {
      commands,
      selections,
      requests,
      targetRequests,
      focus: (group: "content" | "rhythm" | "itemPitch") =>
        controller.current!.focus(group),
      snapshot: () => controller.current!.snapshot(),
      groups: () => controller.current!.groups,
      readStatus: () => controller.current!.readStatus(),
      restoreGroup: (group: "content" | "rhythm" | "itemPitch") => controller.current!.restoreGroup(group),
      external: (type: "change" | "remove") => session.getState().execute(type === "remove" ? {
        type: "numbered.event.remove", trackId: track.id, measureId: measure.id, eventId: event.id,
      } : { type: "numbered.event.set", trackId: track.id, measureId: measure.id, eventId: event.id, tokens: ["7"] }),
      applyGroup: (group: "content" | "rhythm" | "itemPitch") =>
        controller.current!.applyGroup(group),
      apply: (advance = true) => {
        const applyCurrent = controller.current!.apply;
        return applyCurrent(undefined, { advance });
      },
      surface: (next: "popover" | "sidebar") => setPresentation(next),
      document: () => session.getState().document,
      version: () => session.getState().document!.documentRevision,
    },
    });
  }, []);
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
        actionsHost={presentation === "sidebar" ? actionsHost : null}
        onRequestTarget={(target) => targetRequests.push(target)}
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
             : { eventId: event.id, ...(scenario === "explicit-member" ? { itemId: event.items[0]?.id } : {}) }),
        }}
        mode={mode}
        onModeChange={setMode}
        commit={(command) => {
          commands.push(command);
          return session.getState().execute(command);
        }}
        onDirty={() => {}}
        onInputActive={() => {}}
        onPreviewTargetChange={() => {}}
        onActivate={() => {}}
        onCanApply={() => {}}
        onSelectTarget={(target) => selections.push(target)}
        onCancel={() => {}}
        getClipboard={() => null}
        copyRange={() => false}
        selectedMarkId={null}
      />
      <div ref={setActionsHost} data-testid="numbered-actions" />
    </div>
  );
};

createRoot(document.getElementById("root")!).render(
  <EditorStoreContext.Provider value={session}>
    <Harness />
  </EditorStoreContext.Provider>,
);
