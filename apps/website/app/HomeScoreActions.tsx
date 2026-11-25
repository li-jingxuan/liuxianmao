"use client";

import { useRouter } from "next/navigation";
import { LxmEditorFileActions } from "@liuxianmao/lxm-editor-react";
import { websiteEditorSession } from "./website-editor-session";
import styles from "./page.module.scss";

export function HomeScoreActions() {
  const router = useRouter();
  return (
    <LxmEditorFileActions session={websiteEditorSession} onReplacement={() => router.push("/editor")}>
      {({ newScore, importScore, notice }) => (
        <>
          <div className={styles.fileActions}>
            <button type="button" onClick={(event) => newScore(event.currentTarget)}>新建曲谱</button>
            <button type="button" onClick={(event) => importScore(event.currentTarget)}>导入曲谱</button>
          </div>
          {notice && <p className={styles.fileNotice} role="status">{notice}</p>}
        </>
      )}
    </LxmEditorFileActions>
  );
}
