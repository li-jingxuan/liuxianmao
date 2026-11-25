import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from "react";
import styles from "./EditorScrollbars.module.scss";

export { styles as editorScrollbarStyles };

const axes = {
  vertical: { scroll: "scrollTop", full: "scrollHeight", client: "clientHeight", size: "height", start: "top", pointer: "clientY" },
  horizontal: { scroll: "scrollLeft", full: "scrollWidth", client: "clientWidth", size: "width", start: "left", pointer: "clientX" },
} as const;
type Axis = keyof typeof axes;

export function EditorScrollbars({ viewportRef, horizontal = false, className, onPointerScroll }: {
  viewportRef: RefObject<HTMLDivElement | null>;
  horizontal?: boolean;
  className?: string;
  onPointerScroll?: () => void;
}) {
  const bars = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; axis: Axis; offset: number } | null>(null);
  const onPointerScrollRef = useRef(onPointerScroll);
  useLayoutEffect(() => { onPointerScrollRef.current = onPointerScroll; }, [onPointerScroll]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const overlay = bars.current;
    if (!viewport || !overlay) return;
    const tracks = Array.from(overlay.querySelectorAll<HTMLElement>("[data-scroll-axis]"));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    function measure() {
      frame = 0;
      if (!viewport || !overlay) return;
      // 先同步两个方向的溢出，再按扣除交叉角后的实际轨长计算滑块位置。
      for (const track of tracks) {
        const axis = track.dataset.scrollAxis as Axis;
        const { full, client } = axes[axis];
        overlay.toggleAttribute(`data-overflow-${axis}`, viewport[full] > viewport[client]);
      }
      for (const track of tracks) {
        const { full, client, scroll, size, start } = axes[track.dataset.scrollAxis as Axis];
        const range = viewport[full] - viewport[client];
        if (range <= 0) continue;
        const room = track.getBoundingClientRect()[size];
        const length = Math.min(room, Math.max(32, room * viewport[client] / viewport[full]));
        const thumb = track.firstElementChild as HTMLElement;
        thumb.style[size] = `${length}px`;
        thumb.style[start] = `${Math.min(1, Math.max(0, viewport[scroll] / range)) * (room - length)}px`;
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onScroll = () => {
      schedule();
      overlay.setAttribute("data-recent-scroll", "");
      clearTimeout(timer);
      timer = setTimeout(() => overlay.removeAttribute("data-recent-scroll"), 470);
    };
    // 透明拖区属于覆盖层，滚轮落在拖区上时仍交给对应视口，避免滚动被边缘吞掉。
    const forwardWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1;
      const { scrollLeft, scrollTop } = viewport;
      viewport.scrollBy({ left: (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * unit,
        top: (event.shiftKey ? 0 : event.deltaY) * unit, behavior: "instant" });
      if (viewport.scrollLeft !== scrollLeft || viewport.scrollTop !== scrollTop) onPointerScrollRef.current?.();
    };
    const sizes = new ResizeObserver(schedule);
    const observe = () => {
      sizes.disconnect();
      sizes.observe(viewport);
      for (const child of viewport.children) sizes.observe(child);
      schedule();
    };
    const children = new MutationObserver(observe);
    children.observe(viewport, { childList: true });
    observe();
    measure();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    overlay.addEventListener("wheel", forwardWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      sizes.disconnect();
      children.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      overlay.removeEventListener("wheel", forwardWheel);
    };
  }, [horizontal, viewportRef]);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const active = drag.current;
    if (!viewport || !active || active.id !== event.pointerId) return;
    const { full, client, scroll, size, start, pointer } = axes[active.axis];
    const track = event.currentTarget.getBoundingClientRect();
    const travel = track[size] - event.currentTarget.firstElementChild!.getBoundingClientRect()[size];
    if (travel <= 0) return;
    const before = viewport[scroll];
    const ratio = (event[pointer] - track[start] - active.offset) / travel;
    const target = Math.min(1, Math.max(0, ratio)) * (viewport[full] - viewport[client]);
    viewport.scrollTo({ [start]: target, behavior: "instant" });
    if (viewport[scroll] !== before) onPointerScroll?.();
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>, axis: Axis) => {
    if (event.button !== 0 || drag.current) return;
    const track = event.currentTarget;
    const { size, start, pointer } = axes[axis];
    const thumb = track.firstElementChild!.getBoundingClientRect();
    const position = event[pointer] - thumb[start];
    drag.current = { id: event.pointerId, axis, offset: position >= 0 && position <= thumb[size] ? position : thumb[size] / 2 };
    event.preventDefault();
    // 指针移出视口后继续拖动。覆盖层和正文是同级，按下滚动条不会触发谱面选区或提交草稿。
    track.setPointerCapture(event.pointerId);
    bars.current?.setAttribute("data-dragging", axis);
    move(event);
  };

  return <div ref={bars} className={`${styles.bars}${className ? ` ${className}` : ""}`} aria-hidden="true">
    {(horizontal ? ["vertical", "horizontal"] as const : ["vertical"] as const).map((axis) => (
      <div key={axis} data-scroll-axis={axis} className={styles.track} onPointerDown={(event) => startDrag(event, axis)}
        onPointerMove={move} onLostPointerCapture={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          drag.current = null;
          bars.current?.removeAttribute("data-dragging");
        }}><span className={styles.thumb} /></div>
    ))}
  </div>;
}
