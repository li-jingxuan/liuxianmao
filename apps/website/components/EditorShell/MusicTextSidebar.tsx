import {
  useEffect,
  useMemo,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { FileText, Guitar, X, Trash2, Undo2, Redo2 } from "lucide-react";
import {
  createCollapsedTabCellSelection,
  LXMScoreCommandEnum,
  normalizeMusicText,
  parseLyricSequence,
  planLyricSequence,
  validateChordDiagram,
  type ILXMTabCellReference,
  type ILXMLyricVerse,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import { ChordEditor } from "./ChordEditor";
import { shouldIgnoreMusicTextKey } from "./music-text-interaction";
import {
  readMusicTextDraft,
  musicTextDraftValue,
  resolveSidebarRequest,
  type MusicTextTarget,
  type MusicTextDraft,
  type SidebarAction,
} from "./music-text-draft";
import styles from "./index.module.scss";

export interface MusicTextController {
  open: (target: MusicTextTarget) => void;
  move: (target: ILXMTabCellReference) => void;
  requestOpenCurrent: () => void;
  requestClose: () => void;
}

/** 侧栏常驻；可见性与编辑目标分开，所有换拍和关闭共用草稿保护。 */
export const MusicTextSidebar = ({
  ref,
  visible,
  onVisibleChange,
  onOpen,
  onEditingChange,
  onTargetChange,
  onClose,
}: {
  ref: Ref<MusicTextController>;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  onOpen: () => void;
  onEditingChange: (editing: boolean) => void;
  onTargetChange: (target: MusicTextTarget | null) => void;
  onClose: () => void;
}) => {
  const editorStore = useEditorSessionStore();
  const score = useEditorStore((s) => s.document);
  const selection = useEditorStore((s) => s.selection);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const [kind, setKind] = useState<MusicTextTarget["kind"]>("lyric");
  const [draft, setDraft] = useState<MusicTextDraft | null>(null);
  const [pending, setPending] = useState<SidebarAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sequenceInputRef = useRef<HTMLTextAreaElement>(null);
  const [inspection, setInspection] = useState(0);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const compositionEndedAt = useRef(-Infinity);
  const baseline = useRef(score);
  const committing = useRef(false);
  const wasEditing = useRef(false);
  const editing = !!draft;
  const target = draft?.target ?? selection?.focus;
  const track = score?.score.tracks.find((t) => t.id === target?.trackId);
  const measure = track?.measures.find((m) => m.id === target?.measureId);
  const validTarget =
    target && measure?.beats.some((b) => b.id === target.beatId)
      ? target
      : null;
  const existing =
    draft?.target.kind === "lyric"
      ? measure?.lyrics.find(
          (l) =>
            l.beatId === draft.target.beatId && l.verse === draft.target.verse,
        )
      : measure?.chordSymbols.find((c) => c.beatId === draft?.target.beatId);
  const sequence =
    draft?.target.kind === "lyric" && draft.lyricMode === "sequence";
  const parsed = useMemo(
    () =>
      sequence && draft?.text !== undefined
        ? parseLyricSequence(draft.text)
        : null,
    [sequence, draft],
  );
  const plan = useMemo(
    () =>
      parsed?.ok && score && draft?.target
        ? planLyricSequence(
            score,
            { ...draft.target, verse: draft.target.verse! },
            parsed.items,
            draft.allowOverwrite,
          )
        : null,
    [parsed, score, draft],
  );
  const issue = draft
    ? draft.target.kind === "lyric"
      ? sequence
        ? parsed && !parsed.ok
          ? parsed.message
          : (plan?.issue ?? null)
        : normalizeMusicText(draft.text, 64) === null
          ? "歌词须为单行非空文本，最多 64 个字符。"
          : null
      : normalizeMusicText(draft.chord.chord.name, 32) === null
        ? "和弦名须为单行非空文本，最多 32 个字符。"
        : draft.chord.chord.diagram
          ? validateChordDiagram(draft.chord.chord.diagram)
          : null
    : null;
  const inspected = plan?.rows[inspection]?.target;
  const active = useMemo(
    () =>
      draft?.target
        ? sequence && inspected
          ? { ...draft.target, ...inspected }
          : draft.target
        : null,
    [draft, sequence, inspected],
  );
  // 只报告已接受的目标；预览检查行不改变批次起点或持久化 selection。
  useEffect(() => {
    onTargetChange(active ? { ...active } : null);
  }, [onTargetChange, active]);

  const loadTarget = (
    next: MusicTextTarget,
    mode = draft?.lyricMode ?? "single",
  ) => {
    const value = readMusicTextDraft(
      editorStore.getState().document,
      next,
      mode,
    );
    setInspection(0);
    setPending(null);
    setMessage(value ? null : "目标拍已失效，请重新选择。");
    setDraft(value);
    setKind(next.kind);
    onVisibleChange(true);
    baseline.current = editorStore.getState().document;
    if (value) {
      onOpen();
      editorStore.getState().setSelectedTechniqueId(null);
      editorStore
        .getState()
        .setSelection(createCollapsedTabCellSelection(value.target));
    }
  };
  const perform = (action: SidebarAction) => {
    setPending(null);
    if (action.type === "close") {
      setDraft(null);
      setMessage(null);
      onVisibleChange(false);
      onClose();
    } else if (action.type === "target") loadTarget(action.target);
    else if (action.type === "mode") {
      if (draft) loadTarget(draft.target, action.mode);
    } else {
      setKind(action.kind);
      const next = draft?.target ?? editorStore.getState().selection?.focus;
      if (next)
        loadTarget({
          ...next,
          kind: action.kind,
          verse: action.kind === "lyric" ? 1 : undefined,
        });
    }
  };
  const request = (action: SidebarAction) => {
    if (composing.current || pending) return;
    const decision = resolveSidebarRequest(draft, action);
    if (decision === "confirm") setPending(action);
    else if (decision === "execute") perform(action);
  };
  useImperativeHandle(ref, () => ({
    open: (next) => request({ type: "target", target: next }),
    move: (next) => {
      if (draft)
        request({
          type: "target",
          target: { ...next, kind, verse: draft.target.verse },
        });
    },
    requestClose: () => request({ type: "close" }),
    requestOpenCurrent: () => {
      const current = editorStore.getState().selection?.focus;
      if (current)
        request({ type: "target", target: { ...current, kind, verse: 1 } });
      else onVisibleChange(true);
    },
  }));

  // 自身命令的同步 store 通知不清空草稿；外部历史切换总是取消旧目标。
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
    [editorStore],
  );
  useEffect(() => {
    onEditingChange(editing);
    if (wasEditing.current && !editing && visible)
      editButtonRef.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing, onEditingChange, visible]);
  const targetKey = draft
    ? `${draft.target.trackId}/${draft.target.measureId}/${draft.target.beatId}/${kind}/${draft.target.verse}`
    : "";
  // 按业务目标聚焦，不在表单输入或父壳重渲染时抢走指法控件焦点。
  useEffect(() => {
    if (targetKey)
      (sequence ? sequenceInputRef : inputRef).current?.focus({
        preventScroll: true,
      });
  }, [targetKey, sequence]);
  useEffect(() => {
    if (pending) confirmRef.current?.focus({ preventScroll: true });
    else if (targetKey)
      (sequence ? sequenceInputRef : inputRef).current?.focus({
        preventScroll: true,
      });
  }, [pending, targetKey, sequence]);

  /** 提交标记在异常、失败及 no-op 时也释放；失败保留当前草稿。 */
  const commit = (command: ILXMScoreCommand) => {
    committing.current = true;
    try {
      const result = editorStore.getState().execute(command);
      if (result?.ok) baseline.current = result.document;
      else
        setMessage(
          result && !result.ok ? result.message : "当前无法应用修改。",
        );
      return result;
    } finally {
      committing.current = false;
    }
  };
  const apply = (advance = false): boolean => {
    if (!draft || issue || composing.current) return false;
    const target = draft.target;
    const result = commit(
      target.kind === "lyric"
        ? sequence && parsed?.ok
          ? {
              type: LXMScoreCommandEnum.SetLyricSequence,
              ...target,
              verse: target.verse!,
              items: parsed.items,
              allowOverwrite: draft.allowOverwrite,
            }
          : {
              type: LXMScoreCommandEnum.SetLyric,
              ...target,
              verse: target.verse!,
              text: draft.text,
            }
        : {
            type: LXMScoreCommandEnum.SetChordSymbol,
            ...target,
            ...draft.chord,
            display: draft.chord.chord.diagram ? "nameAndDiagram" : "name",
          },
    );
    if (!result?.ok) return false;
    if (sequence) {
      setDraft({ ...draft, initial: musicTextDraftValue(draft) });
    } else setDraft(readMusicTextDraft(result.document, target));
    setMessage(result.changed ? "已应用" : "内容未变化");
    if (advance && target.kind === "lyric" && !sequence) {
      const beats =
        result.document.score.tracks
          .find((t) => t.id === target.trackId)
          ?.measures.flatMap((m) =>
            m.beats.map((b) => ({ ...target, measureId: m.id, beatId: b.id })),
          ) ?? [];
      const next =
        beats[beats.findIndex((b) => b.beatId === target.beatId) + 1];
      if (next) loadTarget(next);
      else setMessage("已应用，已到最后一拍。");
    }
    return true;
  };
  const remove = () => {
    if (!draft || !existing || composing.current) return;
    const result = commit(
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
    if (result?.ok) {
      setDraft(readMusicTextDraft(result.document, draft.target));
      setMessage("已删除，保留当前拍点。");
    }
  };
  /** 单轨设置和小节标记统一走核心命令，侧栏只负责提交输入。 */
  const setTrackCapo = (value: string) => {
    if (!track) return;
    const result = editorStore.getState().execute({
      type: LXMScoreCommandEnum.SetCapo,
      trackId: track.id,
      capo: Number(value),
    });
    if (result?.ok) setMessage("已更新变调夹；品位仍按相对 capo 记谱。");
  };
  const setMeasureSectionLabel = (value: string) => {
    if (!track || !measure) return;
    const result = editorStore.getState().execute({
      type: LXMScoreCommandEnum.SetSectionLabel,
      trackId: track.id,
      measureId: measure.id,
      label: value,
    });
    if (result?.ok) setMessage(value.trim() ? "已更新段落标记。" : "已清除段落标记。");
  };
  return (
    <aside
      id="music-text-sidebar"
      hidden={!visible}
      className={styles.musicTextSidebar}
      aria-label="音乐文本属性"
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        compositionEndedAt.current = e.timeStamp;
      }}
      onPasteCapture={(e) => {
        if (/[\r\n\u2028\u2029]/u.test(e.clipboardData.getData("text"))) {
          e.preventDefault();
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
        ) {
          e.stopPropagation();
          return;
        }
        if (pending) {
          e.stopPropagation();
          // 确认区域形成临时键盘边界，Tab 不逃到其他修改工具。
          if (e.key === "Tab") {
            const buttons = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="alertdialog"] button:not(:disabled)',
              ),
            );
            const index = buttons.indexOf(e.target as HTMLButtonElement);
            const next =
              buttons[
                (index + (e.shiftKey ? -1 : 1) + buttons.length) %
                  buttons.length
              ];
            if (next) {
              e.preventDefault();
              next.focus({ preventScroll: true });
            }
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setPending(null);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          request({ type: "close" });
        }
        if (
          e.key === "Enter" &&
          e.target === inputRef.current &&
          draft?.target.kind === "lyric"
        ) {
          e.preventDefault();
          apply(!e.shiftKey);
        }
      }}
    >
      <header className={styles.sidebarHeader} inert={!!pending}>
        <div role="tablist" aria-label="音乐文本类型">
          {(["lyric", "chord"] as const).map((tab) => (
            <button
              key={tab}
              id={`music-tab-${tab}`}
              role="tab"
              aria-selected={kind === tab}
              aria-controls="music-text-fields"
              tabIndex={kind === tab ? 0 : -1}
              onClick={() => request({ type: "tab", kind: tab })}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  request({
                    type: "tab",
                    kind:
                      e.key === "Home"
                        ? "lyric"
                        : e.key === "End"
                          ? "chord"
                          : tab === "lyric"
                            ? "chord"
                            : "lyric",
                  });
                }
              }}
            >
              {tab === "lyric" ? <FileText size={19} /> : <Guitar size={20} />}
              {tab === "lyric" ? "编辑歌词" : "和弦编辑"}
            </button>
          ))}
        </div>
        <button
          aria-label="关闭属性面板"
          className={styles.iconButton}
          onClick={() => request({ type: "close" })}
        >
          <X size={21} />
        </button>
      </header>
      <div
        className={styles.sidebarBody}
        id="music-text-fields"
        role="tabpanel"
        aria-labelledby={`music-tab-${kind}`}
        inert={!!pending}
      >
        <p className={styles.sidebarTarget}>
          {validTarget
            ? `目标：第 ${(track?.measures.findIndex((m) => m.id === validTarget.measureId) ?? 0) + 1} 小节，第 ${(measure?.beats.findIndex((b) => b.id === validTarget.beatId) ?? 0) + 1} 拍 · ${sequence ? "连续填词起点" : "仅编辑当前拍"}`
            : "请先选择谱面中的一拍"}
        </p>
        {track && (
          <section className={styles.sidebarSection}>
            <h3>单轨设置</h3>
            <label>
              变调夹（相对品位）
              <input
                aria-label="变调夹"
                type="number"
                min={0}
                max={12}
                defaultValue={track.capo}
                key={`${track.id}:${track.capo}`}
                onBlur={(event) => setTrackCapo(event.currentTarget.value)}
              />
            </label>
            {measure && (
              <label>
                段落标记
                <input
                  aria-label="段落标记"
                  maxLength={32}
                  defaultValue={measure.sectionLabel ?? ""}
                  key={`${measure.id}:${measure.sectionLabel ?? ""}`}
                  onBlur={(event) => setMeasureSectionLabel(event.currentTarget.value)}
                />
              </label>
            )}
          </section>
        )}
        {!draft ? (
          <div className={styles.sidebarEmpty}>
            {kind === "lyric" ? <FileText size={36} /> : <Guitar size={36} />}
            <h3>{kind === "lyric" ? "逐拍编辑歌词" : "编辑和弦与指法"}</h3>
            <p>选择目标拍后，开始编辑{kind === "lyric" ? "歌词" : "和弦"}。</p>
            <button
              ref={editButtonRef}
              disabled={!validTarget}
              className={styles.primaryButton}
              onClick={() =>
                validTarget &&
                request({
                  type: "target",
                  target: { ...validTarget, kind, verse: 1 },
                })
              }
            >
              编辑当前拍
            </button>
          </div>
        ) : kind === "lyric" ? (
          <section className={styles.sidebarSection}>
            <h3>歌词设置</h3>
            <label>
              录入方式
              <select
                aria-label="歌词录入方式"
                value={draft.lyricMode}
                onChange={(e) =>
                  request({
                    type: "mode",
                    mode: e.target.value as MusicTextDraft["lyricMode"],
                  })
                }
              >
                <option value="single">单拍编辑</option>
                <option value="sequence">连续填词</option>
              </select>
            </label>
            <label>
              段号
              <select
                aria-label="歌词段号"
                value={draft.target.verse}
                onChange={(e) =>
                  request({
                    type: "target",
                    target: {
                      ...draft.target,
                      verse: Number(e.target.value) as ILXMLyricVerse,
                    },
                  })
                }
              >
                {[1, 2, 3, 4].map((v) => (
                  <option key={v} value={v}>
                    第 {v} 段
                  </option>
                ))}
              </select>
            </label>
            {sequence ? (
              <>
                <label>
                  连续歌词
                  <textarea
                    ref={sequenceInputRef}
                    aria-label="连续歌词"
                    aria-describedby="lyric-sequence-tips"
                    rows={4}
                    placeholder="例如：风 吹 _ 过 山 谷"
                    value={draft.text}
                    onChange={(e) => {
                      setDraft({ ...draft, text: e.target.value });
                      setInspection(0);
                      setMessage(null);
                    }}
                  />
                </label>
                <div id="lyric-sequence-tips" className={styles.sidebarTip}>
                  <strong>连续填词规则</strong>
                  <p>
                    用空格分词，每项依次对应一拍，休止拍也占一格。多个空格按一个分隔处理。
                  </p>
                  <p>
                    用 <code>_</code> 跳过一拍并保留原歌词，例如{" "}
                    <code>风 _ 过</code>。
                  </p>
                  <p>
                    英文短句按空格拆词；要把 <code>a song</code>{" "}
                    放在同一拍，请切到单拍编辑。
                  </p>
                  <p>先核对下方对应预览，再应用全部。已有歌词不会自动覆盖。</p>
                  <details>
                    <summary>详细规则</summary>
                    半角与全角空格均可分隔，首尾空格忽略；仅独立 _
                    表示跳过。每项最多 64 字，每批最多 256 拍。
                    不接受换行或制表符；谱尾位置不足时整批拒绝；整批可一次撤销。
                  </details>
                </div>
                <label className={styles.overwriteToggle}>
                  <input
                    type="checkbox"
                    checked={draft.allowOverwrite}
                    onChange={(e) =>
                      setDraft({ ...draft, allowOverwrite: e.target.checked })
                    }
                  />
                  允许替换预览中标记的已有歌词（{plan?.overwrites ?? 0} 项）
                </label>
                {plan && (
                  <div className={styles.sequencePreview}>
                    <h4>对应预览 · 写入 {plan.changes} 项</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>位置</th>
                          <th>原词 → 新词</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.rows.map((row) => (
                          <tr
                            key={row.index}
                            aria-selected={inspection === row.index}
                          >
                            <td>
                              <button
                                disabled={!row.target}
                                onClick={() => setInspection(row.index)}
                              >
                                {row.target
                                  ? `${row.measureNumber} 小节 / ${row.beatNumber} 拍${row.rest ? "（休止）" : ""}`
                                  : `第 ${row.index + 1} 项（超出谱尾）`}
                              </button>
                            </td>
                            <td>
                              {row.previous ?? "空"} →{" "}
                              {row.item.kind === "skip"
                                ? "保留原词"
                                : row.item.text}
                            </td>
                            <td>
                              {
                                {
                                  add: "新增",
                                  change: "覆盖",
                                  same: "未变化",
                                  skip: "跳过",
                                  error: "错误",
                                }[row.status]
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <label>
                  歌词
                  <input
                    ref={inputRef}
                    aria-label="歌词文本"
                    value={draft.text}
                    onChange={(e) => {
                      setDraft({ ...draft, text: e.target.value });
                      setMessage(null);
                    }}
                  />
                </label>
                {existing ? (
                  <small>将修改已有歌词。</small>
                ) : (
                  <small>此拍暂无第 {draft.target.verse} 段歌词。</small>
                )}
                <div className={styles.sidebarTip}>
                  Enter 应用并下一拍；Shift+Enter 仅应用。
                  <br />
                  每拍单行，支持第 1–4 段歌词。
                </div>
              </>
            )}
          </section>
        ) : (
          <ChordEditor
            inputRef={inputRef}
            draft={draft.chord}
            onChange={(chord) => {
              setDraft({ ...draft, chord });
              setMessage(null);
            }}
            presetsEnabled={
              !!track &&
              JSON.stringify(track.tuning.strings.map((s) => s.pitch)) ===
                JSON.stringify(["E4", "B3", "G3", "D3", "A2", "E2"])
            }
          />
        )}
      </div>
      <footer className={styles.sidebarFooter}>
        {pending ? (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="draft-confirm-title"
            className={styles.draftConfirmation}
          >
            <h3 id="draft-confirm-title">当前草稿尚未应用</h3>
            <p>请先处理修改，再继续操作。</p>
            <div>
              <button
                disabled={!!issue}
                className={styles.primaryButton}
                onClick={() => {
                  if (apply()) perform(pending);
                }}
              >
                应用后继续
              </button>
              <button
                onClick={() => {
                  if (!composing.current) perform(pending);
                }}
              >
                放弃草稿并继续
              </button>
              <button ref={confirmRef} onClick={() => setPending(null)}>
                继续编辑
              </button>
            </div>
          </div>
        ) : (
          <>
            {issue && (
              <p className={styles.sidebarError} role="alert">
                {issue}
              </p>
            )}
            {message && (
              <p className={styles.sidebarMessage} role="status">
                {message}
              </p>
            )}
            <div className={styles.sidebarHistory}>
              <button
                disabled={!canUndo}
                onClick={() => {
                  if (!composing.current) editorStore.getState().undo();
                }}
              >
                <Undo2 size={16} />
                撤销
              </button>
              <button
                disabled={!canRedo}
                onClick={() => {
                  if (!composing.current) editorStore.getState().redo();
                }}
              >
                <Redo2 size={16} />
                重做
              </button>
              <small>作用于整个乐谱</small>
            </div>
            {draft && (
              <div className={styles.sidebarActions}>
                <button
                  className={styles.dangerButton}
                  disabled={!existing || sequence}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                  删除{kind === "lyric" ? "歌词" : "和弦"}
                </button>
                <button onClick={() => request({ type: "close" })}>取消</button>
                <button
                  disabled={!!issue}
                  className={styles.primaryButton}
                  onClick={() => apply()}
                >
                  {sequence
                    ? `应用全部${draft.allowOverwrite && plan?.overwrites ? `（覆盖 ${plan.overwrites} 项）` : ""}`
                    : "应用"}
                </button>
                {kind === "lyric" && !sequence && (
                  <button
                    disabled={!!issue}
                    className={styles.primaryButton}
                    onClick={() => apply(true)}
                  >
                    应用并下一拍
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </footer>
    </aside>
  );
};
