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
  return <>
    <button type="button" className={styles.primary} onClick={(event) => flow.showPanel("new", event.currentTarget)}>
      新建曲谱
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>
    </button>
    <button type="button" className={styles.secondary} onClick={(event) => flow.showPanel("import", event.currentTarget)}>导入曲谱</button>
    <ScoreFilePanels flow={flow} session={editorStore} document={document} />
    {flow.notice && <p role="status">{flow.notice}</p>}
  </>;
}
