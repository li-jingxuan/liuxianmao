"use client";

import { editorStore } from "../../stores/editor-store";
import { EditorSession } from "../../components/EditorShell/session/EditorSession";
import styles from "./page.module.scss";

export function EditorWorkspace({ navigate }: { navigate?: (destination: string) => void }) {
  return (
    <div className={styles.editorShell}>
      <div className={styles.editorContentWrapper}>
        <div className={styles.editorContentContainer}>
          <EditorSession session={editorStore} navigate={navigate} />
        </div>
      </div>
    </div>
  );
}
