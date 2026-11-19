"use client";

import { useRouter } from "next/navigation";
import { EditorWorkspace } from "./EditorWorkspace";

/** 编辑器使用独立会话壳；导入曲谱后重建编辑器，清理旧输入与异步任务。 */
const EditorPage: React.FC = () => {
  const router = useRouter();
  return <EditorWorkspace navigate={router.push} />;
};

export default EditorPage;
