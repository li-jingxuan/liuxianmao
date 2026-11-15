import { createRoot } from "react-dom/client";
import EditorPage from "../app/editor/page";
import { editorStore } from "../stores/editor-store";
import { resolveScorePointerAction } from "../components/EditorShell/session/editor-object-selection";
import { collectMusicTextRangeSlots, layoutParagraphFocus, hitTestNumbered, hitTestMusicText } from "@liuxianmao/lxm-editor";
import "../app/globals.scss";

Object.assign(window, { rangeReview: { store: editorStore, collectMusicTextRangeSlots, layoutParagraphFocus, hitTestNumbered, hitTestMusicText, resolveScorePointerAction } });
createRoot(document.getElementById("root")!).render(<EditorPage />);
