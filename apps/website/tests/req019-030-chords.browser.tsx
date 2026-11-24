import { createRoot } from "react-dom/client";
import { editorStore, EditorWorkspace } from "./editor-workspace.fixture";
import "../app/globals.scss";

Object.assign(window, { coexistStore: editorStore });
createRoot(document.getElementById("root")!).render(<EditorWorkspace />);
