import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { HeroPreview } from "../components/marketing/HeroPreview";
import { ReleaseEntry } from "../components/marketing/ReleaseEntry";
import { MarketingIcon, SiteFooter, SiteNav } from "../components/marketing/SiteChrome";
import { scoreMedia } from "../components/marketing/marketing-assets";
import styles from "../components/marketing/home.module.scss";
import site from "../components/marketing/site.module.scss";
import { readWebsiteRelease, webReleaseNotice } from "../lib/website-release";
import { HomeScoreActions } from "./HomeScoreActions";
import { HomeScorePreview } from "./HomeScorePreview";
import legacy from "./page.module.scss";

export const metadata: Metadata = {
  title: "六线猫 · 吉他谱编辑器",
  description: "六线猫吉他谱编辑器支持六线谱、简谱、歌词与和弦指法。写谱、试听，保存 .lxm 曲谱或导出 A4 谱页。",
};

// 首页和下载页从运行环境读取同一份发布配置，standalone 镜像无需重建即可接入确认的资源。
export const dynamic = "force-dynamic";

export default function HomePage() {
  const release = readWebsiteRelease();
  const media = scoreMedia(release.idealPreview);
  const details = [
    { ...media.tablature, title: "六线谱", alt: "六根弦上的品位数字和节奏符号", description: "在弦格上写下品位与节奏。" },
    { ...media.chords, title: "和弦指法", alt: "吉他和弦指法图", description: "把和弦图放在对应的拍点上。" },
    { ...media.lyrics, title: "简谱与歌词", alt: "逐拍对齐的简谱与歌词", description: "让旋律和唱词随拍点对齐。" },
  ];

  return (
    <div className={site.site}>
      <SiteNav active="home" guitarAdvancedOpen={release.guitarAdvanced} />
      <main className={`${site.wrap} ${styles.home}`}>
        <HeroPreview workbench={media.workbench} title={media.title} ideal={release.idealPreview}>
          <div className={styles.heroCopy}>
            <p className={styles.productName}>六线猫吉他谱编辑器</p>
            <h1 id="hero-title">吉他谱，<br />一弦一弦写</h1>
            <p className={styles.intro}>在电脑上记录指法、和弦与歌词，<br />把一段旋律整理成可以照着弹的谱。</p>
            <div className={styles.heroActions}>
              <Link className={`${site.cta} ${styles.light}`} href="/download"><MarketingIcon name="download" />下载桌面编辑器</Link>
              <ReleaseEntry className={`${site.cta} ${styles.webEntry}`} href={release.webEditor ? "/editor" : undefined} title="打开 Web 编辑器" notice={webReleaseNotice} closeLabel="返回首页">
                打开 Web 编辑器
              </ReleaseEntry>
            </div>
          </div>
        </HeroPreview>

        <section className={styles.scoreSection} aria-labelledby="score-title">
          <h2 className={styles.sectionHeading} id="score-title">一张谱里的细节</h2>
          <div className={styles.details}>
            {details.map(({ src, width, height, alt, title, description }) => (
              <article key={title}>
                <div className={styles.excerpt}><Image src={src} width={width} height={height} alt={alt} unoptimized /></div>
                <h3>{title}</h3><p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.workflow} aria-labelledby="workflow">
          <div className={styles.workflowCopy}>
            <h2 id="workflow">写谱、试听、导出</h2>
            <ol className={styles.steps} role="list">
              <li><h3>在电脑上起谱</h3><p>新建曲谱，填上曲名，选好调号与拍号。也可以打开已有的 .lxm 文件接着写。</p></li>
              <li><h3>写一段，听一遍</h3><p>点选弦格输入品位，再设定音符时值。从选中的小节试听，听一听节奏是否合意。</p></li>
              <li><h3>留下原谱，带走谱页</h3><p>保存 .lxm 原谱以便下次修改。练习或教学时，可把排好的 A4 谱页导出为 PNG，或直接打印。</p></li>
            </ol>
          </div>
          <figure className={styles.printProof}>
            <div className={styles.printDesk}><div className={styles.pageMat}><Image src={media.print} width={860} height={1216} alt={`${media.title}的 A4 成品第一页，和弦图、六线谱和歌词分行排版`} unoptimized /></div></div>
            <figcaption><strong>{media.title}</strong><span>A4 导出实样 · 第 1 页</span></figcaption>
          </figure>
        </section>

        <section className={styles.openSource} aria-labelledby="source-heading">
          <MarketingIcon name="github" size={20} /><h2 id="source-heading">开源六线谱编辑器</h2>
          <a href={release.github} target="_blank" rel="noopener noreferrer">查看 GitHub 源码</a>
        </section>

        {/* 产品首屏沿用验收稿。原有互动谱例、文件快捷操作和接入说明在页末继续提供。 */}
        <details className={`${styles.developerDetails} ${legacy.legacyPanel}`} id="developers">
          <summary>曲谱示例与开发者接入</summary>
          <section aria-labelledby="demo-title" id="demo">
            <h2 id="demo-title">一份谱，几种写法</h2>
            <p>在浏览器里编辑六线谱（TAB）、简谱、歌词与和弦指法。《风吹过山谷》的两小节从 C 和弦转到 G 和弦，可以切换谱层查看同一拍。</p>
            <HomeScorePreview />
            {release.webEditor && <HomeScoreActions />}
            <p>六线猫专用谱（.lxm）使用 UTF-8 JSON。导出时可生成 A4 PNG，也可选「打印」并在打印窗口另存为 PDF。</p>
          </section>
          <section aria-labelledby="developers-title">
            <h2 id="developers-title">怎样在自己的应用里接入六线猫？</h2>
            <p>在 React 19 和 React DOM 19 项目中，用 <code>@liuxianmao/lxm-editor-react</code> 的 <code>LxmEditor</code> 嵌入带工具栏和试听的写谱工作区。</p>
            <p>自建界面可用 JavaScript Core <code>@liuxianmao/lxm-editor</code> 加载和编辑曲谱、生成谱面布局和播放计划。1.0 候选包的安装步骤见各包 README，Core 包内的 <code>docs/api-v1.md</code> 列出公共 API。</p>
          </section>
        </details>
      </main>
      <SiteFooter icpNumber={release.icpNumber} />
    </div>
  );
}
