# 六线猫 JavaScript Core 1.0

**把想弹的，写成谱。**

六线猫是一款吉他曲谱编辑器，可以在同一份谱里编写六线谱（TAB）、简谱、歌词和和弦。`@liuxianmao/lxm-editor` 是六线猫的 JavaScript Core，适合在 Node.js 中处理曲谱，也适合想自己做写谱或练习界面的开发者。

- **自建界面或处理曲谱，选 Core。** Core 提供文档加载与校验、编辑命令、撤销重做、谱面布局与点击命中、绘制图元和播放计划。做吉他教学页时，可以用命中结果确定学生点的是哪一拍、哪根弦，再按练习规则提交品位修改。做自己的写谱工具时，可以用图元绘制谱面，自行设计工具栏和输入方式。
- **在 React 19 应用里直接嵌入编辑器，选 `@liuxianmao/lxm-editor-react`。** 它基于同一套 Core，提供带工具栏、侧栏、试听和 `.lxm` 导入导出的编辑工作区。例如，吉他教学平台可以在备课页嵌入工作区，让老师编一份副歌弹唱练习并试听。

## 快速开始

1.0 正式版尚未发布到公共 npm 注册表。拿到候选包 `liuxianmao-lxm-editor-1.0.0.tgz` 后，把它放进一个仓库外的空目录。在该目录中执行以下命令，建议使用 Node.js 22 或更新版本。

```sh
npm init -y
npm install --omit=dev ./liuxianmao-lxm-editor-1.0.0.tgz
```

### 在 Node.js 里改一拍

```sh
node node_modules/@liuxianmao/lxm-editor/demo/node.mjs
```

示例加载一小节空白 TAB，在第一个单元格填入第 3 品，检查撤销、重做和序列化后重新加载的结果，再生成谱面场景和播放计划。运行成功后，终端会显示一行谱面和一个声音事件。[Node 示例源码](./demo/node.mjs)

### 在原生浏览器里点谱编辑

在同一目录启动静态服务器。

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

用支持 ES2022、`structuredClone` 和 import map 的浏览器打开 `http://127.0.0.1:8080/node_modules/@liuxianmao/lxm-editor/demo/`。输入品位，点击谱面小节内的一根弦，再试试撤销和重做。示例将 Core 的场景图元绘制成 SVG，并用命中结果确定要编辑的拍点和弦号。HTML 里的 import map 将包名映射到已安装的 ESM 文件。[浏览器示例入口](./demo/index.html) · [编辑逻辑](./demo/browser.mjs)

## v1.0 API

Core 1.0 从包根入口提供 ESM 命名导入和 TypeScript 声明（`.d.ts`）。例如，`loadDocument` 读取曲谱 JSON，`applyScoreCommand` 提交编辑，`buildLayout`、`hitTestLayout` 和 `buildScoreScene` 分别提供布局、命中和绘制图元，`createPlaybackPlan` 生成播放时间线。文档输入的布局和播放计划使用第一条吉他轨道。[v1.0 公共 API 手册](./docs/api-v1.md)

## 常见问题

### Core 可以读取 `.lxm` 文件吗？

`.lxm` 是六线猫的可编辑曲谱文件，内容为 UTF-8 JSON。宿主读取文件文本后交给 `loadDocument`，保存时用 `JSON.stringify` 将文档转回 JSON 文本。常规加载要求 Schema 8。解析后的 Schema 4–7 对象可以用 `upgradeDocumentToCurrent` 显式升级。包版本 `1.0.0` 和曲谱的 `schemaVersion` 各自独立。[文档加载与保存 API](./docs/api-v1.md)

### 用 Core 自建界面时，谁来绘制谱面和播放声音？

宿主根据 Core 返回的图元绘制谱面，并根据播放计划中的拍点和声音事件调度音频、同步游标。工具栏、文件选择和保存也由宿主接入。[布局、场景与播放计划 API](./docs/api-v1.md)
