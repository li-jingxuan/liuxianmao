import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { BrandIcon } from "../components/BrandIcon";
import { sitePath } from "../lib/site-path";
import { HomeScoreActions } from "./HomeScoreActions";
import { HomeScorePreview } from "./HomeScorePreview";
import styles from "./page.module.scss";

const steps = [
  {
    title: "新建或导入曲谱",
    description: "从空白谱开始，也可以用「导入曲谱」打开之前保存的 .lxm 文件。",
  },
  {
    title: "在谱面上调整",
    description: "选中音符或小节，调整时值、节奏和演奏技巧，补上简谱、歌词与和弦。",
  },
  {
    title: "留一份能改的谱，分享一份成品",
    description: "在「导出」中选择六线猫专用谱（.lxm）保存可编辑的原谱，文件内容为 UTF-8 JSON。发给学生可选「图片(.png)」生成 A4 PNG，需要 PDF 时选「打印」，在浏览器打印窗口另存为 PDF。",
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
            <a className={styles.sectionLink} href="#developers">开发者接入</a>
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
            <p className={styles.heroDescription}>六线猫是浏览器里的吉他曲谱编辑器。记旋律、写弹唱谱时，可以把六线谱（TAB）、简谱、歌词和和弦指法写在同一份谱里。</p>
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
                  src={sitePath("/assets/home/editor-preview.png")}
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
              <p>《风吹过山谷》的两小节从 C 和弦转到 G 和弦。切换谱层，可以看同一拍的弦与品位、简谱与歌词，以及和弦指法。</p>
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

        <section className={`${styles.developers} ${styles.wrap} ${styles.sectionHeading}`} id="developers" aria-labelledby="developers-title">
          <h2 id="developers-title">怎样在自己的应用里接入六线猫？</h2>
          <p>在 React 19 和 React DOM 19 项目中，用 <code>@liuxianmao/lxm-editor-react</code> 的 <code>LxmEditor</code> 嵌入带工具栏和试听的写谱工作区。</p>
          <p>自建界面可用 JavaScript Core <code>@liuxianmao/lxm-editor</code> 加载和编辑曲谱、生成谱面布局和播放计划。1.0 候选包的安装步骤见各包 README，Core 包内的 <code>docs/api-v1.md</code> 列出公共 API。</p>
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
