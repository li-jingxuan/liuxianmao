import { isInternalPreviewOpen } from "../../lib/website-release";
import { EditorWorkspace } from "./EditorWorkspace";

/** 编辑器使用独立会话壳；导入曲谱后重建编辑器，清理旧输入与异步任务。 */
export default function EditorPage() {
  return <EditorWorkspace learningOpen={isInternalPreviewOpen()} />;
}
