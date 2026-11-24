import { createRoot } from "react-dom/client";
import { editorStore, EditorWorkspace } from "./editor-workspace.fixture";
import { resolveScorePointerAction } from "../../../packages/lxm-editor-react/src/EditorShell/session/editor-object-selection";
import { collectMusicTextRangeSlots, layoutParagraphFocus, hitTestNumbered, hitTestMusicText } from "@liuxianmao/lxm-editor";
import "../app/globals.scss";

Object.assign(window, { rangeReview: { store: editorStore, collectMusicTextRangeSlots, layoutParagraphFocus, hitTestNumbered, hitTestMusicText, resolveScorePointerAction } });
createRoot(document.getElementById("root")!).render(<EditorWorkspace />);
