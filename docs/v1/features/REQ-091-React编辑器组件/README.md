# REQ-091 React 编辑器组件 npm 包

**目标**　已有 React 项目的开发者安装一个组件包，就能嵌入编辑器并获得匹配版本的 Core。

飞书 v1.0 工作表编号为 **REQ-005**。 [React 编辑器接入指南](../../../../packages/lxm-editor-react/README.md)

## 交付与验收

1. React 包通过运行时依赖带入 REQ-090 的 Core，公开约定的组件、内核接口和类型。README 写明 React 兼容版本、样式导入和最小接入代码。
2. 在仓库外空白 React 项目按文档安装，挂载编辑器，加载四小节示例，编辑、保存并重开。核对宿主无需手动安装 Core，样式和资源在生产构建可用。
3. 用宿主按钮替换默认工具栏，调用公开接口编辑并撤销；同时挂载两份谱，验证文档、快捷键和事件互不串用，卸载后释放监听与播放资源。

**v1.0 候选接口**　`@liuxianmao/lxm-editor-react` 安装时带入同版本 Core，宿主提供 React 19 与 React DOM 19。公开组件为 `LxmEditor` 和 `LxmEditorFileActions`。使用 `createEditorSession` 管理会话，通过 `change` 和 `error` 事件接收更新。接入指南涵盖 Props、CSS、文件入口、自定义工具栏和多实例。[React 编辑器接入指南](../../../../packages/lxm-editor-react/README.md)
