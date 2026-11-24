"use client";

import { Button } from "antd";
import type { ILXMDocument } from "@liuxianmao/lxm-editor";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "../../stores/editor-store";
import { captureEditorVersion } from "../session/editor-session-version";
import { NewScoreModal } from "./NewScoreModal";
import { ScoreFileDialog } from "./ScoreFileDialog";
import { ScoreImportModal } from "./ScoreImportModal";
import { SCORE_FILE_LABEL, scoreFileName } from "./score-file";
import type { useScoreFileFlow } from "./use-score-file-flow";
import styles from "./score-file.module.scss";

const exportLabel = `导出${SCORE_FILE_LABEL}`;

export function ScoreFilePanels({ flow, session, document }: {
  flow: ReturnType<typeof useScoreFileFlow>;
  session: StoreApi<EditorStoreState>;
  document: ILXMDocument | null;
}) {
  const scoreTitle = document?.score.title ?? "";
  const title = scoreTitle.trim() || "未命名曲谱";
  return <>
    {flow.panel === "new" && <NewScoreModal onCancel={flow.cancel} onCreate={(candidate) => {
      flow.requestReplacement(candidate, "new", captureEditorVersion(session.getState()));
    }} />}
    {flow.panel === "import" && <ScoreImportModal session={session} nativeFile={flow.nativeImport} canContinue={flow.checkDrafts} onClose={flow.cancel} onOpen={(candidate, name, version, sourceVersion) => {
      flow.requestReplacement(candidate, "file", version, name, sourceVersion);
    }} />}
    {flow.panel === "json" && <ScoreFileDialog title={exportLabel} onClose={flow.cancel}>
      <dl><dt>曲名</dt><dd>{title}</dd><dt>文件名</dt><dd>{scoreFileName(scoreTitle)}</dd></dl>
      <p>下次导入此文件即可继续编辑。</p>
      {flow.error && <p role="alert" className={styles.error}>{flow.error}</p>}
      <div className={styles.actions}>
        <Button data-initial-focus onClick={flow.cancel}>取消</Button>
        <Button type="primary" onClick={() => flow.exportJson(false)}>{exportLabel}</Button>
      </div>
    </ScoreFileDialog>}
    {flow.pending && flow.host && <ScoreFileDialog title="离开前保存曲谱？" onClose={flow.cancel} busy={flow.saving}>
      <p>即将{flow.pending.label}。「{title}」有未保存的内容。</p>
      {flow.error && <p role="alert" className={styles.error}>{flow.error}</p>}
      <div className={styles.actions}>
        <Button data-initial-focus disabled={flow.saving} onClick={flow.cancel}>取消</Button>
        <Button danger disabled={flow.saving} onClick={() => flow.finishLeave(true)}>不保存</Button>
        <Button type="primary" loading={flow.saving} onClick={() => void flow.saveNative(false, true)}>保存并继续</Button>
      </div>
    </ScoreFileDialog>}
    {flow.pending && !flow.host && <ScoreFileDialog title="离开前导出曲谱？" onClose={flow.cancel}>
      <p>即将{flow.pending.label}。</p>
      {flow.downloaded
        ? <p role="status">已发起{SCORE_FILE_LABEL}下载「{flow.downloaded}」。请确认文件已下载，再继续。</p>
        : <p>「{title}」还有未导出的内容。下载{SCORE_FILE_LABEL}后，下次可导入继续编辑。</p>}
      {flow.error && <p role="alert" className={styles.error}>{flow.error}</p>}
      <div className={styles.actions}>
        <Button data-initial-focus onClick={flow.cancel}>继续编辑</Button>
        {flow.downloaded ? <>
          <Button onClick={() => flow.exportJson(true)}>重新下载</Button>
          <Button type="primary" onClick={() => flow.finishLeave(false)}>已下载，继续</Button>
        </> : <>
          <Button danger onClick={() => flow.finishLeave(true)}>不导出并继续</Button>
          <Button type="primary" onClick={() => flow.exportJson(true)}>{exportLabel}</Button>
        </>}
      </div>
    </ScoreFileDialog>}
  </>;
}
