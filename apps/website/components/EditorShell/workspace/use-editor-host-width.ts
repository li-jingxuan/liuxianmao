import { useLayoutEffect, useState, type RefObject } from "react";

export type EditorLayoutMode = "wide" | "desktop" | "compact" | "narrow";
export const editorLayoutMode = (width: number): EditorLayoutMode =>
  width >= 1600
    ? "wide"
    : width >= 1200
      ? "desktop"
      : width >= 960
        ? "compact"
        : "narrow";

/** 观察分列之外的宿主内容盒；面板开关不会改变断点输入。 */
export function useEditorHostWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    let frame = 0;
    const measure = () => {
      const style = getComputedStyle(host);
      const next =
        host.clientWidth -
        parseFloat(style.paddingLeft || "0") -
        parseFloat(style.paddingRight || "0");
      if (next > 0) setWidth((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref]);
  return { width, mode: editorLayoutMode(width || 1200) };
}
