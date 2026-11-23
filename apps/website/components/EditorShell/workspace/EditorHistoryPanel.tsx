"use client";

import { useEffect, useId, useMemo, useState, type Ref } from "react";
import { History, Redo2, Undo2, X, ChevronDown } from "lucide-react";
import type { ILXMCommandEffect } from "@liuxianmao/lxm-editor";
import {
  formatHistoryImpacts,
  type HistoryImpactTrack,
} from "./EditorImpactNotice";
import styles from "./EditorHistoryPanel.module.scss";

/** Structurally compatible with the store metadata; no score snapshots required. */
export interface EditorHistoryItem {
  readonly id: string;
  readonly label: string;
  readonly target: { readonly summary: string };
  readonly effects: readonly ILXMCommandEffect[];
}

export const getEditorHistoryRows = (
  entries: readonly EditorHistoryItem[],
  appliedCount: number,
) =>
  entries
    .map((entry, index) => ({
      entry,
      undone: index >= appliedCount,
      current: index === appliedCount - 1,
    }))
    .reverse();

export const reconcileExpandedHistoryIds = (
  ids: readonly string[],
  entries: readonly EditorHistoryItem[],
) => {
  const valid = new Set(
    entries
      .filter((entry) => entry.effects.length > 0)
      .map((entry) => entry.id),
  );
  return ids.filter((id, index) => valid.has(id) && ids.indexOf(id) === index);
};

export interface EditorHistoryRailProps {
  open: boolean;
  disabled?: boolean;
  panelId?: string;
  onToggle: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export const EditorHistoryRail = ({
  open,
  disabled = false,
  panelId = "editor-history-panel",
  onToggle,
  buttonRef,
}: EditorHistoryRailProps) => (
  <nav className={styles.rail} data-history-rail aria-label="编辑历史入口">
    <button
      ref={buttonRef}
      type="button"
      className={styles.railButton}
      aria-label="操作历史"
      title={disabled ? "试听期间无法打开操作历史" : "操作历史"}
      disabled={disabled}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <History size={19} aria-hidden="true" />
    </button>
  </nav>
);

export interface EditorHistoryPanelProps {
  id?: string;
  open: boolean;
  modal?: boolean;
  entries: readonly EditorHistoryItem[];
  tracks: readonly HistoryImpactTrack[];
  appliedCount: number;
  baselineAdvanced: boolean;
  sessionKey: string | number;
  expandedEntryIds?: readonly string[];
  onExpandedEntryIdsChange?: (ids: string[]) => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRollback: (entryId: string | null) => number;
  canUndo: boolean;
  canRedo: boolean;
  blocked?: boolean;
}

export const EditorHistoryPanel = ({
  id = "editor-history-panel",
  open,
  modal = false,
  entries,
  tracks,
  appliedCount,
  baselineAdvanced,
  sessionKey,
  expandedEntryIds,
  onExpandedEntryIdsChange,
  onClose,
  onUndo,
  onRedo,
  onRollback,
  canUndo,
  canRedo,
  blocked = false,
}: EditorHistoryPanelProps) => {
  const titleId = useId();
  const detailsPrefix = useId();
  const [announcement, setAnnouncement] = useState<{
    sessionKey: string | number;
    text: string;
  }>();
  const [stored, setLocal] = useState<{
    sessionKey: string | number;
    entries: readonly EditorHistoryItem[];
    ids: string[];
    staleControlledIds?: readonly string[];
  }>({ sessionKey, entries, ids: [] });
  let local = stored;
  if (local.sessionKey !== sessionKey) {
    local = {
      sessionKey,
      entries,
      ids: [],
      staleControlledIds: expandedEntryIds,
    };
    setLocal(local);
  } else if (local.entries !== entries) {
    local = {
      ...local,
      entries,
      ids: reconcileExpandedHistoryIds(local.ids, entries),
    };
    setLocal(local);
  }
  const rawIds =
    expandedEntryIds !== undefined &&
    expandedEntryIds !== local.staleControlledIds
      ? expandedEntryIds
      : local.ids;
  const ids = useMemo(
    () => reconcileExpandedHistoryIds(rawIds, entries),
    [rawIds, entries],
  );
  useEffect(() => {
    if (
      expandedEntryIds &&
      (expandedEntryIds === local.staleControlledIds ||
        ids.length !== expandedEntryIds.length)
    ) {
      onExpandedEntryIdsChange?.(ids);
    }
  }, [
    expandedEntryIds,
    ids,
    local.staleControlledIds,
    onExpandedEntryIdsChange,
  ]);
  const toggle = (entryId: string) => {
    const next = ids.includes(entryId)
      ? ids.filter((value) => value !== entryId)
      : [...ids, entryId];
    setLocal({ sessionKey, entries, ids: next });
    onExpandedEntryIdsChange?.(next);
  };
  const rollback = (
    entryId: string | null,
    label: string,
    button: HTMLButtonElement,
  ) => {
    const title = button.parentElement?.querySelector("strong");
    const undoneCount = onRollback(entryId);
    if (!undoneCount) return;
    // 成功后该条目成为当前状态，按钮会消失，把焦点留在目标条目标题。
    title?.focus({ preventScroll: true });
    setAnnouncement({
      sessionKey,
      text: `已撤销 ${undoneCount} 步。当前：${label}`,
    });
  };
  const baselineLabel = baselineAdvanced
    ? "更早状态（保留范围起点）"
    : "本次会话起点";
  const showRollback = canUndo && !blocked;
  const Container = modal ? "section" : "aside";
  return (
    <Container
      id={id}
      data-history-panel
      className={styles.panel}
      hidden={!open}
      role={modal ? "dialog" : undefined}
      aria-modal={modal && open ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={modal ? -1 : undefined}
    >
      <header className={styles.header}>
        <div>
          <h2 id={titleId}>操作历史</h2>
          <p>本次会话 · 最新操作在上</p>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="关闭操作历史"
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      {open && (
        <div className={styles.scroll}>
          {entries.length === 0 && <p className={styles.empty}>暂无操作</p>}
          <ol className={styles.list}>
            {getEditorHistoryRows(entries, appliedCount).map(
              ({ entry, undone, current }) => {
                const expanded = ids.includes(entry.id);
                const detailId = `${detailsPrefix}-${entry.id}`;
                return (
                  <li
                    key={entry.id}
                    className={`${styles.entry} ${current ? styles.current : ""} ${undone ? styles.undone : ""}`}
                    data-entry-id={entry.id}
                  >
                    <div className={styles.entryHeading}>
                      <strong tabIndex={-1}>{entry.label}</strong>
                      {current && <span className={styles.badge}>当前</span>}
                      {undone && (
                        <span className={styles.undoneBadge}>已撤销</span>
                      )}
                      {showRollback && !current && !undone && (
                        <button
                          type="button"
                          className={styles.rollback}
                          aria-label={`撤回到此步：${entry.label}，${entry.target.summary}`}
                          onClick={(event) =>
                            rollback(entry.id, entry.label, event.currentTarget)
                          }
                        >
                          撤回到此步
                        </button>
                      )}
                    </div>
                    <p className={styles.target}>{entry.target.summary}</p>
                    {entry.effects.length > 0 && (
                      <>
                        <button
                          type="button"
                          className={styles.detailsButton}
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={() => toggle(entry.id)}
                        >
                          影响详情
                          <ChevronDown
                            size={13}
                            aria-hidden="true"
                            style={{
                              transform: expanded
                                ? "rotate(180deg)"
                                : undefined,
                            }}
                          />
                        </button>
                        {expanded && (
                          <ul id={detailId} className={styles.impact}>
                            {formatHistoryImpacts(entry.effects, tracks).map(
                              ({ key, text }) => (
                                <li key={key}>{text}</li>
                              ),
                            )}
                          </ul>
                        )}
                      </>
                    )}
                  </li>
                );
              },
            )}
            <li
              className={`${styles.baseline} ${appliedCount === 0 ? styles.current : ""}`}
            >
              <div className={styles.entryHeading}>
                <strong tabIndex={-1}>{baselineLabel}</strong>
                {appliedCount === 0 && (
                  <span className={styles.badge}>当前</span>
                )}
                {showRollback && appliedCount > 0 && (
                  <button
                    type="button"
                    className={styles.rollback}
                    aria-label={`撤回到${baselineAdvanced ? "保留范围起点" : baselineLabel}`}
                    onClick={(event) =>
                      rollback(null, baselineLabel, event.currentTarget)
                    }
                  >
                    撤回到起点
                  </button>
                )}
              </div>
              <p className={styles.target}>
                {baselineAdvanced
                  ? "更早的操作已超出保留范围"
                  : "开始编辑时的曲谱状态"}
              </p>
            </li>
          </ol>
        </div>
      )}
      <footer className={styles.footer}>
        <div>
          <button type="button" disabled={!canUndo || blocked} onClick={onUndo}>
            <Undo2 size={14} aria-hidden="true" />
            撤销
          </button>
          <button type="button" disabled={!canRedo || blocked} onClick={onRedo}>
            <Redo2 size={14} aria-hidden="true" />
            重做
          </button>
        </div>
      </footer>
      <span className={styles.visuallyHidden} role="status">
        {announcement?.sessionKey === sessionKey ? announcement.text : ""}
      </span>
    </Container>
  );
};
