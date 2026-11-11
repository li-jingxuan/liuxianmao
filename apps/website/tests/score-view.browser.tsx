import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { A4_CONTENT_WIDTH } from "@liuxianmao/lxm-editor";
import { useScoreView } from "../components/EditorShell/score/use-score-view";
import styles from "../components/EditorShell/index.module.scss";
import editorHeaderStyles from "../components/EditorShell/workspace/EditorHeader.module.scss";
import musicTextSidebarStyles from "../components/EditorShell/music-text/MusicTextSidebar.module.scss";
import scoreInteractionStyles from "../components/EditorShell/score/score-interaction.module.scss";
import printStyles from "../components/EditorShell/output/score-print.module.scss";
import "../app/globals.scss";

function Fixture() {
  const [hostWidth, setHostWidth] = useState(1600);
  const [history, setHistory] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [session, setSession] = useState(0);
  const [wideScore, setWideScore] = useState(false);
  const changes = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const view = useScoreView({
    viewportRef: viewport,
    layoutWidth: A4_CONTENT_WIDTH * (wideScore ? 2 : 1),
    layoutHeight: 5000,
    sessionKey: session,
    onGeometryChange: () => { changes.current += 1; },
  });
  const layout = hostWidth >= 1600 ? "wide" : hostWidth >= 1200 ? "desktop" : hostWidth >= 960 ? "compact" : "narrow";
  useLayoutEffect(() => {
    Object.assign(window, { scoreViewTest: {
      resize: setHostWidth, history: setHistory, sidebar: setSidebar,
      wide: setWideScore, session: () => setSession((value) => value + 1),
      status: () => ({ ...view.geometry, mode: view.mode, changes: changes.current }),
    } });
  }, [view]);
  return <div className={styles.editor} data-editor-shell data-layout={layout} style={{ width: hostWidth, height: 650, "--sidebar-width": "352px" } as React.CSSProperties}>
    <header className={editorHeaderStyles.editorHeader}>
      header
      {/* 测试控件与生产工具栏一样放在工作区外，避免成为额外网格项。 */}
      <div><button onClick={() => view.setMode("fit")}>fit</button><button onClick={() => view.setMode("actual")}>actual</button></div>
    </header>
    <section className={styles.editorWorkspace} data-layout={layout} data-history-open={history} data-sidebar-collapsed={!sidebar}>
      <nav data-history-rail>rail</nav>
      <aside data-history-panel>history</aside>
      <div ref={viewport} className={scoreInteractionStyles.pageViewport} data-score-viewport data-viewport>
        <div className={scoreInteractionStyles.scoreStage} style={view.stageStyle} data-stage>
          <main className={scoreInteractionStyles.paper} style={view.paperStyle} data-paper>
            <svg viewBox={`0 0 ${A4_CONTENT_WIDTH * (wideScore ? 2 : 1)} 5000`} className={scoreInteractionStyles.scoreSvg} style={view.svgStyle}>
              <rect width="100%" height="100%" fill="white" />
              <path d="M0 100H500M0 1000H500M0 2000H500M0 3000H500" stroke="black" />
            </svg>
          </main>
        </div>
      </div>
      <aside className={musicTextSidebarStyles.musicTextSidebar} data-music-text-sidebar hidden={!sidebar}>sidebar</aside>
    </section>
    <div data-score-print-layer className={printStyles.printLayer}><div className={printStyles.page}>presentation</div></div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
const portal = document.createElement("div");
portal.dataset.externalPortal = "true";
portal.textContent = "external interaction portal";
document.body.append(portal);
