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

## 设计与 UI 重构

[UI 设计与重构总纲](docs/design/README.md)统一管理设计稿、规范复审、技术方案和实施验收，包含本轮范围、阅读顺序、当前进度与下一步。
