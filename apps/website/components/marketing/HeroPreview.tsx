"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHydrated } from "./use-hydrated";
import styles from "./home.module.scss";

export function HeroPreview({ children, workbench, title, ideal }: {
  children: ReactNode;
  workbench: string;
  title: string;
  ideal: boolean;
}) {
  const hero = useRef<HTMLElement>(null);
  const enhanced = useHydrated();
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = hero.current;
    if (!element) return;
    let intersects = false;
    const syncVisibility = () => setVisible(intersects && !document.hidden);
    // 不替换动画节点。视口可见面积不足 20% 或标签页隐藏时冻结时间轴，回到首屏从原进度继续。
    const observer = new IntersectionObserver(([entry]) => {
      intersects = entry.isIntersecting && entry.intersectionRatio >= 0.2;
      syncVisibility();
    }, { threshold: 0.2 });
    observer.observe(element);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  return (
    <section className={styles.hero} ref={hero} aria-labelledby="hero-title" data-cue-active={enhanced} data-cue-running={visible && !paused}>
      {children}
      <div className={styles.heroArt}>
        <div className={styles.strings} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        <figure className={styles.window}>
          <figcaption>
            <span className={styles.windowLights} aria-hidden="true"><i /><i /><i /></span>
            编辑工作台预览
            {enhanced && <button className={styles.cueToggle} type="button" onClick={() => setPaused((value) => !value)}>{paused ? "继续选框" : "暂停选框"}</button>}
          </figcaption>
          <div className={styles.scoreFrame}>
            <Image className={styles.editor} src={workbench} width={1440} height={775} alt={`六线猫编辑器中的${title}，谱面、工具栏和属性面板同屏显示`} loading="eager" unoptimized />
            <span className={styles.measureCue} data-example={ideal ? "ideal" : "valley"} aria-hidden="true" />
          </div>
        </figure>
      </div>
    </section>
  );
}
