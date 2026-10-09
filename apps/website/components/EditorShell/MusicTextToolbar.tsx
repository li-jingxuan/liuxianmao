import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  createCollapsedTabCellSelection,
  LXMScoreCommandEnum,
  normalizeMusicText,
  validateChordDiagram,
  type ILXMTabCellReference,
  type ILXMLyricVerse,
} from "@liuxianmao/lxm-editor";
import { editorStore, useEditorStore } from "../../stores/editor-store";
import { ChordEditor, type ChordDraft } from "./ChordEditor";
import { shouldIgnoreMusicTextKey } from "./music-text-interaction";
import styles from "./index.module.scss";

export interface MusicTextTarget extends ILXMTabCellReference {
  kind: "lyric" | "chord";
  verse?: ILXMLyricVerse;
}
export interface MusicTextController {
  open: (target: MusicTextTarget) => void;
  move: (target: ILXMTabCellReference) => void;
}
interface Draft {
  target: MusicTextTarget;
  text: string;
  chord: ChordDraft;
  initial: string;
}
const draftValue = (draft: Omit<Draft, "initial">): string =>
  JSON.stringify(draft.target.kind === "lyric" ? draft.text : draft.chord);

/** 草稿仅存在于页面；应用一次产生一条命令，切换目标前明确处理未应用内容。 */
export const MusicTextToolbar = ({
  ref,
  onOpen,
  onEditingChange,
  onClose,
}: {
  ref: Ref<MusicTextController>;
  onOpen: () => void;
  onClose: () => void;
  onEditingChange: (editing: boolean) => void;
}) => {
  const score = useEditorStore((s) => s.document);
  const selection = useEditorStore((s) => s.selection);
  const execute = useEditorStore((s) => s.execute);
  const setSelectedTechniqueId = useEditorStore(
    (s) => s.setSelectedTechniqueId,
  );
  const setSelection = useEditorStore((s) => s.setSelection);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<{
    target: MusicTextTarget | null;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const compositionEndedAt = useRef(-Infinity);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const baseline = useRef(score);
  const wasEditing = useRef(false);
  const dirty = !!draft && draftValue(draft) !== draft.initial;
  const open = (target: MusicTextTarget | null) => {
    setPending(null);
    setMessage(null);
    if (!target) {
      setDraft(null);
      return;
    }
    const track = editorStore
      .getState()
      .document?.score.tracks.find((t) => t.id === target.trackId);
    const measure = track?.measures.find((m) => m.id === target.measureId);
    if (!measure?.beats.some((b) => b.id === target.beatId)) {
      setDraft(null);
      return;
    }
    const lyric = measure.lyrics.find(
      (l) => l.beatId === target.beatId && l.verse === (target.verse ?? 1),
    );
    const chord = measure.chordSymbols.find((c) => c.beatId === target.beatId);
    const value = {
      target: { ...target, verse: target.verse ?? 1 },
      text: lyric?.text ?? "",
      chord: chord
        ? structuredClone({ display: chord.display, chord: chord.chord })
        : { display: "name" as const, chord: { name: "", diagram: null } },
    };
    setDraft({ ...value, initial: draftValue(value) });
    baseline.current = editorStore.getState().document;
    onOpen();
    setSelectedTechniqueId(null);
    setSelection(createCollapsedTabCellSelection(target));
  };
  const askOpen = (target: MusicTextTarget | null) =>
    dirty ? setPending({ target }) : open(target);
  // 直接订阅外部 store；仅本组件刚提交的文档可保留草稿。
  const committing = useRef(false);
  useEffect(
    () =>
      editorStore.subscribe((state) => {
        if (state.document !== baseline.current && !committing.current) {
          setDraft(null);
          setPending(null);
          setMessage(
            wasEditing.current ? "谱面已变化，未应用草稿已取消。" : null,
          );
          baseline.current = state.document;
        }
      }),
    [],
  );
  useImperativeHandle(ref, () => ({
    open: askOpen,
    move: (target) => {
      if (draft)
        askOpen({
          ...target,
          kind: draft.target.kind,
          verse: draft.target.verse,
        });
    },
  }));
  const editing = !!draft;
  const focusTarget = draft?.target;
  useEffect(() => {
    if (wasEditing.current && !editing) onClose();
    wasEditing.current = editing;
    onEditingChange(editing);
    inputRef.current?.focus();
  }, [focusTarget, editing, onEditingChange, onClose]);
  const current = selection?.focus ?? null;
  const track = score?.score.tracks.find((t) => t.id === draft?.target.trackId);
  const measure = track?.measures.find((m) => m.id === draft?.target.measureId);
  const existing =
    draft?.target.kind === "lyric"
      ? measure?.lyrics.find(
          (l) =>
            l.beatId === draft.target.beatId && l.verse === draft.target.verse,
        )
      : measure?.chordSymbols.find((c) => c.beatId === draft?.target.beatId);
  const issue = draft
    ? draft.target.kind === "lyric"
      ? normalizeMusicText(draft.text, 64) === null
        ? "歌词须为单行非空文本，最多 64 个字符。"
        : null
      : normalizeMusicText(draft.chord.chord.name, 32) === null
        ? "和弦名须为单行非空文本，最多 32 个字符。"
        : draft.chord.chord.diagram
          ? validateChordDiagram(draft.chord.chord.diagram)
          : draft.chord.display === "nameAndDiagram"
            ? "请创建指法图。"
            : null
    : null;
  const apply = (advance = false): boolean => {
    if (!draft || issue || composing.current) return false;
    const target = draft.target;
    committing.current = true;
    const result = execute(
      target.kind === "lyric"
        ? {
            type: LXMScoreCommandEnum.SetLyric,
            ...target,
            verse: target.verse!,
            text: draft.text,
          }
        : {
            type: LXMScoreCommandEnum.SetChordSymbol,
            ...target,
            ...draft.chord,
          },
    );
    committing.current = false;
    if (!result?.ok) {
      setMessage(result && !result.ok ? result.message : "应用失败");
      return false;
    }
    baseline.current = editorStore.getState().document;
    const savedMeasure = result.document.score.tracks
      .find((t) => t.id === target.trackId)
      ?.measures.find((m) => m.id === target.measureId);
    const savedLyric = savedMeasure?.lyrics.find(
      (l) => l.beatId === target.beatId && l.verse === target.verse,
    );
    const savedChord = savedMeasure?.chordSymbols.find(
      (c) => c.beatId === target.beatId,
    );
    const canonical = {
      ...draft,
      text: savedLyric?.text ?? draft.text,
      chord: savedChord
        ? structuredClone({
            display: savedChord.display,
            chord: savedChord.chord,
          })
        : draft.chord,
    };
    setDraft({ ...canonical, initial: draftValue(canonical) });
    setMessage("已应用");
    if (advance && target.kind === "lyric") {
      const beats =
        result.document.score.tracks
          .find((t) => t.id === target.trackId)
          ?.measures.flatMap((m) =>
            m.beats.map((b) => ({ ...target, measureId: m.id, beatId: b.id })),
          ) ?? [];
      const i = beats.findIndex((b) => b.beatId === target.beatId);
      const next = beats[i + 1];
      if (next) {
        // 连续录入使用新文档中的稳定引用，不跳过休止，也不自动创建 Beat。
        const newScore = editorStore.getState().document;
        const lyric = newScore?.score.tracks
          .find((t) => t.id === target.trackId)
          ?.measures.find((m) => m.id === next.measureId)
          ?.lyrics.find(
            (l) => l.beatId === next.beatId && l.verse === target.verse,
          );
        const text = lyric?.text ?? "";
        setDraft({
          ...draft,
          target: next,
          text,
          initial: JSON.stringify(text),
        });
        setSelection(createCollapsedTabCellSelection(next));
        setMessage(null);
      } else setMessage("已应用，已到最后一拍。");
    }
    return true;
  };
  return (
    <section className={styles.musicTextPanel} aria-label="音乐文本工具">
      <button
        disabled={!current}
        onClick={() =>
          current && askOpen({ ...current, kind: "lyric", verse: 1 })
        }
      >
        编辑歌词
      </button>
      <button
        disabled={!current}
        onClick={() => current && askOpen({ ...current, kind: "chord" })}
      >
        编辑和弦
      </button>
      <button
        disabled={!useEditorStore((s) => s.canUndo)}
        onClick={() => editorStore.getState().undo()}
      >
        撤销文本或文档
      </button>
      <button
        disabled={!useEditorStore((s) => s.canRedo)}
        onClick={() => editorStore.getState().redo()}
      >
        重做文本或文档
      </button>
      {draft && (
        <div
          onPasteCapture={(event) => {
            // 粘贴前拒绝换行；浏览器的单行 input 会静默去掉换行，不能等 onChange 才检查。
            if (
              /[\r\n\u2028\u2029]/u.test(event.clipboardData.getData("text"))
            ) {
              event.preventDefault();
              setMessage("请粘贴单行文本。");
            }
          }}
          onKeyDown={(e) => {
            if (
              shouldIgnoreMusicTextKey(
                e.nativeEvent,
                composing.current,
                compositionEndedAt.current,
              )
            )
              return;
            if (e.key === "Escape") {
              e.preventDefault();
              askOpen(null);
            }
            if (
              e.key === "Enter" &&
              e.target instanceof HTMLInputElement &&
              draft.target.kind === "lyric"
            ) {
              e.preventDefault();
              apply(!e.shiftKey);
            }
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            compositionEndedAt.current = e.timeStamp;
          }}
        >
          <p>
            目标：第{" "}
            {(track?.measures.findIndex(
              (m) => m.id === draft.target.measureId,
            ) ?? 0) + 1}{" "}
            小节，第{" "}
            {(measure?.beats.findIndex((b) => b.id === draft.target.beatId) ??
              0) + 1}{" "}
            拍
          </p>
          {draft.target.kind === "lyric" ? (
            <>
              <label>
                段号{" "}
                <select
                  aria-label="歌词段号"
                  value={draft.target.verse}
                  onChange={(e) =>
                    askOpen({
                      ...draft.target,
                      verse: Number(e.target.value) as ILXMLyricVerse,
                    })
                  }
                >
                  {[1, 2, 3, 4].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                歌词{" "}
                <input
                  ref={inputRef}
                  aria-label="歌词文本"
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
              </label>
              <small>
                Enter 应用并下一拍；Shift+Enter 仅应用。
                {existing && "将修改已有歌词。"}
              </small>
            </>
          ) : (
            <ChordEditor
              inputRef={inputRef}
              draft={draft.chord}
              onChange={(chord) => setDraft({ ...draft, chord })}
              presetsEnabled={
                !!track &&
                JSON.stringify(track.tuning.strings.map((s) => s.pitch)) ===
                  JSON.stringify(["E4", "B3", "G3", "D3", "A2", "E2"])
              }
            />
          )}
          {issue && <p role="alert">{issue}</p>}
          <button disabled={!!issue} onClick={() => apply()}>
            应用
          </button>
          {draft.target.kind === "lyric" && (
            <button disabled={!!issue} onClick={() => apply(true)}>
              应用并下一拍
            </button>
          )}
          <button onClick={() => askOpen(null)}>取消</button>
          <button
            disabled={!existing}
            onClick={() => {
              if (!existing) return;
              committing.current = true;
              const result = execute(
                draft.target.kind === "lyric"
                  ? {
                      type: LXMScoreCommandEnum.RemoveLyric,
                      ...draft.target,
                      lyricId: existing.id,
                    }
                  : {
                      type: LXMScoreCommandEnum.RemoveChordSymbol,
                      ...draft.target,
                      chordSymbolId: existing.id,
                    },
              );
              committing.current = false;
              if (result?.ok) {
                baseline.current = editorStore.getState().document;
                const value = {
                  ...draft,
                  text: "",
                  chord: {
                    display: "name" as const,
                    chord: { name: "", diagram: null },
                  },
                };
                setDraft({ ...value, initial: draftValue(value) });
                setPending(null);
                setMessage("已删除，保留当前拍点。");
              }
            }}
          >
            删除{draft.target.kind === "lyric" ? "歌词" : "和弦"}
          </button>
        </div>
      )}
      {pending && (
        <div role="alertdialog" aria-label="未应用草稿确认">
          <p>当前草稿尚未应用。</p>
          <button
            disabled={!!issue}
            onClick={() => {
              if (apply()) open(pending.target);
            }}
          >
            应用后继续
          </button>
          <button onClick={() => open(pending.target)}>放弃草稿并继续</button>
          <button onClick={() => setPending(null)}>继续编辑</button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
};
