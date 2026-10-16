"use client";
import { Alert, Button, InputNumber, Select } from "antd";

import {
  findNextNoteOnSameStringInTrack,
  LXMScoreCommandEnum,
  resolveTabCellSelection,
  type ILXMDocument,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
  type ILXMTechniqueDraft,
  type ILXMTechniqueType,
} from "@liuxianmao/lxm-editor";
import { useMemo, useRef, useState } from "react";
import type { EditorCommandAdapter } from "./editor-command-adapter";
import { useEditorRuntime } from "./EditorSessionRuntime";
import { useEditorSessionStore } from "../../stores/editor-store";
import {
  captureEditorVersion,
  sameEditorVersion,
} from "./editor-session-version";
import { createTechniqueTypeController } from "./technique-type-controller";
import { TECHNIQUE_OPTIONS } from "./technique-catalog";
import styles from "./index.module.scss";

interface TechniqueToolbarProps {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  selectedTechniqueId: string | null;
  execute: EditorCommandAdapter;
  blocked: boolean;
  onShowParameters: () => void;
  onSuccess: () => void;
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
  blocked,
  onShowParameters,
  onSuccess,
}: TechniqueToolbarProps) => {
  const { modals } = useEditorRuntime();
  const session = useEditorSessionStore();
  const parameterRegion = useRef<HTMLDivElement>(null);
  const [loadedId, setLoadedId] = useState(selectedTechniqueId);
  const busy = useRef(false);
  const [issue, setIssue] = useState<string | null>(null);
  const reportIssue = (message: string) => {
    setIssue(message);
    setErrorMessage(message);
  };
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
  const [semitones, setSemitones] = useState<1 | 2>(
    selectedTechnique?.type === "bend" ? selectedTechnique.semitones : 2,
  );
  const [trillFret, setTrillFret] = useState(() =>
    selectedTechnique?.type === "trill" ? selectedTechnique.auxiliaryFret : 7,
  );

  // 仅真正换编辑对象时重载；菜单关闭、搜索和断点不重置参数。
  if (loadedId !== selectedTechniqueId) {
    setLoadedId(selectedTechniqueId);
    setType(selectedTechnique?.type ?? "hammerOn");
    setDirection(
      selectedTechnique?.type === "arpeggio"
        ? selectedTechnique.direction === "ascending"
          ? "down"
          : "up"
        : selectedTechnique?.type === "strum" ||
            selectedTechnique?.type === "pickStroke"
          ? selectedTechnique.stroke
          : "down",
    );
    setSemitones(
      selectedTechnique?.type === "bend" ? selectedTechnique.semitones : 2,
    );
    setTrillFret(
      selectedTechnique?.type === "trill" ? selectedTechnique.auxiliaryFret : 7,
    );
  }
  const chooseType = (create: boolean) => {
    if (modals.isOpen()) return;
    const version = captureEditorVersion(session.getState());
    const capturedSelection = JSON.stringify(session.getState().selection);
    const capturedNumbered = JSON.stringify(
      session.getState().numberedSelection,
    );
    const reason = (candidate: ILXMTechniqueType): string | null => {
      if (blocked) return "先完成属性编辑，再修改 TAB。";
      if (!selection) return "请先选择 TAB 目标。";
      const range = resolveTabCellSelection(document, selection);
      if (!range.ok) return range.message;
      if (
        [
          "bend",
          "vibrato",
          "naturalHarmonic",
          "artificialHarmonic",
          "tapping",
          "trill",
        ].includes(candidate) &&
        !findNoteAtCell(document, selection.focus)
      )
        return "需要当前单元格已有音符。";
      if (
        ["hammerOn", "pullOff", "slideUp", "slideDown", "tie"].includes(
          candidate,
        )
      ) {
        const first = findNoteAtCell(document, {
          ...selection.anchor,
          ...range.range.beats[0]!,
        });
        if (!first) return "连接技巧的起始单元格需要已有音符。";
        const last = findNoteAtCell(document, {
          ...selection.focus,
          ...range.range.beats.at(-1)!,
        });
        const track = document.score.tracks.find(
          (item) => item.id === selection.focus.trackId,
        );
        if (
          (!last || last.id === first.id) &&
          (!track || !findNextNoteOnSameStringInTrack(track, first.id))
        )
          return "没有可连接的同弦下一音。";
      }
      if (
        (candidate === "strum" || candidate === "arpeggio") &&
        (range.range.beats.length !== 1 ||
          range.range.startString === range.range.endString)
      )
        return "需要同一拍至少两根弦。";
      return null;
    };
    const picker = createTechniqueTypeController(type, reason);
    let handoff = false;
    modals.open({
      kind: "technique-type",
      title: create ? "添加弹奏技巧" : "更改技巧类型",
      message: "",
      picker,
      version,
      isValid: () =>
        capturedSelection === JSON.stringify(session.getState().selection) &&
        capturedNumbered ===
          JSON.stringify(session.getState().numberedSelection),
      confirm: ({ isCurrent }) => {
        if (
          !isCurrent() ||
          capturedSelection !== JSON.stringify(session.getState().selection) ||
          reason(picker.getSnapshot())
        )
          return false;
        if (create) {
          setLoadedId(null);
          setSelectedTechniqueId(null);
        }
        setType(picker.getSnapshot());
        handoff = true;
        return true;
      },
      afterClose: () => {
        if (
          !handoff ||
          !sameEditorVersion(session.getState(), version) ||
          capturedSelection !== JSON.stringify(session.getState().selection)
        )
          return false;
        onShowParameters();
        return true;
      },
    });
  };
  const buildDraft = (): {
    trackId: string;
    draft: ILXMTechniqueDraft;
  } | null => {
    if (!selection) {
      reportIssue("请先选择技巧的目标音符或 Beat。");
      return null;
    }
    const resolved = resolveTabCellSelection(document, selection);
    if (!resolved.ok) {
      reportIssue(resolved.message);
      return null;
    }
    const track = document.score.tracks.find(
      (candidate) => candidate.id === selection.focus.trackId,
    );
    if (!track) {
      reportIssue("技巧目标轨道不存在。");
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
        reportIssue("该技巧需要 focus 单元格中已有品位音符。");
        return null;
      }
      if (type === "bend")
        return {
          trackId: track.id,
          draft: { type, fromNoteId: focusNote.id, semitones },
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
      // 连接始终按领域时间顺序提交，点击起点或反向框选不会颠倒 from/to。
      const firstBeat = resolved.range.beats[0]!;
      const lastBeat = resolved.range.beats.at(-1)!;
      const anchorNote = findNoteAtCell(document, {
        ...selection.anchor,
        ...firstBeat,
      });
      if (!anchorNote) {
        reportIssue("连接技巧的起始单元格必须已有品位音符。");
        return null;
      }
      const explicitTarget = findNoteAtCell(document, {
        ...selection.focus,
        ...lastBeat,
      });
      const nextTarget = findNextNoteOnSameStringInTrack(track, anchorNote.id);
      const targetNote =
        explicitTarget && explicitTarget.id !== anchorNote.id
          ? explicitTarget
          : nextTarget?.note;
      if (!targetNote) {
        reportIssue("没有找到可连接的同弦下一音，请调整选区。");
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
        reportIssue("扫弦和琶音需要在同一 Beat 内选择至少两根弦线。");
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
      reportIssue("区间技巧需要至少一个有效 Beat。");
      return null;
    }
    return {
      trackId: track.id,
      draft: { type, fromBeatId, toBeatId },
    };
  };

  const submit = async () => {
    if (blocked || busy.current) return;
    setIssue(null);
    const target = buildDraft();
    if (!target) return;
    busy.current = true;
    const outcome = selectedTechniqueId
      ? await execute({
          type: LXMScoreCommandEnum.UpdateTechnique,
          trackId: target.trackId,
          techniqueId: selectedTechniqueId,
          technique: target.draft,
        })
      : await execute({
          type: LXMScoreCommandEnum.AddTechnique,
          trackId: target.trackId,
          technique: target.draft,
        });
    busy.current = false;
    if (outcome.status !== "applied" && outcome.status !== "noop") {
      if (outcome.status !== "needs-impact" && outcome.status !== "cancelled")
        setIssue(outcome.message);
      return;
    }
    const result = outcome.result;
    if (result.changed && !selectedTechniqueId) {
      const created = result.document.score.tracks
        .find((track) => track.id === target.trackId)
        ?.techniques.at(-1);
      if (created) setSelectedTechniqueId(created.id);
    }
    onSuccess();
  };

  const remove = async () => {
    if (blocked || busy.current) return;
    if (!selectedTechniqueId || !selectedTechnique) return;
    const track = document.score.tracks.find((candidate) =>
      candidate.techniques.some(
        (technique) => technique.id === selectedTechniqueId,
      ),
    );
    if (!track) return;
    busy.current = true;
    const outcome = await execute({
      type: LXMScoreCommandEnum.RemoveTechnique,
      trackId: track.id,
      techniqueId: selectedTechniqueId,
    });
    busy.current = false;
    if (outcome.status === "applied" || outcome.status === "noop") {
      setSelectedTechniqueId(null);
      onSuccess();
    }
  };

  return (
    <div className={styles.toolMenu} aria-label="吉他技巧工具">
      <Button
        data-tool-action="technique-actions"
        block
        onClick={() => chooseType(true)}
      >
        新增技巧：选择全部 16 类…
      </Button>
      {selectedTechnique && (
        <Button block onClick={() => chooseType(false)}>
          更改当前技巧类型…
        </Button>
      )}
      <div
        ref={parameterRegion}
        className={styles.toolMenu}
        data-technique-parameters
      >
        <label className={styles.toolbarField}>
          <span>技巧</span>
          <Select
            style={{ minWidth: 110 }}
            aria-label="选择吉他技巧"
            value={type}
            onChange={(value) => setType(value as ILXMTechniqueType)}
            options={[
              ...TECHNIQUE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
          />
        </label>
        {(type === "strum" || type === "arpeggio" || type === "pickStroke") && (
          <label className={styles.toolbarField}>
            <span>{type === "arpeggio" ? "音高方向" : "演奏方向"}</span>
            <Select
              style={{ minWidth: 110 }}
              aria-label="选择技巧方向"
              value={direction}
              onChange={(value) => setDirection(value as "down" | "up")}
              options={[
                { value: "down", label: type === "arpeggio" ? "上行" : "下" },
                { value: "up", label: type === "arpeggio" ? "下行" : "上" },
              ]}
            />
          </label>
        )}
        {type === "bend" && (
          <label>
            推弦幅度
            <Select
              aria-label="推弦幅度"
              value={semitones}
              onChange={(value) => setSemitones(Number(value) as 1 | 2)}
              options={[
                { value: 1, label: "半音" },
                { value: 2, label: "全音" },
              ]}
            />
          </label>
        )}
        {type === "trill" && (
          <label className={styles.toolbarField}>
            <span>辅助品位</span>
            <InputNumber
              aria-label="辅助品位"
              style={{ width: 88 }}
              min={0}
              max={24}
              value={Number.isFinite(trillFret) ? trillFret : null}
              onChange={(value) => setTrillFret(value ?? Number.NaN)}
              changeOnBlur={false}
            />
          </label>
        )}
        <Button
          htmlType="button"
          size="middle"
          disabled={
            blocked ||
            !selection ||
            (type === "trill" &&
              (!Number.isInteger(trillFret) || trillFret < 0 || trillFret > 24))
          }
          onClick={() => void submit()}
        >
          {selectedTechniqueId ? "应用更改" : "添加技巧"}
        </Button>
        <Button
          htmlType="button"
          size="middle"
          disabled={blocked || !selectedTechniqueId}
          onClick={() => void remove()}
        >
          删除技巧
        </Button>
        {issue && <Alert type="error" showIcon title={issue} />}
        {type === "trill" &&
          (!Number.isInteger(trillFret) || trillFret < 0 || trillFret > 24) && (
            <Alert type="error" showIcon title="辅助品位须为 0–24 的整数。" />
          )}
        {selectedTechnique && (
          <span className={styles.techniqueSelectionLabel}>
            已选：
            {TECHNIQUE_OPTIONS.find(
              (item) => item.value === selectedTechnique.type,
            )?.label ?? selectedTechnique.type}
          </span>
        )}
      </div>
    </div>
  );
};
