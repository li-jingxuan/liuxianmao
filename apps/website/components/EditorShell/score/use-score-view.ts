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
  type ScoreViewMode,
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

/** Screen-only geometry. Export and print must keep using presentation layouts. */
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
  const [modeState, setModeState] = useState<{ sessionKey: unknown; mode: ScoreViewMode }>(
    () => ({ sessionKey, mode: "fit" }),
  );
  // Adjust during render so revisiting a previous session cannot revive its old mode.
  if (!Object.is(modeState.sessionKey, sessionKey)) setModeState({ sessionKey, mode: "fit" });
  const mode = Object.is(modeState.sessionKey, sessionKey) ? modeState.mode : "fit";
  const [viewportWidth, setViewportWidth] = useState(0);
  const geometry = useMemo(() => calculateScoreView({
    layoutWidth, layoutHeight, viewportWidth, mode, gutter, visibleWidth, visibleHeight,
  }), [layoutWidth, layoutHeight, viewportWidth, mode, gutter, visibleWidth, visibleHeight]);
  const previous = useRef<{ geometry: ScoreViewGeometry; sessionKey: unknown; viewportWidth: number } | null>(null);
  const lastScroll = useRef<ScoreViewScroll | null>(null);
  const pendingAnchor = useRef<ScoreViewAnchor | null>(null);
  const latest = useRef({ geometry, gutter, topInset, sessionKey, viewportWidth, onGeometryChange });

  const setMode = useCallback((next: ScoreViewMode) => {
    if (lastScroll.current) {
      pendingAnchor.current = captureScoreViewAnchor(
        latest.current.geometry, lastScroll.current,
        latest.current.gutter, latest.current.topInset,
      );
    }
    setModeState({ sessionKey: latest.current.sessionKey, mode: next });
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
        // Direct assignment avoids inherited smooth-scroll animation while matrices change.
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
  }, [geometry, sessionKey, gutter, topInset, viewportWidth, viewportRef, onGeometryChange, modeState.sessionKey]);

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
  return { mode, setMode, geometry, stageStyle, paperStyle, svgStyle, viewportStyle };
}
