import type React from "react";
import { EditorShell } from "../components/editor-shell/EditorShell";

/** 首页只负责装配编辑器壳，领域状态由核心包管理。 */
const HomePage: React.FC = () => <EditorShell />;

export default HomePage;
