import { createRoot } from "react-dom/client";
import { EditorWorkspace } from "../app/editor/EditorWorkspace";
import { editorStore } from "../stores/editor-store";
import { resolveScorePointerAction } from "../components/EditorShell/session/editor-object-selection";
import { collectMusicTextRangeSlots, layoutParagraphFocus, hitTestNumbered, hitTestMusicText } from "@liuxianmao/lxm-editor";
import "../app/globals.scss";

Object.assign(window, { rangeReview: { store: editorStore, collectMusicTextRangeSlots, layoutParagraphFocus, hitTestNumbered, hitTestMusicText, resolveScorePointerAction } });
createRoot(document.getElementById("root")!).render(<EditorWorkspace />);
