import type {
  ILXMMusicTextMeasureRequest,
  ILXMMusicTextMetric,
} from "@liuxianmao/lxm-editor";

/** SVG 的音乐字体框包含整套字库上下界；音乐符号改用墨迹度量，页面与导出共用。 */
export const createMusicTextMetricReader = (svg: SVGSVGElement) => {
  let context: CanvasRenderingContext2D | null | undefined;
  return (request: ILXMMusicTextMeasureRequest): ILXMMusicTextMetric => {
    if (request.fontFamily === "Bravura") {
      context ??= document.createElement("canvas").getContext("2d");
      if (context?.measureText) {
        context.font = `${request.fontWeight} ${request.fontSize}px ${request.fontFamily}`;
        context.textAlign =
          request.textAnchor === "middle" ? "center" : request.textAnchor;
        context.textBaseline = "alphabetic";
        const m = context.measureText(request.text);
        const metric = {
          x: -m.actualBoundingBoxLeft,
          y: -m.actualBoundingBoxAscent,
          width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
          height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
        };
        if (
          Object.values(metric).every(Number.isFinite) &&
          metric.width > 0 &&
          metric.height > 0
        )
          return metric;
      }
    }
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = request.text;
    text.style.whiteSpace = "pre";
    for (const [key, value] of Object.entries({
      x: 0,
      y: 0,
      "font-family": request.fontFamily,
      "font-size": request.fontSize,
      "font-weight": request.fontWeight,
      "text-anchor": request.textAnchor,
      "dominant-baseline": "alphabetic",
    }))
      text.setAttribute(key, String(value));
    svg.appendChild(text);
    try {
      const b = text.getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    } finally {
      text.remove();
    }
  };
};
