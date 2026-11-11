"use client";

// @env browser
import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodeScorePage,
  exportScoreImages,
  MAX_IMAGE_PAGES,
  pageImageName,
  prepareScoreImages,
  toImageExportError,
  ImageExportError,
  type PreparedScoreImages,
} from "./image-export-controller";
import type {
  DownloadState,
  ExportRange,
  ExportStatus,
  ImageExportTaskOptions,
} from "./image-export-task-types";

/**
 * 管理一次导出预览的准备、生成、取消与下载资源，不直接修改曲谱或操作历史。
 * snapshot 是打开预览时捕获的输入；isCurrent 在异步结果落地前复核会话版本。
 * 字体变化使成品几何失效，需重新准备；会话失效则通知 Modal 决定如何关闭。
 * AbortSignal 用于中止协作任务，递增令牌用于拒绝无法及时中止的迟到结果。
 */
export const useImageExportTask = ({
  snapshot,
  isCurrent,
  onInvalid,
}: ImageExportTaskOptions) => {
  const task = useRef<AbortController | null>(null);
  const taskToken = useRef(0);
  const urlRef = useRef<string | null>(null);
  const preparedRef = useRef<PreparedScoreImages | null>(null);
  const currentRef = useRef(isCurrent);
  const invalidRef = useRef(onInvalid);
  const stopped = useRef(false);
  const [prepareAttempt, setPrepareAttempt] = useState(0);
  const [prepared, setPrepared] = useState<PreparedScoreImages | null>(null);
  const [status, setStatus] = useState<ExportStatus>("preparing");
  const [error, setError] = useState<ImageExportError | null>(null);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [inspected, setInspected] = useState(0);
  const [rangeAll, setRangeAll] = useState(true);
  const [lastRange, setLastRange] = useState<ExportRange>({ type: "all" });
  const [download, setDownload] = useState<DownloadState | null>(null);

  useEffect(() => {
    // 始终调用最新的宿主检查，但不因回调引用变化而重新执行字体测量与分页。
    currentRef.current = isCurrent;
    invalidRef.current = onInvalid;
  }, [isCurrent, onInvalid]);

  const releaseUrl = useCallback(() => {
    // URL 只由任务释放；关闭动画仍保留成品，卸载时才释放。
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);
  const clearDownload = useCallback(() => {
    releaseUrl();
    setDownload(null);
  }, [releaseUrl]);
  const abortTask = useCallback(() => {
    taskToken.current += 1;
    task.current?.abort();
    task.current = null;
  }, []);

  const stop = useCallback(() => {
    // 关闭动画开始即禁止新任务；现有预览与 URL 留到卸载统一释放，避免闪空。
    stopped.current = true;
    abortTask();
    setProgress(0);
  }, [abortTask]);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
      abortTask();
      releaseUrl();
      preparedRef.current = null;
    };
  }, [abortTask, releaseUrl]);

  useEffect(() => {
    const controller = new AbortController();
    task.current = controller;
    let ready = false;

    const invalidate = () => {
      // 初次等待字体期间的事件交给 prepareScoreImages；仅废弃已经就绪的几何，
      // 防止字体刚加载完成就把同一次准备过程误判为过期。
      if (!ready || stopped.current) return;
      ready = false;
      controller.abort();
      abortTask();
      clearDownload();
      preparedRef.current = null;
      setPrepared(null);
      setStatus("stale");
      setStaleReason("字体发生变化，请重新准备预览。");
    };
    document.fonts.addEventListener("loadingdone", invalidate);
    document.fonts.addEventListener("loadingerror", invalidate);
    void prepareScoreImages(
      snapshot.document,
      snapshot.density,
      snapshot.showChordDiagrams,
      controller.signal,
    ).then(
      (result) => {
        // 每次 effect 独立持有 signal；StrictMode 重挂载不会接收前次迟到结果。
        if (controller.signal.aborted || stopped.current) return;
        if (!currentRef.current()) {
          invalidRef.current("prepare");
          return;
        }
        ready = true;
        preparedRef.current = result;
        setPrepared(result);
        setRangeAll(
          result.pages.length > 0 && result.pages.length <= MAX_IMAGE_PAGES,
        );
        setStatus("ready");
      },
      (cause) => {
        if (controller.signal.aborted || stopped.current) return;
        if (!currentRef.current()) {
          invalidRef.current("prepare");
          return;
        }
        setError(toImageExportError(cause));
        setStatus("failed");
      },
    );
    return () => {
      controller.abort();
      // snapshot 改变也必须取消生成，不能把旧快照的下载写入新预览。
      abortTask();
      releaseUrl();
      document.fonts.removeEventListener("loadingdone", invalidate);
      document.fonts.removeEventListener("loadingerror", invalidate);
    };
  }, [snapshot, prepareAttempt, abortTask, clearDownload, releaseUrl]);

  const validateCurrent = (): boolean => {
    if (stopped.current) return false;
    if (currentRef.current()) return true;
    invalidRef.current("generate");
    return false;
  };

  const generate = async (target: ExportRange): Promise<void> => {
    if (!prepared || status === "generating" || status === "preparing") return;
    if (!validateCurrent()) return;
    if (target.type === "all" && prepared.pages.length > MAX_IMAGE_PAGES) {
      setError(new ImageExportError("zip-too-many-pages", "超过 100 页，请在预览中按页下载"));
      setStatus("failed");
      return;
    }
    const token = ++taskToken.current;
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    clearDownload();
    setError(null);
    setStaleReason(null);
    setLastRange(target);
    setProgress(target.type === "page" ? 1 : 0);
    setStatus("generating");
    try {
      const result = target.type === "all"
        ? await exportScoreImages(prepared, controller.signal, (page) => {
            if (taskToken.current === token && !controller.signal.aborted)
              setProgress(page);
          })
        : {
            blob: await encodeScorePage(prepared, target.index, controller.signal),
            name: pageImageName(prepared.title, target.index),
          };
      // 取消、字体变化、关闭和卸载都先撤销令牌；迟到结果不能创建 URL。
      if (taskToken.current !== token || controller.signal.aborted) return;
      if (!validateCurrent()) return;
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      setDownload({ url, name: result.name, range: target.type === "all" ? "all" : target.index });
      setProgress(prepared.pages.length);
      setStatus("generated");
    } catch (cause) {
      if (taskToken.current !== token || controller.signal.aborted) return;
      if (!validateCurrent()) return;
      setError(toImageExportError(cause));
      setStatus("failed");
    } finally {
      if (taskToken.current === token) task.current = null;
    }
  };

  const cancel = (): void => {
    // 用户取消编码可继续使用已准备的预览；与关闭整个导出会话的 stop 区分。
    if (stopped.current) return;
    abortTask();
    setProgress(0);
    setError(null);
    setStatus(preparedRef.current ? "ready" : "preparing");
  };
  const reprepare = (): void => {
    // 重新准备会改变页数及坐标，旧页码、范围和下载地址必须一起失效。
    if (!validateCurrent()) return;
    abortTask();
    preparedRef.current = null;
    setPrepared(null);
    setStatus("preparing");
    setError(null);
    setStaleReason(null);
    setProgress(0);
    setInspected(0);
    setRangeAll(true);
    clearDownload();
    setPrepareAttempt((value) => value + 1);
  };
  const inspectPage = (index: number): void => {
    if (stopped.current) return;
    if (status === "generating" || status === "preparing") return;
    setInspected(index);
    if (download && download.range !== "all" && download.range !== index) {
      clearDownload();
      if (status === "generated") setStatus("ready");
    }
  };
  const changeRange = (value: "all" | "page"): void => {
    if (stopped.current) return;
    if (status === "generating" || status === "preparing") return;
    setRangeAll(value === "all");
    if (download) {
      clearDownload();
      if (status === "generated") setStatus("ready");
    }
  };

  return {
    prepared, status, error, staleReason, progress, inspected, rangeAll, lastRange,
    download, generate, cancel, reprepare, inspectPage, changeRange, stop,
    validateCurrent,
  };
};
