import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { BrandIcon } from "../components/BrandIcon";
import { HomeScoreActions } from "./HomeScoreActions";
import { HomeScorePreview } from "./HomeScorePreview";
import styles from "./page.module.scss";

const steps = [
  {
    title: "新建或导入曲谱",
    description: "从空白谱开始，也可以导入六线猫专用谱(.lxm)继续写。",
  },
  {
    title: "在谱面上调整",
    description: "选中音符或小节，调整时值、节奏和演奏技巧，补上简谱、歌词与和弦。",
  },
  {
    title: "保存或导出",
    description: "导出六线猫专用谱(.lxm)供下次编辑，或导出谱面图片发给琴友。",
  },
];

export default function HomePage() {
  return (
    <div className={styles.home}>
      <header className={styles.siteHeader} id="top">
        <div className={`${styles.wrap} ${styles.headerInner}`}>
          <a className={styles.brand} href="#top" aria-label="六线猫首页">
            <BrandIcon size={36} />
            <span>六线猫</span>
          </a>
          <nav aria-label="首页导航">
            <a className={styles.sectionLink} href="#demo">曲谱示例</a>
            <a className={styles.sectionLink} href="#workflow">写谱与导出</a>
            <Link className={styles.learningLink} href="/guitar-advanced">吉他进阶</Link>
            <Link className={`${styles.button} ${styles.buttonOutline}`} href="/editor">
              打开编辑器 <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className={`${styles.hero} ${styles.wrap}`} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.productLabel}>吉他曲谱编辑器</p>
            <h1 id="hero-title">把想弹的，<br />写成谱。</h1>
            <p className={styles.heroDescription}>记下刚弹出的旋律，整理一首弹唱谱。六线谱、简谱、歌词和和弦指法，都可以写在同一份谱里。</p>
            <div className={styles.heroActions}>
              <Link className={`${styles.button} ${styles.buttonPrimary}`} href="/editor">
                打开编辑器 <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a className={`${styles.button} ${styles.buttonText}`} href="#demo">
                看看曲谱示例 <ChevronDown size={16} aria-hidden="true" />
              </a>
            </div>
            <HomeScoreActions />
          </div>
          <figure className={styles.heroFigure}>
            <div className={styles.editorStage}>
              <div className={styles.editorFrame}>
                <Image
                  src="/assets/home/editor-preview.png"
                  alt="六线猫编辑器。左侧谱面同时显示和弦图、六线谱、简谱和歌词，右侧是编辑面板。"
                  width={1440}
                  height={900}
                  loading="eager"
                  unoptimized
                />
              </div>
            </div>
            <figcaption>编辑器实拍</figcaption>
          </figure>
        </section>

        <section className={styles.demo} id="demo" aria-labelledby="demo-title">
          <div className={styles.wrap}>
            <div className={styles.sectionHeading}>
              <h2 id="demo-title">一份谱，几种写法</h2>
              <p>切换谱层，看看一段旋律怎么写成指弹谱或弹唱谱。</p>
            </div>
            <HomeScorePreview />
          </div>
        </section>

        <section className={`${styles.workflow} ${styles.wrap}`} id="workflow" aria-labelledby="workflow-title">
          <div className={styles.sectionHeading}>
            <h2 id="workflow-title">从第一拍写到成谱</h2>
          </div>
          <ol className={styles.workflowSteps} role="list">
            {steps.map(({ title, description }, index) => (
              <li key={title}>
                <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
          <Link className={`${styles.button} ${styles.buttonPrimary}`} href="/editor">
            打开编辑器 <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </main>

      <footer className={styles.siteFooter}>
        <div className={`${styles.wrap} ${styles.footerInner}`}>
          <div className={styles.brand}><BrandIcon size={32} /><span>六线猫</span></div>
          <a href="#top">回到顶部</a>
        </div>
      </footer>
    </div>
  );
}
