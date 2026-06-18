"use client";

import { Plus } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  layoutScore,
  useScoreStore,
  useViewportStore,
} from "@liuxianmao/lxm-tabeditor";
import { BRAVURA_SYMBOLS, STAFF_STRINGS } from "./editor-data";
import styles from "./EditorShell.module.scss";

/**
 * Bravura 只用于 SMuFL 音乐符号。这里显式探测字体加载状态，
 * 避免字体失败时用户看到私用区乱码却没有任何提示。
 */
const useBravuraFontStatus = (): "loading" | "ready" | "failed" => {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    if (!("fonts" in document)) {
      queueMicrotask(() => setStatus("failed"));
      return;
    }

    let mounted = true;
    document.fonts
      .load("16px Bravura")
      .then((fonts) => {
        if (!mounted) return;
        setStatus(fonts.length > 0 ? "ready" : "failed");
      })
      .catch(() => {
        if (mounted) setStatus("failed");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return status;
};

export const ScorePreview: React.FC = () => {
  const score = useScoreStore((state) => state.score);
  const zoom = useViewportStore((state) => state.zoom);
  const fontStatus = useBravuraFontStatus();
  const layout = useMemo(
    () =>
      /**
       * MVP 固定按 720p 桌面基线排版，页面层不再把容器宽度传入 layout。
       * 这样只读谱面的换行结果稳定，后续编辑命中索引不会因为窗口变化而漂移。
       */
      layoutScore(score, {
        zoom,
      }),
    [score, zoom],
  );

  return (
    <main className={styles["canvas-panel"]} aria-label="乐谱编辑区域">
      <div className={styles["tempo-row"]}>
        <span className={`${styles["tempo-note"]} ${styles["music-icon"]}`}>
          {BRAVURA_SYMBOLS.noteQuarter}
        </span>
        <span>= {layout.tempo}</span>
      </div>
      {fontStatus === "failed" ? (
        <p className={styles["font-warning"]}>
          Bravura 字体加载失败，休止符等音乐符号可能显示异常。
        </p>
      ) : null}

      <div className={styles["score-sheet"]}>
        <svg
          className={styles["score-svg"]}
          role="img"
          aria-label={score.title}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width * layout.zoom}
          height={layout.height * layout.zoom}
        >
          {layout.systems.map((system) => (
            /*
             * layout 已经产出绝对 SVG 坐标；system 分组只负责整体平移，
             * 小节、音符、休止符和连音括号不再在 React 层重新计算位置。
             */
            <g
              key={system.index}
              transform={`translate(${system.x} ${system.y})`}
            >
              <text className={styles["tab-prefix-svg"]} x={18} y={58}>
                <tspan x={18} dy={0}>
                  T
                </tspan>
                <tspan x={18} dy={18}>
                  A
                </tspan>
                <tspan x={18} dy={18}>
                  B
                </tspan>
              </text>
              {system.measures.map((measure) => (
                <g
                  className={styles["measure-svg"]}
                  key={measure.id}
                  aria-label={`第 ${measure.number} 小节`}
                >
                  <text
                    className={styles["measure-number-svg"]}
                    x={measure.x + measure.width / 2}
                    y={measure.y + 18}
                  >
                    {measure.number}
                  </text>
                  {measure.showTimeSignature ? (
                    <text
                      className={styles["time-signature-svg"]}
                      x={measure.x - 28}
                      y={measure.y + measure.staffTop + 15}
                    >
                      <tspan x={measure.x - 28} dy={0}>
                        {measure.timeSignature.numerator}
                      </tspan>
                      <tspan x={measure.x - 28} dy={22}>
                        {measure.timeSignature.denominator}
                      </tspan>
                    </text>
                  ) : null}
                  {STAFF_STRINGS.map((stringIndex) => (
                    <line
                      className={styles["staff-line-svg"]}
                      key={`${measure.id}-${stringIndex}`}
                      x1={measure.x}
                      x2={measure.x + measure.width}
                      y1={
                        measure.y +
                        measure.staffTop +
                        (stringIndex - 1) * measure.stringSpacing
                      }
                      y2={
                        measure.y +
                        measure.staffTop +
                        (stringIndex - 1) * measure.stringSpacing
                      }
                    />
                  ))}
                  <line
                    className={styles["barline-svg"]}
                    x1={measure.x}
                    x2={measure.x}
                    y1={measure.y + measure.staffTop}
                    y2={measure.y + measure.staffTop + measure.staffHeight}
                  />
                  <line
                    className={
                      measure.barline === "final"
                        ? `${styles["barline-svg"]} ${styles["barline-final-svg"]}`
                        : styles["barline-svg"]
                    }
                    x1={measure.x + measure.width}
                    x2={measure.x + measure.width}
                    y1={measure.y + measure.staffTop}
                    y2={measure.y + measure.staffTop + measure.staffHeight}
                  />
                  {measure.notes.map((note) => (
                    <g key={note.id}>
                      {note.tied ? (
                        <path
                          className={styles["tie-svg"]}
                          d={`M ${note.x - 14} ${note.y - 11} Q ${note.x} ${
                            note.y - 22
                          } ${note.x + 14} ${note.y - 11}`}
                        />
                      ) : null}
                      <text
                        className={
                          note.ghost
                            ? `${styles["fret-note-svg"]} ${styles["ghost-note-svg"]}`
                            : styles["fret-note-svg"]
                        }
                        x={note.x}
                        y={note.y + 4}
                      >
                        {note.fret}
                      </text>
                    </g>
                  ))}
                  {measure.rests.map((rest) => (
                    <g key={rest.id}>
                      <text
                        className={`${styles["rest-svg"]} ${styles["music-icon"]}`}
                        x={rest.x}
                        y={rest.y + 8}
                      >
                        {rest.symbol}
                      </text>
                      {rest.rhythm.dots > 0 ? (
                        <text
                          className={styles["duration-dots-svg"]}
                          x={rest.x + 15}
                          y={rest.y + 2}
                        >
                          {".".repeat(rest.rhythm.dots)}
                        </text>
                      ) : null}
                    </g>
                  ))}
                  {measure.tuplets.map((tuplet) => (
                    <g className={styles["tuplet-svg"]} key={tuplet.id}>
                      <path
                        d={`M ${tuplet.x1} ${tuplet.y} L ${tuplet.x1} ${
                          tuplet.y - 8
                        } L ${tuplet.x2} ${tuplet.y - 8} L ${tuplet.x2} ${
                          tuplet.y
                        }`}
                      />
                      <text x={(tuplet.x1 + tuplet.x2) / 2} y={tuplet.y - 12}>
                        {tuplet.number}
                      </text>
                    </g>
                  ))}
                </g>
              ))}
            </g>
          ))}
        </svg>
      </div>

      <button className={styles["add-measure-button"]} type="button">
        <Plus aria-hidden="true" size={15} /> 添加小节
      </button>
    </main>
  );
};
