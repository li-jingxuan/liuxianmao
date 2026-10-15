"use client";
import { useMemo, useRef, useState } from "react";
import {
  LXMScoreCommandEnum,
  resolveTabCellSelection,
  planBeatPaste,
  type ILXMBeatPasteCommand,
} from "@liuxianmao/lxm-editor";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import styles from "./index.module.scss";
import { useEditorDraftRecords } from "./EditorSessionRuntime";
import { captureEditorVersion } from "./editor-session-version";
/** 工具仅把稳定选区转为命令；预览与执行共享核心规划，不在页面计算时值。 */
export const BeatToolbar = ({ beforeAction }: { beforeAction: () => void }) => {
  const store = useEditorSessionStore(),
    document = useEditorStore((s) => s.document),
    selection = useEditorStore((s) => s.selection),
    hasClipboard = useEditorStore((s) => s.hasBeatClipboard);
  const [mode, setMode] = useState<"insert" | "overwrite">("insert"),
    [layers, setLayers] = useState<"tab" | "both">("both"),
    [preview, setPreview] = useState<{
      command: ILXMBeatPasteCommand;
      summary: string;
      required: boolean;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState<string | null>(null);

  const range = useMemo(() => {
    if (!document || !selection) return null;
    const r = resolveTabCellSelection(document, selection);
    return r.ok ? r.range : null;
  }, [document, selection]);
  const sameMeasure =
    range &&
    range.beats.every((b) => b.measureId === range.beats[0]!.measureId);
  const target = selection?.focus;
  const previewRef = useRef<HTMLDivElement>(null);
  const action = (run: () => void) => {
    beforeAction();
    run();
  };
  const prepare = () => {
    if (!document || !target) return;
    const clipboard = store.getState().getBeatClipboard();
    if (!clipboard) return;
    const plan = planBeatPaste(document, { ...target, mode }, clipboard);
    if (!plan.ok) {
      store.getState().setErrorMessage(plan.message);
      setPreview(null);
      return;
    }
    setConfirmed(false);
    setPreview({
      command: {
        type: LXMScoreCommandEnum.PasteBeats,
        ...target,
        mode,
        clipboard,
        allowOverwrite: false,
        expectedConfirmationKey: plan.confirmationKey,
      },
      required: plan.requiresConfirmation,
      summary: `${mode === "insert" ? "插入" : "覆盖"} ${plan.count} 拍（${clipboard.layers === "both" ? "双谱" : "六线谱"}，${plan.durationLabel}）；替换 ${plan.replacedBeats} 拍、${plan.replacedLyrics} 项歌词、${plan.replacedNumbered} 项简谱、${plan.replacedChords} 个和弦，清理 ${plan.removedTechniques} 个六线谱技巧、${plan.removedNumberedMarks} 个简谱标记。`,
    });
  };
  const applyPreview = () => {
    if (!preview || (preview.required && !confirmed)) return false;
    beforeAction();
    const result = store
      .getState()
      .execute({ ...preview.command, allowOverwrite: confirmed });
    if (!result?.ok) return false;
    setPreview(null);
    setConfirmed(false);
    setNotice("已粘贴，可撤销。");
    return true;
  };
  useEditorDraftRecords(
    preview
      ? [
          {
            id: `beatPaste:${preview.command.expectedConfirmationKey}`,
            kind: "beatPaste",
            targetKey: preview.command.expectedConfirmationKey ?? "",
            label: "拍点粘贴预览",
            dirty: true,
            composing: false,
            canApply: !preview.required || confirmed,
            error: null,
            version: captureEditorVersion(store.getState()),
            focus: () => {
              previewRef.current?.focus();
              return !!previewRef.current;
            },
            apply: ({ isCurrent }) =>
              isCurrent() ? (applyPreview() ? "applied" : "blocked") : "stale",
            discard: () => {
              setPreview(null);
              setConfirmed(false);
              return true;
            },
          },
        ]
      : [],
  );
  return (
    <div className={styles.techniqueToolbar} aria-label="拍点结构与复用">
      <button
        className={styles.toolbarButton}
        disabled={!target || !range || range.beats.length !== 1}
        title="单拍等分，数字音符保持为 Tie 持续音"
        onClick={() =>
          action(() => {
            if (target)
              store
                .getState()
                .execute({ type: LXMScoreCommandEnum.SplitBeat, ...target });
          })
        }
      >
        拆分拍点
      </button>
      <button
        className={styles.toolbarButton}
        disabled={!sameMeasure || !range || range.beats.length < 2}
        title="合并同小节休止或完整 Tie 持续音"
        onClick={() =>
          action(() => {
            if (target && range)
              store.getState().execute({
                type: LXMScoreCommandEnum.MergeBeats,
                ...target,
                startBeatId: range.beats[0]!.beatId,
                endBeatId: range.beats.at(-1)!.beatId,
              });
          })
        }
      >
        合并拍点
      </button>
      <label className={styles.toolbarField}>
        复制范围
        <select
          className={styles.toolbarSelect}
          aria-label="拍点复制谱层"
          value={layers}
          onChange={(e) => setLayers(e.target.value as typeof layers)}
        >
          <option value="both">双谱</option>
          <option value="tab">仅六线谱</option>
        </select>
      </label>
      <button
        className={styles.toolbarButton}
        disabled={!sameMeasure || !range}
        title="同小节连续拍点，含所有弦、歌词、简谱与完整技巧"
        onClick={() =>
          action(() => {
            if (
              target &&
              range &&
              store.getState().copyBeats({
                ...target,
                startBeatId: range.beats[0]!.beatId,
                endBeatId: range.beats.at(-1)!.beatId,
                layers,
              })
            )
              setNotice(`已复制 ${range.beats.length} 拍（含全部弦）。`);
          })
        }
      >
        复制拍点
      </button>
      <label className={styles.toolbarField}>
        粘贴方式
        <select
          className={styles.toolbarSelect}
          aria-label="拍点粘贴方式"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setPreview(null);
            setConfirmed(false);
          }}
        >
          <option value="insert">在目标拍前插入</option>
          <option value="overwrite">从目标拍覆盖</option>
        </select>
      </label>
      <button
        className={styles.toolbarButton}
        disabled={!hasClipboard || !target}
        onClick={() => action(prepare)}
      >
        预览粘贴
      </button>
      {preview && (
        <div
          ref={previewRef}
          tabIndex={-1}
          className={styles.beatPastePreview}
          role="group"
          aria-label="粘贴预览"
        >
          <span>{preview.summary}</span>
          {preview.required && (
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              确认覆盖
            </label>
          )}
          <button
            className={styles.toolbarButton}
            disabled={preview.required && !confirmed}
            onClick={applyPreview}
          >
            应用粘贴
          </button>
          <button
            className={styles.toolbarButton}
            onClick={() => setPreview(null)}
          >
            取消预览
          </button>
        </div>
      )}
      {(notice || hasClipboard) && (
        <span role="status">
          {notice ??
            `已复制 ${store.getState().getBeatClipboard()?.content.beats.length ?? 0} 拍（含全部弦）。`}
        </span>
      )}
    </div>
  );
};
