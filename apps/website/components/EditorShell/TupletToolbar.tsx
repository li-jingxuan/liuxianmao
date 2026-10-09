"use client";
import {
  LXM_TUPLET_RATIOS,
  LXMScoreCommandEnum,
  resolveTupletSelection,
  type ILXMDocument,
  type ILXMTabCellSelection,
  type ILXMScoreCommand,
  type ILXMApplyScoreCommandResult,
} from "@liuxianmao/lxm-editor";
import { useMemo } from "react";
import styles from "./index.module.scss";
const ICONS: Record<string, string> = {
  "2:3": "duplet",
  "3:2": "triplet",
  "4:3": "quadruplet",
  "5:4": "quintuplet-5-4",
  "5:3": "quintuplet-5-3",
  "6:4": "sextuplet",
};
/** 状态完全由文档与选区派生；持久化编辑统一交给核心命令。 */
export const TupletToolbar = ({
  document,
  selection,
  execute,
}: {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  execute: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
}) => {
  const range = useMemo(
    () => resolveTupletSelection(document, selection),
    [document, selection],
  );
  return (
    <div className={styles.tupletToolbar} role="group" aria-label="连音组工具">
      <span>连音组</span>
      {LXM_TUPLET_RATIOS.map((ratio) => {
        const label = `${ratio.actual}:${ratio.normal}`;
        return (
          <button
            key={label}
            className={styles.toolbarButton}
            type="button"
            aria-label={`连音 ${label}`}
            title={`${ratio.actual} 个同值音符占 ${ratio.normal} 个音符的时间`}
            aria-pressed={
              range?.group?.ratio.actual === ratio.actual &&
              range.group.ratio.normal === ratio.normal
            }
            disabled={!range || range.beatIds.length !== ratio.actual}
            onClick={() => {
              if (range)
                execute({
                  type: LXMScoreCommandEnum.SetTuplet,
                  trackId: range.trackId,
                  measureId: range.measureId,
                  startBeatId: range.startBeatId,
                  endBeatId: range.endBeatId,
                  ratio,
                });
            }}
          >
            {/* 六种既有资产配合完整比例，两个五连音始终可区分。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/assets/svg/music-controls/${ICONS[label]}.svg`}
              width="22"
              height="22"
              alt=""
            />
            {label}
          </button>
        );
      })}
      <button
        type="button"
        className={styles.toolbarButton}
        aria-label="删除连音组"
        disabled={!range?.group}
        onClick={() => {
          if (range?.group)
            execute({
              type: LXMScoreCommandEnum.RemoveTuplet,
              trackId: range.trackId,
              measureId: range.measureId,
              tupletId: range.group.id,
            });
        }}
      >
        删除连音组
      </button>
      <span>
        {range ? `已选 ${range.beatIds.length} 拍` : "请选择同小节内连续节拍"}
      </span>
    </div>
  );
};
