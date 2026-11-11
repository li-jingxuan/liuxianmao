import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ILXMCommandEffect } from "@liuxianmao/lxm-editor";
import {
  EditorHistoryPanel,
  EditorHistoryRail,
  type EditorHistoryItem,
} from "../components/EditorShell/workspace/EditorHistoryPanel";
import {
  EditorFeedback,
  type EditorFeedbackEvent,
} from "../components/EditorShell/workspace/EditorFeedback";

const effect: ILXMCommandEffect = {
  kind: "technique.removed",
  trackId: "t",
  measureId: "m",
  measureNumber: 7,
  techniqueId: "tech",
  techniqueType: "slideUp",
};
const initial: EditorHistoryItem[] = ["A", "B", "C"].map((id) => ({
  id,
  label: `操作 ${id}`,
  target: { summary: "提交时第 7 小节" },
  effects: [effect],
}));
let eventSequence = 0;

const Harness = () => {
  const [entries, setEntries] = useState(initial);
  const [appliedCount, setAppliedCount] = useState(2);
  const [sessionKey, setSessionKey] = useState(1);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [event, setEvent] = useState<EditorFeedbackEvent | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [modal, setModal] = useState(false);
  const onOpen = useCallback(
    (id: string) => {
      if (!allowed || !entries.some((entry) => entry.id === id)) return false;
      setOpen(true);
      setExpanded((ids) => (ids.includes(id) ? ids : [...ids, id]));
      return true;
    },
    [allowed, entries],
  );
  useEffect(() => {
    Object.assign(window, {
      historyFeedbackTest: {
        send: (source: "command" | "clipboard", entryId = "C") =>
          setEvent({
            eventId: `e-${++eventSequence}`,
            source,
            entryId: source === "command" ? entryId : undefined,
            effects: [
              {
                ...effect,
                kind:
                  source === "command"
                    ? "technique.removed"
                    : "technique.omitted",
              },
            ],
          }),
        allowed: setAllowed,
        hidden: setHidden,
        applied: setAppliedCount,
        prune: (id: string) =>
          setEntries((items) => items.filter((item) => item.id !== id)),
        modal: setModal,
        switchSession: () => {
          setSessionKey((key) => key + 1);
          setEvent(null);
          setEntries([...initial]);
          setOpen(false);
        },
        status: () => ({ open, expanded, sessionKey }),
      },
    });
  }, [open, expanded, sessionKey]);
  return (
    <main
      style={{
        height: 600,
        width: "100%",
        maxWidth: 900,
        position: "relative",
        display: "flex",
        background: "#f3f6fb",
        fontFamily: "sans-serif",
      }}
    >
      <EditorHistoryRail
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      <EditorHistoryPanel
        open={open}
        modal={modal}
        entries={entries}
        appliedCount={appliedCount}
        baselineAdvanced={false}
        sessionKey={sessionKey}
        expandedEntryIds={expanded}
        onExpandedEntryIdsChange={setExpanded}
        onClose={() => setOpen(false)}
        onUndo={() => setAppliedCount((value) => Math.max(0, value - 1))}
        onRedo={() =>
          setAppliedCount((value) => Math.min(entries.length, value + 1))
        }
        canUndo={appliedCount > 0}
        canRedo={appliedCount < entries.length}
      />
      <label style={{ padding: 20 }}>
        未应用草稿
        <input aria-label="未应用草稿" defaultValue="保留输入" />
      </label>
      <EditorFeedback
        event={event}
        entries={entries}
        appliedCount={appliedCount}
        sessionKey={sessionKey}
        onOpenHistoryEntry={onOpen}
        retryKey={`${allowed}:${open}`}
        hidden={hidden}
      />
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<Harness />);
