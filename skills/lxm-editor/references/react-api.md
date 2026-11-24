# 六线猫 React 编辑器 1.0.0 公开 API

`@liuxianmao/lxm-editor-react` 支持 React 19 和 React DOM 19，根入口为 ESM。根入口还重新导出 `@liuxianmao/lxm-editor` 的公开 API，例如 `ILXMDocument`、`ILXMScoreCommand`、`LXMScoreCommandEnum`、`loadDocument` 和 `upgradeDocumentToCurrent`。应用直接从 Core 包名导入时，将同版本 Core 声明为直接依赖。

## 组件与样式

### `LxmEditor(props: LxmEditorProps)`

| 属性 | 类型 | 行为 |
| --- | --- | --- |
| `session` | `EditorSession` | 必填。使用同一个 React 包入口的 `createEditorSession` 创建。空会话显示新建和导入入口。 |
| `fullPage` | `boolean` | 默认使用嵌入布局，由宿主容器提供高度。整页模式占用 `100dvh`，内容最小宽度为 `1400px`，窄窗可横向滚动。 |
| `host` | `EditorHost` | 提供原生打开、保存、导出、打印和关闭流程，详见 [Electron 宿主](#electron-宿主)。 |
| `toolbar` | `LxmEditorToolbar` | 替换谱面编辑模式的工具按钮，详见[工具栏](#工具栏)。 |
| `navigation` | `LxmEditorNavigation` | 接入首页、学习入口和路由。 |
| `resources` | `LxmEditorResources` | 覆盖和弦、音源、工具图标或品牌图。 |

工作区提供六线谱、简谱、歌词和和弦编辑、属性侧栏、历史、试听和节拍器，以及 `.lxm`、PNG 和 A4 打印流程。浏览器通过内置入口下载文件。组件通过会话接收曲谱和提交结果。

### `LxmEditorFileActions(props: LxmEditorFileActionsProps)`

用在首页或编辑页外。必填 `session: EditorSession` 和 `children: (controls: LxmEditorFileActionControls) => ReactNode`。可选 `onReplacement?: () => void` 在面板成功新建或导入并替换文档后执行，适合触发路由跳转。程序调用 `session.replaceDocument` 产生会话事件，组件的 `onReplacement` 只对应自身面板提交。

`children` 收到 `newScore(trigger: HTMLElement | null): void`、`importScore(trigger: HTMLElement | null): void` 和 `notice: string | null`。点击时传 `event.currentTarget`，便于面板关闭后恢复入口焦点。该组件使用浏览器文件流程，原生文件流程通过 `LxmEditor.host` 接入。

### CSS 入口

- `@liuxianmao/lxm-editor-react/styles.css` 包含工作区、对话框、打印样式、Bravura 字体和内联工具 SVG。嵌入和整页均需导入，可在客户端入口或框架的全局样式入口导入一次。嵌入容器要给出明确高度，Flex 或 Grid 子项可设 `min-height: 0`。
- `@liuxianmao/lxm-editor-react/page.css` 是可额外导入的整页宿主样式。它在 `:root`、`html` 和 `body` 设置页面颜色、字体、视口高度和滚动规则，也覆盖挂在页面上的浮层所继承的基础样式。`fullPage` 控制组件布局，整页基础样式需要宿主显式导入。常规网页嵌入导入 `styles.css` 即可。

## 会话

`createEditorSession(input?: unknown, options?: EditorSessionOptions): EditorSession`。省略 `input` 即创建空会话。可传曲谱对象或 UTF-8 JSON 文本，要求 Schema 8、单轨且至少有一小节。初始校验失败时会话为空，`options.onError` 在工厂执行期间即可收到错误。有效初始文档可立即通过 `getDocument()` 读取。

| `EditorSession` 方法 | 返回类型及行为 |
| --- | --- |
| `getDocument()` | `ILXMDocument \| null`。读取已提交快照，引用在文档变化前稳定。可作为 `useSyncExternalStore` 的 `getSnapshot`。 |
| `execute(command: ILXMScoreCommand)` | `ILXMApplyScoreCommandResult \| null`。同步执行 Core 编辑命令，无文档时返回 `null`。成功结果包括 `ok: true`、`changed`、`document`、可选 `effects` 和焦点信息。失败结果包括 `ok: false`、`code` 和 `message`。工作区自定义按钮应使用 `toolbar` 提供的 `execute` 接入界面保护。 |
| `undo()`、`redo()` | `void`。有对应历史条目时切换文档快照。 |
| `replaceDocument(input: unknown)` | `DocumentLoadResult`，即 `{ ok: true; document: ILXMDocument }` 或 `{ ok: false; errors: string[] }`。成功开启新的会话版本，重置历史、旧选区与剪贴板，并清理当前界面草稿。失败时保留当前曲谱和历史，并发出会话错误。 |
| `on("change", listener)`、`on("error", listener)` | `() => void`，即取消订阅函数。事件类型如下。 |

`EditorSessionOptions` 的可选 `onChange` 和 `onError` 是工厂注册的监听器，签名与上述 `on` 一致。

- `EditorChangeEvent` 有只读字段 `document: ILXMDocument`、`reason: "command" | "undo" | "redo" | "replace"`、`command?: ILXMScoreCommand` 和 `effects: readonly ILXMCommandEffect[]`。命令实际改变文档、撤销、重做或成功换谱时发出事件。内置新建和导入属于 `replace`。初始化、仅选择谱格和内容未变的命令均无 `change` 事件。
- `EditorErrorEvent` 有只读字段 `message: string`。可通过回调显示加载或编辑错误。变化监听器抛出异常时，会话报告错误并保留已提交结果。

对快照、事件和命令结果按不可变数据读取。将非空快照用 `JSON.stringify` 保存即可在应用中重新载入。宿主自行保存 JSON 时，编辑器内置的文件保存基线由自身的下载或原生保存流程管理。未应用的界面表单草稿留在工作区，先应用再读取快照。`.lxm` 是 UTF-8 JSON，内置 `.lxm` 导入可迁移 Schema 4–7。程序载入旧谱时，先解析 JSON，再调用 `upgradeDocumentToCurrent(value)`，检查 `ok` 后把迁移结果的 `document` 交给会话。

每个同时挂载的工作区使用独立会话。组件卸载会清理该界面的草稿、计时器和播放任务，宿主保留的句柄可继续读取文档与历史。宿主订阅应在卸载时取消。页面重新加载后的状态取决于宿主如何持久化文档。

## 工具栏

`LxmEditorToolbar = (state: LxmEditorToolbarState) => ReactNode`。传入 `toolbar` 后，谱面右键面板、历史、属性侧栏、试听和节拍器仍可使用。空工作区和试听模式使用各自的内置界面。

- `document: ILXMDocument | null`、`selection: ILXMTabCellSelection | null`、`rhythm: ILXMRhythm | null` 提供文档、TAB 选区和当前时值。
- `readOnly`、`blocked`、`canUndo`、`canRedo` 和 `sidebarCollapsed` 为只读布尔状态。可据此禁用按钮。`readOnly` 描述编辑器当前的试听只读状态。
- `execute(command: ILXMScoreCommand): Promise<boolean>` 检查草稿、弹层和结构影响确认。已应用或成功但内容无需修改时返回 `true`，受阻、取消或失败时返回 `false`。
- `undo(): boolean`、`redo(): boolean` 尝试按工作区规则执行历史操作。`toggleSidebar(): void` 切换属性侧栏。

例如在自定义按钮中读取 `document?.score.tracks[0]`，取最后一小节的 ID，在按钮点击时调用 `execute({ type: LXMScoreCommandEnum.InsertMeasure, trackId: track.id, afterMeasureId: lastMeasure.id })`。按 `readOnly`、`blocked` 和目标是否存在设置按钮禁用状态。

## 导航与资源

### `LxmEditorNavigation`

| 可选属性 | 行为 |
| --- | --- |
| `homeHref?: string` | 启用品牌首页链接和文件菜单的返回首页入口。 |
| `learningHref?: string` | 启用帮助菜单的吉他进阶链接。 |
| `renderLink?: (props: LxmEditorNavigationLinkProps) => ReactNode` | 替换默认锚点。收到 `href`、`children`、`onNavigate(event: { preventDefault(): void }): void`，以及可选 `className`、`aria-label`、`tabIndex` 和 `ref: Ref<HTMLAnchorElement>`。转发 `ref` 和链接属性，只在当前页面跳转时调用传入的 `onNavigate` 并遵循其取消结果。Next.js 可用 `renderLink: (props) => <Link {...props} />`。 |
| `onNavigate?: (href: string) => void` | 处理程序发起的跳转，包括菜单操作和确认离开后的继续跳转。可接入 `router.push`。无此回调时，程序跳转使用 `window.location.assign`。 |
| `onDiscard?: () => void` | 用户在编辑器离开确认中选择放弃时调用。宿主可在这里重置应用状态。 |

### `LxmEditorResources`

默认品牌图、工具 SVG、和弦库及木吉他试听采样随 npm 包和应用打包产物交付。和弦库和采样按需加载。使用内置资源时可省略整个 `resources`。

| 可选字符串属性 | 行为 |
| --- | --- |
| `basePath` | 为宿主托管的资源指定共同前缀。分别读取 `<basePath>/assets/chords/` 和 `<basePath>/assets/audio/meta-steel-guitar-v1/`。空字符串表示站点根目录。 |
| `chordCatalogDirectory` | 覆盖和弦库目录。提供 `manifest.json` 和清单引用的版本 JSON。可部署 npm 包内的 `dist/assets/chords/` 数据。 |
| `audioDirectory` | 覆盖采样目录。提供 `manifest.json` 和 `ogg/`，可提供 `m4a/` 以启用 AAC 回退。两种编码均无法加载或解码时，可在试听栏重试。 |
| `musicIconBaseUrl` | 自定义工具 SVG 目录，例如提供 `note-quarter.svg`、`note-dot.svg`、`triplet.svg`。默认从组件样式取得内联图标。 |
| `brandIconUrl` | 覆盖顶栏品牌图。 |

目录以渲染页面为参照，部署时应可由渲染页面同源请求。Electron 离线应用可使用支持 Fetch 的应用协议。

## Electron 宿主

渲染进程继续使用相同的会话、组件和 CSS。通过 preload 暴露实现 `EditorHost` 的桥接，传给 `<LxmEditor session={session} host={editorHost} />`。将系统对话框、路径、文件读写、打印和窗口关闭交给主进程处理。用窗口范围内的不透明 ID 做文件授权，保持 `host` 引用稳定。

```ts
import type { EditorHost } from "@liuxianmao/lxm-editor-react";

declare global {
  interface Window {
    editorHost: EditorHost;
  }
}
```

`EditorHostFile` 为 `{ id: string; name: string }`。`EditorHostResult<T = void>` 为 `{ status: "ok"; value: T }`、`{ status: "cancelled" }` 或 `{ status: "error"; message: string }`。`void` 成功结果传 `value: undefined`。

| `EditorHost` 方法 | 参数、返回与行为 |
| --- | --- |
| `openScore()` | `Promise<EditorHostResult<EditorHostFile & { bytes: ArrayBuffer }>>`。选择 `.lxm`，返回原始字节、显示名和文件 ID。工作区进行预览、校验和所需的旧版迁移。 |
| `saveScore(request)` | 请求为 `{ fileId?: string; suggestedName: string; text: string; confirmUpgrade?: boolean }`，返回 `Promise<EditorHostResult<EditorHostFile>>`。无 ID 时选择保存位置，有 ID 时写入对应文件。`confirmUpgrade: true` 表示覆盖已打开的旧版文件前需确认升级。成功返回实际写入的文件标识，编辑器据实际写入快照更新保存基线。 |
| `writeOutput(request)` | 请求为 `{ suggestedName: string; bytes: ArrayBuffer }`，返回 `Promise<EditorHostResult>`。保存编辑器生成的 PNG 或多页 ZIP。 |
| `print()` | `Promise<EditorHostResult>`。在工作区打印预览就绪且用户提交后，触发当前渲染窗口的原生打印。 |
| `onAction(listener)` | `listener: (action: EditorHostAction) => void`，返回 `() => void` 以移除宿主菜单或窗口事件订阅。`EditorHostAction` 为 `"open" \| "save" \| "saveAs" \| "print" \| "close"`。组件在卸载或重订阅时调用清理函数。 |
| `resolveClose(allow: boolean)` | `void`。主进程发出 `"close"` 后等待该响应，再决定是否关闭。工作区检查未应用草稿和保存状态，可能让用户先处理或确认。 |

原生打开、另存、打印和导出中的用户取消应返回 `status: "cancelled"`。关闭请求应针对当前编辑器窗口发出，由该窗口的工作区响应。直接调用 `session.replaceDocument` 可切换宿主管理的快照，原生文件绑定通过工作区的打开和保存流程建立。
