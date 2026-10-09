import type { ILXMDocument } from "../core/types";

export interface ILXMMusicTextMeasureRequest {
  key: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAnchor: "middle" | "start" | "end";
}
export interface ILXMMusicTextMetric {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type ILXMMusicTextMetrics = Readonly<
  Record<string, ILXMMusicTextMetric>
>;
export interface MusicTextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MusicTextGlyph extends ILXMMusicTextMeasureRequest {
  x: number;
  y: number;
  fill?: string;
  bounds: MusicTextRect;
  measured: boolean;
}
export const MUSIC_TEXT_FONT =
  'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
export const MUSIC_TEXT_GAP = 6;
export const MUSIC_TEXT_LANE_GAP = 8;

/** 度量与渲染共同消费字体和 anchor，避免继承样式产生漂移。 */
export const musicTextRequest = (
  text: string,
  fontSize = 13,
  textAnchor: ILXMMusicTextMeasureRequest["textAnchor"] = "middle",
  fontWeight = 400,
): ILXMMusicTextMeasureRequest => {
  const values = [
    text,
    MUSIC_TEXT_FONT,
    fontSize,
    fontWeight,
    textAnchor,
  ] as const;
  return {
    key: JSON.stringify(values),
    text,
    fontFamily: MUSIC_TEXT_FONT,
    fontSize,
    fontWeight,
    textAnchor,
  };
};
/** 无 DOM 的保守 fallback；真实客户端会注入有限数值的 bbox 快照。 */
export const musicTextGlyph = (
  request: ILXMMusicTextMeasureRequest,
  x = 0,
  y = 0,
  metrics?: ILXMMusicTextMetrics,
): MusicTextGlyph => {
  const candidate = metrics?.[request.key];
  const measured =
    !!candidate &&
    Object.values(candidate).every(Number.isFinite) &&
    candidate.width >= 0 &&
    candidate.height >= 0;
  const width = [...request.text].length * request.fontSize * 1.2;
  const metric = measured
    ? candidate!
    : {
        x:
          request.textAnchor === "middle"
            ? -width / 2
            : request.textAnchor === "end"
              ? -width
              : 0,
        y: -request.fontSize,
        width,
        height: request.fontSize * 1.3,
      };
  return {
    ...request,
    x,
    y,
    measured,
    bounds: {
      x: x + metric.x - 2,
      y: y + metric.y - 2,
      width: metric.width + 4,
      height: metric.height + 4,
    },
  };
};
/** 请求去重且不读取布局；首次服务端/客户端均使用相同估算。 */
export const collectMusicTextMeasureRequests = (
  document: ILXMDocument,
): ILXMMusicTextMeasureRequest[] => {
  const requests: ILXMMusicTextMeasureRequest[] = [];
  for (const measure of document.score.tracks[0]?.measures ?? []) {
    for (const lyric of measure.lyrics) {
      requests.push(
        musicTextRequest(lyric.text),
        musicTextRequest(`${lyric.verse}.`, 13, "start"),
      );
    }
    for (const symbol of measure.chordSymbols) {
      requests.push(musicTextRequest(symbol.chord.name, 13, "middle", 600));
      const diagram =
        symbol.display === "nameAndDiagram" ? symbol.chord.diagram : null;
      if (diagram) {
        if (diagram.startFret > 1)
          requests.push(musicTextRequest(String(diagram.startFret), 9, "end"));
        for (const s of diagram.strings) {
          if (s.fret === "x" || s.fret === 0)
            requests.push(musicTextRequest(s.fret === "x" ? "×" : "○", 9));
          if (s.finger) requests.push(musicTextRequest(String(s.finger), 7));
        }
        for (const b of diagram.barres)
          requests.push(musicTextRequest(String(b.finger), 7));
      }
    }
  }
  // 稀疏段号仍会输出之前的空槽标签，度量请求必须覆盖这些实际渲染文字。
  const maxVerse = Math.max(
    0,
    ...(document.score.tracks[0]?.measures ?? []).flatMap((m) =>
      m.lyrics.map((l) => l.verse),
    ),
  );
  for (let verse = 1; verse <= maxVerse; verse++)
    requests.push(musicTextRequest(`${verse}.`, 13, "start"));
  return [...new Map(requests.map((r) => [r.key, r])).values()];
};
/** 图元包围框的统一合并，供 spacing、高度和命中使用。 */
export const unionMusicBounds = (rects: MusicTextRect[]): MusicTextRect => {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
};
