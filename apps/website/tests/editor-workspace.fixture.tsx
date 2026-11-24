import { DEFAULT_MOCK_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { EditorSession } from "../../../packages/lxm-editor-react/src/EditorShell/session/EditorSession";
import { createEditorSessionStore } from "../../../packages/lxm-editor-react/src/stores/editor-store";
import styles from "../app/editor/page.module.scss";
import { websiteEditorResources } from "../lib/editor-resources";

/** 浏览器交互夹具显式持有一个会话，方便直接观测选区、历史和文档，布局与网站一致。 */
export const editorStore = createEditorSessionStore(DEFAULT_MOCK_DOCUMENT);

export function EditorWorkspace() {
  return (
    <div className={styles.editorShell}>
      <div className={styles.editorContentWrapper}>
        <div className={styles.editorContentContainer}>
          <EditorSession session={editorStore} resources={websiteEditorResources} />
        </div>
      </div>
    </div>
  );
}
