import type React from "react";
import styles from './page.module.scss'
import { EditorShell } from "../components/EditorShell";

/** 首页只负责装配编辑器壳，领域状态由核心包管理。 */
const HomePage: React.FC = () => {


  return (
    <div className={styles.editorShell}>
      {/* 编辑器主体 */}
      <div className={styles.editorContentWrapper}>
        <div className={styles.editorContentContainer}>
          <EditorShell />
        </div>
      </div>
    </div>
  )
};

export default HomePage;
