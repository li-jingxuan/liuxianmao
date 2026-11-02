"use client";

import { useEffect, useRef, useState } from "react";

import { createImageDelivery } from "@/lib/api";
import { diagnoseFnosUploadSession } from "@/lib/fnos-session";
import type { ImageDeliveryResponse } from "@/lib/types";

import styles from "./fnos-album-test.module.scss";

type Operation = "generate" | "upload" | "diagnose" | "copy";
type TestImage = { blob: Blob; url: string; filename?: string };

const MAX_PNG_BYTES = 15 * 1024 * 1024;

async function copyText(value: string, isCurrent: () => boolean) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // HTTP 和部分 App WebView 无法使用 Clipboard API，继续尝试选区复制。
  }
  if (!isCurrent()) return;
  const previousFocus = document.activeElement;
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, value.length);
    if (!document.execCommand?.("copy")) throw new Error("请长按文本，手动复制");
  } finally {
    field.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }
}

function generatePng(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("当前环境无法生成测试图，请换浏览器重试"));
  const colors = ["#f26b6b", "#ffd36c", "#69c7ae", "#7697ed"];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      context.fillStyle = colors[(x + y) % colors.length];
      context.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("测试图生成失败，请重试"));
    }, "image/png");
  });
}

export function FnosAlbumTest() {
  const [image, setImage] = useState<TestImage | null>(null);
  const [delivery, setDelivery] = useState<ImageDeliveryResponse | null>(null);
  const [diagnostic, setDiagnostic] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<Operation | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, []);

  useEffect(() => {
    return () => { if (image) URL.revokeObjectURL(image.url); };
  }, [image]);

  const run = async (operation: Operation, task: (controller: AbortController) => Promise<void>) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(operation);
    setError("");
    setNotice("");
    if (operation === "upload" || operation === "diagnose") setDiagnostic("");
    try {
      await task(controller);
    } catch (cause: unknown) {
      if (!isCurrent(controller)) return;
      setError(cause instanceof Error ? cause.message : "操作失败，请重试");
      if (cause instanceof Error && "diagnostic" in cause && typeof cause.diagnostic === "string") {
        setDiagnostic(cause.diagnostic);
      }
    } finally {
      if (isCurrent(controller)) {
        active.current = null;
        setBusy(null);
      }
    }
  };

  const isCurrent = (controller: AbortController) =>
    mounted.current && active.current === controller && !controller.signal.aborted;

  const generate = () => void run("generate", async (controller) => {
    const blob = await generatePng();
    if (!isCurrent(controller)) return;
    setImage({ blob, url: URL.createObjectURL(blob) });
    setDelivery(null);
    setNotice("测试图已生成：128 × 128 PNG");
  });

  const selectPng = (file?: File) => {
    if (!file || active.current) return;
    setError("");
    setNotice("");
    if (!/\.png$/i.test(file.name) || (file.type !== "" && file.type !== "image/png")) {
      setError("请选择 PNG 文件（.png）");
      return;
    }
    if (file.size > MAX_PNG_BYTES) {
      setError("PNG 文件不能超过 15 MiB");
      return;
    }
    setImage({ blob: file, url: URL.createObjectURL(file), filename: file.name });
    setDelivery(null);
    setNotice("已选择 PNG，上传时使用原文件");
  };

  const upload = () => {
    if (!image) return;
    void run("upload", async (controller) => {
      setDelivery(null);
      const result = await createImageDelivery(image.blob, { fnos: true, signal: controller.signal });
      if (!isCurrent(controller)) return;
      if (!result.share_url || !/^https?:\/\//i.test(result.share_url)) {
        throw new Error("相册未返回可用分享链接，请手动检查 App 会话");
      }
      setDelivery(result);
      setNotice("相册分享链接已生成");
    });
  };

  const diagnose = () => void run("diagnose", async (controller) => {
    const result = await diagnoseFnosUploadSession(controller.signal);
    if (!isCurrent(controller)) return;
    setDiagnostic(result);
    setNotice("App 会话检查完成");
  });

  const copy = (value: string, message: string) => void run("copy", async (controller) => {
    await copyText(value, () => isCurrent(controller));
    if (isCurrent(controller)) setNotice(message);
  });

  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setBusy(null);
    setNotice(busy === "upload" ? "已取消等待；已提交的上传可能已保存，请检查相册" : "已取消");
  };

  return (
    <main className={styles.shell}>
      <header>
        <span className={styles.badge}>飞牛 · 临时测试版</span>
        <h1>拼豆相册测试</h1>
        <p className={styles.assurance}>不调用 AI，不消耗转换次数</p>
        <p>生成本地小图，或选择已有 PNG，测试保存、相册上传和七天分享。</p>
      </header>

      <section className={styles.card} aria-labelledby="test-image-title">
        <h2 id="test-image-title">测试图片</h2>
        <div className={styles.actions}>
          <button type="button" onClick={generate} disabled={!!busy}>生成测试图</button>
          <button type="button" onClick={upload} disabled={!image || !!busy}>上传并生成链接</button>
        </div>
        <label className={styles.filePicker}>
          选择 PNG
          <input
            type="file"
            accept="image/png,.png"
            disabled={!!busy}
            onChange={(event) => {
              selectPng(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <span>可选，最大 15 MiB；预览所选 PNG，直接上传原文件。</span>
        </label>
        {image && (
          <figure className={styles.preview}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              width={image.filename ? undefined : 128}
              height={image.filename ? undefined : 128}
              alt={image.filename ? `所选 PNG：${image.filename}` : "本地生成的彩色 PNG 测试图"}
            />
            <figcaption>{image.filename ? `所选 PNG：${image.filename} · 上传原文件` : "128 × 128 PNG · 预览与上传使用同一张图"}</figcaption>
          </figure>
        )}
        {delivery?.share_url && (
          <div className={styles.result}>
            <label htmlFor="album-share-url">相册分享链接</label>
            <input id="album-share-url" readOnly value={delivery.share_url} onFocus={(event) => event.currentTarget.select()} />
            <a href={delivery.share_url} target="_blank" rel="noreferrer">打开分享链接</a>
            <p>有效期 7 天 · 到期时间：<time dateTime={delivery.expires_at}>{delivery.expires_at}</time></p>
            <button type="button" disabled={!!busy} onClick={() => copy(delivery.share_url!, "链接已复制")}>复制链接</button>
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="session-title">
        <h2 id="session-title">App 会话诊断</h2>
        <p>仅包含脱敏的环境和会话字段信息。失败后可手动检查，不会自动重传。</p>
        <div className={styles.actions}>
          <button type="button" onClick={diagnose} disabled={!!busy}>检查 App 会话</button>
          <button type="button" disabled={!diagnostic || !!busy} onClick={() => copy(diagnostic, "诊断已复制")}>复制诊断</button>
        </div>
        <label className={styles.diagnosticLabel} htmlFor="album-diagnostic">完整诊断</label>
        <textarea id="album-diagnostic" readOnly spellCheck={false} value={diagnostic} rows={10} placeholder="点击“检查 App 会话”查看诊断" />
      </section>

      {busy && <div className={styles.actions}>
        <span role="status">{busy === "upload" ? "正在上传并生成链接…" : busy === "diagnose" ? "正在检查 App 会话…" : busy === "generate" ? "正在生成测试图…" : "正在复制…"}</span>
        <button type="button" onClick={cancel}>取消</button>
      </div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.notice} role="status">{notice}</p>
    </main>
  );
}
