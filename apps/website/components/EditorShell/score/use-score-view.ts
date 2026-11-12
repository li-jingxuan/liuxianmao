"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import {
  calculateScoreView,
  captureScoreViewAnchor,
  isScoreViewGeometryEqual,
  restoreScoreViewAnchor,
  SCORE_VIEW_GUTTER,
  type ScoreViewAnchor,
  type ScoreViewGeometry,
  type ScoreZoom,
  type ScoreViewScroll,
} from "./score-view";

export interface UseScoreViewOptions {
  viewportRef: RefObject<HTMLDivElement | null>;
  layoutWidth: number;
  layoutHeight: number;
  /** Change on document/session replacement, not on document revision. */
  sessionKey?: unknown;
  /** Keep viewport CSS padding synchronized when overriding these defaults. */
  gutter?: number;
  topInset?: number;
  visibleWidth?: number;
  visibleHeight?: number;
  /** After the DOM transform and scroll restoration: cancel drag and remeasure overlays. */
  onGeometryChange?: (next: ScoreViewGeometry, previous: ScoreViewGeometry) => void;
}

/** 仅供编辑视图使用；打印和导出继续使用独立的成品排版。 */
export function useScoreView({
  viewportRef,
  layoutWidth,
  layoutHeight,
  sessionKey,
  gutter = SCORE_VIEW_GUTTER,
  topInset = 30,
  visibleWidth,
  visibleHeight,
  onGeometryChange,
}: UseScoreViewOptions) {
  const [zoomState, setZoomState] = useState<{ sessionKey: unknown; zoom: ScoreZoom }>(
    () => ({ sessionKey, zoom: 125 }),
  );
  // 替换会话时恢复默认倍率；普通修订和撤销不会改变 sessionKey。
  if (!Object.is(zoomState.sessionKey, sessionKey)) setZoomState({ sessionKey, zoom: 125 });
  const zoom = Object.is(zoomState.sessionKey, sessionKey) ? zoomState.zoom : 125;
  const [viewportWidth, setViewportWidth] = useState(0);
  const geometry = useMemo(() => calculateScoreView({
    layoutWidth, layoutHeight, zoom, visibleWidth, visibleHeight,
  }), [layoutWidth, layoutHeight, zoom, visibleWidth, visibleHeight]);
  const previous = useRef<{ geometry: ScoreViewGeometry; sessionKey: unknown; viewportWidth: number } | null>(null);
  const lastScroll = useRef<ScoreViewScroll | null>(null);
  const pendingAnchor = useRef<ScoreViewAnchor | null>(null);
  const latest = useRef({ geometry, gutter, topInset, sessionKey, viewportWidth, onGeometryChange });

  const setZoom = useCallback((next: ScoreZoom) => {
    // 在倍率提交前捕获中心点，DOM 变换后沿用既有滚动恢复链路。
    if (lastScroll.current) {
      pendingAnchor.current = captureScoreViewAnchor(
        latest.current.geometry, lastScroll.current,
        latest.current.gutter, latest.current.topInset,
      );
    }
    setZoomState({ sessionKey: latest.current.sessionKey, zoom: next });
  }, []);

  useLayoutEffect(() => {
    latest.current = { geometry, gutter, topInset, sessionKey, viewportWidth, onGeometryChange };
    const viewport = viewportRef.current;
    const old = previous.current;
    const newSession = old && !Object.is(old.sessionKey, sessionKey);
    const changed = old && (!isScoreViewGeometryEqual(old.geometry, geometry) || old.viewportWidth !== viewportWidth);
    if (viewport && old && (changed || newSession)) {
      const anchor = pendingAnchor.current ?? (lastScroll.current && captureScoreViewAnchor(
        old.geometry, lastScroll.current, gutter, topInset,
      ));
      if (newSession) {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      } else if (anchor) {
        const position = restoreScoreViewAnchor(anchor, geometry, {
          viewportWidth: viewport.clientWidth,
          viewportHeight: viewport.clientHeight,
        }, gutter, topInset);
        // 直接赋值，避免矩阵变化期间继承平滑滚动造成视图跳动。
        viewport.scrollLeft = position.left;
        viewport.scrollTop = position.top;
      }
      onGeometryChange?.(geometry, old.geometry);
    }
    pendingAnchor.current = null;
    previous.current = { geometry, sessionKey, viewportWidth };
    if (viewport) lastScroll.current = {
      left: viewport.scrollLeft, top: viewport.scrollTop,
      viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight,
    };
  }, [geometry, sessionKey, gutter, topInset, viewportWidth, viewportRef, onGeometryChange, zoomState.sessionKey]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame: number | null = null;
    const rememberScroll = () => {
      lastScroll.current = {
        left: viewport.scrollLeft, top: viewport.scrollTop,
        viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight,
      };
    };
    const measure = () => {
      frame = null;
      const current = latest.current;
      if (viewport.clientWidth === current.viewportWidth) return;
      if (lastScroll.current && !pendingAnchor.current) {
        pendingAnchor.current = captureScoreViewAnchor(
          current.geometry, lastScroll.current, current.gutter, current.topInset,
        );
      }
      setViewportWidth(viewport.clientWidth);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    measure();
    viewport.addEventListener("scroll", rememberScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(viewport);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      viewport.removeEventListener("scroll", rememberScroll);
      window.removeEventListener("resize", schedule);
    };
  }, [viewportRef]);

  const stageStyle: CSSProperties = {
    width: geometry.width,
    height: geometry.height,
  };
  const paperStyle: CSSProperties = {
    minHeight: geometry.baseHeight,
    transform: `scale(${geometry.scale})`,
  };
  const svgStyle: CSSProperties = { width: geometry.svgWidth };
  const viewportStyle: CSSProperties = { paddingInline: gutter, paddingTop: topInset };
  return { zoom, setZoom, geometry, stageStyle, paperStyle, svgStyle, viewportStyle };
}
