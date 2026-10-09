import { useEffect, useMemo, useState, useRef } from "react";
import {
  collectMusicTextMeasureRequests,
  type ILXMDocument,
  type ILXMMusicTextMetrics,
} from "@liuxianmao/lxm-editor";

/** 挂载后的真实 SVG 度量快照；核心和 SSR 不接触 DOM。 */
export const useMusicTextMetrics = (
  score: ILXMDocument | null,
): ILXMMusicTextMetrics | undefined => {
  const requests = useMemo(
    () => (score ? collectMusicTextMeasureRequests(score) : []),
    [score],
  );
  const [state, setState] = useState<{
    requests: typeof requests;
    metrics: ILXMMusicTextMetrics;
  } | null>(null);
  const cacheRef = useRef(new Map<string, ILXMMusicTextMetrics[string]>());
  useEffect(() => {
    if (!requests.length) return;
    let cancelled = false;
    const cache = cacheRef.current;
    const measure = () => {
      if (cancelled) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.style.cssText =
        "position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;overflow:visible";
      document.body.appendChild(svg);
      const metrics: Record<string, ILXMMusicTextMetrics[string]> = {};
      try {
        for (const request of requests) {
          const found = cache.get(request.key);
          if (found) {
            cache.delete(request.key);
            cache.set(request.key, found);
            metrics[request.key] = found;
            continue;
          }
          const text = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
          );
          text.textContent = request.text;
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
          text.style.whiteSpace = "pre";
          svg.appendChild(text);
          let box: DOMRect;
          try {
            box = text.getBBox();
          } catch {
            text.remove();
            continue;
          }
          if (
            [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
            box.width > 0 &&
            box.height > 0
          ) {
            const metric = {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            };
            metrics[request.key] = metric;
            cache.set(request.key, metric);
            if (cache.size > 2048) cache.delete(cache.keys().next().value!);
          }
          text.remove();
        }
        if (!cancelled) setState({ requests, metrics });
      } finally {
        svg.remove();
      }
    };
    void document.fonts.ready.then(measure, measure);
    const reload = () => {
      cache.clear();
      measure();
    };
    document.fonts.addEventListener("loadingdone", reload);
    document.fonts.addEventListener("loadingerror", reload);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener("loadingdone", reload);
      document.fonts.removeEventListener("loadingerror", reload);
    };
  }, [requests]);
  return state?.requests === requests ? state.metrics : undefined;
};
