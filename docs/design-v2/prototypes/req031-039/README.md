# REQ-031 / 033 / 038 / 039 · 设计稿 v1

**状态：设计稿保留回溯，四项已接入正式产品并完成本地验证，待用户验收。** 上一轮 v4 已实现；本目录是根据最新未划线反馈制作的新稿。实际效果和交付见[产品实现与验证](../../records/REQ-031-039产品实现与验证.md)。

当前预览：<http://127.0.0.1:4187/docs/design-v2/prototypes/req031-039/>。

- [031 / 038 · 和弦库](http://127.0.0.1:4187/docs/design-v2/prototypes/req031-039/?scene=library)：悬停“我的指法”，检查 AntD 默认效果；切换主音与大小调、搜索或筛选，查看完整分组及详情属性。
- [033 · 弹窗覆盖](http://127.0.0.1:4187/docs/design-v2/prototypes/req031-039/?scene=custom)：改名、编辑按点或输入未完成的起始品位，点击“查看我的指法 >”；Esc／返回关闭上层，保留下层。选择收藏仅预览，选用先确认替换，替换可以撤销。
- [039 · 空拍侧栏](http://127.0.0.1:4187/docs/design-v2/prototypes/req031-039/?scene=empty)：顶部背景框显示“尚未配置和弦”；选择常用和弦先回填，点击应用后再更新谱面。

本稿直接打包本工作区 React 19.2.7、AntD 6.4.4 与系统和弦目录。Segmented 没有 hover、选中颜色或边框样式覆盖；输入框使用 AntD 默认结构。界面采用既有编辑器配色和紧凑布局，使用 frontend-design、ui-ux-pro-max 技能。原型不连接正式编辑器，所有编辑和收藏仅在本页内存中演示。

REQ038 的拟议信息结构见[规格](../../specs/REQ-031-039交互设计待确认.md)：按当前调性的 12 个相对根音位置分组，每组 16 种类型，完整覆盖 192 项；根音级数与调式归属分开表达。C7 在 C 大调 C 根音组，详情标“含调外音”；G#dim7 在 A 小调升 VII 根音组，标“和声小调内”。本稿不推断副属、借用等需要音乐上下文的功能。

## 生成与预览

仓库根目录执行：

```sh
node docs/design-v2/prototypes/req031-039/build.cjs
python3 -m http.server 4187 --bind 127.0.0.1
```

构建使用工作区已安装的 esbuild，不修改依赖或 lockfile。`preview.jsx` 是设计源文件，`preview.js` 是离线可运行的本地 bundle。当前预览使用新端口 4187；此前停止的 4186 原型和 3001 产品服务没有恢复。

## 浏览器核对

执行 `node docs/design-v2/prototypes/req031-039/review.mjs`。脚本使用本机 Chrome 与现有 Playwright 安装，地址和导入路径为当前环境配置。

已核对完整 192 项／12 组、五列布局、hover 无位移、搜索保持分类、大小调及和声小调属性、固定详情、覆盖时保留下层 DOM 节点、无效输入往返、选择后确认替换、Esc 按层关闭、替换可撤销、空状态背景、先草稿后应用、1400×720 底部操作可见，以及 390px 侧栏无横向越界。没有页面脚本错误或 deprecated 警告。详情见 [review-result.json](screenshots/review-result.json)。

截图：[默认 hover](screenshots/01-library-default-hover.png)、[小调分类](screenshots/02-minor-classification.png)、[编辑缓冲](screenshots/03-custom-before-overlay.png)、[库覆盖自定义](screenshots/04-library-over-custom.png)、[替换确认](screenshots/05-replace-confirmation.png)、[空拍侧栏](screenshots/06-empty-beat-sidebar.png)、[1400×720 和弦库](screenshots/07-library-1400x720.png)、[小窗侧栏](screenshots/08-sidebar-small.png)。

原型只完整演示本轮四项行为：指板提供按弦／擦除演示，没有重建上一轮所有横按、快捷键、打印与导出能力。预览验证不能代替正式产品集成回归；生产层的弹层宿主、守卫、调性查询与分类能力须在确认后实现。
