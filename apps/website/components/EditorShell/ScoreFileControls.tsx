"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "../../stores/editor-store";
import {
  decodeScoreFile,
  SCORE_FILE_MAX_BYTES,
  serializeScoreFile,
} from "./score-file";
import styles from "./score-file.module.scss";

type VersionToken = Pick<
  EditorStoreState,
  "sessionId" | "sessionVersion" | "stateVersion" | "document"
>;
type Candidate = {
  bytes: ArrayBuffer;
  name: string;
  token: VersionToken;
  title: string;
  track: string;
  measures: number;
  upgraded: boolean;
  sourceVersion: number;
};

/** 除文档 ID 外核对真实会话与编辑版本，异步读取或确认期间发生编辑时不能覆盖。 */
const sameVersion = (current: EditorStoreState, token: VersionToken): boolean =>
  current.sessionId === token.sessionId &&
  current.sessionVersion === token.sessionVersion &&
  current.stateVersion === token.stateVersion &&
  current.document === token.document;

export const ScoreFileControls = ({
  session,
  isBlocked,
  className,
  feedbackContainer,
}: {
  session: StoreApi<EditorStoreState>;
  isBlocked: () => boolean;
  className: string;
  feedbackContainer?: HTMLElement | null;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const downloadUrls = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    mounted.current = true;
    const urls = downloadUrls.current;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (candidate) {
      dialogRef.current?.showModal();
      cancelButtonRef.current?.focus();
    }
  }, [candidate]);

  const close = () => {
    dialogRef.current?.close();
    setCandidate(null);
    importButtonRef.current?.focus();
  };
  const blocked = () => {
    if (!isBlocked()) return false;
    setErrors(["请先应用或取消当前输入，再导入或导出曲谱。"]);
    return true;
  };
  const openFile = () => {
    if (busy || blocked()) return;
    setErrors([]);
    setNotice("");
    inputRef.current?.click();
  };

  /** 文件读取后的验证保持候选隔离，确认之前绝不写入正在编辑的会话。 */
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (blocked()) return;
    setErrors([]);
    const token = session.getState();
    const generation = ++requestId.current;
    if (file.size > SCORE_FILE_MAX_BYTES) {
      setErrors(["曲谱文件超过 10 MiB 上限"]);
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      if (!mounted.current || generation !== requestId.current) return;
      if (!sameVersion(session.getState(), token)) {
        setErrors(["读取期间曲谱已变化，请重新选择文件。"]);
        return;
      }
      const checked = decodeScoreFile(bytes);
      if (!mounted.current || generation !== requestId.current) return;
      if (!sameVersion(session.getState(), token)) {
        setErrors(["校验期间曲谱已变化，请重新选择文件。"]);
        return;
      }
      if (!checked.ok) {
        setErrors(checked.errors);
        return;
      }
      setCandidate({
        bytes,
        name: file.name,
        token,
        upgraded: checked.upgraded,
        sourceVersion: checked.sourceVersion,
        title: checked.document.score.title || "未命名曲谱",
        track: checked.document.score.tracks[0]!.name,
        measures: checked.document.score.tracks[0]!.measures.length,
      });
    } catch {
      if (mounted.current && generation === requestId.current)
        setErrors(["文件读取失败，请重新选择。"]);
    } finally {
      if (mounted.current && generation === requestId.current) setBusy(false);
    }
  };

  /** 最终确认重新校验版本及原始文件；store 自己再次校验后才提交。 */
  const confirmImport = () => {
    if (!candidate || blocked()) return;
    if (!sameVersion(session.getState(), candidate.token)) {
      close();
      setErrors(["当前曲谱已变化，请重新选择文件。"]);
      return;
    }
    const checked = decodeScoreFile(candidate.bytes);
    if (!checked.ok) {
      close();
      setErrors(checked.errors);
      return;
    }
    const replaced = session
      .getState()
      .replaceDocument(checked.document, "file");
    if (!replaced.ok) {
      close();
      setErrors(replaced.errors);
      return;
    }
    close();
  };

  /** 下载链接点击后延时释放，同时在组件卸载时兜底回收。 */
  const exportFile = () => {
    if (blocked()) return;
    const score = session.getState().document;
    if (!score) {
      setErrors(["当前没有可导出的曲谱。"]);
      return;
    }
    setErrors([]);
    setNotice("");
    const result = serializeScoreFile(score);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([result.text], { type: "application/json;charset=utf-8" }),
    );
    downloadUrls.current.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.name;
    document.body.appendChild(link);
    try {
      link.click();
      setNotice(`已发起下载「${result.name}」。`);
    } catch {
      setErrors(["浏览器未能发起下载，请重试。"]);
    } finally {
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 60_000);
    }
  };

  // 反馈仍由文件控制器持有，按宿主位置渲染，避免长错误把头部动作挤出视口。
  const feedback = (
    <>
      {busy && <span role="status">正在读取曲谱…</span>}
      {notice && <span role="status">{notice}</span>}
      {errors.length > 0 && (
        <div role="alert" className={styles.error}>
          <p>曲谱文件操作失败（共 {errors.length} 项）：</p>
          <ul>
            {errors.slice(0, 5).map((error, index) => (
              <li key={`${index}:${error}`}>{error}</li>
            ))}
          </ul>
          {errors.length > 5 && (
            <p>另有 {errors.length - 5} 项错误，请检查曲谱文件。</p>
          )}
        </div>
      )}
    </>
  );
  return (
    <>
      <button
        ref={importButtonRef}
        type="button"
        className={className}
        disabled={busy}
        onClick={openFile}
      >
        导入曲谱
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.lxm.json,application/json"
        className={styles.hiddenInput}
        aria-label="选择六线猫曲谱文件"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void onFile(file);
        }}
      />
      <button
        type="button"
        className={className}
        onClick={exportFile}
        disabled={!session.getState().document}
      >
        导出曲谱
      </button>
      {feedbackContainer ? createPortal(feedback, feedbackContainer) : feedback}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="score-import-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <h2 id="score-import-title">确认导入曲谱</h2>
        {candidate && (
          <>
            <dl>
              <dt>文件</dt>
              <dd>{candidate.name}</dd>
              <dt>曲名</dt>
              <dd>{candidate.title}</dd>
              <dt>轨道</dt>
              <dd>{candidate.track}</dd>
              <dt>小节</dt>
              <dd>{candidate.measures}</dd>
            </dl>
            <p>
              导入将替换当前曲谱并清空撤销历史。需要保留当前曲谱时，请先取消并导出。
            </p>
            <div className={styles.actions}>
              <button ref={cancelButtonRef} type="button" onClick={close}>
                取消
              </button>
              {candidate?.upgraded && (
                <p>
                  此文件将从版本 {candidate.sourceVersion}{" "}
                  显式升级为独立简谱格式，原文件不会被覆盖。
                </p>
              )}
              <button type="button" onClick={confirmImport}>
                导入并替换
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
};
