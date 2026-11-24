# 六线猫 v1.0 交付计划

建议按 **JS Core → React 编辑器候选包 → Electron 桌面版** 的顺序开发。React 包先用仓库外的示例和现有 Web 编辑器验证接入，再交给 Windows、macOS 共用的 Electron 应用。两包通过候选验收即可开始完整的桌面开发，正式 `1.0.0` 随首发验收放行。开源准备和桌面打包验证可以并行。

## 需求范围

下表列出 v1.0 的编辑器与发版交付事项。仓库专题保留已有编号，讨论实施进度时使用飞书编号。REQ-001（SEO）、REQ-002（首页与 Web 体验）、REQ-008（宣传与渠道复盘）按版本列排在 `v1.1`。[飞书「v1.0」工作表](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=D9eELE)

| 飞书编号 | v1.0 交付物 | 仓库专题 |
| --- | --- | --- |
| REQ-003 | GitHub 开源仓库、中文 README、许可证、可运行示例 | [REQ-089](../features/REQ-089-GitHub开源与README/README.md) |
| REQ-004 | 独立 JS Core npm 包及版本化公共 API 手册，支持自定义 UI | [REQ-090](../features/REQ-090-JS内核与公共API/README.md) |
| REQ-005 | 可嵌入的 React 编辑器 npm 包，自动安装配套 Core | [REQ-091](../features/REQ-091-React编辑器组件/README.md) |
| REQ-006 | 支持离线编辑和跨端交换曲谱的 Windows 安装包 | [REQ-092](../features/REQ-092-Windows桌面版/README.md) |
| REQ-007 | 支持离线编辑和跨端交换曲谱的 macOS 安装包 | [REQ-093](../features/REQ-093-macOS桌面版/README.md) |
| REQ-009 | GitHub 开源与版本发布规则 | [REQ-089 发版规则](../features/REQ-089-GitHub开源与README/README.md#github-与-npm-发版) |
| REQ-011 | GEO（待验收）。首页可引用的写谱、导出与开发者接入说明，以及联网问答抽查 | [REQ-011 实现与验收](../features/REQ-011-GEO/README.md) |

`@liuxianmao/lxm-editor` 负责文档、命令与布局，`@liuxianmao/lxm-editor-react` 复用现有编辑会话、谱面和工具栏。Web 通过 React 包接入，提供站点导航、资源路径和跨页面会话。 [Core 公共 API](../../../packages/lxm-editor/docs/api-v1.md) · [React 编辑器接入指南](../../../packages/lxm-editor-react/README.md) · [编辑器源码导航](../../../packages/lxm-editor-react/src/EditorShell/README.md)

## 里程碑与验收

| 阶段 | 实施内容 | 完成条件 |
| --- | --- | --- |
| M0 确定边界 | 确定 Core 公开 API 首批清单、包名和 npm scope，约定 React 的实例状态与宿主接口。准备中文 README、许可证、再分发素材清单和一份可公开使用的四小节谱。可并行推进桌面最小验证。 | 谱例与公开范围明确。文件、资源和编辑会话的接口有初稿。桌面工作可以拿同一份谱做最小验证。 |
| M1 JS Core（REQ-004） | 改造现有包，输出可运行的 ESM 和 `.d.ts`。整理加载与迁移、编辑命令、历史与选区的接入方式、布局命中、渲染场景、播放计划和序列化的公开入口。同步编写版本化中文 API 手册和纯 JS 示例。 | 仓库外仅安装 Core，在 Node ESM 与浏览器打包器验证真实候选包。纯 JS 示例通过公开入口完成加载、点击命中、修改、撤销、序列化与重开，并覆盖坏文件、旧谱升级和过期编辑目标。 |
| M2 React 编辑器（REQ-005） | 从现有工作台抽出可嵌入的组件，默认工具栏可用，工具栏可由宿主替换。公开组件、样式入口、事件和宿主适配接口。React 包以运行时依赖带入配套 Core，`react` 和 `react-dom` 声明为 peer 依赖。 | 空白 React 项目仅安装组件包及 peer，生产构建后可编辑、试听、保存并重开。验证自定义工具栏、两个编辑器实例的状态与快捷键隔离，以及卸载清理。现有 Web 编辑器接入后跑关键流程回归。双包的公开 API 一起用候选包走查。 |
| M3 Electron 桌面（REQ-006、REQ-007） | 接入 M2 候选组件，按 [Windows 专题](../features/REQ-092-Windows桌面版/README.md) 和 [macOS 专题](../features/REQ-093-macOS桌面版/README.md) 实施。 | 按 [共享桌面版技术方案](../features/REQ-092-Windows桌面版/桌面版技术方案.md) 完成两平台候选制品和实机验收。 |
| M4 正式放行（REQ-003、REQ-009） | 在干净环境按 README 构建并运行示例，核对公开仓库、包版本、API 文档、签名与安装包。 | 外部可按文档安装两包，并从 GitHub Release 下载已验收的安装包。发布记录可追溯到源码标签和产物校验值。 |

现有 Web 在 v1.0 充当组件的真实消费方和跨端验收入口，首页改版按 REQ-002 的 `v1.1` 排期。

双包和桌面共用同一组验收谱。产品仅打开和保存 `.lxm` 曲谱，内容为 UTF-8 JSON，当前 Schema 为 8，旧 Schema 4–7 的升级路径以当前代码为准。仓库内部曲谱 mock 用 `.lxm.json`。Core 负责曲谱数据和确定性的谱面逻辑，React 提供交互、渲染和播放接入，宿主提供系统文件操作和打印出口。技术参考中的 Next standalone 路线可用于需要纳入其他网站路由的情况。 [曲谱文件基线](../design-baseline/score-files.md) · [开源与三端交付技术参考](02-开源与三端交付.md)
