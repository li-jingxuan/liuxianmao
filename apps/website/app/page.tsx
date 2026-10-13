"use client";

import { EditorSession } from "../components/EditorShell/EditorSession";
import { editorStore } from "../stores/editor-store";
import styles from "./page.module.scss";

/** 首页使用独立会话壳；导入曲谱后重建编辑器，清理旧输入与异步任务。 */
const HomePage: React.FC = () => (
  <div className={styles.editorShell}>
    <div className={styles.editorContentWrapper}>
      <div className={styles.editorContentContainer}>
        <EditorSession session={editorStore} />
      </div>
    </div>
  </div>
);

export default HomePage;
