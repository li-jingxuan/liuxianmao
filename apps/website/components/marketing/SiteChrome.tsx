import Image from "next/image";
import Link from "next/link";
import { BrandIcon } from "../BrandIcon";
import { marketingAsset } from "./marketing-assets";
import styles from "./site.module.scss";

export function SiteNav({ active, guitarAdvancedOpen = false }: { active: "home" | "download"; guitarAdvancedOpen?: boolean }) {
  return (
    <header className={styles.mast}>
      <div className={`${styles.wrap} ${styles.mastInner}`}>
        <Link className={styles.brand} href="/" aria-label="六线猫首页"><BrandIcon size={42} />六线猫</Link>
        <nav aria-label="主导航">
          <Link href="/" aria-current={active === "home" ? "page" : undefined}>产品首页</Link>
          <Link href="/download" aria-current={active === "download" ? "page" : undefined}>编辑器下载</Link>
          {/* 入口仅放在产品首页，跟随进阶页面的发布开关，避免链接到关闭的页面。 */}
          {active === "home" && guitarAdvancedOpen && <Link href="/guitar-advanced">吉他进阶</Link>}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ icpNumber }: { icpNumber?: string }) {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.wrap} ${styles.footerInner}`}>
        <span>六线猫吉他谱编辑器</span>
        {icpNumber && <a href="https://beian.miit.gov.cn/" rel="noopener noreferrer" target="_blank">{icpNumber}</a>}
      </div>
    </footer>
  );
}

export function MarketingIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return <Image className={className} src={marketingAsset(`${name}.svg`)} alt="" width={size} height={size} unoptimized />;
}
