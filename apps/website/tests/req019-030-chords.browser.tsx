import { createRoot } from "react-dom/client";
import { EditorWorkspace } from "../app/editor/EditorWorkspace";
import { editorStore } from "../stores/editor-store";
import "../app/globals.scss";

Object.assign(window, { coexistStore: editorStore });
createRoot(document.getElementById("root")!).render(<EditorWorkspace />);
