# 六线猫 React 编辑器 1.0

**把想弹的，写成谱。**

六线猫是一款吉他曲谱编辑器，可以在同一份曲谱里记录六线谱（TAB）、简谱、歌词和和弦。`@liuxianmao/lxm-editor-react` 把写谱工作区带进 React 19 应用，适合吉他教学网站、练习工具和需要嵌入编辑器的网页。比如，老师可以在教学页里写一份弹唱谱，让学生把指法、旋律和歌词放在一起看，再用试听和节拍器练习。

工作区自带编辑工具栏、属性侧栏、历史面板、试听和节拍器，支持 `.lxm` 文件导入导出、PNG 图片导出和 A4 打印。如果你想自己设计谱面、输入方式或练习界面，可以直接使用 JavaScript Core `@liuxianmao/lxm-editor`。它提供文档校验、编辑命令、谱面布局、绘制图元和播放计划，也是 React 编辑器所用的核心库。

- [安装候选包并挂载编辑器](#安装候选包并挂载编辑器)
- [新建或载入曲谱](#新建或载入曲谱)
- [读取、编辑和订阅会话](#读取编辑和订阅会话)
- [自定义工具栏](#自定义工具栏)
- [在首页放置文件入口](#在首页放置文件入口)
- [在同一页编辑多份曲谱](#在同一页编辑多份曲谱)
- [常见问题](#常见问题)
- [配置导航与部署资源](#配置导航与部署资源) · [接入 Electron](#接入-electron)

## 安装候选包并挂载编辑器

1.0 尚未发布到公共 npm 注册表。在已有 React 19 和 React DOM 19 的项目中，把两个同版本候选 tarball 放在项目目录下，然后一起安装。

```sh
npm install ./liuxianmao-lxm-editor-1.0.0.tgz ./liuxianmao-lxm-editor-react-1.0.0.tgz
```

如果验收环境的临时 registry 已提供两个候选包，并且可以解析公共依赖，就能直接安装 React 包。命令里的 `LXM_CANDIDATE_REGISTRY` 为该 registry 的地址。

```sh
npm install @liuxianmao/lxm-editor-react@1.0.0 --registry="$LXM_CANDIDATE_REGISTRY"
```

**正式发布后**，可从公共 npm 注册表安装。

```sh
npm install @liuxianmao/lxm-editor-react@1.0.0 --registry=https://registry.npmjs.org
```

React 包依赖同版本 Core，并从包根入口重新导出 Core 的公开 API。如果应用通过 `@liuxianmao/lxm-editor` 包名直接导入 API，将 Core 声明为应用的直接依赖。

导入组件、会话工厂和样式，给编辑器外层容器一个明确的高度。下面的组件可以直接放进 React 页面。

```tsx
"use client";

import { useState } from "react";
import { createEditorSession, LxmEditor } from "@liuxianmao/lxm-editor-react";
import "@liuxianmao/lxm-editor-react/styles.css";

export function ScoreWorkspace({ initialScore }: { initialScore?: unknown }) {
  const [session] = useState(() =>
    createEditorSession(initialScore, {
      onError: ({ message }) => console.error(message),
    }),
  );

  return (
    <div style={{ height: "100dvh", minHeight: 0 }}>
      <LxmEditor session={session} />
    </div>
  );
}
```

在 Next.js 中，把创建会话、传入回调和挂载编辑器的代码放在 Client Component。样式也可以统一在根布局导入一次。

## 新建或载入曲谱

`createEditorSession()` 创建空会话。挂载后，用户可以新建四小节空谱，或从文件导入已有曲谱。

如果应用已有一份曲谱，把文档对象或 JSON 字符串传给 `createEditorSession(input)`。会话通过 Core 加载并校验输入，要求 Schema 8、单轨且至少含一个小节。初始输入校验失败时会话保持为空，工厂的 `onError` 可以接收错误消息。

工作区已经挂载时，调用 `session.replaceDocument(input)` 切换曲谱，输入要求相同。`initialScore` 在上面的组件中只用于初始化会话。

## 读取、编辑和订阅会话

- `session.getDocument()` 读取当前已提交的文档快照。空会话返回 `null`。未提交的界面草稿不会进入快照。请把文档、命令结果与事件视为不可变数据，需要修改时先复制。
- `session.execute(command)` 同步执行一条 Core 命令，返回 Core 的成功或失败结果。空会话返回 `null`。应用可以用这个入口直接发起编辑操作。工作区内的自定义按钮使用 `toolbar` 提供的 `execute`，可以沿用编辑器的草稿保护和结构影响确认。
- `session.undo()` 和 `session.redo()` 在存在对应历史条目时切换快照。
- `session.replaceDocument(input)` 返回 `DocumentLoadResult`。成功时开始新的会话版本，清空选区、剪贴板和历史。失败时保留当前曲谱和历史，可从结果的 `errors` 读取校验信息。
- `session.on("change", listener)` 在命令实际修改文档、撤销、重做或换谱成功后触发。事件包含 `document`、`reason` 和 `effects`，命令事件还包含 `command`。`reason` 分别为 `command`、`undo`、`redo`、`replace`。内置新建与导入也会发出 `replace`，仅改变选区时不会发出 `change`。
- `session.on("error", listener)` 接收含有 `message` 的会话错误。两个 `on` 方法都返回取消订阅函数。也可以通过 `createEditorSession(input, { onChange, onError })` 在创建会话时注册回调。

应用可以在 `change` 时保存已提交的快照。快照引用在文档变化前保持稳定，可以直接用 `useSyncExternalStore` 读取，例如在编辑器外显示曲名。

```tsx
import { useSyncExternalStore } from "react";
import type { EditorSession } from "@liuxianmao/lxm-editor-react";

export function ScoreTitle({ session }: { session: EditorSession }) {
  const score = useSyncExternalStore(
    (notify) => session.on("change", notify),
    session.getDocument,
    session.getDocument,
  );
  return <h1>{score?.score.title || "未命名曲谱"}</h1>;
}
```

## 自定义工具栏

传入 `toolbar` 渲染函数来替换编辑工具按钮。编辑器仍提供谱面右键面板、历史、属性侧栏、试听和节拍器。渲染函数可读取 `document`、TAB 选区 `selection` 和当前时值 `rhythm`，以及 `readOnly`（当前只读状态）、`blocked`、`canUndo`、`canRedo` 和 `sidebarCollapsed`。

自定义编辑按钮在点击时调用工具栏提供的 `execute(command)`。它会检查编辑保护状态，并在命令需要时等待结构影响确认。返回的 `Promise<boolean>` 在命令已应用或成功但内容无需修改时为 `true`，操作受阻、取消或失败时为 `false`。如果要在操作完成后更新宿主界面，可以等待此结果。`blocked` 和 `readOnly` 可用于设置按钮的禁用状态。

下面的按钮在曲谱末尾追加一小节。撤销、重做和侧栏开关也使用 `toolbar` 参数里的操作函数。

```tsx
import {
  LxmEditor,
  LXMScoreCommandEnum,
  type EditorSession,
} from "@liuxianmao/lxm-editor-react";

export function CustomScoreEditor({ session }: { session: EditorSession }) {
  return (
    <div style={{ height: "100dvh" }}>
      <LxmEditor
        session={session}
        toolbar={({
          document,
          readOnly,
          blocked,
          execute,
          canUndo,
          canRedo,
          undo,
          redo,
          sidebarCollapsed,
          toggleSidebar,
        }) => {
          const track = document?.score.tracks[0];
          const lastMeasure = track?.measures.at(-1);
          return (
            <>
              <button
                type="button"
                disabled={readOnly || blocked || !lastMeasure}
                onClick={() => {
                  if (!track || !lastMeasure) return;
                  void execute({
                    type: LXMScoreCommandEnum.InsertMeasure,
                    trackId: track.id,
                    afterMeasureId: lastMeasure.id,
                  });
                }}
              >
                追加空小节
              </button>
              <button type="button" disabled={!canUndo} onClick={undo}>
                撤销
              </button>
              <button type="button" disabled={!canRedo} onClick={redo}>
                重做
              </button>
              <button
                type="button"
                aria-expanded={!sidebarCollapsed}
                onClick={toggleSidebar}
              >
                属性
              </button>
            </>
          );
        }}
      />
    </div>
  );
}
```

## 在首页放置文件入口

`LxmEditorFileActions` 可以在工作区外打开同样的新建和导入面板。把会话放在首页和编辑页共用的客户端宿主里，让文件入口和 `LxmEditor` 接收同一个会话。只有新建或导入成功写入文档后，`onReplacement` 才会触发，适合用来跳转到编辑页。

```tsx
import {
  LxmEditorFileActions,
  type EditorSession,
} from "@liuxianmao/lxm-editor-react";

export function HomeScoreActions({
  session,
  openEditor,
}: {
  session: EditorSession;
  openEditor: () => void;
}) {
  return (
    <LxmEditorFileActions session={session} onReplacement={openEditor}>
      {({ newScore, importScore, notice }) => (
        <>
          <button
            type="button"
            onClick={(event) => newScore(event.currentTarget)}
          >
            新建曲谱
          </button>
          <button
            type="button"
            onClick={(event) => importScore(event.currentTarget)}
          >
            导入曲谱
          </button>
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </LxmEditorFileActions>
  );
}
```

## 在同一页编辑多份曲谱

每个同时挂载的编辑工作区使用独立会话。这样，两份谱各自维护文档、选区、草稿、剪贴板和撤销历史，谱面快捷键作用于当前交互的工作区。

```tsx
import { useState } from "react";
import { createEditorSession, LxmEditor } from "@liuxianmao/lxm-editor-react";

export function CompareScores({
  left,
  right,
}: {
  left: unknown;
  right: unknown;
}) {
  const [leftSession] = useState(() => createEditorSession(left));
  const [rightSession] = useState(() => createEditorSession(right));
  return (
    <>
      <div style={{ height: 480 }}>
        <LxmEditor session={leftSession} />
      </div>
      <div style={{ height: 480 }}>
        <LxmEditor session={rightSession} />
      </div>
    </>
  );
}
```

卸载工作区会清理该界面的草稿、计时器和播放任务。应用可以继续持有会话，在另一条路由重新挂载时保留已提交曲谱和历史。组件手动订阅 `session.on` 时，可以在卸载时调用返回的取消订阅函数。

## 常见问题

### `.lxm` 是什么？应用如何保存曲谱？

`.lxm` 是六线猫的可编辑曲谱文件，内容为 UTF-8 JSON。用户可以通过编辑器导入或导出 `.lxm`。应用也可以读取 `session.getDocument()`，用 `JSON.stringify` 将非空文档快照转为 JSON，保存到自己的存储中。需要重新打开时，把 Schema 8 文档对象或 JSON 文本交给 `createEditorSession` 或 `session.replaceDocument`。

### 旧版 `.lxm` 文件可以打开吗？

可以。六线猫 React 编辑器的内置 `.lxm` 导入会将 Schema 4–7 的曲谱迁移到 Schema 8。通过 `createEditorSession(input)` 或 `session.replaceDocument(input)` 直接载入时，应用需要提供 Schema 8 文档。应用可以用包根入口导出的 `upgradeDocumentToCurrent` 迁移已解析的 Schema 4–7 对象，再把迁移成功的 `document` 传给会话。

### 网页嵌入时需要自己部署和弦库和试听音源吗？

采用包的默认资源时，和弦库与木吉他试听采样通过打包器按需加载。导入 `@liuxianmao/lxm-editor-react/styles.css` 后，样式也会带入 Bravura 谱面字体和工具字形。需要使用站点自己的和弦库或音源目录时，可以配置 `resources`。

### 可以在同一页面同时编辑两份曲谱吗？

可以。用 `createEditorSession` 分别为两份曲谱创建会话，再各自传给一个 `LxmEditor`。文档、剪贴板和撤销历史各自独立，两个工作区可以共用同一次 CSS 导入。

## 配置导航与部署资源

### 连接宿主站点的导航

通过 `navigation.homeHref` 和 `navigation.learningHref` 启用首页和学习入口，默认使用普通链接。Next.js 应用可传入 `renderLink: (props) => <Link {...props} />`，并用 `onNavigate: (href) => router.push(href)` 处理程序发起的跳转。这样链接可以沿用 Next 的 `basePath`、站内导航以及修饰键打开新标签页的行为。用户在离开确认中选择放弃时，应用可在 `onDiscard` 里重置会话。

### 使用自定义资源目录

默认资源随应用的打包产物交付，包括内置品牌图和按需加载的和弦库、木吉他采样。使用默认资源时，应用无需手工复制资源或配置资源根路径。只有在由应用托管资源时才需要设置相关 `resources` 属性。

- `resources.basePath` 为和弦库和试听音源设置共同的部署前缀。配置后分别从 `<basePath>/assets/chords/` 和 `<basePath>/assets/audio/meta-steel-guitar-v1/` 加载。空字符串代表站点根目录。
- `resources.chordCatalogDirectory` 单独指定同源和弦库目录，覆盖共同前缀。目录需包含 `manifest.json` 和清单引用的版本文件。包内的 `dist/assets/chords/` 提供可部署的数据。
- `resources.audioDirectory` 单独指定压缩采样目录，覆盖共同前缀。目录需包含 `manifest.json` 和 `ogg/`，可以提供 `m4a/` 作为 AAC 兼容版本。遇到请求或解码失败时，播放器会尝试另一种编码，两种都失败时会在试听栏提示并允许重试。
- `resources.musicIconBaseUrl` 指向自定义工具 SVG 目录，文件名如 `note-quarter.svg`、`note-dot.svg` 和 `triplet.svg`。`resources.brandIconUrl` 可单独覆盖品牌图。

内置音源从 6 根弦、3 层力度里各选低、中、高三个录音，共 54 个 OGG 采样和对应的 AAC 版本。播放器按谱面的调弦、品位和技巧计算音高，再对最接近的同弦采样移调。需要在改动调弦后获得更接近原始录音的音色时，可以通过 `audioDirectory` 提供全量音源。播放器只请求实际演奏用到的采样。

Safari 18.4 起在对应系统版本支持 Ogg，播放器也提供 AAC 回退。[Safari 的 Ogg 支持](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/#media)

音源来自 Meta Creative Audio 的 CC0 录音。包内附有音源授权和来源记录。[音源授权](./dist/assets/meta-steel-guitar/LICENSE) · [音源来源](./dist/assets/meta-steel-guitar/SOURCE.md) · [Bravura 字体授权](./Bravura-OFL.txt)

## 接入 Electron

在 Electron 渲染进程中使用相同的 React 入口、样式和会话工厂。窗口内可沿用内置的新建、导入和试听流程，内置音源与和弦库随渲染应用的异步打包块交付。

使用系统原生菜单时，由 Electron 宿主通过 preload 桥接处理文件选择和磁盘读写。打开 Schema 8 文件时，把 `.lxm` 的 JSON 文本交给渲染进程中的 `session.replaceDocument(text)`。若原生菜单也支持 Schema 4–7，先解析 JSON，再用 `@liuxianmao/lxm-editor-react` 根入口导出的 `upgradeDocumentToCurrent` 迁移旧文档。迁移成功后，把结果的 `document` 传给 `session.replaceDocument`，并根据加载结果反馈是否打开成功。

保存时，渲染进程读取 `session.getDocument()`，将非空快照序列化为 JSON，再通过 IPC 保存到用户选择的 `.lxm` 路径。

自定义资源目录由渲染页面可请求的同源地址提供。离线发行可使用支持 Fetch 的 Electron 应用协议。

## 在源码仓库中开发

先构建 Core，再运行 `pnpm --filter @liuxianmao/lxm-editor-react build`。React 构建从工作区共用的和弦库与 CC0 采样生成动态资源块。仓库测试可以引用 `src/EditorShell`、`src/stores` 和 `src/editor-session.ts` 中的内部适配器。

外部应用通过包根入口和 `@liuxianmao/lxm-editor-react/styles.css` 接入。`LxmEditorProps`、`LxmEditorFileActionsProps` 和 `LxmEditorToolbarState` 都从包根入口导出。[公开类型索引](./dist/index.d.ts)
