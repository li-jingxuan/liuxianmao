"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { ILXMLayout } from "@liuxianmao/lxm-editor";
import type { ScorePlaybackControls } from "./controller";
import styles from "../score/score-interaction.module.scss";

type CursorProps = {
  layout: ILXMLayout;
  viewportRef: RefObject<HTMLDivElement | null>;
  playback: ScorePlaybackControls;
};

function locateBeat(layout: ILXMLayout, measureId: string, beatId: string) {
  for (const row of layout.systems) {
    const measure = row.measures.find((item) => item.id === measureId);
    const beat = measure?.beats.find((item) => item.id === beatId);
    const top = measure?.strings[0];
    const bottom = measure?.strings.at(-1);
    if (beat && top && bottom) {
      return { x: beat.x, top: top.y1 - 6, bottom: bottom.y1 + 6, system: row.index };
    }
  }
  return null;
}

export const ScorePlaybackCursor = ({ layout, viewportRef, playback }: CursorProps) => {
  const { follow, phase, position, suspendFollow } = playback;
  const marker = useRef<SVGRectElement>(null);
  const scrollIntentUntil = useRef(0);
  const lastRow = useRef<{ system: number; measureId: string; beatId: string; visitIndex: number } | null>(null);
  const measureId = position?.measureId;
  const beatId = position?.beatId;
  const visitIndex = position?.visitIndex;
  const bounds = measureId && beatId ? locateBeat(layout, measureId, beatId) : null;

  const active = phase === "loading" || phase === "playing" || phase === "paused";
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !active || !follow) return;
    let draggingScrollbar = false;
    const markIntent = () => { scrollIntentUntil.current = performance.now() + 250; };
    const keyScroll = (event: KeyboardEvent) => {
      if (event.target instanceof Node && viewport.contains(event.target) && !event.defaultPrevented &&
        ["PageUp", "PageDown", "Home", "End", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) markIntent();
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.target !== viewport || event.button !== 0) return;
      const area = viewport.getBoundingClientRect();
      draggingScrollbar = event.clientX >= area.left + viewport.clientWidth ||
        event.clientY >= area.top + viewport.clientHeight;
      if (draggingScrollbar) markIntent();
    };
    const pointerUp = () => { draggingScrollbar = false; };
    const onScroll = () => {
      if (draggingScrollbar || performance.now() < scrollIntentUntil.current) {
        scrollIntentUntil.current = 0;
        suspendFollow();
      }
    };
    viewport.addEventListener("wheel", markIntent, { passive: true });
    viewport.addEventListener("touchmove", markIntent, { passive: true });
    window.addEventListener("keydown", keyScroll);
    viewport.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", markIntent);
      viewport.removeEventListener("touchmove", markIntent);
      window.removeEventListener("keydown", keyScroll);
      viewport.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      viewport.removeEventListener("scroll", onScroll);
      scrollIntentUntil.current = 0;
    };
  }, [active, follow, suspendFollow, viewportRef]);

  const system = bounds?.system;
  useEffect(() => {
    if (!follow || !measureId || !beatId || system === undefined || visitIndex === undefined) {
      lastRow.current = null;
      return;
    }
    if (phase !== "playing") return;
    const previous = lastRow.current;
    lastRow.current = { system, measureId, beatId, visitIndex };
    const sameBeat = previous?.measureId === measureId && previous.beatId === beatId && previous.visitIndex === visitIndex;
    if (sameBeat || previous?.system === system) return;

    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const target = marker.current?.getBoundingClientRect();
      if (!viewport || !target || performance.now() < scrollIntentUntil.current) return;
      const { left, top } = viewport.getBoundingClientRect();
      const right = left + viewport.clientWidth;
      const bottom = top + viewport.clientHeight;
      if (target.left >= left && target.right <= right && target.top >= top && target.bottom <= bottom) return;
      const dx = target.left < left || target.right > right ? (target.left + target.right - left - right) / 2 : 0;
      const dy = target.top < top || target.bottom > bottom ? (target.top + target.bottom - top - bottom) / 2 : 0;
      viewport.scrollBy({ left: dx, top: dy, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [beatId, follow, measureId, phase, system, viewportRef, visitIndex]);

  if (!bounds) return null;
  return (
    <g className={styles.playbackCursor} aria-hidden="true" pointerEvents="none" data-playback-cursor
      data-playback-measure={measureId} data-playback-beat={beatId} data-playback-visit={visitIndex}
      data-playback-system={system} data-paused={phase === "paused" || undefined}>
      <rect ref={marker} x={bounds.x - 10} y={bounds.top} width={20} height={bounds.bottom - bounds.top} rx={3} />
      <line x1={bounds.x - 9} x2={bounds.x - 9} y1={bounds.top} y2={bounds.bottom} />
    </g>
  );
};
