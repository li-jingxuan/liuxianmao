# 六线猫项目文档

- [v1.0 工作区](v1/README.md)用于新增需求、交互稿、交付方案和验收记录。
- [v1.0 设计基线](v1/design-baseline/README.md)按模块记录当前分支的实际行为与验证依据。
- [MVP 归档](archive/mvp/README.md)保留路线图、历次版本交付和[设计 v2 全部资料](archive/mvp/design-v2/README.md)。

[飞书需求表](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=tcgLfi)维护 REQ／BUG 编号、确认口径、状态和验收备注。新设计与产品验收采用 1440px 及以上视口。协作约定见 [AGENTS.md](../AGENTS.md#需求与实现要求)。

## 架构与部署

- **开发与构建** · [项目命令](../README.md#commands) · [原始 SVG 素材](archive/mvp/extracted-svg-icons/README.txt)。
- **网站编辑器** · [EditorShell 源码导航](../packages/lxm-editor-react/src/EditorShell/README.md) · [模块边界重构方案](./archive/mvp/versions/v8/20261111_编辑器模块与职责边界重构技术方案.md) · [目录分组与迁移记录](./archive/mvp/versions/v8/20261111_编辑器目录分组与模块内聚整理.md) · [右侧编辑台历史技术方案](./archive/mvp/design-v2/implementation/05-右侧编辑台实施技术方案.md)。
- **领域模型与谱面布局** · [编辑器核心](../packages/lxm-editor/src/core/README.md) · [结构排版、谱面几何与命中](../packages/lxm-editor/src/layout/README.md) · [MVP 布局设计留档](./archive/mvp/notes/core-layout/)。
- **飞牛 NAS 与 Woodpecker** · [应用打包与安装](../apps/fnos/README.md) · [发布、健康检查与回滚](../deploy/fnos/README.md) · [REQ-078 技术方案](./archive/mvp/versions/v8/REQ-078-飞牛NAS部署与Woodpecker技术方案.md)。
