"use client";
import { Button, Tooltip } from "antd";

import {
  LXM_TUPLET_RATIOS,
  LXMScoreCommandEnum,
  resolveTupletSelection,
  type ILXMDocument,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { useMemo } from "react";
import type { EditorCommandAdapter } from "./editor-command-adapter";
import { MusicAssetIcon } from "../MusicAssetIcon";
import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";
import styles from "./index.module.scss";
const ICONS: Record<string, MusicControlIcon> = {
  "2:3": "duplet",
  "3:2": "triplet",
  "4:3": "quadruplet",
  "5:4": "quintupletFiveFour",
  "5:3": "quintupletFiveThree",
  "6:4": "sextuplet",
};
/** 状态完全由文档与选区派生；持久化编辑统一交给核心命令。 */
export const TupletToolbar = ({
  document,
  selection,
  execute,
  blocked = false,
  onSuccess,
}: {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  execute: EditorCommandAdapter;
  blocked?: boolean;
  onSuccess: () => void;
}) => {
  const range = useMemo(
    () => resolveTupletSelection(document, selection),
    [document, selection],
  );
  return (
    <div className={styles.toolMenu} role="group" aria-label="连音组工具">
      <span>连音组</span>
      {LXM_TUPLET_RATIOS.map((ratio) => {
        const label = `${ratio.actual}:${ratio.normal}`;
        const unavailable =
          blocked || !range || range.beatIds.length !== ratio.actual;
        const reason = blocked
          ? "先完成属性编辑，再修改 TAB。"
          : `需要同小节内连续 ${ratio.actual} 拍。`;
        return (
          <Tooltip key={label} title={unavailable ? reason : undefined}>
            <span
              tabIndex={unavailable ? 0 : undefined}
              aria-label={unavailable ? reason : undefined}
            >
              <Button
                data-tool-action={
                  label === "2:3" ? "tuplet-actions" : undefined
                }
                size="middle"
                htmlType="button"
                aria-label={`连音 ${label}`}
                title={`${ratio.actual} 个同值音符占 ${ratio.normal} 个音符的时间`}
                aria-pressed={
                  range?.group?.ratio.actual === ratio.actual &&
                  range.group.ratio.normal === ratio.normal
                }
                disabled={
                  blocked || !range || range.beatIds.length !== ratio.actual
                }
                onClick={async () => {
                  if (range) {
                    const result = await execute({
                      type: LXMScoreCommandEnum.SetTuplet,
                      trackId: range.trackId,
                      measureId: range.measureId,
                      startBeatId: range.startBeatId,
                      endBeatId: range.endBeatId,
                      ratio,
                    });
                    if (result.status === "applied" || result.status === "noop")
                      onSuccess();
                  }
                }}
              >
                <MusicAssetIcon
                  assetId={ICONS[label]!}
                  className={styles.toolbarIcon}
                />
                应用 {label}
              </Button>
            </span>
          </Tooltip>
        );
      })}
      <Button
        htmlType="button"
        size="middle"
        aria-label="删除连音组"
        disabled={blocked || !range?.group}
        onClick={async () => {
          if (range?.group) {
            const result = await execute({
              type: LXMScoreCommandEnum.RemoveTuplet,
              trackId: range.trackId,
              measureId: range.measureId,
              tupletId: range.group.id,
            });
            if (result.status === "applied" || result.status === "noop")
              onSuccess();
          }
        }}
      >
        删除连音组
      </Button>
      <span>
        {range ? `已选 ${range.beatIds.length} 拍` : "请选择同小节内连续节拍"}
      </span>
    </div>
  );
};
