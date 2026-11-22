"use client";

import { useRouter } from "next/navigation";
import { useStore } from "zustand";
import { editorStore } from "../stores/editor-store";
import { ScoreFilePanels } from "../components/EditorShell/output/ScoreFilePanels";
import { useScoreFileFlow } from "../components/EditorShell/output/use-score-file-flow";
import styles from "./page.module.scss";

export function HomeScoreActions() {
  const router = useRouter();
  const document = useStore(editorStore, (state) => state.document);
  const flow = useScoreFileFlow({ session: editorStore, onReplacement: () => router.push("/editor") });
  return (
    <>
      <div className={styles.fileActions}>
        <button type="button" onClick={(event) => flow.showPanel("new", event.currentTarget)}>新建曲谱</button>
        <button type="button" onClick={(event) => flow.showPanel("import", event.currentTarget)}>导入曲谱</button>
      </div>
      <ScoreFilePanels flow={flow} session={editorStore} document={document} />
      {flow.notice && <p className={styles.fileNotice} role="status">{flow.notice}</p>}
    </>
  );
}
