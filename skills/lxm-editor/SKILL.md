---
name: lxm-editor
description: 接入六线猫 1.0.0 的 @liuxianmao/lxm-editor 和 @liuxianmao/lxm-editor-react。用于读取、校验、迁移或编辑 .lxm 吉他谱，管理撤销重做、布局命中和播放计划，或在 React 19 和 Electron 宿主挂载编辑器、保存会话及定制工具栏。
---

# 接入六线猫编辑器

根据宿主要完成的任务选择 npm 包。处理曲谱数据、自绘谱面或生成播放时间线时使用 Core。要嵌入现成的编辑工作区时使用 React 包，其根入口也导出 Core 的命令和类型。

## 用 Core 读写曲谱

从 `@liuxianmao/lxm-editor` 的 ESM 根入口导入函数和类型。在 Node.js 22 或更新版本中，可把 `examples/core/` 完整复制到可写目录，在该目录安装依赖并运行示例。使用候选包时，将同版本 Core tarball 放在该目录。

```sh
npm init -y
npm install --omit=dev ./liuxianmao-lxm-editor-1.0.0.tgz
node edit-score.mjs
```

使用已提供正式版的 registry 时，安装命令为 `npm install --save-exact @liuxianmao/lxm-editor@1.0.0`。示例将合成谱的首个 TAB 单元格设为第 3 品，完成撤销、重做和序列化回读，再验证布局命中和播放事件。[Node.js 示例](examples/core/edit-score.mjs) · [合成曲谱](examples/core/synthetic-score.lxm)

- **读谱和保存**。将 UTF-8 JSON 文本交给 `loadDocument`，检查 `ok`。普通加载要求 Schema 8。经用户确认，可将已解析的 Schema 4–7 对象传给 `upgradeDocumentToCurrent`。用 `JSON.stringify` 序列化成功快照，再回读验证。[文档与校验](references/core-api.md#文档与校验)
- **编辑和撤销**。从文档或命中结果取得稳定 ID，按 `ILXMScoreCommand` 构造命令，以当前 `documentRevision` 作为 `expectedRevision`。检查 `ok`、`changed` 后再更新文档及历史。历史恢复会带回原修订号，跨撤销或换谱的异步写入还需核对宿主会话。[编辑命令](references/core-api.md#编辑命令) · [历史](references/core-api.md#历史)
- **绘制、点击和播放**。从 `buildLayout` 获取逻辑坐标，用命中函数定位编辑目标，按 `buildScoreScene` 输出绘制或分页。`createPlaybackPlan` 提供拍点和声音事件，音频时钟、采样和游标由宿主驱动。[布局与命中](references/core-api.md#布局与命中) · [场景与分页](references/core-api.md#场景与分页) · [播放计划](references/core-api.md#播放计划)

## 在 React 中嵌入工作区

宿主需要 React 19 和 React DOM 19。正式版可从提供该版本的 registry 安装 `@liuxianmao/lxm-editor-react@1.0.0`。使用候选包时，在同一次 `npm install` 中传入 Core 和 React 的两个 tarball。可直接复制随附的 Vite 示例，按说明安装后运行 `npm run dev`。[示例项目与安装命令](examples/react/README.md)

```tsx
"use client";

import { useState } from "react";
import { createEditorSession, LxmEditor } from "@liuxianmao/lxm-editor-react";
import "@liuxianmao/lxm-editor-react/styles.css";

export function ScoreEditor({ initialScore }: { initialScore?: unknown }) {
  const [session] = useState(() =>
    createEditorSession(initialScore, { onError: ({ message }) => console.error(message) }),
  );
  return <div style={{ height: 640 }}><LxmEditor session={session} /></div>;
}
```

- **挂载与新建**。给嵌入容器明确高度。全页布局可使用 `fullPage`，按需导入 `page.css`。编辑页外的建谱入口使用 `LxmEditorFileActions`，与工作区共享宿主持有的会话。[组件与样式](references/react-api.md#组件与样式)
- **换谱与保存**。每个独立工作区创建一个稳定会话。`initialScore` 只在创建时读取，换谱时调用 `session.replaceDocument(input)` 并检查 `ok`。直接载入要求 Schema 8、单轨且至少有一小节。序列化 `getDocument()` 或 `change` 事件的已提交快照；卸载时释放宿主订阅。[会话](references/react-api.md#会话) · [双会话保存和恢复示例](examples/react/src/main.tsx)
- **定制与桌面接入**。按宿主需求注入工具栏、导航、资源或 Electron 文件与打印桥接。[工具栏](references/react-api.md#工具栏) · [导航与资源](references/react-api.md#导航与资源) · [Electron 宿主](references/react-api.md#electron-宿主)
