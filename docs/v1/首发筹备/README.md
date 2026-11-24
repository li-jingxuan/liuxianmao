# 六线猫 v1.0 交付计划

建议按 **JS Core → React 编辑器候选包 → Electron 桌面版** 的顺序开发。React 包先用仓库外的示例和现有 Web 编辑器验证接入，再交给 Windows、macOS 共用的 Electron 应用。两包通过候选验收即可开始完整的桌面开发，正式 `1.0.0` 随首发验收放行。开源准备和桌面打包验证可以并行。

## 需求范围

下表列出 v1.0 的编辑器与发版交付事项。仓库专题保留已有编号，讨论实施进度时使用飞书编号。REQ-001（SEO）、REQ-002（首页与 Web 体验）、REQ-008（宣传与渠道复盘）按版本列排在 `v1.1`。REQ-011（GEO）属于 `v1.0`，单独评审技术方案。[飞书「v1.0」工作表](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=D9eELE) · [REQ-011 GEO 技术方案](../features/REQ-011-GEO/README.md)

| 飞书编号 | v1.0 交付物 | 仓库专题 |
| --- | --- | --- |
| REQ-003 | GitHub 开源仓库、中文 README、许可证、可运行示例 | [REQ-089](../features/REQ-089-GitHub开源与README/README.md) |
| REQ-004 | 独立 JS Core npm 包及版本化公共 API 手册，支持自定义 UI | [REQ-090](../features/REQ-090-JS内核与公共API/README.md) |
| REQ-005 | 可嵌入的 React 编辑器 npm 包，自动安装配套 Core | [REQ-091](../features/REQ-091-React编辑器组件/README.md) |
| REQ-006 | 支持离线编辑和跨端交换曲谱的 Windows 安装包 | [REQ-092](../features/REQ-092-Windows桌面版/README.md) |
| REQ-007 | 支持离线编辑和跨端交换曲谱的 macOS 安装包 | [REQ-093](../features/REQ-093-macOS桌面版/README.md) |
| REQ-009 | GitHub 开源与版本发布规则 | [本页发版规则](#github-与-npm-发版) |

`@liuxianmao/lxm-editor` 负责文档、命令与布局，`@liuxianmao/lxm-editor-react` 复用现有编辑会话、谱面和工具栏。Web 通过 React 包接入，提供站点导航、资源路径和跨页面会话。 [Core 公共 API](../../../packages/lxm-editor/docs/api-v1.md) · [React 编辑器接入指南](../../../packages/lxm-editor-react/README.md) · [编辑器源码导航](../../../packages/lxm-editor-react/src/EditorShell/README.md)

## 里程碑与验收

| 阶段 | 实施内容 | 完成条件 |
| --- | --- | --- |
| M0 确定边界 | 确定 Core 公开 API 首批清单、包名和 npm scope，约定 React 的实例状态与宿主接口。准备中文 README、许可证、再分发素材清单和一份可公开使用的四小节谱。同时确认桌面首发架构、构建环境、签名和公证条件。 | 谱例与公开范围明确。文件、资源和编辑会话的接口有初稿。桌面工作可以拿同一份谱做最小验证。 |
| M1 JS Core（REQ-004） | 改造现有包，输出可运行的 ESM 和 `.d.ts`。整理加载与迁移、编辑命令、历史与选区的接入方式、布局命中、渲染场景、播放计划和序列化的公开入口。同步编写版本化中文 API 手册和纯 JS 示例。 | 仓库外仅安装 Core，在 Node ESM 与浏览器打包器验证真实候选包。纯 JS 示例通过公开入口完成加载、点击命中、修改、撤销、序列化与重开，并覆盖坏文件、旧谱升级和过期编辑目标。 |
| M2 React 编辑器（REQ-005） | 从现有工作台抽出可嵌入的组件，默认工具栏可用，工具栏可由宿主替换。公开组件、样式入口、事件和宿主适配接口。React 包以运行时依赖带入配套 Core，`react` 和 `react-dom` 声明为 peer 依赖。 | 空白 React 项目仅安装组件包及 peer，生产构建后可编辑、试听、保存并重开。验证自定义工具栏、两个编辑器实例的状态与快捷键隔离，以及卸载清理。现有 Web 编辑器接入后跑关键流程回归。双包的公开 API 一起用候选包走查。 |
| M3 Electron 桌面（REQ-006、REQ-007） | 用一个 Electron 应用承载已验证的 React 编辑器。优先验证独立编辑器 renderer 的离线构建，通过宿主接口接入原生打开、保存、另存、打印和未保存退出保护，把字体、和弦库与音色随应用打包。 | Windows 和 macOS 的目标架构均用候选安装包实装。断网从中文路径打开、编辑、试听、保存、重开和导出，检查取消、写入失败和未保存退出。Windows、macOS、现有 Web 之间交叉打开同一份 `.lxm`，核对谱面和编辑结果。 |
| M4 正式放行（REQ-003、REQ-009） | 在干净环境按 README 构建并运行示例，核对公开仓库、包版本、API 文档、签名与安装包。 | 外部可按文档安装两包，并从 GitHub Release 下载已验收的安装包。发布记录可追溯到源码标签和产物校验值。 |

M0 可并行做 Electron 最小验证。用占位窗口跑一次两平台打包、断网加载随包资源和原生文件对话框，并落实真机与签名条件。建议先验证 Windows x64 和 macOS arm64，其他架构按首发承诺补充。M2 通过后，桌面主开发直接接入候选组件。现有 Web 在 v1.0 充当组件的真实消费方和跨端验收入口，首页改版按 REQ-002 的 `v1.1` 排期。

双包和桌面共用同一组验收谱。首发格式沿用当前的 `.lxm`，内容为 UTF-8 JSON，当前 Schema 为 8，旧 Schema 4–7 的升级路径以当前代码为准。此前专题中的 `.lxm.json` 是旧口径。Core 负责曲谱数据和确定性的谱面逻辑，React 提供交互、渲染和播放接入，宿主提供系统文件操作和打印出口。技术参考中的 Next standalone 路线可用于需要纳入其他网站路由的情况。 [曲谱文件基线](../design-baseline/score-files.md) · [开源与三端交付技术参考](02-开源与三端交付.md)

## GitHub 与 npm 发版

- `main` 用于日常合并。需要让正式版本修补与新功能并行时，再维护 `release/1.0` 分支。每个对外版本用 Git tag 标记具体提交，如 `v1.0.0-rc.1`、`v1.0.0`、`v1.0.1`。GitHub Release 绑定对应 tag，列出变更、支持平台、安装包、SHA-256、npm 包和 API 文档。
- 双包先生成 tarball，在仓库外验证。需要让外部开发者试装时，在开源与分发条件满足后，先发 Core，再发依赖它的 React。两个候选包对齐版本，如 `1.0.0-rc.1`，使用 npm `next` dist-tag。
- 建议正式版从同一发布提交构建。先验证 Core 的 `1.0.0` 可安装，再验证 React 的 `1.0.0` 自动拉取匹配 Core，两包通过后再切换到 `latest`。GitHub Release 随已通过签名、实装与跨端验收的桌面制品发布。
