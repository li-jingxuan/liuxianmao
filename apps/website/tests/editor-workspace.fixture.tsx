import { DEFAULT_MOCK_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { LxmEditor } from "../../../packages/lxm-editor-react/src/LxmEditor";
import { createEditorSession, getEditorSessionStore } from "../../../packages/lxm-editor-react/src/editor-session";
import { websiteEditorResources } from "../lib/editor-resources";

/** 浏览器交互夹具显式持有一个会话，方便直接观测选区、历史和文档，布局与网站一致。 */
const session = createEditorSession(DEFAULT_MOCK_DOCUMENT);
export const editorStore = getEditorSessionStore(session);

export function EditorWorkspace() {
  return <LxmEditor fullPage session={session} resources={websiteEditorResources} />;
}
