"use client";

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import { Button, Input, Select, type InputRef } from "antd";
import {
  applyScoreCommand,
  getLyricVerseCount,
  LXMScoreCommandEnum,
  readMusicTextRange,
  resolveMusicTextRange,
  type ILXMDocument,
  type ILXMLyricVerse,
  type MusicTextRange,
  type MusicTextRangeSlot,
} from "@liuxianmao/lxm-editor";
import { useEditorSessionStore, useEditorStore } from "../../../stores/editor-store";
import { useEditorDraftRecords, useEditorRuntime } from "../session/EditorSessionRuntime";
import { captureEditorVersion, sameEditorVersion, type EditorSessionVersion } from "../session/editor-session-version";
import { formatNumberedBeatPosition } from "../numbered/numbered-editor-target";
import { isEditorInputEnter } from "../shared/editor-input-enter";
import { ShortcutTooltip } from "../session/EditorShortcutReference";
import styles from "./MusicTextRangeEditor.module.scss";

export interface MusicTextRangeEditorController {
  isDirty(): boolean;
  isComposing(): boolean;
  focus(): void;
  clear(): boolean;
}

export interface MusicTextRangeEditorProps {
  range: MusicTextRange;
  onChange: (range: MusicTextRange) => void;
  onClose: () => void;
  onScoreFocus: () => void;
  onRequestFocus?: () => void;
  ref?: Ref<MusicTextRangeEditorController>;
}

type RangeDraft = {
  key: string;
  text: string;
  initial: string;
  version: EditorSessionVersion;
  conflict: boolean;
  message: string | null;
};

const conflictMessage = "曲谱已变化，未应用的输入已保留。请恢复范围内容后重新编辑。";
const emptyMessage = "范围已失效，请重新选择。";
const command = (range: MusicTextRange, text: string) => ({
  type: LXMScoreCommandEnum.ReplaceMusicTextRange as const,
  range,
  text,
});

function contentAt(document: ILXMDocument, range: MusicTextRange, slot: MusicTextRangeSlot) {
  const measure = document.score.tracks.find((track) => track.id === range.trackId)
    ?.measures.find((item) => item.id === slot.measureId);
  const event = measure?.numberedVoice.events.find((item) =>
    slot.eventId ? item.id === slot.eventId : item.tick === slot.tick);
  if (range.kind === "lyric")
    return measure?.lyrics.find((lyric) => lyric.eventId === event?.id && lyric.verse === (range.verse ?? 1))?.text ?? "";
  return event?.items.map((item) => item.token).join("+") ?? "";
}

/** The candidate uses the same atomic command as Apply; it never writes to the store. */
export function previewMusicTextRange(document: ILXMDocument | null, range: MusicTextRange, text: string) {
  if (!document) return { error: emptyMessage, rows: [], removedMarkIds: [] as string[] };
  const resolved = resolveMusicTextRange(document, range);
  if (!resolved.ok) return { error: resolved.message, rows: [], removedMarkIds: [] as string[] };
  const cmd = command(range, text);
  const result = applyScoreCommand(document, cmd);
  const removedMarkIds = !result.ok && result.code === "NUMBERED_IMPACT_REQUIRED" ? result.removedMarkIds ?? [] : [];
  // Only a successful, explicitly confirmed pure candidate supplies preview content.
  const candidate = !result.ok && result.code === "NUMBERED_IMPACT_REQUIRED"
    ? applyScoreCommand(document, { ...cmd, expectedRevision: document.documentRevision, confirmedRemovedMarkIds: removedMarkIds })
    : result;
  const tokens = text.trim().split(/[ \u3000]+/u);
  return {
    error: candidate.ok ? null : candidate.message,
    removedMarkIds,
    rows: resolved.slots.map((slot, index) => {
      const before = contentAt(document, range, slot);
      const after = candidate.ok ? contentAt(candidate.document, range, slot) : before;
      const status = !candidate.ok ? "error" : range.kind === "numbered" && tokens[index] === "_"
        ? "keep" : !after ? "empty" : before === after ? "same" : "change";
      return { slot, before, after, status };
    }),
  };
}

export function MusicTextRangeEditor({ range, onChange, onClose, onScoreFocus, onRequestFocus, ref }: MusicTextRangeEditorProps) {
  const store = useEditorSessionStore();
  const document = useEditorStore((state) => state.document);
  const { modals, drafts } = useEditorRuntime();
  const activeModal = useSyncExternalStore(modals.subscribe, modals.getSnapshot, () => null);
  const input = useRef<InputRef>(null);
  const id = useId();
  const key = JSON.stringify(range);
  const rangeLive = useRef(range);
  rangeLive.current = range;
  const readDraft = useCallback((): RangeDraft => {
    const version = captureEditorVersion(store.getState());
    const value = version.document ? readMusicTextRange(version.document, rangeLive.current) : null;
    const text = value?.ok ? value.text : "";
    return { key: JSON.stringify(rangeLive.current), text, initial: text, version,
      conflict: false, message: value && !value.ok ? value.message : value ? null : emptyMessage };
  }, [store]);
  const [draft, setDraft] = useState<RangeDraft>(readDraft);
  const live = useRef(draft);
  const update = (next: RangeDraft) => { live.current = next; setDraft(next); };
  const composing = useRef(false);
  const cooling = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inputBusy, setInputBusy] = useState(false);
  const committing = useRef(false);
  const mounted = useRef(true);
  const focus = () => input.current?.focus({ preventScroll: true });
  const busy = () => composing.current || cooling.current || committing.current || modals.isOpen();
  const dirty = draft.text !== draft.initial;

  useLayoutEffect(() => {
    if (live.current.key !== key) update(readDraft());
  }, [key, readDraft]);
  useEffect(() => store.subscribe((state) => {
    if (committing.current || sameEditorVersion(state, live.current.version)) return;
    const previous = live.current;
    if (previous.text !== previous.initial || composing.current || cooling.current) {
      update({ ...previous, conflict: true, message: conflictMessage });
    } else update(readDraft());
  }), [store, readDraft]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  const preview = useMemo(() => previewMusicTextRange(document, range, draft.text), [document, range, draft.text]);
  const error = draft.conflict ? conflictMessage : draft.message ?? preview.error;
  const track = document?.score.tracks.find((item) => item.id === range.trackId);
  const position = (slot: MusicTextRangeSlot) => {
    const index = track?.measures.findIndex((measure) => measure.id === slot.measureId) ?? -1;
    if (index < 0 || !track) return "位置已失效";
    return `第 ${index + 1} 小节 · ${formatNumberedBeatPosition(slot.tick, track.measures[index]!.timeSignature.denominator)}`;
  };
  const first = preview.rows[0]?.slot;
  const last = preview.rows[preview.rows.length - 1]?.slot;
  const location = first && last ? `${position(first)} ～ ${position(last)}` : "请选择有效范围";
  const groups = [...new Set(preview.rows.map((row) => row.slot.measureId))];
  const verseCount = Math.max(1, document ? getLyricVerseCount(document) : 1, range.verse ?? 1);

  const restore = () => {
    if (busy()) return false;
    update(readDraft());
    return true;
  };
  const registration = useEditorDraftRecords(() => {
    if (!dirty && !inputBusy && !error) return [];
    return [{
      id: `music-text-range:${id}`, kind: range.kind, targetKey: key,
      label: range.kind === "numbered" ? "简谱范围内容" : "歌词范围内容", location,
      dirty, composing: inputBusy, canApply: !error && !inputBusy, error,
      version: draft.version, inputKey: JSON.stringify([key, draft.text, draft.conflict]),
      focus: () => {
        if (!mounted.current || !input.current) return false;
        const identity = registration.captureIdentity();
        onRequestFocus?.();
        requestAnimationFrame(() => {
          const node = input.current?.input;
          if (mounted.current && registration.isCurrent(identity) && node?.getClientRects().length && !node.closest("[hidden],[inert]"))
            node.focus({ preventScroll: true });
        });
        return true;
      },
      apply: ({ isCurrent }: { isCurrent: () => boolean }) =>
        !isCurrent() ? "stale" as const : apply(live.current.text) ? "applied" as const : "blocked" as const,
      discard: restore,
    }];
  });

  function apply(text: string): boolean {
    if (busy() || live.current.key !== JSON.stringify(rangeLive.current) || live.current.conflict) return false;
    const state = store.getState();
    if (!sameEditorVersion(state, live.current.version)) {
      update({ ...live.current, conflict: true, message: conflictMessage });
      return false;
    }
    const inspection = drafts.inspect(registration.captureIdentity().owner);
    if (inspection.busy || inspection.pending.length) return false;
    if (!state.document) return false;
    const candidate = previewMusicTextRange(state.document, rangeLive.current, text);
    if (candidate.error) { update({ ...live.current, message: candidate.error }); return false; }
    const cmd = command(rangeLive.current, text);
    committing.current = true;
    try {
      const result = state.execute(cmd);
      if (result && !result.ok && result.code === "NUMBERED_IMPACT_REQUIRED") {
        const version = captureEditorVersion(state);
        const identity = registration.captureIdentity();
        const pendingDraft = live.current;
        const targetKey = pendingDraft.key;
        const removedMarkIds = [...(result.removedMarkIds ?? [])];
        const isValid = () => mounted.current && registration.isCurrent(identity) &&
          live.current === pendingDraft && !live.current.conflict &&
          JSON.stringify(rangeLive.current) === targetKey &&
          !composing.current && !cooling.current &&
          sameEditorVersion(store.getState(), version);
        modals.open({
          kind: "structure-impact",
          title: "范围内容影响确认",
          message: `这次范围修改将删除 ${removedMarkIds.length} 个简谱连接记号。确认后与范围内容一起提交、一起撤销。`,
          version,
          isValid,
          confirm: ({ isCurrent }) => {
            if (!isCurrent() || !isValid() || committing.current) return false;
            const currentInspection = drafts.inspect(identity.owner);
            if (currentInspection.busy || currentInspection.pending.length) return false;
            committing.current = true;
            try {
              // Execute directly once; a changed impact must never open a second confirmation.
              const confirmed = store.getState().execute({ ...cmd,
                expectedRevision: version.document!.documentRevision,
                confirmedRemovedMarkIds: removedMarkIds });
              if (!confirmed?.ok) {
                update({ ...live.current, message: confirmed && !confirmed.ok ? confirmed.message : "当前无法应用范围内容。" });
                return false;
              }
              update(readDraft());
              return true;
            } finally { committing.current = false; }
          },
          afterClose: () => { onScoreFocus(); return true; },
        });
        return false;
      }
      if (!result?.ok) {
        update({ ...live.current, message: result && !result.ok ? result.message : "当前无法应用范围内容。" });
        return false;
      }
      update(readDraft());
      return true;
    } finally { committing.current = false; }
  }

  useImperativeHandle(ref, () => ({
    isDirty: () => live.current.text !== live.current.initial,
    isComposing: () => composing.current || cooling.current,
    focus,
    clear: () => apply(""),
  }));

  const changeTarget = (next: MusicTextRange) => {
    if (busy()) return;
    const state = store.getState();
    const resolved = state.document ? resolveMusicTextRange(state.document, next) : null;
    if (!resolved?.ok) {
      update({ ...live.current, message: resolved && !resolved.ok ? resolved.message : emptyMessage });
      return;
    }
    registration.invalidateOwner();
    onChange(next);
  };
  const changeKind = (kind: MusicTextRange["kind"]) => {
    if (kind === range.kind || !first || !last || busy()) return;
    // Time endpoints allow the destination resolver to reject rests and sustains.
    const endpoint = (slot: MusicTextRangeSlot) => ({ measureId: slot.measureId, tick: slot.tick, endTick: slot.endTick });
    changeTarget({ trackId: range.trackId, kind, ...(kind === "lyric" ? { verse: range.verse ?? 1 } : {}),
      anchor: endpoint(first), focus: endpoint(last) });
  };

  return (
    <section className={styles.editor} data-music-text-range-editor aria-label="音乐文本范围编辑">
      <header className={styles.header}>
        <div><strong>{range.kind === "numbered" ? "简谱范围" : `歌词范围 · 第 ${range.verse ?? 1} 段`}</strong><p>{location}</p></div>
        <Button aria-label="结束范围编辑" disabled={inputBusy || !!activeModal} onClick={() => {
          if (busy()) return;
          registration.invalidateOwner();
          onClose();
          onScoreFocus();
        }}>结束</Button>
      </header>
      <div className={styles.body}>
        <div className={styles.segmented} role="group" aria-label="范围编辑对象">
          {(["numbered", "lyric"] as const).map((kind) => <Button key={kind} type={range.kind === kind ? "primary" : "text"} aria-pressed={range.kind === kind}
            disabled={inputBusy || !!activeModal} onClick={() => changeKind(kind)}>{kind === "numbered" ? "简谱" : "歌词"}</Button>)}
        </div>
        {range.kind === "lyric" && <div className={styles.verse}>
          <label htmlFor={`${id}-verse`}>歌词段落</label>
          <Select id={`${id}-verse`} aria-label="范围歌词段落" value={range.verse ?? 1} disabled={inputBusy || !!activeModal}
            virtual={false}
            options={Array.from({ length: verseCount }, (_, index) => ({ value: index + 1, label: `第 ${index + 1} 段` }))}
            onChange={(verse) => changeTarget({ ...range, verse: verse as ILXMLyricVerse })} />
        </div>}
        <label className={styles.label} htmlFor={`${id}-content`}>{range.kind === "numbered" ? "简谱内容" : "歌词内容"}</label>
        <div className={styles.inputRow}>
          <Input ref={input} id={`${id}-content`} aria-label="范围内容" value={draft.text} status={error ? "error" : undefined}
            autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={`${id}-rules${error ? ` ${id}-error` : ""}`}
            onChange={(event) => update({ ...live.current, text: event.target.value, message: null })}
            onCompositionStart={() => {
              if (timer.current) clearTimeout(timer.current);
              composing.current = true; cooling.current = false; setInputBusy(true);
            }}
            onCompositionEnd={() => {
              composing.current = false; cooling.current = true;
              timer.current = setTimeout(() => { cooling.current = false; setInputBusy(false); timer.current = null; }, 60);
            }}
            onKeyDown={(event) => {
              if (!isEditorInputEnter(event)) return;
              event.stopPropagation();
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current || cooling.current) return;
              event.preventDefault();
              if (apply(live.current.text)) onScoreFocus();
            }} />
          <ShortcutTooltip shortcuts={["apply"]} disabled={!!error || inputBusy || !!activeModal || !dirty}>
            <Button type="primary" aria-label="应用范围" disabled={!!error || inputBusy || !!activeModal || !dirty}
              onClick={() => { if (apply(live.current.text)) onScoreFocus(); }}>应用</Button>
          </ShortcutTooltip>
        </div>
        {error && <p className={styles.error} role="alert" id={`${id}-error`}>{error}</p>}
        {!error && preview.removedMarkIds.length > 0 && <p className={styles.impact} role="status">将影响 {preview.removedMarkIds.length} 个简谱连接记号，应用时需确认。</p>}
        <p className={styles.rules} id={`${id}-rules`}>空格分隔位置{range.kind === "numbered" ? "，1+3 表示同时发声；_ 保留原内容" : "；_ 清空该位置"}。空输入清空整个范围，未填满的位置清空，输入不能超出范围。</p>
        <div className={styles.previewHeading}><strong>选区预览</strong><span>{preview.rows.length} 个位置</span></div>
        <div className={styles.preview} data-range-preview aria-label="范围映射预览">
          {groups.map((measureId) => <div className={styles.measure} key={measureId}>
            <div className={styles.measureHeading}>第 {(track?.measures.findIndex((measure) => measure.id === measureId) ?? -1) + 1} 小节</div>
            <div className={styles.slots}>
              {preview.rows.filter((row) => row.slot.measureId === measureId).map((row) => <div className={styles.slot}
                key={`${row.slot.tick}:${row.slot.endTick}`} data-status={row.status}>
                <span className={styles.slotPosition}>{position(row.slot).split(" · ")[1]}</span>
                <strong className={styles.music}>{row.after || <span className={styles.empty} aria-label="空位">空</span>}</strong>
                <span className={styles.status}>{row.status === "keep" ? "保留原内容" : row.status === "empty" ? "清空为空位" : row.status === "error" ? "待修正" : row.status === "change" ? "替换" : "原内容"}</span>
                {row.status === "change" && row.before && <span className={styles.before}>原：{row.before}</span>}
              </div>)}
            </div>
          </div>)}
          {!preview.rows.length && <p className={styles.rules}>暂无可编辑位置，请在谱面重新选择范围。</p>}
        </div>
        <div className={styles.actions}>
          <Button aria-label="清空范围内容" disabled={inputBusy || !!activeModal || !preview.rows.length}
            onClick={() => { if (!busy()) update({ ...live.current, text: "", message: null }); }}>清空内容</Button>
          <Button aria-label="恢复范围内容" disabled={inputBusy || !!activeModal || (!dirty && !error)} onClick={() => restore()}>恢复</Button>
          {dirty && <span className={styles.dirty}>未应用</span>}
        </div>
        <footer className={styles.hints}><strong>连续选择</strong>
          <p>拖动选取一段，或按住 <kbd>Shift</kbd> 点击终点。可跨小节、跨谱行。</p>
          <p><kbd>←</kbd> <kbd>→</kbd> 移动 · <kbd>Shift</kbd> + 方向键扩选<br /><kbd>Esc</kbd> 收起选区</p>
        </footer>
      </div>
    </section>
  );
}
