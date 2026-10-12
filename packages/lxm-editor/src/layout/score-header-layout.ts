import { scoreHeaderText } from "./score-header-text";
import type { ILXMScore, ILXMTrack } from "../core/types";
import {
  musicTextGlyph,
  musicTextRequest,
  type MusicTextGlyph,
  type ILXMMusicTextMetrics,
} from "./music-text-metrics";

/** 按字形实际宽度累积断行；未知度量使用保守 fallback，不缩字号或裁切。 */
export const layoutScoreHeader = (
  score: ILXMScore,
  track: ILXMTrack,
  x: number,
  y: number,
  width: number,
  metrics?: ILXMMusicTextMetrics,
): { labels: MusicTextGlyph[]; height: number } => {
  const texts = scoreHeaderText(score, track);
  const labels: MusicTextGlyph[] = [];
  let nextY = y + 6;
  const add = (
    text: string,
    size: number,
    anchor: "middle" | "end" | "start",
  ) => {
    if (!text) return;
    const rows: string[] = [];
    let row = "",
      used = 0;
    for (const char of text) {
      const glyph = musicTextGlyph(
        musicTextRequest(char, size, "start"),
        0,
        0,
        metrics,
      );
      const advance = glyph.bounds.width; // 含安全净空，避免累积字形发生碰撞。
      if (row && used + advance > width - 8) {
        rows.push(row);
        row = "";
        used = 0;
      }
      row += char;
      used += advance;
    }
    if (row) rows.push(row);
    rows.forEach((line) => {
      const chars = [...line].map((c) =>
        musicTextGlyph(musicTextRequest(c, size, "start"), 0, 0, metrics),
      );
      const lineWidth = chars.reduce((sum, c) => sum + c.bounds.width, 0);
      const ascent = Math.max(size, ...chars.map((c) => -c.bounds.y));
      const descent = Math.max(
        size * 0.3,
        ...chars.map((c) => c.bounds.y + c.bounds.height),
      );
      const request = musicTextRequest(line, size, anchor);
      const bbox = {
        x:
          anchor === "middle"
            ? -lineWidth / 2
            : anchor === "end"
              ? -lineWidth
              : 0,
        y: -ascent,
        width: lineWidth,
        height: ascent + descent,
      };
      labels.push(
        musicTextGlyph(
          request,
          anchor === "middle"
            ? x + width / 2
            : anchor === "end"
              ? x + width - 4
              : x + 4,
          nextY + ascent,
          { [request.key]: bbox },
        ),
      );
      // 收紧行间留白，行高仍由实际字形决定，折行文字不会被固定高度裁切。
      nextY += ascent + descent + 4;
    });
    nextY += 2;
  };
  add(texts.title, 20, "middle");
  add(texts.author, 12, "middle");
  add(texts.info, 12, "start");
  // 首条谱行只保留必要尾部净空，其技巧/和弦占位仍由正文布局负责。
  return { labels, height: nextY - y + 2 };
};
