import type React from "react";
import styles from './page.module.scss'

/** 首页只负责装配编辑器壳，领域状态由核心包管理。 */
const HomePage: React.FC = () => {


  return (
    <div className={styles.editorShell}>
      <div className={styles.toolbar}></div>

      {/* 编辑器主体 */}
      <div className={styles.editorContentWrapper}>
        <div className={styles.editorToolbar}>
          工具栏
        </div>
        <div className={styles.sidlerBar}>

        </div>
        <div className={styles.editorContentContainer}>
          
        </div>
      </div>
    </div>
  )
};

export default HomePage;
