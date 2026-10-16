"use client";

import {
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  GuitarAdvancedStoreProvider,
  useGuitarAdvancedStore,
} from "../../stores/guitar-advanced-store";
import styles from "./GuitarAdvancedShell.module.scss";

const navigation = [
  {
    label: "学习路径",
    href: "/guitar-advanced",
    icon: LayoutDashboard,
  },
  {
    label: "理论课程",
    href: "/guitar-advanced/theory/rhythm-eighth-sixteenth",
    icon: BookOpen,
  },
  {
    label: "练习中心",
    href: "/guitar-advanced/practice/rhythm-identify-eighth-notes",
    icon: ClipboardList,
  },
];

/** 学习模块的外壳只负责导航、hydrate 和全局存储异常，不承载具体课程数据。 */
const GuitarAdvancedShellContent = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  const hydrated = useGuitarAdvancedStore((state) => state.hydrated);
  const storageError = useGuitarAdvancedStore((state) => state.storageError);
  const hydrate = useGuitarAdvancedStore((state) => state.hydrate);
  const clearProgress = useGuitarAdvancedStore((state) => state.clearProgress);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>六</span>
          <span>六线猫</span>
        </Link>
        <nav className={styles.productNav} aria-label="产品导航">
          <Link href="/">曲谱工作台</Link>
          <span className={styles.productNavActive}>吉他进阶</span>
        </nav>
        <span className={styles.localBadge}>当前浏览器</span>
      </header>
      <div className={styles.body}>
        <aside className={styles.sidebar} aria-label="吉他进阶导航">
          <div className={styles.sidebarTitle}>吉他进阶</div>
          <nav className={styles.navigation}>
            {navigation.map(({ label, href, icon: Icon }) => {
              const isActive =
                href === "/guitar-advanced"
                  ? pathname === href
                  : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  aria-current={isActive ? "page" : undefined}
                  className={`${styles.navigationItem} ${isActive ? styles.navigationItemActive : ""}`}
                  href={href}
                >
                  <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                </Link>
              );
            })}
            <span className={styles.navigationDisabled} aria-disabled="true">
              <FileText aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>综合考试</span>
              <small>即将开放</small>
            </span>
            <span className={styles.navigationDisabled} aria-disabled="true">
              <History aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>学习进度</span>
              <small>即将开放</small>
            </span>
          </nav>
          <div className={styles.sidebarFooter}>
            <CheckCircle2 aria-hidden="true" size={16} />
            <div>
              <strong>本地保存</strong>
              <span>{hydrated ? "仅当前浏览器" : "正在读取记录…"}</span>
            </div>
          </div>
        </aside>
        <main className={styles.main}>
          {storageError ? (
            <div className={styles.storageNotice} role="alert">
              <strong>学习记录提示</strong>
              <span>{storageError}</span>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "清除当前浏览器中的吉他进阶学习记录并重新开始？",
                    )
                  )
                    clearProgress();
                }}
              >
                清除记录并重新开始
              </button>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
};

export const GuitarAdvancedShell = ({ children }: { children: ReactNode }) => (
  <GuitarAdvancedStoreProvider>
    <GuitarAdvancedShellContent>{children}</GuitarAdvancedShellContent>
  </GuitarAdvancedStoreProvider>
);
