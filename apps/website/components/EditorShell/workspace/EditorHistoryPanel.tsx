"use client";

import { useEffect, useId, useMemo, useState, type Ref } from "react";
import { History, Redo2, Undo2, X, ChevronDown } from "lucide-react";
import type { ILXMCommandEffect } from "@liuxianmao/lxm-editor";
import { EditorImpactDetails } from "./EditorImpactNotice";
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
  panelId?: string;
  onToggle: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export const EditorHistoryRail = ({
  open,
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
      title="操作历史"
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
  appliedCount: number;
  baselineAdvanced: boolean;
  sessionKey: string | number;
  expandedEntryIds?: readonly string[];
  onExpandedEntryIdsChange?: (ids: string[]) => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  blocked?: boolean;
}

export const EditorHistoryPanel = ({
  id = "editor-history-panel",
  open,
  modal = false,
  entries,
  appliedCount,
  baselineAdvanced,
  sessionKey,
  expandedEntryIds,
  onExpandedEntryIdsChange,
  onClose,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  blocked = false,
}: EditorHistoryPanelProps) => {
  const titleId = useId();
  const detailsPrefix = useId();
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
                      <strong>{entry.label}</strong>
                      {current && <span className={styles.badge}>当前</span>}
                      {undone && (
                        <span className={styles.undoneBadge}>已撤销</span>
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
                          <div id={detailId} className={styles.impact}>
                            <EditorImpactDetails
                              effects={entry.effects}
                              context={undone ? "undone" : "committed"}
                            />
                          </div>
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
                <strong>
                  {baselineAdvanced
                    ? "更早状态（保留范围起点）"
                    : "本次会话起点"}
                </strong>
                {appliedCount === 0 && (
                  <span className={styles.badge}>当前</span>
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
        <p>仅逐步撤销／重做，不跳转历史</p>
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
    </Container>
  );
};
