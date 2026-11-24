# REQ-090 独立 JS Core npm 包与公共 API 手册

**目标**　开发者仅安装内核即可使用原生 JavaScript 自定义编辑界面。官方组件所需的谱面业务操作均能通过有文档的公共 API 完成。

飞书 v1.0 工作表编号为 **REQ-004**。 [JS Core 公共 API 手册](../../../../packages/lxm-editor/docs/api-v1.md) · [Core 安装与示例](../../../../packages/lxm-editor/README.md)

## 交付与验收

1. 发布可独立安装的运行时 JavaScript 与类型声明。在仓库外从候选包导入 Core，验证浏览器与声明支持的 Node 环境，检查 Core 的安装依赖独立于 React 和 Next.js。
2. 对照官方组件逐项建立「界面操作、公开入口、宿主职责、示例」清单。版本化中文 API 手册覆盖加载迁移、命令、历史、选区、布局命中、渲染、播放及文件输出边界；逐项写明入参、返回、错误、版本与示例。
3. 用原生控件加载练习谱、点击命中、编辑、撤销、保存并重新载入。用坏文件、旧谱和过期编辑目标验证错误或迁移结果。检查示例只引用公开入口。

## v1.0 候选接口

包名为 `@liuxianmao/lxm-editor`。候选制品提供 ESM 与 TypeScript 声明，验收覆盖 Node 和支持 ES2022、`structuredClone` 的浏览器。手册按下列集成操作组织，包内 `dist/public.d.ts` 可查阅其余领域辅助函数和类型。[JS Core 公共 API 手册](../../../../packages/lxm-editor/docs/api-v1.md)

| 界面操作 | Core 入口 | 宿主职责 | 手册示例 |
| --- | --- | --- | --- |
| 打开、迁移、保存曲谱 | `loadDocument`、`upgradeDocumentToCurrent` | 读写文件、选择是否升级、呈现校验错误 | 文档加载、版本迁移、JSON 回读 |
| 点击谱面、绘制选区 | `buildLayout`、`hitTestLayout`、`hitTestNumbered`、`layoutTabCellSelection`、`buildScoreScene` | 转换指针坐标、根据稳定 ID 恢复焦点、绘制场景 | 布局命中和原生浏览器示例 |
| 写入品位、节奏、简谱、歌词、和弦、技巧和小节 | `applyScoreCommand`、`planRhythmPattern`、`validateTechnique` | 捕获编辑版本、呈现错误及变更影响、提交确认后的操作 | 编辑命令和结构影响确认 |
| 撤销、重做、换谱 | `createDocumentHistory`、`transitionDocumentHistory` | 按会话持有历史、应用快照、更新选区和保存状态 | 历史转换和 Node 示例 |
| 试听 | `createPlaybackPlan`、`getPlaybackBeatAtTick` | 调度音源、管理播放状态、同步光标 | 播放计划和 tick 换算 |
| 图片和打印 | `buildScoreScene`、`paginateLayout` | 绘制图元、编码图片、调用打印或下载 | 成品布局与文件输出边界 |

需求中的 OpenAPI 文档指本地 JS Core 的公共接口手册。[包与 API 交付方案](../../首发筹备/02-开源与三端交付.md)
