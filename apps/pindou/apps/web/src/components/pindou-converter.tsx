"use client";

import {
  CheckCircle2,
  ChevronDown,
  Download,
  Grid2X2,
  ImageIcon,
  Palette,
  RefreshCw,
  Settings,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { createConversion, getColorSets } from "@/lib/api";
import { drawBeadGrid } from "@/lib/canvas";
import { exportPatternSheet } from "@/lib/pattern-sheet-export";
import type { BackgroundMode, BeadGrid, ColorSetsResponse } from "@/lib/types";
import { validateImage } from "@/lib/validation";

import styles from "./pindou-converter.module.scss";

// 快捷尺寸来自 MVP1 设计稿；自定义尺寸与后端共用同一范围约束。
const GRID_SIZES = [52, 78, 104] as const;
const MIN_GRID_SIZE = 8;
const MAX_GRID_SIZE = 156;

// value 与后端枚举严格一致，label 只负责界面展示。
const BACKGROUNDS: Array<{ value: BackgroundMode; label: string }> = [
  { value: "simplify", label: "简化背景" },
  { value: "solid", label: "纯色背景" },
  { value: "keep", label: "保留原图背景" },
];

type ImageDetails = { width: number; height: number };
type Status = "idle" | "processing" | "complete";

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

export function PindouConverter({ apiKey }: { apiKey?: string }) {
  // DOM 引用：文件选择器由定制按钮触发；结果引用用于转换后平滑定位。
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  // 上传文件状态。previewUrl 仅用于当前浏览器会话，必须在替换/卸载时释放。
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [details, setDetails] = useState<ImageDetails | null>(null);

  // 用户参数状态。最大颜色数按设计约定固定为 18，因此不作为可编辑 state。
  const [gridSize, setGridSize] = useState<number>(52);
  const [customGridSize, setCustomGridSize] = useState("");
  const [colorSets, setColorSets] = useState<ColorSetsResponse | null>(null);
  const [colorSetSize, setColorSetSize] = useState<number>(48);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("solid");
  const [backgroundColor, setBackgroundColor] = useState("#EEF0F6");

  // 转换流程状态。result 只在 complete 时展示，错误后回到 idle 允许直接重试。
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<BeadGrid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // 首次挂载时从后端加载颜色组；卸载时中止请求，防止更新已销毁组件。
  useEffect(() => {
    const controller = new AbortController();
    getColorSets(controller.signal)
      .then((response) => {
        setColorSets(response);
        // 设计稿默认 48 色；若色卡将来移除此组，则尊重后端 default_size。
        setColorSetSize(
          response.sets.some(({ size }) => size === 48)
            ? 48
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

  /**
   * 以新文件完整替换旧上传状态。
   * 文件变化会令旧转换结果失效，因此同时重置结果和流程状态；参数选择保留。
   */
  const replaceFile = async (nextFile: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void replaceFile(event.target.files?.[0] ?? null);
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
          backgroundMode,
          backgroundColor,
        },
        { apiKey },
      );
      setResult(conversion);
      setStatus("complete");
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "转换失败，请稍后重试");
    }
  };

  /** 将网格导出为 PNG，并通过临时 Object URL 触发浏览器下载。 */
  const download = async () => {
    if (!result || !file || !details || isExporting) return;
    setError(null);
    setIsExporting(true);
    try {
      const blob = await exportPatternSheet({
        grid: result,
        sourceFile: file,
        sourceDetails: details,
      });
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

  // 透明格不需要放豆，因此总豆数按非 -1 单元统计，而不是简单 width×height。
  const occupiedBeads = useMemo(
    () =>
      result?.rows.reduce(
        (total, row) => total + row.filter((index) => index !== -1).length,
        0,
      ) ?? 0,
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
      setGridSize(GRID_SIZES[0]);
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
                onClick={() => inputRef.current?.click()}
              >
                <strong>{file.name}</strong>
                <span>
                  {details
                    ? `${details.width} × ${details.height}`
                    : "正在读取图片…"}
                </span>
              </button>
              <button
                className={cx("remove-file")}
                type="button"
                aria-label="移除图片"
                onClick={() => void replaceFile(null)}
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
              />
            </label> */}
          </div>
        </div>

        {error && (
          <div className={cx("error-message")} role="alert">
            {error}
          </div>
        )}
        <button
          className={cx("primary-button", "convert-button")}
          type="button"
          disabled={status === "processing" || !colorSets}
          onClick={() => void convert()}
        >
          <Sparkles />
          {status === "processing" ? "AI 处理中…" : "开始转换"}
        </button>
      </section>

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
              <span className={cx("status-chip", "complete")}>
                <CheckCircle2 />
                转换完成
              </span>
            )}
          </div>

          {status === "processing" && (
            <div className={cx("processing-panel")} aria-live="polite">
              <Logo />
              <strong>AI 正在简化图像…</strong>
              <p>完成后将匹配合适的 MARD 拼豆颜色</p>
              <div className={cx("progress-track")}>
                <span />
              </div>
            </div>
          )}

          {status === "complete" && result && (
            <div className={cx("result-content")}>
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
                          <Grid2X2 />
                          网格大小
                        </dt>
                        <dd>
                          {result.width} × {result.height}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          <Palette />
                          使用颜色
                        </dt>
                        <dd>
                          {result.meta.actual_color_count} /{" "}
                          {result.meta.effective_max_colors}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          <Logo />
                          总豆数
                        </dt>
                        <dd>{occupiedBeads.toLocaleString("zh-CN")}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className={cx("palette-panel")}>
                    <h3>主要颜色</h3>
                    <div className={cx("swatches")}>
                      {result.palette.slice(0, 17).map((color) => (
                        <span
                          key={color.id}
                          style={{ backgroundColor: color.hex }}
                          title={`${color.code} · ${color.hex}`}
                        />
                      ))}
                      {result.palette.length > 17 && (
                        <span className={cx("more-colors")}>
                          +{result.palette.length - 17}
                        </span>
                      )}
                    </div>
                    <p>屏幕色仅供参考，实物可能存在色差</p>
                  </div>
                </div>
              </div>
              <div className={cx("result-actions")}>
                <button
                  className={cx("secondary-button")}
                  type="button"
                  onClick={() => {
                    setResult(null);
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
