import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { A4_CONTENT_WIDTH } from "@liuxianmao/lxm-editor";
import { useScoreView } from "../components/EditorShell/score/use-score-view";
import { SCORE_ZOOM_LEVELS } from "../components/EditorShell/score/score-view";
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
  const hit = useRef<{ x: number; y: number } | null>(null);
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
      wide: setWideScore, session: (next?: number) => setSession((value) => next ?? value + 1),
      status: () => ({ ...view.geometry, zoom: view.zoom, changes: changes.current, hit: hit.current }),
    } });
  }, [view]);
  return <div className={styles.editor} data-editor-shell data-layout={layout} style={{ width: hostWidth, height: 650, "--sidebar-width": "352px" } as React.CSSProperties}>
    <header className={editorHeaderStyles.editorHeader}>
      header
      {/* 夹具只驱动倍率；真实产品控件另由编辑器浏览器验收覆盖。 */}
      <div>{SCORE_ZOOM_LEVELS.map((zoom) => <button key={zoom} onClick={() => view.setZoom(zoom)}>{zoom}%</button>)}</div>
    </header>
    <section className={styles.editorWorkspace} data-layout={layout} data-history-open={history} data-sidebar-collapsed={!sidebar}>
      <nav data-history-rail>rail</nav>
      <aside data-history-panel>history</aside>
      <div ref={viewport} className={scoreInteractionStyles.pageViewport} data-score-viewport data-viewport>
        <div className={scoreInteractionStyles.scoreStage} style={view.stageStyle} data-stage data-score-zoom={view.zoom}>
          <main className={scoreInteractionStyles.paper} style={view.paperStyle} data-paper>
            <svg viewBox={`0 0 ${A4_CONTENT_WIDTH * (wideScore ? 2 : 1)} 5000`} className={scoreInteractionStyles.scoreSvg} style={view.svgStyle} onPointerDown={(event) => {
              // 与编辑器一致，仅用实际屏幕矩阵逆变换，不再次除以倍率。
              const matrix = event.currentTarget.getScreenCTM();
              if (matrix) hit.current = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            }}>
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
