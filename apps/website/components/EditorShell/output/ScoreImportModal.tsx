"use client";

import { Button } from "antd";
import { readScoreTonality, type ILXMDocument } from "@liuxianmao/lxm-editor";
import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "../../../stores/editor-store";
import { captureEditorVersion, sameEditorVersion, type EditorSessionVersion } from "../session/editor-session-version";
import { displaySignature } from "./new-score";
import { ScoreFileDialog } from "./ScoreFileDialog";
import { decodeScoreFile, SCORE_FILE_EXTENSION, SCORE_FILE_LABEL, SCORE_FILE_MAX_BYTES } from "./score-file";
import styles from "./score-file.module.scss";

type Candidate = {
  name: string;
  document: ILXMDocument;
  sourceVersion?: number;
  version: EditorSessionVersion;
};

export function ScoreImportModal({ session, canContinue, onClose, onOpen }: {
  session: StoreApi<EditorStoreState>;
  canContinue: () => boolean;
  onClose: () => void;
  onOpen: (document: ILXMDocument, filename: string, version: EditorSessionVersion) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const canContinueRef = useRef(canContinue);
  const request = useRef(0);
  const reading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<Candidate>();
  const [errors, setErrors] = useState<string[]>([]);
  const [errorSummary, setErrorSummary] = useState("");

  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => { canContinueRef.current = canContinue; }, [canContinue]);

  const readFile = async (files: FileList | undefined) => {
    if (!files?.length || reading.current || !canContinueRef.current()) return;
    setCandidate(undefined);
    setErrors([]);
    setErrorSummary("");
    if (files.length !== 1) { setErrors([`请一次选择一个 ${SCORE_FILE_EXTENSION} 曲谱文件。`]); return; }
    const file = files[0]!;
    // 文件选择器的过滤可被绕过，拖放也会直达这里。先校验最终扩展名，兼容大小写，
    // 再校验内容、版本和排版，避免把任意改名文件识别成六线猫曲谱。
    if (!file.name.toLowerCase().endsWith(SCORE_FILE_EXTENSION)) {
      setErrors([`请选择 ${SCORE_FILE_EXTENSION} 曲谱文件。`]);
      return;
    }
    if (file.size > SCORE_FILE_MAX_BYTES) {
      setErrors([`曲谱文件为 ${(file.size / 1024 / 1024).toFixed(2)} MiB，超过 10 MiB 上限。`]);
      return;
    }
    const version = captureEditorVersion(session.getState());
    const generation = ++request.current;
    reading.current = true;
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      if (generation !== request.current) return;
      if (!sameEditorVersion(session.getState(), version)) {
        setErrors(["读取期间曲谱已变化，请重新选择文件。"]);
        return;
      }
      if (!canContinueRef.current()) return;
      const checked = decodeScoreFile(bytes);
      if (!checked.ok) {
        setErrors(checked.errors);
        if (checked.reason !== "format") setErrorSummary(checked.reason === "version"
          ? "此文件版本暂不支持，请使用兼容版本导出的曲谱。"
          : checked.reason === "syntax"
            ? `文件内容无法读取，请重新选择原始 ${SCORE_FILE_EXTENSION} 文件。`
            : "曲谱结构无效，请检查原文件后重试。");
        return;
      }
      setCandidate({ name: file.name, document: checked.document, sourceVersion: checked.upgraded ? checked.sourceVersion : undefined, version });
    } catch {
      if (generation === request.current) setErrors(["文件读取失败，请重新选择。"]);
    } finally {
      if (generation === request.current) {
        reading.current = false;
        setBusy(false);
      }
    }
  };

  const close = () => { request.current += 1; onClose(); };
  const open = () => {
    if (!candidate) return;
    if (!sameEditorVersion(session.getState(), candidate.version)) {
      setCandidate(undefined);
      setErrors(["当前曲谱已变化，请重新选择文件。"]);
      return;
    }
    onOpen(candidate.document, candidate.name, candidate.version);
  };
  const score = candidate?.document.score;
  const measures = score?.tracks[0]?.measures;
  const tonality = candidate && readScoreTonality(candidate.document);

  return (
    <ScoreFileDialog title="导入曲谱" onClose={close}>
      <div className={styles.dropZone}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }}
        onDrop={(event) => { event.preventDefault(); void readFile(event.dataTransfer.files); }}>
        <p>将曲谱拖到这里，或从电脑选择文件。</p>
        <small>{SCORE_FILE_LABEL} · 最大 10 MiB</small>
        <Button data-initial-focus htmlType="button" disabled={busy}
          onClick={() => input.current?.click()}>{candidate ? "重新选择" : "选择文件"}</Button>
        <input ref={input} type="file" accept={SCORE_FILE_EXTENSION} className={styles.hiddenInput}
          aria-label="选择六线猫曲谱文件" onChange={(event) => {
            const fileInput = event.currentTarget;
            void readFile(fileInput.files ?? undefined);
            fileInput.value = "";
          }} />
      </div>
      {busy && <p role="status">正在读取曲谱…</p>}
      {!!errors.length && <div role="alert" className={styles.error}>
        <p>{errorSummary || errors[0]}</p>
        {(errorSummary || errors.length > 1) && <details><summary>查看错误详情（{errors.length} 项）</summary>
          <ul>{errors.slice(0, 5).map((error, index) => <li key={index}>{error}</li>)}</ul>
        </details>}
      </div>}
      {score && candidate && <>
        <dl aria-label="导入曲谱预览" aria-live="polite">
          <dt>文件</dt><dd>{candidate.name}</dd>
          <dt>曲名</dt><dd>{score.title.trim() || "未命名曲谱"}</dd>
          <dt>编谱作者</dt><dd>{score.arranger || "未填写"}</dd>
          <dt>拍号</dt><dd>{measures?.[0] && displaySignature(measures[0].timeSignature)}</dd>
          <dt>小节</dt><dd>{measures?.length}</dd>
          <dt>数字 1</dt><dd>{score.keySignature ? `1=${score.keySignature}` : "未设置"}</dd>
          <dt>调性</dt><dd>{tonality?.kind === "confirmed" ? `${tonality.tonality.tonic} ${tonality.tonality.mode === "major" ? "大调" : "小调"}` : "大小调未确认"}</dd>
        </dl>
        {candidate.sourceVersion !== undefined && <p>版本 {candidate.sourceVersion} 将升级后打开，原文件不会被覆盖。</p>}
      </>}
      <div className={styles.actions}>
        <Button onClick={close}>取消</Button>
        <Button type="primary" onClick={open} disabled={!candidate || busy}>打开曲谱</Button>
      </div>
    </ScoreFileDialog>
  );
}
