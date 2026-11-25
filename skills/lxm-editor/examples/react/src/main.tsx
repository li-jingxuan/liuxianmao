import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  createEditorSession,
  LxmEditor,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor-react";
import "@liuxianmao/lxm-editor-react/styles.css";

function createWorkspace(storageKey: string) {
  const session = createEditorSession();
  let startupNotice = "";
  // 每个工作区有自己的存储键。只读取快照，恢复失败时可继续在空会话中建谱。
  try {
    const text = localStorage.getItem(storageKey);
    if (text !== null) {
      const result = session.replaceDocument(text);
      startupNotice = result.ok ? "已恢复本地快照。" : result.errors.join("；");
    }
  } catch {
    startupNotice = "无法读取浏览器存储。";
  }
  return { session, startupNotice };
}

function ScoreWorkspace({ slot, label }: { slot: string; label: string }) {
  const storageKey = `lxm-editor-react-example:${slot}`;
  // 会话只在挂载时创建，普通 React 重渲染继续使用同一份文档和历史。
  const [{ session, startupNotice }] = useState(() => createWorkspace(storageKey));
  const [notice, setNotice] = useState(startupNotice);
  const subscribe = useCallback((notify: () => void) => session.on("change", notify), [session]);
  const score = useSyncExternalStore(subscribe, session.getDocument);
  // React 在卸载时释放 change 订阅，下面的 Effect 返回 error 的取消订阅函数。
  useEffect(() => session.on("error", ({ message }) => setNotice(message)), [session]);

  function appendMeasure() {
    // 宿主命令从最新已提交快照取目标。编辑器工具栏按钮可使用自带草稿保护的 execute。
    const track = session.getDocument()?.score.tracks[0];
    const lastMeasure = track?.measures.at(-1);
    if (!track || !lastMeasure) return;
    const result = session.execute({
      type: LXMScoreCommandEnum.InsertMeasure,
      trackId: track.id,
      afterMeasureId: lastMeasure.id,
    });
    if (result?.ok && result.changed) setNotice("已追加一小节。");
  }

  function save() {
    // 读取点击时的已提交快照。需要保存界面上的表单草稿时，先在工作区应用。
    const document = session.getDocument();
    if (!document) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(document));
      setNotice("已保存到此工作区的本地存储。");
    } catch {
      setNotice("写入浏览器存储失败，当前曲谱仍在编辑器中。");
    }
  }

  function reload() {
    try {
      const text = localStorage.getItem(storageKey);
      if (text === null) {
        setNotice("此工作区还没有本地快照。");
        return;
      }
      const result = session.replaceDocument(text);
      setNotice(result.ok ? "已重新载入保存的快照。" : result.errors.join("；"));
    } catch {
      setNotice("无法读取浏览器存储。");
    }
  }

  function tryInvalidInput() {
    // 格式错误走和正式载入相同的校验入口，失败后仍可继续编辑或撤销。
    const result = session.replaceDocument("{invalid-json");
    if (!result.ok) setNotice(`无效输入已拒绝：${result.errors.join("；")}`);
  }

  const measureCount = score?.score.tracks[0]?.measures.length ?? 0;
  return (
    <section aria-labelledby={`title-${slot}`}>
      <h2 id={`title-${slot}`}>{label} · {score?.score.title || "未载入曲谱"}</h2>
      <p>已提交小节数：{measureCount}</p>
      <div className="actions">
        <button type="button" onClick={appendMeasure} disabled={!score}>追加一小节</button>
        <button type="button" onClick={save} disabled={!score}>保存本地快照</button>
        <button type="button" onClick={reload}>重新载入快照</button>
        <button type="button" onClick={tryInvalidInput}>尝试无效输入</button>
      </div>
      <p className="notice" role="status">{notice}</p>
      <div className="workspace"><LxmEditor session={session} /></div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <main>
    <h1>六线猫曲谱保存示例</h1>
    <p>在工作区新建曲谱，编辑后可把快照保存到当前浏览器。</p>
    <ScoreWorkspace slot="a" label="工作区 A" />
    <ScoreWorkspace slot="b" label="工作区 B" />
  </main>,
);
