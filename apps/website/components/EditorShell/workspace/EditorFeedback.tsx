"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, X } from "lucide-react";
import type { ILXMCommandEffect } from "@liuxianmao/lxm-editor";
import type { EditorHistoryItem } from "./EditorHistoryPanel";
import {
  EditorImpactDetails,
  formatEditorImpactSummary,
} from "./EditorImpactNotice";
import styles from "./EditorFeedback.module.scss";

export interface EditorFeedbackEvent {
  readonly eventId: string;
  readonly source: "command" | "clipboard";
  readonly entryId?: string;
  readonly effects: readonly ILXMCommandEffect[];
}
type SessionKey = string | number;
type OpenHistoryEntry = (entryId: string) => boolean | Promise<boolean>;
interface FeedbackSnapshot {
  sessionKey: SessionKey;
  toast: EditorFeedbackEvent | null;
  clipboardDetails: EditorFeedbackEvent | null;
  pendingEntryId: string | null;
}

const snapshotEvent = (event: EditorFeedbackEvent): EditorFeedbackEvent => ({
  eventId: event.eventId,
  source: event.source,
  entryId: event.entryId,
  effects: structuredClone([...event.effects]),
});

/** Independent transient UI owner. It never writes score, selection or history. */
export class EditorFeedbackController {
  private state: FeedbackSnapshot;
  private listeners = new Set<() => void>();
  private entries: readonly EditorHistoryItem[] = [];
  private seenEventId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = 4000;
  private startedAt = 0;
  private pauses = new Set<string>();
  private requestVersion = 0;
  private opening = false;

  constructor(sessionKey: SessionKey) {
    this.state = {
      sessionKey,
      toast: null,
      clipboardDetails: null,
      pendingEntryId: null,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: FeedbackSnapshot) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  private stopTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.remaining = Math.max(
        0,
        this.remaining - (Date.now() - this.startedAt),
      );
    }
  }
  private startTimer() {
    if (this.timer !== null || this.pauses.size > 0 || !this.state.toast)
      return;
    const { sessionKey, toast } = this.state;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dismiss(toast.eventId, sessionKey);
    }, this.remaining);
  }
  update(
    sessionKey: SessionKey,
    event: EditorFeedbackEvent | null | undefined,
    entries: readonly EditorHistoryItem[],
  ) {
    this.entries = entries;
    if (sessionKey !== this.state.sessionKey) {
      this.stopTimer();
      this.requestVersion++;
      this.opening = false;
      this.seenEventId = null;
      this.pauses.clear();
      this.publish({
        sessionKey,
        toast: null,
        clipboardDetails: null,
        pendingEntryId: null,
      });
    }
    if (event && event.eventId !== this.seenEventId) {
      this.stopTimer();
      this.requestVersion++;
      this.opening = false;
      this.seenEventId = event.eventId;
      this.remaining = 4000;
      const valid =
        event.source === "clipboard" ||
        entries.some((entry) => entry.id === event.entryId);
      if (event.effects.length === 0 || !valid) {
        this.pauses.delete("pointer");
        this.pauses.delete("focus");
      }
      this.publish({
        ...this.state,
        toast: event.effects.length > 0 && valid ? snapshotEvent(event) : null,
        pendingEntryId: null,
      });
    }
    const { toast, pendingEntryId } = this.state;
    if (
      (toast?.source === "command" &&
        !entries.some((entry) => entry.id === toast.entryId)) ||
      (pendingEntryId && !entries.some((entry) => entry.id === pendingEntryId))
    ) {
      this.stopTimer();
      this.pauses.delete("pointer");
      this.pauses.delete("focus");
      this.requestVersion++;
      this.opening = false;
      this.publish({
        ...this.state,
        toast:
          toast?.source === "command" &&
          !entries.some((entry) => entry.id === toast.entryId)
            ? null
            : toast,
        pendingEntryId: null,
      });
    }
    this.startTimer();
  }
  pause(reason: "pointer" | "focus" | "hidden", paused: boolean) {
    if (paused) {
      this.stopTimer();
      if (reason === "hidden") {
        // A hidden element may not receive pointerleave/blur before it disappears.
        this.pauses.delete("pointer");
        this.pauses.delete("focus");
      }
      this.pauses.add(reason);
    } else {
      this.pauses.delete(reason);
      this.startTimer();
    }
  }
  dismiss(eventId: string, sessionKey: SessionKey) {
    if (
      sessionKey !== this.state.sessionKey ||
      eventId !== this.state.toast?.eventId
    )
      return;
    this.stopTimer();
    this.pauses.delete("pointer");
    this.pauses.delete("focus");
    this.publish({ ...this.state, toast: null });
  }
  closeClipboardDetails = () => {
    this.publish({ ...this.state, clipboardDetails: null });
  };
  async showDetails(
    eventId: string,
    sessionKey: SessionKey,
    onOpen: OpenHistoryEntry,
  ) {
    const { toast } = this.state;
    if (
      !toast ||
      toast.eventId !== eventId ||
      sessionKey !== this.state.sessionKey
    )
      return;
    if (toast.source === "clipboard") {
      this.publish({ ...this.state, clipboardDetails: snapshotEvent(toast) });
      return;
    }
    if (
      !toast.entryId ||
      !this.entries.some((entry) => entry.id === toast.entryId)
    )
      return;
    this.publish({ ...this.state, pendingEntryId: toast.entryId });
    await this.retry(onOpen);
  }
  async retry(onOpen: OpenHistoryEntry) {
    const { pendingEntryId, sessionKey } = this.state;
    if (
      this.opening ||
      this.pauses.has("hidden") ||
      !pendingEntryId ||
      !this.entries.some((entry) => entry.id === pendingEntryId)
    )
      return;
    const version = ++this.requestVersion;
    this.opening = true;
    try {
      const opened = await onOpen(pendingEntryId);
      if (
        version !== this.requestVersion ||
        sessionKey !== this.state.sessionKey ||
        this.state.pendingEntryId !== pendingEntryId
      )
        return;
      if (opened) this.publish({ ...this.state, pendingEntryId: null });
    } catch {
      // A layout owner may reject while its protected transition is busy. Keep the request.
    } finally {
      if (version === this.requestVersion) this.opening = false;
    }
  }
  dispose = () => {
    this.stopTimer();
    this.requestVersion++;
    this.opening = false;
  };
}

export interface EditorFeedbackProps {
  event?: EditorFeedbackEvent | null;
  entries: readonly EditorHistoryItem[];
  appliedCount: number;
  sessionKey: SessionKey;
  /** true only after the layout owner actually opens AND expands this entry. */
  onOpenHistoryEntry: OpenHistoryEntry;
  /** Change when a protected layout transition can be retried. */
  retryKey?: unknown;
  /** Pause and hide under a higher overlay, retaining pending requests and copy snapshots. */
  hidden?: boolean;
}

export const EditorFeedback = ({
  event,
  entries,
  appliedCount,
  sessionKey,
  onOpenHistoryEntry,
  retryKey,
  hidden = false,
}: EditorFeedbackProps) => {
  const [controller] = useState(() => new EditorFeedbackController(sessionKey));
  const detailsRef = useRef<HTMLElement>(null);
  const detailsButtonRef = useRef<HTMLButtonElement>(null);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.update(sessionKey, event, entries);
    controller.pause("hidden", hidden);
    void controller.retry(onOpenHistoryEntry);
  }, [
    controller,
    sessionKey,
    event,
    entries,
    hidden,
    retryKey,
    onOpenHistoryEntry,
  ]);
  useEffect(() => controller.dispose, [controller]);
  const closeClipboardDetails = () => {
    controller.closeClipboardDetails();
    const button = detailsButtonRef.current;
    if (!hidden && button && button.getClientRects().length > 0) {
      button.focus({ preventScroll: true });
    }
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        hidden ||
        event.key !== "Escape" ||
        event.isComposing ||
        !(event.target instanceof Node) ||
        !detailsRef.current?.contains(event.target)
      )
        return;
      // Window capture precedes the workspace's document-capture drawer owner.
      event.preventDefault();
      event.stopPropagation();
      closeClipboardDetails();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  });
  // The first render after a document switch cannot expose the preceding session.
  if (state.sessionKey !== sessionKey) return null;
  const { toast, clipboardDetails, pendingEntryId } = state;
  const entryIndex =
    toast?.source === "command"
      ? entries.findIndex((entry) => entry.id === toast.entryId)
      : -1;
  const visibleToast =
    toast?.source === "clipboard" || entryIndex >= 0 ? toast : null;
  const undone = entryIndex >= appliedCount && entryIndex >= 0;
  return (
    <div className={styles.feedback} hidden={hidden} data-editor-feedback>
      {visibleToast && (
        <div
          className={styles.toast}
          onPointerEnter={() => controller.pause("pointer", true)}
          onPointerLeave={() => controller.pause("pointer", false)}
          onFocusCapture={() => controller.pause("focus", true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
              controller.pause("focus", false);
          }}
        >
          <CheckCircle2 size={17} className={styles.icon} aria-hidden="true" />
          <div className={styles.body}>
            <div role="status" aria-live="polite" aria-atomic="true">
              <strong>
                {visibleToast.source === "clipboard"
                  ? "复制完成，部分内容未复制"
                  : undone
                    ? "此操作已撤销"
                    : "编辑已完成"}
              </strong>
              <p>{formatEditorImpactSummary(visibleToast.effects)}</p>
            </div>
            <button
              ref={detailsButtonRef}
              type="button"
              className={styles.link}
              onClick={() => {
                void controller.showDetails(
                  visibleToast.eventId,
                  sessionKey,
                  onOpenHistoryEntry,
                );
              }}
            >
              {visibleToast.source === "clipboard" ? "查看详情" : "查看影响"}
            </button>
            {pendingEntryId && (
              <span className={styles.pending}>等待面板可用后打开</span>
            )}
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭编辑反馈"
            onClick={() => controller.dismiss(visibleToast.eventId, sessionKey)}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      {clipboardDetails && (
        <section
          ref={detailsRef}
          className={styles.clipboardDetails}
          role="region"
          aria-label="复制遗漏详情"
          tabIndex={0}
        >
          <header>
            <h2>复制遗漏详情</h2>
            <button
              type="button"
              className={styles.close}
              aria-label="关闭复制遗漏详情"
              onClick={closeClipboardDetails}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className={styles.detailsScroll}>
            <EditorImpactDetails
              effects={clipboardDetails.effects}
              context="clipboard"
            />
          </div>
        </section>
      )}
    </div>
  );
};
