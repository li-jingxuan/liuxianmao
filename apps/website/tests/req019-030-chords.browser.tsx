import { createRoot } from "react-dom/client";
import EditorPage from "../app/editor/page";
import { editorStore } from "../stores/editor-store";
import "../app/globals.scss";

Object.assign(window, { coexistStore: editorStore });
createRoot(document.getElementById("root")!).render(<EditorPage />);
