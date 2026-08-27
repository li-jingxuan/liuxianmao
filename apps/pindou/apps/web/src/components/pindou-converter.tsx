"use client";

import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Grid2X2,
  ImageIcon,
  Palette,
  RefreshCw,
  Settings,
  Sparkles,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Area } from "react-easy-crop";

import {
  createConversion,
  createImageDelivery,
  getAccessKeyQuota,
  getColorSets,
  PindouApiError,
} from "@/lib/api";
import { countForegroundBeads } from "@/lib/bead-grid";
import { drawBeadGrid } from "@/lib/canvas";
import { cropImageToFile } from "@/lib/image-crop";
import { exportPatternSheet } from "@/lib/pattern-sheet-export";
import type {
  BackgroundMode,
  BeadGrid,
  ColorSetsResponse,
  ConversionStyle,
} from "@/lib/types";
import { validateImage } from "@/lib/validation";

import styles from "./pindou-converter.module.scss";
import { ImageCropModal } from "./image-crop-modal";

// 快捷尺寸来自 MVP1 设计稿；自定义尺寸与后端共用同一范围约束。
const GRID_SIZES = [52, 78, 104] as const;
const DEFAULT_GRID_SIZE = 78;
const DEFAULT_COLOR_SET_SIZE = 221;
const MIN_GRID_SIZE = 8;
const MAX_GRID_SIZE = 156;

// value 与后端枚举严格一致，label 只负责界面展示。
const BACKGROUNDS: Array<{ value: BackgroundMode; label: string }> = [
  { value: "simplify", label: "简化背景" },
  { value: "solid", label: "纯色背景" },
  { value: "keep", label: "保留原图背景" },
];

const CONVERSION_STYLES = [
  { value: "original", label: "原图增强" },
  { value: "chibi", label: "Q版" },
  { value: "sticker", label: "贴纸风" },
  { value: "minimal_illustration", label: "简约插画" },
  { value: "paper_cut", label: "剪纸风" },
] as const satisfies ReadonlyArray<{
  value: ConversionStyle;
  label: string;
}>;

const CONVERSION_STYLE_LABELS: Record<ConversionStyle, string> = Object.fromEntries(
  CONVERSION_STYLES.map(({ value, label }) => [value, label]),
) as Record<ConversionStyle, string>;

type ImageDetails = { width: number; height: number };
type Status = "idle" | "processing" | "complete";
type QuotaState =
  | { status: "loading" }
  | { status: "ready"; initialUses: number; remainingUses: number }
  | { status: "invalid" }
  | { status: "error" };
type Delivery = {
  previewUrl: string;
  expiresAt: string;
};

/** 微信内置浏览器不支持稳定的 a[download]，需要切换到长按保存流程。 */
const isWechatBrowser = () =>
  typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);

/** 把 Blob 转为 data URL，确保微信 WebView 能把生成图当作普通图片长按保存。 */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("无法读取导出图片"));
    reader.onerror = () => reject(new Error("无法读取导出图片"));
    reader.readAsDataURL(blob);
  });

/** 将语义化样式名映射为 CSS Modules 生成的局部类名。 */
const cx = (...classNames: Array<string | false | undefined>) =>
  classNames
    .filter((className): className is string => Boolean(className))
    .map((className) => styles[className])
    .join(" ");

/** 读取本地 Object URL 对应图片的原始像素尺寸，不把图片内容上传到服务器。 */
const readImageDetails = (url: string): Promise<ImageDetails> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("无法读取图片尺寸"));
    image.src = url;
  });

/** 由 CSS 着色的四格品牌标记；不依赖额外图片资源，也可在 Loading 中复用。 */
const Logo = () => (
  <span className={cx("logo-mark")} aria-hidden="true">
    <i />
    <i />
    <i />
    <i />
  </span>
);

const FieldIcon = ({ children }: { children: React.ReactNode }) => (
  <span className={cx("field-icon")}>{children}</span>
);

/** 微信端保存提示：H5 没有直接写入相册的通用权限，只能交给用户长按保存。 */
function ImageSaveGuide({ imageUrl, onClose }: { imageUrl: string; onClose: () => void }) {
  return (
    <div className={cx("save-guide-backdrop")} role="presentation" onClick={onClose}>
      <section
        className={cx("save-guide")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className={cx("save-guide-close")} type="button" aria-label="关闭保存提示" onClick={onClose}>
          <X />
        </button>
        <h2 id="save-guide-title">长按图片保存</h2>
        <p>请长按下方图片，在菜单中选择“保存图片”或“保存到相册”。</p>
        {/* 使用 data URL 而不是 Blob URL，兼容微信 iOS/Android WebView 的长按菜单。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={cx("save-guide-image")} src={imageUrl} alt="可长按保存的拼豆图纸" />
        <p className={cx("save-guide-hint")}>如果没有出现保存菜单，请点击右上角 ···，选择“在浏览器打开”后再保存。</p>
        <button className={cx("secondary-button", "save-guide-done")} type="button" onClick={onClose}>
          完成
        </button>
      </section>
    </div>
  );
}

/**
 * 响应式结果画布。
 * ResizeObserver 负责容器尺寸变化，DPR 负责高清屏清晰度；CSS 展示尺寸和
 * backing store 像素尺寸分开设置，避免 Retina 屏上的格线发虚。
 */
function ResultCanvas({ grid }: { grid: BeadGrid }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvas?.parentElement;
    if (!canvas || !wrapper) return;

    const render = () => {
      const displaySize = Math.max(1, Math.floor(wrapper.clientWidth));
      const dpr = window.devicePixelRatio || 1;

      // backing store 使用物理像素，style 使用 CSS 像素。
      canvas.width = Math.floor(displaySize * dpr);
      canvas.height = Math.floor(displaySize * dpr);
      canvas.style.width = `${displaySize}px`;
      canvas.style.height = `${displaySize}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      // 将后续绘制坐标缩放到 CSS 像素空间，drawBeadGrid 无需感知 DPR。
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBeadGrid(context, grid, {
        cellSize: displaySize / grid.width,
        gridLine: true,
      });
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [grid]);

  return <canvas ref={canvasRef} aria-label="拼豆图纸预览" />;
}

export function PindouConverter({
  apiKey,
  deliveryAdminKey,
}: {
  apiKey?: string;
  deliveryAdminKey?: string;
}) {
  // DOM 引用：文件选择器由定制按钮触发；结果引用用于转换后平滑定位。
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  // 请求序号避免较早发出的额度查询晚返回后覆盖更新的数据。
  const quotaRequestIdRef = useRef(0);

  // 上传文件状态。previewUrl 仅用于当前浏览器会话，必须在替换/卸载时释放。
  const [file, setFile] = useState<File | null>(null);
  // originalFile 用于重新裁剪；pendingCropFile 只表示当前弹窗尚未确认的新选择。
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null);
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [details, setDetails] = useState<ImageDetails | null>(null);

  // 用户参数状态。颜色硬上限由网格尺寸在后端统一派生。
  const [gridSize, setGridSize] = useState<number>(DEFAULT_GRID_SIZE);
  const [customGridSize, setCustomGridSize] = useState("");
  const [colorSets, setColorSets] = useState<ColorSetsResponse | null>(null);
  const [colorSetSize, setColorSetSize] = useState<number>(
    DEFAULT_COLOR_SET_SIZE,
  );
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("solid");
  const [conversionStyle, setConversionStyle] =
    useState<ConversionStyle>("chibi");
  const [backgroundColor] = useState("#FFFFFF");
  // const [allowSimplifyFallback, setAllowSimplifyFallback] = useState(false);
  const [quotaState, setQuotaState] = useState<QuotaState>({ status: "loading" });

  // 转换流程状态。result 只在 complete 时展示，错误后回到 idle 允许直接重试。
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<BeadGrid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [savePreviewUrl, setSavePreviewUrl] = useState<string | null>(null);
  // 本地下载和管理员上传复用同一 Blob，确保两条交付链路的图片完全一致。
  const [exportBlob, setExportBlob] = useState<Blob | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [isUploadingDelivery, setIsUploadingDelivery] = useState(false);
  const [isDeliveryCopied, setIsDeliveryCopied] = useState(false);

  /** 从服务端重新读取权威额度；查询失败不应覆盖现有转换错误。 */
  const refreshQuota = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++quotaRequestIdRef.current;
      // 确保 effect 只启动异步同步流程，不在调用栈内触发级联渲染。
      await Promise.resolve();
      if (!apiKey) {
        setQuotaState({ status: "invalid" });
        return;
      }
      try {
        const quota = await getAccessKeyQuota(apiKey, signal);
        if (requestId !== quotaRequestIdRef.current) return;
        setQuotaState({
          status: "ready",
          initialUses: quota.initial_uses,
          remainingUses: quota.remaining_uses,
        });
      } catch (cause) {
        if ((cause as Error).name === "AbortError") return;
        if (requestId !== quotaRequestIdRef.current) return;
        setQuotaState(
          cause instanceof PindouApiError && cause.code === "API_KEY_INVALID"
            ? { status: "invalid" }
            : { status: "error" },
        );
      }
    },
    [apiKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++quotaRequestIdRef.current;
    if (!apiKey) {
      // 通过微任务进入状态更新，避免 effect 调用栈内产生级联渲染。
      void Promise.resolve().then(() => {
        if (requestId === quotaRequestIdRef.current) {
          setQuotaState({ status: "invalid" });
        }
      });
      return () => controller.abort();
    }
    void getAccessKeyQuota(apiKey, controller.signal)
      .then((quota) => {
        if (requestId !== quotaRequestIdRef.current) return;
        setQuotaState({
          status: "ready",
          initialUses: quota.initial_uses,
          remainingUses: quota.remaining_uses,
        });
      })
      .catch((cause: unknown) => {
        if ((cause as Error).name === "AbortError") return;
        if (requestId !== quotaRequestIdRef.current) return;
        setQuotaState(
          cause instanceof PindouApiError && cause.code === "API_KEY_INVALID"
            ? { status: "invalid" }
            : { status: "error" },
        );
      });
    return () => controller.abort();
  }, [apiKey]);

  // 首次挂载时从后端加载颜色组；卸载时中止请求，防止更新已销毁组件。
  useEffect(() => {
    const controller = new AbortController();
    getColorSets(controller.signal)
      .then((response) => {
        setColorSets(response);
        // 首页默认使用 221 色标准套装；若将来移除该组，则尊重后端默认值。
        setColorSetSize(
          response.sets.some(({ size }) => size === DEFAULT_COLOR_SET_SIZE)
            ? DEFAULT_COLOR_SET_SIZE
            : response.default_size,
        );
      })
      .catch((cause: unknown) => {
        if ((cause as Error).name !== "AbortError")
          setError("颜色选项加载失败，请确认后端服务已启动");
      });
    return () => controller.abort();
  }, []);

  // 最终兜底清理：页面离开或 previewUrl 更新时释放浏览器持有的 Blob 引用。
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  // 裁剪弹窗使用独立 Object URL；取消或确认后释放，避免反复选图累积 Blob 引用。
  useEffect(
    () => () => {
      if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    },
    [cropSourceUrl],
  );

  /**
   * 以新文件完整替换旧上传状态。
   * 文件变化会令旧转换结果失效，因此同时重置结果和流程状态；参数选择保留。
   */
  const replaceFile = async (nextFile: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    // 更换图片后关闭旧的微信保存预览，避免用户误保存上一张图纸。
    setSavePreviewUrl(null);
    setExportBlob(null);
    setDelivery(null);
    setIsDeliveryCopied(false);
    setFile(nextFile);
    setPreviewUrl(null);
    setDetails(null);
    setResult(null);
    setStatus("idle");
    if (!nextFile) return;

    // 先做廉价的浏览器校验，再创建 Object URL 和解析图片。
    const validationError = validateImage(nextFile);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    const nextUrl = URL.createObjectURL(nextFile);
    setPreviewUrl(nextUrl);
    setError(null);
    try {
      setDetails(await readImageDetails(nextUrl));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  /** 打开当前原图的裁剪弹窗；已裁剪图片再次编辑时仍回到 originalFile。 */
  const openCropEditor = () => {
    const sourceFile = originalFile ?? file;
    if (!sourceFile) {
      inputRef.current?.click();
      return;
    }
    const sourceUrl = URL.createObjectURL(sourceFile);
    setPendingCropFile(sourceFile);
    setCropSourceUrl(sourceUrl);
    setIsCropOpen(true);
  };

  /** 关闭裁剪弹窗并放弃 pending 文件，不影响当前已经确认的图片。 */
  const closeCropEditor = () => {
    setIsCropOpen(false);
    setPendingCropFile(null);
    setCropSourceUrl(null);
  };

  /** 跳过裁剪时直接提交原文件，但仍保留它作为后续重新裁剪的基准。 */
  const skipCrop = async () => {
    if (!pendingCropFile) return;
    const nextFile = pendingCropFile;
    setOriginalFile(nextFile);
    setError(null);
    await replaceFile(nextFile);
    closeCropEditor();
  };

  /** 将裁剪区域转换为 File 后提交到现有预览和转换流程。 */
  const confirmCrop = async (area: Area) => {
    if (!pendingCropFile) return;
    try {
      const croppedFile = await cropImageToFile(pendingCropFile, area, {
        mimeType: pendingCropFile.type,
        quality: 0.92,
        maxSizeMB: 10,
        maxWidthOrHeight: 4096,
      });
      setOriginalFile(pendingCropFile);
      setError(null);
      await replaceFile(croppedFile);
      closeCropEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片裁剪失败，请重试");
      throw cause;
    }
  };

  /** 移除当前图片，并同时清理待确认的裁剪会话。 */
  const removeFile = async () => {
    closeCropEditor();
    setOriginalFile(null);
    await replaceFile(null);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (nextFile) {
      const validationError = validateImage(nextFile);
      if (validationError) {
        setError(validationError);
      } else {
        const sourceUrl = URL.createObjectURL(nextFile);
        setPendingCropFile(nextFile);
        setCropSourceUrl(sourceUrl);
        setIsCropOpen(true);
      }
    }
    // 清空 input，确保用户连续选择同一个文件时仍会触发 change。
    event.target.value = "";
  };

  /** 提交一次真实同步转换；processing 只表示等待，不声称服务端精确进度。 */
  const convert = async () => {
    if (customGridSize && !isValidCustomGridSize) {
      setError(`自定义网格大小请输入 ${MIN_GRID_SIZE}–${MAX_GRID_SIZE} 的整数`);
      return;
    }
    if (!file) {
      setError("请先上传一张图片");
      inputRef.current?.click();
      return;
    }
    if (!colorSets) {
      setError("颜色选项尚未加载完成，请稍后重试");
      return;
    }
    setError(null);
    setResult(null);
    setExportBlob(null);
    setDelivery(null);
    setIsDeliveryCopied(false);
    setStatus("processing");
    // 等待 processing 结果卡挂载后再滚动，否则 ref 此刻仍为空。
    window.setTimeout(
      () =>
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
    try {
      const conversion = await createConversion(
        {
          image: file,
          gridSize,
          colorSetSize,
          conversionStyle,
          backgroundMode,
          backgroundColor,
          // 主体识别不可靠时，默认允许生成包含背景的简化版本
          fallbackMode: 'simplify',
        },
        { apiKey },
      );
      setResult(conversion.grid);
      if (conversion.quota) {
        setQuotaState({
          status: "ready",
          initialUses: conversion.quota.initial_uses,
          remainingUses: conversion.quota.remaining_uses,
        });
      }
      setStatus("complete");
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "转换失败，请稍后重试");
    } finally {
      // 转换在 AI/量化失败前也可能已经扣次，成功和失败都重新校准额度。
      void refreshQuota();
    }
  };

  /** 只生成一次完整施工图，供本地下载和管理员上传共同复用。 */
  const getPatternSheetBlob = async (): Promise<Blob> => {
    if (exportBlob) return exportBlob;
    if (!result || !file || !details) throw new Error("当前图纸尚未准备完成");
    const blob = await exportPatternSheet({
      grid: result,
      sourceFile: file,
      sourceDetails: details,
    });
    setExportBlob(blob);
    return blob;
  };

  /** 将网格导出为 PNG；普通浏览器下载，微信内置浏览器切换为长按保存。 */
  const download = async () => {
    if (!result || !file || !details || isExporting) return;
    setError(null);
    setIsExporting(true);
    try {
      const blob = await getPatternSheetBlob();

      // 微信 H5 不具备可靠的文件下载/相册写入能力，改用可长按的图片预览。
      if (isWechatBrowser()) {
        setSavePreviewUrl(await blobToDataUrl(blob));
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pindou-pattern-${result.width}x${result.height}.png`;
      link.click();
      // 点击动作入队后释放 URL，避免重复导出持续占用 Blob 内存。
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败，请重试");
    } finally {
      setIsExporting(false);
    }
  };

  /** 管理员把当前完整施工图上传为短期交付文件，并生成用户预览链接。 */
  const uploadDelivery = async () => {
    if (!deliveryAdminKey || !result || !file || !details || isUploadingDelivery) return;
    setError(null);
    setIsUploadingDelivery(true);
    setIsDeliveryCopied(false);
    try {
      const blob = await getPatternSheetBlob();
      const response = await createImageDelivery(blob, { adminApiKey: deliveryAdminKey });
      setDelivery({
        previewUrl: new URL(
          `/delivery/${encodeURIComponent(response.token)}`,
          window.location.origin,
        ).toString(),
        expiresAt: response.expires_at,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图纸上传失败，请稍后重试");
    } finally {
      setIsUploadingDelivery(false);
    }
  };

  /** 优先使用 Clipboard API；失败时提示管理员手动复制，避免伪造成功状态。 */
  const copyDeliveryLink = async () => {
    if (!delivery) return;
    try {
      await navigator.clipboard.writeText(delivery.previewUrl);
      setIsDeliveryCopied(true);
      window.setTimeout(() => setIsDeliveryCopied(false), 1800);
    } catch {
      setError("自动复制失败，请长按链接手动复制");
    }
  };

  // null 格属于背景或空位，不需要制作主体豆；统计逻辑与导出图纸保持一致。
  const occupiedBeads = useMemo(
    () => (result ? countForegroundBeads(result) : 0),
    [result],
  );

  const parsedCustomGridSize = Number(customGridSize);
  const isValidCustomGridSize =
    /^\d+$/.test(customGridSize) &&
    parsedCustomGridSize >= MIN_GRID_SIZE &&
    parsedCustomGridSize <= MAX_GRID_SIZE;

  /** 自定义输入仅在满足后端范围时同步业务值，非法内容保留用于就地提示。 */
  const handleCustomGridSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setCustomGridSize(value);
    if (!value) {
      setGridSize(DEFAULT_GRID_SIZE);
      setError(null);
      return;
    }
    if (/^\d+$/.test(value)) {
      const nextSize = Number(value);
      if (nextSize >= MIN_GRID_SIZE && nextSize <= MAX_GRID_SIZE) {
        setGridSize(nextSize);
        setError(null);
      }
    }
  };

  return (
    <main className={cx("app-shell")}>
      {/* 品牌区：移动端保持紧凑，桌面端随容器居中。 */}
      <header className={cx("brand-header")}>
        <div className={cx("brand-lockup")}>
          <Logo />
          <div>
            <h1>拼豆图片转换器</h1>
            <p>把喜欢的图片变成拼豆图纸</p>
          </div>
        </div>

        {/* {backgroundMode === "solid" && (
          <label className={cx("fallback-option")}>
            <input
              type="checkbox"
              checked={allowSimplifyFallback}
              onChange={(event) => setAllowSimplifyFallback(event.target.checked)}
            />
            <span>
              主体识别不可靠时，允许生成包含背景的简化版本
              <small>系统故障不会触发此降级</small>
            </span>
          </label>
        )} */}
        {/* <button className={cx("icon-button")} aria-label="查看使用说明" title="上传图片并选择参数，即可生成拼豆图纸">
          <HelpCircle />
        </button> */}
      </header>

      {/* 参数区保留原生 input/select，兼顾键盘、读屏和移动端系统控件。 */}
      <section
        className={cx("card", "settings-card")}
        aria-labelledby="settings-title"
      >
        <h2 id="settings-title">
          <Settings />
          参数设置
        </h2>

        <div className={cx("form-row")}>
          <div className={cx("field-label")}>
            <FieldIcon>
              <Upload />
            </FieldIcon>
            <span>上传图片</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            hidden
          />
          {file && previewUrl ? (
            <div className={cx("file-summary")}>
              {/* Native img keeps local Object URLs lightweight and avoids image optimizer routing. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="待转换图片缩略图" />
              <button
                className={cx("file-meta")}
                type="button"
                onClick={openCropEditor}
              >
                <strong>{file.name}</strong>
                <span>
                  {details
                    ? `${details.width} × ${details.height} · 点击调整`
                    : "正在读取图片…"}
                </span>
              </button>
              <button
                className={cx("remove-file")}
                type="button"
                aria-label="移除图片"
                onClick={() => void removeFile()}
              >
                <X />
              </button>
            </div>
          ) : (
            <button
              className={cx("upload-trigger")}
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              <ImageIcon />
              <span>
                <strong>选择一张图片</strong>
                <small>JPG、PNG 或 WebP，最大 10 MiB</small>
              </span>
            </button>
          )}
        </div>

        <div className={cx("form-row")}>
          <div className={cx("field-label")}>
            <FieldIcon>
              <Sparkles />
            </FieldIcon>
            <span>转换类型</span>
          </div>
          <div
            className={cx("segmented", "conversion-style-options")}
            role="group"
            aria-label="转换类型"
          >
            {CONVERSION_STYLES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx(conversionStyle === option.value && "active")}
                aria-pressed={conversionStyle === option.value}
                disabled={status === "processing"}
                onClick={() => setConversionStyle(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={cx("form-row")}>
          <div className={cx("field-label")}>
            <FieldIcon>
              <Grid2X2 />
            </FieldIcon>
            <span>网格大小</span>
          </div>
          <div className={cx("grid-controls")}>
            <div
              className={cx("segmented", "grid-options")}
              aria-label="快捷网格大小"
            >
              {GRID_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={cx(
                    !customGridSize && gridSize === size && "active",
                  )}
                  onClick={() => {
                    setGridSize(size);
                    setCustomGridSize("");
                    setError(null);
                  }}
                >
                  {size}×{size}
                </button>
              ))}
              <div className={cx("custom-grid-size")}>
                <input
                  type="number"
                  min={MIN_GRID_SIZE}
                  max={MAX_GRID_SIZE}
                  step={1}
                  inputMode="numeric"
                  value={customGridSize}
                  placeholder="自定义"
                  aria-label={`自定义网格大小，${MIN_GRID_SIZE} 到 ${MAX_GRID_SIZE}`}
                  aria-invalid={Boolean(customGridSize) && !isValidCustomGridSize}
                  onChange={handleCustomGridSizeChange}
                />
              {isValidCustomGridSize && (
                <span aria-hidden="true">×{parsedCustomGridSize}</span>
              )}
              </div>
            </div>
          </div>
        </div>

        <div className={cx("form-row")}>
          <label className={cx("field-label")} htmlFor="color-set">
            <FieldIcon>
              <Palette />
            </FieldIcon>
            <span>颜色选项卡</span>
          </label>
          <div className={cx("select-wrap")}>
            <select
              id="color-set"
              value={colorSetSize}
              disabled={!colorSets}
              onChange={(event) => setColorSetSize(Number(event.target.value))}
            >
              {!colorSets && <option>正在加载颜色选项…</option>}
              {colorSets?.sets.map((set) => (
                <option key={set.size} value={set.size}>
                  {set.label}
                  {set.size === 48 ? "（常用套装）" : ""}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </div>
        </div>

        <div className={cx("form-row")}>
          <div className={cx("field-label")}>
            <FieldIcon>
              <Grid2X2 />
            </FieldIcon>
            <span>背景模式</span>
          </div>
          <div className={cx("background-controls")}>
            <div
              className={cx("segmented", "background-options")}
              aria-label="背景模式"
            >
              {BACKGROUNDS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cx(backgroundMode === option.value && "active")}
                  onClick={() => setBackgroundMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {/* <label
              className={cx(
                "color-picker",
                backgroundMode !== "solid" && "disabled",
              )}
              title="选择纯色背景"
            >
              <input
                type="color"
                value={backgroundColor}
                disabled={backgroundMode !== "solid"}
                onChange={(event) =>
                  setBackgroundColor(event.target.value.toUpperCase())
                }
                aria-label="纯色背景颜色"
              />
            </label> */}
          </div>
        </div>

        {error && (
          <div className={cx("error-message")} role="alert">
            {error}
          </div>
        )}
        <div
          className={cx(
            "quota-message",
            quotaState.status === "ready" &&
              quotaState.remainingUses > 0 &&
              quotaState.remainingUses <= 3 &&
              "quota-warning",
            ((quotaState.status === "ready" && quotaState.remainingUses === 0) ||
              quotaState.status === "invalid") &&
              "quota-danger",
          )}
          role="status"
          aria-live="polite"
        >
          {quotaState.status === "loading" && "正在查询剩余次数…"}
          {quotaState.status === "ready" &&
            quotaState.remainingUses > 0 &&
            `剩余转换次数：${quotaState.remainingUses.toLocaleString("zh-CN")} 次`}
          {quotaState.status === "ready" &&
            quotaState.remainingUses === 0 &&
            "转换次数已用完"}
          {quotaState.status === "invalid" && "当前访问链接无效"}
          {quotaState.status === "error" && "剩余次数暂时无法获取"}
        </div>
        <button
          className={cx("primary-button", "convert-button")}
          type="button"
          disabled={
            status === "processing" ||
            !colorSets ||
            quotaState.status === "loading" ||
            quotaState.status === "invalid" ||
            (quotaState.status === "ready" && quotaState.remainingUses === 0)
          }
          onClick={() => void convert()}
        >
          <Sparkles />
          {status === "processing" ? "图片处理中…" : "开始转换"}
        </button>
      </section>

      {isCropOpen && cropSourceUrl && (
        <ImageCropModal
          imageUrl={cropSourceUrl}
          onConfirm={confirmCrop}
          onSkip={() => void skipCrop()}
          onCancel={closeCropEditor}
        />
      )}

      {savePreviewUrl && (
        <ImageSaveGuide imageUrl={savePreviewUrl} onClose={() => setSavePreviewUrl(null)} />
      )}

      {/* idle 时不渲染结果区；processing 与 complete 复用同一语义区域。 */}
      {status !== "idle" && (
        <section
          ref={resultRef}
          className={cx("card", "result-card")}
          aria-labelledby="result-title"
        >
          <div className={cx("card-heading")}>
            <h2 id="result-title">
              <ImageIcon />
              转换结果
            </h2>
            {status === "processing" ? (
              <span className={cx("status-chip", "processing")}>处理中…</span>
            ) : (
              <div className={cx("result-heading-actions")}>
                {deliveryAdminKey && (
                  <button
                    className={cx("delivery-upload-button")}
                    type="button"
                    disabled={isUploadingDelivery || isExporting || !result || !file || !details}
                    onClick={() => void uploadDelivery()}
                  >
                    <UploadCloud />
                    {isUploadingDelivery ? "正在上传…" : "上传并生成链接"}
                  </button>
                )}
                <span className={cx("status-chip", "complete")}>
                  <CheckCircle2 />
                  转换完成
                </span>
              </div>
            )}
          </div>

          {status === "processing" && (
            <div className={cx("processing-panel")} aria-live="polite">
              <Logo />
              <strong>AI 制作中…</strong>
              <p>完成后将匹配合适的拼豆颜色</p>
              <div className={cx("progress-track")}>
                <span />
              </div>
            </div>
          )}

          {status === "complete" && result && (
            <div className={cx("result-content")}>
              {result.meta.degraded && (
                <div className={cx("degraded-notice")} role="status">
                  未能可靠分离主体，已按你的选择生成包含背景的简化版本。
                </div>
              )}
              {delivery && (
                <div className={cx("delivery-link-panel")}>
                  <div>
                    <div className={cx("delivery-link-title")}>
                      <strong>交付链接已生成</strong>
                      <button
                        type="button"
                        aria-label="复制完整交付链接"
                        title={isDeliveryCopied ? "已复制" : "复制完整链接"}
                        onClick={() => void copyDeliveryLink()}
                      >
                        <Copy />
                      </button>
                      <span aria-live="polite">
                        {isDeliveryCopied ? "已复制" : ""}
                      </span>
                    </div>
                    <a href={delivery.previewUrl} target="_blank" rel="noreferrer">
                      {delivery.previewUrl}
                    </a>
                    <small>
                      有效期至{" "}
                      {new Intl.DateTimeFormat("zh-CN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(delivery.expiresAt))}
                    </small>
                  </div>
                </div>
              )}
              <div className={cx("result-grid")}>
                <div className={cx("canvas-wrap")}>
                  <ResultCanvas grid={result} />
                </div>
                <div className={cx("result-sidebar")}>
                  <div className={cx("info-panel")}>
                    <h3>图像信息</h3>
                    <dl>
                      <div>
                        <dt>
                          <Sparkles />
                          {/* 实际转换类型 */}
                        </dt>
                        <dd>
                          {CONVERSION_STYLE_LABELS[result.meta.conversion_style]}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          <Grid2X2 />
                          {/* 网格大小 */}
                        </dt>
                        <dd>
                          {result.width} × {result.height}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          <Palette />
                          {/* 使用颜色 */}
                        </dt>
                        <dd>
                          {result.stats.color_count} /{" "}
                          {result.meta.effective_max_colors}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          <Logo />
                          {/* 总豆数 */}
                        </dt>
                        <dd>{occupiedBeads.toLocaleString("zh-CN")}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className={cx("palette-panel")}>
                    <h3>主要颜色</h3>
                    <div className={cx("swatches")}>
                      {result.foreground.palette.slice(0, 17).map((color) => (
                        <span
                          key={color.id}
                          style={{ backgroundColor: color.hex }}
                          title={`${color.code} · ${color.hex}`}
                        >{color.code}</span>
                      ))}
                      {result.foreground.palette.length > 17 && (
                        <span className={cx("more-colors")}>
                          +{result.foreground.palette.length - 17}
                        </span>
                      )}
                    </div>
                    <p>
                      屏幕色仅供参考，实物可能存在色差
                      {result.background.mode === "solid" && "；纯色背景不计入颜色和豆数"}
                    </p>
                  </div>
                </div>
              </div>
              <div className={cx("result-actions")}>
                <button
                  className={cx("secondary-button")}
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setExportBlob(null);
                    setDelivery(null);
                    setIsDeliveryCopied(false);
                    setStatus("idle");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <RefreshCw />
                  重试
                </button>
                <button
                  className={cx("primary-button")}
                  type="button"
                  disabled={isExporting || !file || !details}
                  onClick={() => void download()}
                >
                  <Download />
                  {isExporting ? "正在导出…" : "导出图纸"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
