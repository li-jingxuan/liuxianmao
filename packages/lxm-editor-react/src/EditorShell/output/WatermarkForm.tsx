"use client";

import { RotateLeftOutlined, RotateRightOutlined } from "@ant-design/icons";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import {
  createExampleWatermarkAsset,
  DEFAULT_WATERMARK_STYLE,
  WATERMARK_LIMITS,
  readWatermarkAsset,
  type ScoreWatermark,
  type WatermarkAsset,
  type WatermarkStyle,
} from "./score-watermark";
import styles from "./watermark-form.module.scss";

const textLimit = 32;
const graphemes = new Intl.Segmenter("zh", { granularity: "grapheme" });
const lineBreaks = /(?:\r\n|\r|\n)+/g;
// 文字和图片水印共用预设组。方向图标用于辅助识别，按钮的无障碍名称完整描述旋转方向与角度。
const angles = [
  {
    value: -30,
    label: "−30°",
    name: "逆时针旋转到 30 度",
    icon: RotateLeftOutlined,
  },
  { value: 0, label: "水平 0°", name: "恢复水平，0 度", icon: null },
  {
    value: 30,
    label: "+30°",
    name: "顺时针旋转到 30 度",
    icon: RotateRightOutlined,
  },
] as const;
const positions = [
  { value: "center", label: "居中" },
  { value: "left", label: "左下" },
  { value: "right", label: "右下" },
] as const;

type ImageWatermark = Extract<ScoreWatermark, { kind: "image" }>;
type TextWatermark = Extract<ScoreWatermark, { kind: "text" }>;
type ImageDraft = Omit<ImageWatermark, "asset"> & {
  asset: WatermarkAsset | null;
};
type WatermarkDraft = {
  base: ScoreWatermark;
  enabled: boolean;
  kind: "text" | "image";
  text: TextWatermark;
  image: ImageDraft;
  reading: boolean;
  uploadError: string;
};

const newDraft = (base: ScoreWatermark): WatermarkDraft => ({
  base,
  enabled: base !== null,
  kind: base?.kind ?? "text",
  text:
    base?.kind === "text"
      ? base
      : { kind: "text", ...DEFAULT_WATERMARK_STYLE.text, text: "" },
  image:
    base?.kind === "image"
      ? base
      : { kind: "image", ...DEFAULT_WATERMARK_STYLE.image, asset: null },
  reading: false,
  uploadError: "",
});

/** 内容和样式共同决定成品是否失效。仅整理首尾空白且样式一致时，可继续使用旧成品。 */
export const sameWatermark = (a: ScoreWatermark, b: ScoreWatermark) => {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    a.kind !== b.kind ||
    a.size !== b.size ||
    a.opacity !== b.opacity ||
    a.angle !== b.angle ||
    a.position !== b.position
  )
    return false;
  return a.kind === "text"
    ? b.kind === "text" && a.text === b.text
    : b.kind === "image" && a.asset === b.asset;
};

/** 草稿只存在一个预览里。弹窗读取同一份状态决定试排和输出锁，表单负责编辑它。 */
export const useWatermarkDraft = (watermark: ScoreWatermark) => {
  const [state, setState] = useState(() => newDraft(watermark));
  const readVersion = useRef(0);
  const draft = state.base === watermark ? state : newDraft(watermark);
  // 已应用值由会话持有。外部更新时在提交画面前重置，避免错误地把原值当作新草稿。
  if (draft !== state) setState(draft);
  useLayoutEffect(
    () => () => {
      readVersion.current += 1;
    },
    [watermark],
  );

  const { enabled, kind, text, image, reading } = draft;
  const trimmed = text.text.trim();
  const count = [...graphemes.segment(trimmed)].length;
  const imageValue = image.asset ? { ...image, asset: image.asset } : undefined;
  const textError =
    count === 0
      ? "请输入水印文字。"
      : count > textLimit
        ? `请减少 ${count - textLimit} 个字符，最多 ${textLimit} 个。`
        : "";
  const error = !enabled
    ? ""
    : kind === "text"
      ? textError
      : reading
        ? "正在读取图片…"
        : imageValue
          ? ""
          : "请选择图片，或试用示例。";
  const value: ScoreWatermark | undefined = !enabled
    ? null
    : error
      ? undefined
      : kind === "text"
        ? { ...text, text: trimmed }
        : imageValue;
  const dirty =
    value === undefined ||
    !sameWatermark(value, watermark) ||
    (enabled &&
      kind === "text" &&
      watermark?.kind === "text" &&
      text.text !== watermark.text);
  // 试排值只交给当前页。文字不合法时回到已应用的预览，换图解码期间继续展示上一张可用的草稿图片。
  const trial =
    dirty && enabled ? (kind === "image" ? imageValue : value) : undefined;

  const setEnabled = (next: boolean) => {
    readVersion.current += 1;
    setState((old) => ({
      ...old,
      enabled: next,
      reading: false,
      uploadError: "",
    }));
  };
  const setKind = (next: "text" | "image") => {
    if (next === kind) return;
    readVersion.current += 1;
    setState((old) => ({
      ...old,
      kind: next,
      reading: false,
      uploadError: "",
    }));
  };
  const reset = () => {
    readVersion.current += 1;
    setState(newDraft(watermark));
  };
  const load = async (
    source: () => WatermarkAsset | Promise<WatermarkAsset>,
  ) => {
    // 替换、还原、切换类型和卸载都会废弃前一次读取，较慢的解码不能覆盖后来选中的图片。
    const version = ++readVersion.current;
    setState((old) => ({ ...old, reading: true, uploadError: "" }));
    try {
      const asset = await source();
      if (version !== readVersion.current) return;
      setState((old) => ({
        ...old,
        image: { ...old.image, asset },
        reading: false,
      }));
    } catch (cause) {
      if (version !== readVersion.current) return;
      const reason =
        cause instanceof Error && cause.message
          ? cause.message
          : "无法读取这张图片，请换一张。";
      setState((old) => ({
        ...old,
        reading: false,
        uploadError: reason + (old.image.asset ? " 已保留原图。" : ""),
      }));
    }
  };

  return {
    ...draft,
    count,
    error,
    value,
    dirty,
    trial,
    setEnabled,
    setKind,
    reset,
    load,
    setText: (next: string) => {
      setState((old) => ({ ...old, text: { ...old.text, text: next } }));
    },
    setStyle: (style: Partial<WatermarkStyle>) => {
      // 两种水印各自保存弹窗内的草稿。切换类型时保留正在试过的布局，避免把图片长边百分比用作文字字号。
      setState((old) => ({ ...old, [kind]: { ...old[kind], ...style } }));
    },
  };
};

const rangeFields = [
  { field: "size", label: { image: "图片长边", text: "文字大小" } },
  { field: "opacity", label: "不透明度" },
  { field: "angle", label: "旋转角度" },
] as const;

export const WatermarkForm = ({
  draft,
  disabled,
  onApply,
}: {
  draft: ReturnType<typeof useWatermarkDraft>;
  disabled: boolean;
  onApply: (value: ScoreWatermark) => boolean;
}) => {
  const id = useId();
  const switchRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const {
    enabled,
    kind,
    text: { text },
    image: { asset },
    reading,
    uploadError,
    count,
    error,
    dirty,
    value,
  } = draft;
  const style = draft[kind];
  const { angle, position } = style;
  // 文字校验紧跟输入框，并通过 aria-describedby 关联。下方只显示试排状态或图片选择提示，避免重复播报错误。
  let feedback = kind === "image" && !uploadError ? error : "";
  if (!enabled && dirty) feedback = "应用后将移除全部页的水印。";
  else if (dirty && !error) feedback = "当前页正在试排，应用后更新全部谱页。";
  else if (enabled && !dirty) feedback = "已应用于本曲谱的全部页。";

  const restore = () => {
    setDragging(false);
    draft.reset();
    switchRef.current?.focus({ preventScroll: true });
  };
  const apply = () => {
    if (!disabled && dirty && value !== undefined && onApply(value)) restore();
  };
  const chooseFile = (file?: File) => {
    if (!disabled && enabled && kind === "image" && file)
      void draft.load(() => readWatermarkAsset(file));
  };
  const pasteText = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text/plain");
    if (!/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    // 单行输入会丢掉粘贴的换行。主动替换为一个空格，并保留原来的选区替换与光标位置。
    const input = event.currentTarget;
    input.setRangeText(
      pasted.replace(lineBreaks, " "),
      input.selectionStart ?? 0,
      input.selectionEnd ?? 0,
      "end",
    );
    draft.setText(input.value);
  };

  return (
    <section className={styles.form} aria-labelledby={`${id}-heading`}>
      <div className={styles.heading}>
        <h3 id={`${id}-heading`}>自定义水印</h3>
        <button
          ref={switchRef}
          className={styles.switch}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="自定义水印"
          disabled={disabled}
          onClick={() => {
            setDragging(false);
            draft.setEnabled(!enabled);
            if (!enabled)
              requestAnimationFrame(() => {
                if (document.activeElement === switchRef.current)
                  (kind === "image" ? upload : textRef).current?.focus();
              });
          }}
        >
          <span />
        </button>
      </div>
      {!enabled ? (
        !dirty && (
          <p className={styles.feedback}>
            为每页曲谱添加文字署名或自己的标志。
          </p>
        )
      ) : (
        <>
          <div className={styles.kind} role="group" aria-label="水印类型">
            {(["text", "image"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                disabled={disabled}
                onClick={() => {
                  setDragging(false);
                  draft.setKind(option);
                }}
              >
                {option === "text" ? "文字水印" : "图片水印"}
              </button>
            ))}
          </div>
          {kind === "text" ? (
            <>
              <div className={styles.fieldLabel}>
                <label htmlFor={`${id}-text`}>水印文字</label>
                <span id={`${id}-count`}>
                  {count} / {textLimit}
                </span>
              </div>
              <input
                ref={textRef}
                id={`${id}-text`}
                className={styles.textInput}
                type="text"
                autoComplete="off"
                placeholder="例如：青禾吉他教室 · 练习用"
                disabled={disabled}
                value={text}
                aria-invalid={!!error}
                aria-describedby={`${id}-text-error ${id}-count`}
                onChange={(event) => draft.setText(event.currentTarget.value)}
                onPaste={pasteText}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.repeat &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
                    // 应用后焦点回到开关，消费本次 Enter，避免同一次按键又切换开关。
                    event.preventDefault();
                    apply();
                  }
                }}
              />
              <p
                id={`${id}-text-error`}
                className={styles.error}
                aria-live="polite"
              >
                {error}
              </p>
            </>
          ) : (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={disabled}
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  // 重置原生控件以便连续选择同名文件，大小、格式和解码仍交给共享资源读取器。
                  event.currentTarget.value = "";
                  chooseFile(file);
                }}
              />
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = disabled ? "none" : "copy";
                  if (!disabled) setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                  )
                    setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  chooseFile(event.dataTransfer.files[0]);
                }}
              >
                <button
                  ref={upload}
                  className={styles.upload}
                  data-dragging={dragging && !disabled ? true : undefined}
                  type="button"
                  disabled={disabled}
                  aria-label={asset ? "替换图片" : "选择图片"}
                  aria-describedby={`${id}-upload-help ${id}-upload-message`}
                  onClick={() => fileInput.current?.click()}
                >
                  {asset ? (
                    <span className={styles.asset}>
                      <span className={styles.assetTile}>
                        <img src={asset.url} alt="" />
                      </span>
                      <span className={styles.assetDetails}>
                        <strong title={asset.name}>{asset.name}</strong>
                        <small>
                          {asset.width} × {asset.height} px
                        </small>
                        <span>替换图片</span>
                      </span>
                    </span>
                  ) : (
                    <span className={styles.emptyUpload}>
                      <strong>选择图片</strong>
                      <small>或拖放图片到这里</small>
                    </span>
                  )}
                </button>
              </div>
              <div className={styles.uploadFoot}>
                <small id={`${id}-upload-help`}>
                  PNG、JPG、WebP · 最大 5 MB
                </small>
                {!asset && (
                  <button
                    className={styles.example}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      void draft.load(createExampleWatermarkAsset);
                      upload.current?.focus({ preventScroll: true });
                    }}
                  >
                    试用示例
                  </button>
                )}
              </div>
              <p
                id={`${id}-upload-message`}
                className={styles.error}
                role="status"
              >
                {uploadError}
              </p>
            </>
          )}
          {(kind === "text" || asset) && (
            <fieldset
              className={styles.placement}
              disabled={disabled || (kind === "image" && reading)}
            >
              {rangeFields.map(({ field, label }) => {
                const current = style[field];
                const { min, max } = WATERMARK_LIMITS[kind][field];
                const formatted =
                  field === "size"
                    ? kind === "image"
                      ? `纸宽的 ${current}%`
                      : `${current} px`
                    : field === "opacity"
                      ? `${current}%`
                      : `${current > 0 ? "+" : ""}${current}°`;
                const spoken =
                  field === "angle"
                    ? angle === 0
                      ? "水平，0 度"
                      : `${angle < 0 ? "逆时针" : "顺时针"} ${Math.abs(angle)} 度`
                    : formatted;
                return (
                  <div key={field} className={styles.range}>
                    <div className={styles.fieldLabel}>
                      <label htmlFor={`${id}-${field}`}>
                        {typeof label === "string" ? label : label[kind]}
                      </label>
                      <span aria-hidden="true">{formatted}</span>
                    </div>
                    <input
                      id={`${id}-${field}`}
                      type="range"
                      min={min}
                      max={max}
                      step={1}
                      value={current}
                      aria-valuetext={spoken}
                      onChange={(event) =>
                        draft.setStyle({
                          [field]: event.currentTarget.valueAsNumber,
                        })
                      }
                    />
                    {field === "angle" && (
                      <div
                        className={styles.options}
                        role="group"
                        aria-label="常用角度"
                      >
                        {angles.map(
                          ({ value: degrees, label, name, icon: Icon }) => (
                            <button
                              key={degrees}
                              type="button"
                              aria-label={name}
                              aria-pressed={angle === degrees}
                              onClick={() => draft.setStyle({ angle: degrees })}
                            >
                              {Icon && <Icon aria-hidden="true" />}
                              {label}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className={styles.positionLabel} id={`${id}-position`}>
                每页位置
              </div>
              <div
                className={styles.options}
                role="group"
                aria-labelledby={`${id}-position`}
              >
                {positions.map(({ value: option, label }) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={position === option}
                    onClick={() => draft.setStyle({ position: option })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}
      <p className={styles.feedback} aria-live="polite">
        {feedback}
      </p>
      {dirty && (
        <div className={styles.actions}>
          <button
            className={styles.apply}
            type="button"
            disabled={disabled || value === undefined}
            onClick={apply}
          >
            应用到全部页
          </button>
          <button type="button" disabled={disabled} onClick={restore}>
            还原
          </button>
        </div>
      )}
    </section>
  );
};
