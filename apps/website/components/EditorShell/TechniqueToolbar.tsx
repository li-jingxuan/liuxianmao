"use client";

import {
  findNextNoteOnSameStringInTrack,
  LXMScoreCommandEnum,
  resolveTabCellSelection,
  type ILXMApplyScoreCommandResult,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
  type ILXMTechniqueDraft,
  type ILXMTechniqueType,
} from "@liuxianmao/lxm-editor";
import { useMemo, useState } from "react";
import styles from "./index.module.scss";

const TECHNIQUE_OPTIONS: { value: ILXMTechniqueType; label: string }[] = [
  { value: "hammerOn", label: "击弦 H" },
  { value: "pullOff", label: "勾弦 P" },
  { value: "slideUp", label: "上滑音" },
  { value: "slideDown", label: "下滑音" },
  { value: "tie", label: "延音线" },
  { value: "bend", label: "全音推弦" },
  { value: "vibrato", label: "颤音" },
  { value: "naturalHarmonic", label: "自然泛音" },
  { value: "artificialHarmonic", label: "人工泛音" },
  { value: "tapping", label: "点弦 T" },
  { value: "trill", label: "颤音奏 tr" },
  { value: "strum", label: "扫弦" },
  { value: "arpeggio", label: "琶音" },
  { value: "pickStroke", label: "拨片方向" },
  { value: "palmMute", label: "手掌闷音 P.M." },
  { value: "letRing", label: "Let Ring" },
];

interface TechniqueToolbarProps {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  selectedTechniqueId: string | null;
  execute: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  setSelectedTechniqueId: (techniqueId: string | null) => void;
  setErrorMessage: (message: string | null) => void;
}

/** 从稳定单元格引用解析 Note；空单元格返回 null，由工具给出明确反馈。 */
const findNoteAtCell = (
  document: ILXMDocument,
  reference: ILXMTabCellReference,
) =>
  document.score.tracks
    .find((track) => track.id === reference.trackId)
    ?.measures.find((measure) => measure.id === reference.measureId)
    ?.beats.find((beat) => beat.id === reference.beatId)
    ?.notes.find((note) => note.string === reference.string) ?? null;

/**
 * 技巧工具只负责把当前稳定 selection 翻译成命令草稿。
 *
 * Note/Beat 是否满足音乐规则仍由核心命令最终裁决；页面在这里做的检查仅用于给
 * 用户更即时、可读的错误提示，不能替代 technique-rules.ts。
 */
export const TechniqueToolbar = ({
  document,
  selection,
  selectedTechniqueId,
  execute,
  setSelectedTechniqueId,
  setErrorMessage,
}: TechniqueToolbarProps) => {
  const selectedTechnique = useMemo(
    () =>
      document.score.tracks
        .flatMap((track) => track.techniques)
        .find((technique) => technique.id === selectedTechniqueId) ?? null,
    [document, selectedTechniqueId],
  );
  const [type, setType] = useState<ILXMTechniqueType>(
    selectedTechnique?.type ?? "hammerOn",
  );
  const [direction, setDirection] = useState<"down" | "up">(() => {
    if (selectedTechnique?.type === "arpeggio")
      return selectedTechnique.direction === "ascending" ? "down" : "up";
    if (
      selectedTechnique?.type === "strum" ||
      selectedTechnique?.type === "pickStroke"
    )
      return selectedTechnique.stroke;
    return "down";
  });
  const [trillFret, setTrillFret] = useState(() =>
    selectedTechnique?.type === "trill"
      ? selectedTechnique.auxiliaryFret
      : 7,
  );

  const buildDraft = (): {
    trackId: string;
    draft: ILXMTechniqueDraft;
  } | null => {
    if (!selection) {
      setErrorMessage("请先选择技巧的目标音符或 Beat。");
      return null;
    }
    const resolved = resolveTabCellSelection(document, selection);
    if (!resolved.ok) {
      setErrorMessage(resolved.message);
      return null;
    }
    const track = document.score.tracks.find(
      (candidate) => candidate.id === selection.focus.trackId,
    );
    if (!track) {
      setErrorMessage("技巧目标轨道不存在。");
      return null;
    }
    const focusNote = findNoteAtCell(document, selection.focus);

    if (
      type === "bend" ||
      type === "vibrato" ||
      type === "naturalHarmonic" ||
      type === "artificialHarmonic" ||
      type === "tapping" ||
      type === "trill"
    ) {
      if (!focusNote) {
        setErrorMessage("该技巧需要 focus 单元格中已有品位音符。");
        return null;
      }
      if (type === "bend")
        return {
          trackId: track.id,
          draft: { type, fromNoteId: focusNote.id, semitones: 2 },
        };
      if (type === "trill")
        return {
          trackId: track.id,
          draft: {
            type,
            fromNoteId: focusNote.id,
            auxiliaryFret: trillFret,
          },
        };
      return {
        trackId: track.id,
        draft: { type, fromNoteId: focusNote.id },
      };
    }

    if (
      type === "hammerOn" ||
      type === "pullOff" ||
      type === "slideUp" ||
      type === "slideDown" ||
      type === "tie"
    ) {
      const anchorNote = findNoteAtCell(document, selection.anchor);
      if (!anchorNote) {
        setErrorMessage("连接技巧的起始单元格必须已有品位音符。");
        return null;
      }
      const explicitTarget = findNoteAtCell(document, selection.focus);
      const nextTarget = findNextNoteOnSameStringInTrack(track, anchorNote.id);
      const targetNote =
        explicitTarget && explicitTarget.id !== anchorNote.id
          ? explicitTarget
          : nextTarget?.note;
      if (!targetNote) {
        setErrorMessage("没有找到可连接的同弦下一音，请调整选区。");
        return null;
      }
      return {
        trackId: track.id,
        draft: {
          type,
          fromNoteId: anchorNote.id,
          toNoteId: targetNote.id,
        },
      };
    }

    if (type === "strum" || type === "arpeggio") {
      if (
        resolved.range.beats.length !== 1 ||
        resolved.range.startString === resolved.range.endString
      ) {
        setErrorMessage("扫弦和琶音需要在同一 Beat 内选择至少两根弦线。");
        return null;
      }
      const stringRange = {
        minString: resolved.range.startString,
        maxString: resolved.range.endString,
      };
      if (type === "strum")
        return {
          trackId: track.id,
          draft: {
            type,
            beatId: selection.focus.beatId,
            ...stringRange,
            stroke: direction,
          },
        };
      return {
        trackId: track.id,
        draft: {
          type,
          beatId: selection.focus.beatId,
          ...stringRange,
          direction: direction === "down" ? "ascending" : "descending",
        },
      };
    }
    if (type === "pickStroke")
      return {
        trackId: track.id,
        draft: { type, beatId: selection.focus.beatId, stroke: direction },
      };

    const ordered = resolved.range.beats;
    const fromBeatId = ordered[0]?.beatId;
    const toBeatId = ordered.at(-1)?.beatId;
    if (!fromBeatId || !toBeatId) {
      setErrorMessage("区间技巧需要至少一个有效 Beat。");
      return null;
    }
    return {
      trackId: track.id,
      draft: { type, fromBeatId, toBeatId },
    };
  };

  const submit = () => {
    const target = buildDraft();
    if (!target) return;
    const result =
      selectedTechniqueId
        ? execute({
            type: LXMScoreCommandEnum.UpdateTechnique,
            trackId: target.trackId,
            techniqueId: selectedTechniqueId,
            technique: target.draft,
          })
        : execute({
            type: LXMScoreCommandEnum.AddTechnique,
            trackId: target.trackId,
            technique: target.draft,
          });
    if (result?.ok && result.changed && !selectedTechniqueId) {
      const created = result.document.score.tracks
        .find((track) => track.id === target.trackId)
        ?.techniques.at(-1);
      if (created) setSelectedTechniqueId(created.id);
    }
  };

  const remove = () => {
    if (!selectedTechniqueId || !selectedTechnique) return;
    const track = document.score.tracks.find((candidate) =>
      candidate.techniques.some(
        (technique) => technique.id === selectedTechniqueId,
      ),
    );
    if (!track) return;
    const result = execute({
      type: LXMScoreCommandEnum.RemoveTechnique,
      trackId: track.id,
      techniqueId: selectedTechniqueId,
    });
    if (result?.ok) setSelectedTechniqueId(null);
  };

  return (
    <div className={styles.techniqueToolbar} aria-label="吉他技巧工具">
      <span className={styles.toolbarSeparator} aria-hidden="true" />
      <label className={styles.toolbarField}>
        <span>技巧</span>
        <select
          className={styles.toolbarSelect}
          aria-label="选择吉他技巧"
          value={type}
          onChange={(event) =>
            setType(event.currentTarget.value as ILXMTechniqueType)
          }
        >
          {TECHNIQUE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {(type === "strum" || type === "arpeggio" || type === "pickStroke") && (
        <label className={styles.toolbarField}>
          <span>{type === "arpeggio" ? "音高方向" : "演奏方向"}</span>
          <select
            className={styles.toolbarSelect}
            aria-label="选择技巧方向"
            value={direction}
            onChange={(event) =>
              setDirection(event.currentTarget.value as "down" | "up")
            }
          >
            <option value="down">{type === "arpeggio" ? "上行" : "下"}</option>
            <option value="up">{type === "arpeggio" ? "下行" : "上"}</option>
          </select>
        </label>
      )}
      {type === "trill" && (
        <label className={styles.toolbarField}>
          <span>辅助品位</span>
          <input
            className={styles.toolbarNumberInput}
            type="number"
            min={0}
            max={24}
            value={trillFret}
            onChange={(event) =>
              setTrillFret(Number(event.currentTarget.value))
            }
          />
        </label>
      )}
      <button
        type="button"
        className={styles.toolbarButton}
        disabled={!selection}
        onClick={submit}
      >
        {selectedTechniqueId ? "应用更改" : "添加技巧"}
      </button>
      <button
        type="button"
        className={styles.toolbarButton}
        disabled={!selectedTechniqueId}
        onClick={remove}
      >
        删除技巧
      </button>
      {selectedTechnique && (
        <span className={styles.techniqueSelectionLabel}>
          已选：{selectedTechnique.type}
        </span>
      )}
    </div>
  );
};
