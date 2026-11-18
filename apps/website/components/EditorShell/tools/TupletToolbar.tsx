"use client";
import { Button } from "antd";

import {
  LXM_TUPLET_RATIOS,
  LXMScoreCommandEnum,
  resolveTupletSelection,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { useMemo, useRef, useState } from "react";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { MusicAssetIcon } from "../../MusicAssetIcon";
import type { MusicControlIcon } from "../../../assets/svg/svg-assets-manifest";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";
import { formatTupletLabel } from "../shared/tuplet-label";
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
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (command: ILXMScoreCommand) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await execute(command);
      if (result.status === "applied" || result.status === "noop") onSuccess();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className={editorToolPanelStyles.toolMenu} role="group" aria-label="连音组工具">
      <span>连音组</span>
      {LXM_TUPLET_RATIOS.map((ratio) => {
        const label = `${ratio.actual}:${ratio.normal}`;
        const reason = blocked
          ? "先完成属性编辑，再修改 TAB。"
          : busy
            ? "正在提交，请稍候。"
            : !range || range.beatIds.length !== ratio.actual
              ? `需要同小节内连续 ${ratio.actual} 拍。`
              : range.partiallyOverlapsTuplet
                ? "请扩大选区以覆盖完整的原连音组"
                : undefined;
        return (
          <Button
            key={label}
            data-tool-action={label === "2:3" ? "tuplet-actions" : undefined}
            size="middle"
            htmlType="button"
            aria-label={formatTupletLabel(ratio)}
            aria-description={reason}
            aria-pressed={
              range?.group?.ratio.actual === ratio.actual &&
              range.group.ratio.normal === ratio.normal
            }
            disabled={!!reason}
            onClick={() => {
              if (range) void run({
                type: LXMScoreCommandEnum.SetTuplet,
                trackId: range.trackId,
                measureId: range.measureId,
                startBeatId: range.startBeatId,
                endBeatId: range.endBeatId,
                ratio,
              });
            }}
          >
            <MusicAssetIcon
              assetId={ICONS[label]!}
              className={editorToolPanelStyles.toolbarIcon}
            />
            应用{formatTupletLabel(ratio)}
          </Button>
        );
      })}
      <Button
        htmlType="button"
        size="middle"
        aria-label="删除连音组"
        disabled={blocked || busy || !range?.group}
        onClick={() => {
          if (range?.group) void run({
            type: LXMScoreCommandEnum.RemoveTuplet,
            trackId: range.trackId,
            measureId: range.measureId,
            tupletId: range.group.id,
          });
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
