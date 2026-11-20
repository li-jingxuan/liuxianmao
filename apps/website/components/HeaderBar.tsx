"use client";

import Link from "next/link";
import { BrandIcon } from "./BrandIcon";
import styles from "./HeaderBar.module.scss";

export function HeaderBar({ active, canNavigate }: {
  active?: "learning";
  canNavigate?: () => boolean;
}) {
  const guard: React.ComponentProps<typeof Link>["onNavigate"] = (event) => {
    if (canNavigate && !canNavigate()) event.preventDefault();
  };

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/" aria-label="六线猫首页" onNavigate={guard}>
          <BrandIcon size={40} />
          <span>六线猫</span>
        </Link>
        <nav className={styles.navigation} aria-label="产品导航">
          <Link href="/editor" onNavigate={guard}>曲谱编辑器</Link>
          {active === "learning"
            ? <span aria-current="location">吉他进阶</span>
            : <Link href="/guitar-advanced">吉他进阶</Link>}
        </nav>
      </div>
    </header>
  );
}
