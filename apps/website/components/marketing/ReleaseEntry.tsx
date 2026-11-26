"use client";

import Link from "next/link";
import { useId, useRef, type ReactNode } from "react";
import styles from "./site.module.scss";

export function ReleaseEntry({ href, className, children, title, notice, closeLabel }: {
  href?: string;
  className: string;
  children: ReactNode;
  title: string;
  notice: string;
  closeLabel: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  if (href?.startsWith("/")) return <Link className={className} href={href}>{children}</Link>;
  if (href) return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

  // 新浏览器的原生命令无脚本也可打开说明，旧浏览器由同一 dialog 增强。
  // showModal 与 method=dialog 保留 Tab、Esc 和关闭后回到触发控件的原生行为。
  const command = { commandfor: id, command: "show-modal" };
  return (
    <>
      <button className={className} type="button" {...command} onClick={(event) => {
        if (!("commandForElement" in event.currentTarget)) dialog.current?.showModal();
      }}>{children}</button>
      <dialog className={styles.dialog} id={id} ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-notice`}>
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-notice`}>{notice}</p>
        <form method="dialog"><button className={`${styles.cta} ${styles.blue}`} autoFocus>{closeLabel}</button></form>
      </dialog>
    </>
  );
}
