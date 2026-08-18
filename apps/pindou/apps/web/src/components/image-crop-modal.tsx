"use client";

import dynamic from "next/dynamic";
import { Check, Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Area, Point } from "react-easy-crop";

import styles from "./image-crop-modal.module.scss";

const Cropper = dynamic(() => import("react-easy-crop"), { ssr: false });

type ImageCropModalProps = {
  imageUrl: string;
  onConfirm: (area: Area) => Promise<void>;
  onSkip: () => void;
  onCancel: () => void;
};

/**
 * 上传后的本地裁剪弹窗。只把裁剪区域交给父层，文件编码细节集中在 image-crop 模块。
 */
export function ImageCropModal({
  imageUrl,
  onConfirm,
  onSkip,
  onCancel,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onCancel]);

  const handleConfirm = async () => {
    if (!croppedAreaPixels || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm(croppedAreaPixels);
    } catch (cause) {
      setSubmitError(
        cause instanceof Error ? cause.message : "图片裁剪失败，请重试",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-crop-title"
      >
        <header className={styles.header}>
          <div>
            <h2 id="image-crop-title">调整图片范围</h2>
            <p>拖动图片让主体位于方形区域内</p>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="关闭裁剪弹窗"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            <X />
          </button>
        </header>

        <div className={styles.cropStage}>
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            rotation={0}
            aspect={1}
            minZoom={1}
            maxZoom={3}
            cropShape="rect"
            objectFit="contain"
            showGrid
            zoomSpeed={1}
            keyboardStep={1}
            style={{}}
            classes={{}}
            restrictPosition={false}
            mediaProps={{}}
            cropperProps={{}}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
          />
        </div>

        <div className={styles.controls}>
          <label className={styles.zoomControl}>
            <Minus aria-hidden="true" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              aria-label="图片缩放"
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <Plus aria-hidden="true" />
          </label>
          {submitError && (
            <p className={styles.error} role="alert">
              {submitError}
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={isSubmitting}
            onClick={onSkip}
          >
            跳过裁剪
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={isSubmitting || !croppedAreaPixels}
            onClick={() => void handleConfirm()}
          >
            <Check aria-hidden="true" />
            {isSubmitting ? "处理中…" : "确认裁剪"}
          </button>
        </footer>
      </section>
    </div>
  );
}
