import Image from "next/image";
import Link from "next/link";
import { BrandIcon } from "../BrandIcon";
import { marketingAsset } from "./marketing-assets";
import styles from "./site.module.scss";

export function SiteNav({ active }: { active: "home" | "download" }) {
  return (
    <header className={styles.mast}>
      <div className={`${styles.wrap} ${styles.mastInner}`}>
        <Link className={styles.brand} href="/" aria-label="六线猫首页"><BrandIcon size={42} />六线猫</Link>
        <nav aria-label="主导航">
          <Link href="/" aria-current={active === "home" ? "page" : undefined}>产品首页</Link>
          <Link href="/download" aria-current={active === "download" ? "page" : undefined}>编辑器下载</Link>
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
