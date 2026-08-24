"use client";

import {
  AlertTriangle,
  Clock3,
  Download,
  ImageIcon,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";

import { getImageDelivery, PindouApiError, resolveApiUrl } from "@/lib/api";
import type { ImageDeliveryResponse } from "@/lib/types";

import styles from "./image-delivery-preview.module.scss";

type PreviewStatus = "loading" | "ready" | "expired" | "error";

const MIN_ZOOM = 100;
const MAX_ZOOM = 400;
const ZOOM_STEP = 25;

const formatExpiresAt = (expiresAt: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(expiresAt));

export function ImageDeliveryPreview({ token }: { token: string }) {
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [delivery, setDelivery] = useState<ImageDeliveryResponse | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [now, setNow] = useState(() => Date.now());

  const loadDelivery = () => {
    const controller = new AbortController();
    const request = async () => {
      try {
        const payload = await getImageDelivery(token, controller.signal);
        setDelivery(payload);
        setStatus("ready");
      } catch (cause: unknown) {
        if ((cause as Error).name === "AbortError") return;
        setStatus(
          cause instanceof PindouApiError && cause.code === "DELIVERY_IMAGE_NOT_FOUND"
            ? "expired"
            : "error",
        );
      }
    };
    void request();
    return controller;
  };

  const retryDelivery = () => {
    setStatus("loading");
    setDelivery(null);
    loadDelivery();
  };

  useEffect(() => {
    const controller = loadDelivery();
    return () => controller.abort();
    // loadDelivery 只依赖当前 token；避免每次渲染重新请求公开元数据。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    // 每分钟刷新提示，并在页面保持打开时及时收起已经过期的原图入口。
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (delivery && currentTime >= new Date(delivery.expires_at).getTime()) {
        setStatus("expired");
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [delivery]);

  const resetZoom = () => {
    setZoom(MIN_ZOOM);
    const viewport = document.getElementById("delivery-image-viewport");
    if (typeof viewport?.scrollTo === "function") {
      viewport.scrollTo({ top: 0, left: 0 });
    } else if (viewport) {
      // JSDOM 和极旧浏览器没有 scrollTo，直接写滚动位置作为兼容兜底。
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
    }
  };

  const remainingMilliseconds = delivery
    ? new Date(delivery.expires_at).getTime() - now
    : Number.POSITIVE_INFINITY;
  const expiresSoon = remainingMilliseconds > 0 && remainingMilliseconds <= 24 * 60 * 60 * 1000;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.logo} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <div>
          <h1>拼豆图纸</h1>
          <p>查看细节并保存高清施工图</p>
        </div>
      </header>

      {status === "loading" && (
        <section className={styles.stateCard} aria-live="polite">
          <RefreshCw className={styles.loadingIcon} />
          <h2>正在加载图纸…</h2>
          <p>图片较大时需要稍等片刻</p>
        </section>
      )}

      {status === "expired" && (
        <section className={styles.stateCard} role="alert">
          <AlertTriangle />
          <h2>图纸链接已过期或不存在</h2>
          <p>请联系卖家重新生成并发送新的交付链接。</p>
        </section>
      )}

      {status === "error" && (
        <section className={styles.stateCard} role="alert">
          <AlertTriangle />
          <h2>图纸加载失败</h2>
          <p>请检查网络连接后重试，当前错误不代表链接已经过期。</p>
          <button type="button" onClick={retryDelivery}>
            <RefreshCw />
            重新加载
          </button>
        </section>
      )}

      {status === "ready" && delivery && (
        <>
          <section className={styles.viewerCard} aria-labelledby="delivery-title">
            <div className={styles.viewerHeading}>
              <div>
                <h2 id="delivery-title">
                  <ImageIcon />
                  高清施工图
                </h2>
                <p className={expiresSoon ? styles.expiringSoon : undefined}>
                  <Clock3 />
                  {expiresSoon ? "剩余不足 24 小时，请尽快保存 · " : "链接有效期至 "}
                  {formatExpiresAt(delivery.expires_at)}
                </p>
              </div>
              <div className={styles.zoomControls} aria-label="图纸缩放控制">
                <button
                  type="button"
                  aria-label="缩小图纸"
                  disabled={zoom <= MIN_ZOOM}
                  onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
                >
                  <Minus />
                </button>
                <output aria-live="polite">{zoom}%</output>
                <button
                  type="button"
                  aria-label="放大图纸"
                  disabled={zoom >= MAX_ZOOM}
                  onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
                >
                  <Plus />
                </button>
                <button type="button" aria-label="还原图纸缩放" onClick={resetZoom}>
                  <RotateCcw />
                  <span>还原</span>
                </button>
              </div>
            </div>

            <div id="delivery-image-viewport" className={styles.imageViewport}>
              {/* 原生 img 保留原始 PNG 和移动端长按菜单，不经过 Next 图片优化。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveApiUrl(delivery.image_url)}
                alt="可缩放查看并长按保存的拼豆施工图"
                style={{ width: `${zoom}%` }}
                onError={() => setStatus("error")}
              />
            </div>

            <a className={styles.downloadButton} href={resolveApiUrl(delivery.download_url)}>
              <Download />
              下载原图
            </a>
          </section>

          <section className={styles.instructions} aria-labelledby="save-steps-title">
            <div>
              <h2 id="save-steps-title">保存步骤</h2>
              <ol>
                <li>手机可以长按上方图纸，在菜单中选择“保存图片”或“保存到相册”。</li>
                <li>如果长按没有反应，请点击“下载原图”。</li>
                <li>闲鱼内无法下载时，请点击右上角菜单，选择“在浏览器打开”后再保存。</li>
              </ol>
            </div>
            <div>
              <h2>注意事项</h2>
              <ul>
                <li>请在有效期结束前保存，链接过期后将无法继续访问。</li>
                <li>页面缩放只影响查看大小，不会降低原图清晰度。</li>
                <li>实际制作时请以下载的高清原图和图中标注色号为准。</li>
              </ul>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
