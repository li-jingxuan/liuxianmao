# liuxianmao

Turborepo monorepo initialized with a Next.js website app and shared package configuration.

## 项目文档

[六线猫项目文档](docs/README.md)汇总功能、架构与部署资料。从 [v1.0 工作区](docs/v1/README.md)开始新增需求、交互稿和交付方案；此前的版本资料见 [MVP 归档](docs/archive/mvp/README.md)。

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm type-check
```

工具栏图标随网站发布，原始 SVG 素材见 [MVP 图标素材归档](docs/archive/mvp/extracted-svg-icons/README.txt)。

## 编辑器源码导航

- [网站编辑器](apps/website/components/EditorShell/README.md)：页面组装、会话协调、编辑表单、谱面与浏览器输出，组件及其逻辑/样式按业务目录维护。
- [核心领域](packages/lxm-editor/src/core/README.md)：文档校验、命令、节奏、简谱、歌词、和弦与技巧；网站通过包根公共入口消费。
- [布局计算](packages/lxm-editor/src/layout/README.md)：结构排版、音乐文字、节奏与技巧几何，命中与选区共用最终坐标。
- [目录整理记录](docs/archive/mvp/versions/v8/20261111_编辑器目录分组与模块内聚整理.md)：目录归属、迁移约束与验证结果。

## 设计资料

[v1.0 设计基线](docs/v1/design-baseline/README.md)记录当前分支的实际交互和验收依据。改动这些功能时，在 [v1.0 工作区](docs/v1/README.md)建立交付条目。[MVP 设计 v2 归档](docs/archive/mvp/design-v2/README.md)保留历次评审稿和交付记录。
