"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { MarketingIcon } from "./SiteChrome";
import { marketingAsset } from "./marketing-assets";
import { useHydrated } from "./use-hydrated";
import styles from "./download.module.scss";

export function EditorGallery({ tablature, print, title }: { tablature: string; print: string; title: string }) {
  const slides = [
    { title: "六线谱编辑", src: tablature, imageClass: styles.tabPhoto, width: 914, height: 435, alt: `${title}编辑器谱面的两行六线谱，可见品位、节奏与和弦图`, description: "在对应的弦和拍点记录品位、和弦与节奏。" },
    { title: "和弦指法", src: marketingAsset("gallery-chord.webp"), imageClass: styles.chordPhoto, width: 430, height: 365, alt: "指法设置面板中的 C 和弦，显示各弦按指与空弦", description: "在指法面板中核对每根弦的按法。" },
    { title: "A4 谱页导出", src: print, imageClass: styles.a4Photo, width: 860, height: 1216, alt: `实际导出的${title}第一页 A4 谱，包含完整分页和页码`, description: "把编辑好的曲谱排成 A4 谱页，用于练习或打印。" },
  ];
  const gallery = useRef<HTMLElement>(null);
  const hydrated = useHydrated();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hasSwitched, setHasSwitched] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const count = slides.length;

  useEffect(() => {
    const element = gallery.current;
    if (!hydrated || !element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const controller = new AbortController();
    const options = { signal: controller.signal };
    let timer: number | undefined;
    // 每次恢复给满 7 秒。悬停、聚焦、手动暂停、系统动效偏好、后台与模态阅读都会阻止自动切换。
    const schedule = () => {
      window.clearTimeout(timer);
      if (controller.signal.aborted || paused || reduced.matches || document.hidden || document.querySelector("dialog[open]") || element.matches(":hover, :focus-within")) return;
      timer = window.setTimeout(() => {
        setHasSwitched(true);
        setAnnouncement("");
        setCurrent((index) => (index + 1) % count);
      }, 7000);
    };
    // focusout 时根据下一个焦点决定是否恢复。移到同一区域内的另一个控制按钮时仍暂停。
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      queueMicrotask(schedule);
    };
    for (const event of ["pointerenter", "pointerleave", "focusin"]) element.addEventListener(event, schedule, options);
    element.addEventListener("focusout", focusOut, options);
    document.addEventListener("visibilitychange", schedule, options);
    reduced.addEventListener("change", schedule, options);
    const dialogs = new MutationObserver(schedule);
    for (const dialog of document.querySelectorAll("dialog")) dialogs.observe(dialog, { attributeFilter: ["open"] });
    schedule();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      dialogs.disconnect();
    };
  }, [count, current, hydrated, paused]);

  function move(direction: number) {
    const next = (current + direction + count) % count;
    setHasSwitched(true);
    setCurrent(next);
    // 仅手动切换时播报，避免每次自动换图打断阅读。
    setAnnouncement(`第 ${next + 1} 张，共 ${count} 张，${slides[next].title}`);
  }

  return (
    <section className={styles.gallery} ref={gallery} aria-label="编辑器画面" aria-roledescription="轮播">
      {slides.map(({ title, src, imageClass, width, height, alt, description }, index) => (
        <figure className={styles.slide} data-switching={hasSwitched} key={title} hidden={current !== index}>
          <div className={`${styles.slidePhoto} ${imageClass}`}><Image src={src} width={width} height={height} alt={alt} loading={index === 0 ? "eager" : undefined} unoptimized /></div>
          <figcaption><h2>{title}</h2><p>{description}</p></figcaption>
        </figure>
      ))}
      {hydrated && (
        <div className={styles.galleryControls}>
          <span className={styles.galleryCount} aria-label="当前画面">{current + 1} / {count}</span>
          <div className={styles.paging}>
            <button type="button" className={styles.autoplay} aria-label={paused ? "继续自动轮播" : "暂停自动轮播"} onClick={() => setPaused((value) => !value)}>{paused ? "继续轮播" : "暂停轮播"}</button>
            <button type="button" className={styles.previous} aria-label="上一张" onClick={() => move(-1)}><MarketingIcon name="back" size={16} /></button>
            <button type="button" className={styles.next} aria-label="下一张" onClick={() => move(1)}><MarketingIcon name="back" size={16} /></button>
          </div>
        </div>
      )}
      <span className={styles.visuallyHidden} role="status">{announcement}</span>
    </section>
  );
}
