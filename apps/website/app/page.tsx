import Link from "next/link";
import { HomeScoreActions } from "./HomeScoreActions";
import styles from "./page.module.scss";

const HomePage = () => (
  <div className={styles.home}>
    <header className={styles.siteHeader}>
      <Link className={styles.brand} href="/" aria-label="六线猫首页">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M5 13 6 4l8 6h4l8-6 1 9v9c0 5-22 5-22 0Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M10 17h2m8 0h2m-7 4h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        六线猫
      </Link>
      <nav aria-label="主导航">
        <Link href="/editor">曲谱编辑器</Link>
        <Link href="/guitar-advanced">吉他进阶</Link>
      </nav>
    </header>
    <main className={styles.welcome}>
      <div className={styles.welcomeCopy}>
        <h1>欢迎来到六线猫</h1>
        <p>把旋律写下来，<br />让每一次练习都有回响。</p>
        <div className={styles.actions}>
          <HomeScoreActions />
        </div>
        <div className={styles.capabilities}>六线谱<span>简谱</span><span>歌词</span><span>和弦指法</span></div>
      </div>
      <div className={styles.scoreArt} aria-label="吉他曲谱示意">
        <div className={styles.paper}>
          <div className={styles.paperTitle}>风吹过山谷</div>
          <div className={styles.paperMeta}>1=C{"\u3000"}4/4</div>
          <svg viewBox="0 0 460 350" role="img" aria-label="六线谱、简谱和歌词的组合示例">
            <g fill="none" stroke="#64728a" strokeWidth=".9">
              <path d="M25 90h410M25 102h410M25 114h410M25 126h410M25 138h410M25 150h410M25 90v60m205-60v60m205-60v60" />
              <path d="M50 157v27h100v-27m-67 0v27m34-27v27M255 157v27h100v-27m-67 0v27m34-27v27" stroke="#202838" strokeWidth="1.5" />
            </g>
            <g fill="#202838" fontFamily="Georgia,serif" textAnchor="middle">
              <text x="60" y="63" fontSize="20">C</text><text x="263" y="63" fontSize="20">G</text>
              <g fontSize="16">
                <text x="50" y="119">0</text><text x="83" y="143">3</text><text x="117" y="107">1</text><text x="150" y="131">0</text>
                <text x="255" y="119">0</text><text x="288" y="143">2</text><text x="322" y="107">3</text><text x="355" y="131">0</text>
              </g>
              <g fontSize="22">
                <text x="50" y="234">1</text><text x="100" y="234">2</text><text x="150" y="234">3</text><text x="200" y="234">5</text>
                <text x="255" y="234">6</text><text x="305" y="234">5</text><text x="355" y="234">3</text><text x="405" y="234">2</text>
              </g>
            </g>
            <g fontSize="17" fill="#202838" textAnchor="middle">
              <text x="50" y="279">风</text><text x="100" y="279">吹</text><text x="150" y="279">过</text><text x="200" y="279">山</text>
              <text x="255" y="279">谷</text><text x="305" y="279">轻</text><text x="355" y="279">轻</text><text x="405" y="279">响</text>
            </g>
            <path d="M25 312h410" stroke="#dce2ec" />
          </svg>
          <span className={styles.paperCorner} aria-hidden="true" />
        </div>
        <div className={styles.chordChip}>
          <svg viewBox="0 0 75 90" aria-hidden="true">
            <g stroke="#285be0" strokeWidth="1.2" fill="none">
              <path d="M12 23h50M12 37h50M12 51h50M12 65h50M12 79h50M12 23v56m10-56v56m10-56v56m10-56v56m10-56v56m10-56v56" />
              <path d="M12 23h50" strokeWidth="3" />
            </g>
            <g fill="#285be0"><circle cx="22" cy="58" r="5" /><circle cx="32" cy="44" r="5" /><circle cx="52" cy="30" r="5" /></g>
            <g fontSize="10" fill="#285be0" textAnchor="middle"><text x="12" y="17">×</text><text x="42" y="17">○</text><text x="62" y="17">○</text></g>
          </svg>
          <div><strong>C</strong><span>从一个和弦开始</span></div>
        </div>
      </div>
    </main>
    <footer className={styles.siteFooter}><span>六线猫</span><span>写谱，也练琴。</span></footer>
  </div>
);

export default HomePage;
