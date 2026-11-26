import type { Metadata } from "next";
import Link from "next/link";
import { EditorGallery } from "../../components/marketing/EditorGallery";
import { ReleaseEntry } from "../../components/marketing/ReleaseEntry";
import { MarketingIcon, SiteNav } from "../../components/marketing/SiteChrome";
import { scoreMedia } from "../../components/marketing/marketing-assets";
import styles from "../../components/marketing/download.module.scss";
import site from "../../components/marketing/site.module.scss";
import { readWebsiteRelease, webReleaseNotice } from "../../lib/website-release";

export const metadata: Metadata = {
  title: "编辑器下载 · 六线猫",
  description: "六线猫 macOS 和 Windows 桌面编辑器下载、Web 编辑器与 GitHub 源码入口。",
};

export const dynamic = "force-dynamic";

export default function DownloadPage() {
  const release = readWebsiteRelease();
  const media = scoreMedia(release.idealPreview);
  const platforms = [
    { name: "macOS", icon: "apple", href: release.macDownload },
    { name: "Windows", icon: "windows", href: release.windowsDownload },
  ];

  return (
    <div className={site.site}>
      <SiteNav active="download" />
      <main className={`${site.wrap} ${styles.downloadPage}`}>
        <Link href="/" className={styles.back}><MarketingIcon name="back" />返回首页</Link>
        <div className={styles.downloadLayout}>
          <section className={styles.downloadContent} aria-labelledby="download-title">
            <h1 id="download-title">下载编辑器</h1>
            <p className={styles.downloadIntro}>选择电脑的操作系统，下载六线猫开始离线写谱。</p>
            <div className={styles.platforms}>
              {platforms.map(({ name, icon, href }) => (
                <article className={styles.platform} key={name}>
                  <MarketingIcon name={icon} size={36} /><h2 lang="en">{name}</h2>
                  <ReleaseEntry className={`${site.cta} ${site.blue} ${styles.platformButton}`} href={href} title={`${name} 安装包`} notice={`正式下载地址待确认。发布后可在此下载 ${name} 安装包。`} closeLabel="返回下载页">
                    <MarketingIcon name="download" />下载 {name} 版
                  </ReleaseEntry>
                </article>
              ))}
            </div>
            <div className={styles.source}>
              <MarketingIcon name="github" size={33} />
              <div><h2>GitHub 源码仓库</h2><p>查看六线猫编辑器的源代码。</p></div>
              <a className={styles.sourceLink} href={release.github} target="_blank" rel="noopener noreferrer">查看源码<MarketingIcon name="external" size={15} /></a>
            </div>
            <div className={styles.tryOnline}>
              <span>也可以在浏览器中写谱</span>
              <ReleaseEntry className={styles.onlineLink} href={release.webEditor ? "/editor" : undefined} title="打开 Web 编辑器" notice={webReleaseNotice} closeLabel="返回下载页">在线体验</ReleaseEntry>
            </div>
          </section>
          <EditorGallery tablature={media.galleryTab} print={media.print} title={media.title} />
        </div>
      </main>
    </div>
  );
}
