# 六线猫编辑器开发者 Skill

`lxm-editor` 同时覆盖 Core 和 React 两个 npm 包。下载分发包后，将完整的 `lxm-editor/` 文件夹复制到编码助手的 skill 安装目录。使用 Codex 时，放在消费项目的 `.agents/skills/lxm-editor/`。也可以直接阅读[接入指南](lxm-editor/SKILL.md)。

| 任务 | 调用示例 | 接入材料 |
| --- | --- | --- |
| 处理 `.lxm` 或自建谱面 | `$lxm-editor 把这份谱的第一个 TAB 单元格改为第 3 品，保存并回读` | [Core API](lxm-editor/references/core-api.md) · [Node.js 示例](lxm-editor/examples/core/edit-score.mjs) |
| 在 React 19 中嵌入编辑器 | `$lxm-editor 给这个页面接入曲谱编辑器，刷新后恢复上次保存的谱` | [React API](lxm-editor/references/react-api.md) · [React 示例](lxm-editor/examples/react/README.md) |

运行示例时，在消费项目中按接入指南安装所需 npm 依赖。使用 `1.0.0` 候选包时，Core 示例只需 Core tarball，React 示例需同时安装两个同版本 tarball。
