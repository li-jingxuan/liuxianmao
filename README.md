# liuxianmao

Turborepo monorepo initialized with a Next.js website app and shared package configuration.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm type-check
pnpm assets:build
```

`pnpm assets:build` 会将 `docs/extracted-svg-icons` 中已登记的原始素材标准化到网站运行时资源目录。

## 编辑器源码导航

- [网站编辑器](apps/website/components/EditorShell/README.md)：页面组装、会话协调、编辑表单、谱面与浏览器输出，组件及其逻辑/样式按业务目录维护。
- [核心领域](packages/lxm-editor/src/core/README.md)：文档校验、命令、节奏、简谱、歌词、和弦与技巧；网站通过包根公共入口消费。
- [布局计算](packages/lxm-editor/src/layout/README.md)：结构排版、音乐文字、节奏与技巧几何，命中与选区共用最终坐标。
- [目录整理记录](docs/mvp/v8/20261111_编辑器目录分组与模块内聚整理.md)：目录归属、迁移约束与验证结果。

## 设计与 UI 重构

本轮[工具栏与历史交互稿](docs/design-v2/prototypes/toolbar-history/README.md)及[配套技术方案](docs/design-v2/implementation/12-工具栏历史与响应式优化技术方案.md)已迁入 `design-v2`，包括原型、评审截图和核对脚本；状态仍为设计提案、未实施。

当前设计入口为 [design-v2](docs/design-v2/README.md)，统一管理后续设计稿、技术方案、评审与实施记录。本轮[和弦库与指法交互稿](docs/design-v2/prototypes/chord-library/README.md)及[技术方案](docs/design-v2/implementation/20261107_和弦库与指法编辑优化技术方案.md)均归入 v2。

[旧版 design](docs/design/README.md)已完结并停止维护，仅保留历史设计和验收依据；新增工作请放入 `docs/design-v2/`。
