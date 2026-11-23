# Ant Design 设计回归与组件映射

文档分类：02_规范与复审 · [返回 UI 设计与重构总纲](../README.md)

日期：2026-10-13。用户已确定通用 UI 使用 Ant Design。已更新 58 张 PNG、分类总览、视觉规范，并新增组件/图标映射 PNG。本轮不修改产品 React 代码或依赖清单。

2026-10-15 复审：本机仍为 antd 6.4.4；当前总清单为 61 张界面/状态、71 张 PNG。独立简谱已实现，迁移时同时遵守[最新代码落地复审](20261015_最新代码与设计稿落地复审.md)。当前 EditorShell 尚未按 AntD 设计迁移，不能因 package.json 已列出依赖就视为完成。

## 1. 基准与交付边界

- 项目实际安装 `antd 6.4.4`，依赖声明 `^6.4.4`；通用图标读取其间接依赖 `@ant-design/icons 6.2.5` / `@ant-design/icons-svg 4.4.2`。
- 实施时应将 `@ant-design/icons` 加为 website 的直接依赖，不能依赖 pnpm 的间接包恰好可访问。本轮未新增或升级应用依赖。
- 已调用 antd CLI 核对 22 个组件 API；关键变化再对照当前安装包 `.d.ts`。官网可能显示更高版本，不能直接照搬新版本 API。
- 当前 PNG 是按 Ant Design 规范和品牌主题绘制的静态设计表达，不是浏览器中真实 React 控件截图；正式 implementation 还须核对实际组件布局、焦点和行为。
- 通用图标直接来自官方 SVG path，仅按状态缩放/着色，保留来源信息；音乐符号仍由项目资产和谱面引擎提供。

## 2. 全局视觉约定

使用 `ConfigProvider` 统一主题和中文 locale；`App` 提供上下文内的反馈入口。保留浅色、蓝色品牌方向，不改为另一套产品视觉。

| 配置 | 值/规则 | 用途 |
| --- | --- | --- |
| colorPrimary | `#285BE0` | 品牌主操作，取代默认蓝色 |
| colorText / colorTextSecondary | `#202838` / `#626E82` | 明确的正文和辅助说明，不使用过浅灰色描述重要条件 |
| colorSuccess / colorWarning / colorError | `#19734F` / `#92600C` / `#BC3547` | 继续沿用复审后的语义颜色 |
| colorBgLayout / colorBgContainer | `#F4F6FA` / 白色 | 工作区与控件/面板背景 |
| colorBorder / colorBorderSecondary | `#D9D9D9` / `#F0F0F0` | 输入边框与分隔，取自实际 antd token |
| borderRadius | 6 | 通用控件；面板/卡片/Modal 使用较大半径 8 |
| fontSize | 14 | 通用控件；辅助说明 12，主要模块标题 16–20 |
| controlHeightSM / controlHeight / controlHeightLG | 24 / 32 / 40 | 紧凑、标准、主要入口；使用 small / medium / large |
| locale | `antd/locale/zh_CN` | Select/Empty/Modal 等中文默认文案 |

hover/active/background 色通过 Ant Design 的主题算法派生，不复制截图里所有色值成为互不关联 CSS。确有不同的音乐选区颜色和灰色纸张背景时作为业务 token 保留。

证据文件：`制作源文件/antd-design-tokens.json` 来自本机 `theme.getDesignToken()`；`antd-6.4.4-api.json` 是 CLI 查询快照。

## 3. 页面到组件的映射

| 界面角色 | 优先使用的 Ant Design 组件 | 约束 |
| --- | --- | --- |
| 全局主题/反馈上下文 | ConfigProvider、App | 主题与 locale 统一；通过上下文反馈实例展示消息 |
| 主操作/普通/危险按钮 | Button | primary/default/text 与 danger；加载用 loading；避免把内部“ghost”样式名直接当 `ghost` prop |
| 图标操作按钮 | Button + Tooltip + Icons | 无文字时提供 aria-label；禁用原因放在可触达容器说明 |
| 歌名、作者、段落字段 | Form.Item + Input | required、help、validateStatus；Unicode 长度使用自定义校验，不按 JS code unit 误判 |
| Capo、小节数量、起始/辅助品位 | Form.Item + InputNumber | precision=0、范围约束；空值 null 必须处理，不能自动写成 0 |
| 调性、拍号、分类、段号、预设 | Form.Item + Select | options 的 value 与模型类型一致；不开放任意拍号输入 |
| 歌词/简谱连续文本 | Input.TextArea | 输入草稿保留空格/ASCII 符号；先解析与预览，再提交领域批次 |
| 品位临时输入 | Input 或谱面键盘草稿 | 支持 x 和两位输入的时序；不强行改为普通 InputNumber 并丢失原交互 |
| 允许覆盖 | Checkbox | Form.Item 用 valuePropName="checked"；歌词/简谱默认差异继续保留 |
| 和弦图显示 | Switch | 全局视图偏好，不进音乐历史；不删除 diagram |
| 属性四栏目 | Tabs | 选区/段落/和弦/歌曲；保持稳定实例和草稿，使用 items API |
| 歌词/简谱、单拍/连续、卡片/列表 | Segmented | 有限模式切换；在切换提交前运行草稿保护 |
| 技巧幅度/方向选项 | Radio.Group 或 Select | 半音/全音和方向类型由模型决定，不从图标方向猜测 |
| 小节/拍点/技巧目录 | Dropdown + Menu | menu.items；按选区设置 disabled/danger；不使 popup 改变谱面目标 |
| 曲谱分类与最近/收藏 | Menu | 分类为固定枚举；Menu 选择与列表 query 同源 |
| 卡片曲谱列表 | Card + responsive Grid | 音乐缩略图为自定义内容；星标/更多与卡片打开隔离冒泡 |
| 表格列表/连续对应预览 | Table | rowKey 业务 ID；scroll 保留表头/底部动作；统计依赖 planner |
| 横按列表 | Form.List / Collapse | 最大 4 组由核心校验；增删是指法草稿，不提前写文档 |
| 指法图/音乐图元 | 自定义 SVG + AntD 表单 | 保留官方布局引擎及命中规则；不使用图表组件或通用图标代替 |
| 新建、首次保存、三选项保护 | Modal + Form/Button footer | 自定义 footer 完整呈现三个动作；忙状态不能被遮罩或 Esc 绕过 |
| 删除确认 | Modal（可用上下文 modal.confirm） | 简单两选项；异步失败不关闭、不移除列表项 |
| 轻量成功/复制消息 | App 的 message | 短结果可消失；不能替代持久的保存状态和错误说明 |
| 字段/范围错误、重要影响 | Form.Item help / Alert / Collapse | 字段错误就近；可展开结构影响；错误不能仅在短暂 toast 中 |
| 空曲谱库/无结果/加载失败 | Empty / Result / Alert | 三类原因区分，提供对应操作 |
| 导出进度 | Progress + Button.loading | 取消请求须真正终止输出；不把进度完成直接当已下载 |
| 页列表与页缩略图 | Card / List 布局 + 自定义 SVG | 原文件多页 PNG/ZIP 路线不变 |
| 所有状态标签 | Tag | 当前目标、数量和结果保持文字说明；较长内容不藏进小标签 |

`Segmented` 没有音乐多拍范围的自动禁用逻辑，`Form.disabled` 也不能覆盖自定义谱面、菜单快捷键与所有业务动作；需显式控制各个入口。

## 4. 图标映射与例外

| 操作 | 官方图标 |
| --- | --- |
| 新建 / 保存 | PlusOutlined / SaveOutlined |
| 搜索 / 筛选下拉 | SearchOutlined / DownOutlined |
| 撤销 / 重做 | UndoOutlined / RedoOutlined |
| 卡片 / 列表 | AppstoreOutlined / BarsOutlined |
| 重命名 / 复制 / 删除 | EditOutlined / CopyOutlined / DeleteOutlined |
| 收藏 / 已收藏 / 更多 | StarOutlined / StarFilled / MoreOutlined |
| 设置 / 段落 / 和弦表单 / 曲谱库 | SettingOutlined / FileTextOutlined / FormOutlined / FolderOutlined |
| 返回 / 关闭 | LeftOutlined / CloseOutlined |
| 视图 / 图片输出 / 下载 | EyeOutlined / PictureOutlined / DownloadOutlined |
| 提示 / 成功 / 警告 / 错误 | InfoCircleFilled / CheckCircleFilled / ExclamationCircleFilled / CloseCircleFilled |
| 加载 | LoadingOutlined 或组件内置 loading |

图标通常 14/16px，提示图标 16px；由控件文字颜色继承。图标只能补充文字，不能把“删除音符/删除拍点/删除小节/删除曲谱”统一成缺少目标说明的垃圾桶。

例外：音符、休止、附点、连音、TAB、技巧线、指法网格、禁奏记号继续复用 `MusicAssetIcon` 和正式谱面 scene；可放入 AntD Button 的 icon 区域，但不重画为 Ant Design Icons。Logo 保留六线猫品牌元素。

## 5. 表单、草稿与弹层的落地细节

- Form 负责草稿字段和交互校验，Zustand/领域文档负责已应用内容，Repository 负责已保存快照；三个状态不能合并为“Form 改了就保存”。
- 新建、歌曲信息、和弦、歌词/简谱与首次保存分别建立明确 Form 边界。onValuesChange 更新草稿；onFinish 调用合法性规划与命令。高频时值/休止工具保持已有即时命令语义。
- React 输入法 composition 期间不自动提交、不切模式；文字 normalize 不在 onChange 中破坏光标/空格。提交时核心解析器是最终事实来源。
- 文档或目标发生变化时，先运行已有草稿保护再 `setFieldsValue`；`initialValues` 不负责持续同步已挂载表单。不得重挂载表单来“顺便清草稿”。
- Switch/Checkbox 绑定 checked；InputNumber 处理 number/null；Select 把数字段号与字符串模型值正确转换。对领域限制使用自定义 validator，不能只依赖 required/min/max。
- Tabs 首版不销毁未激活内容，且草稿状态保存在稳定上层；需要初始挂载的面板使用相应 forceRender。Modal 的 Form 生命周期与业务草稿丢弃分别控制。
- Tabs/Segmented 的受控值只有在草稿请求被接受后改变；简谱目标切换遵循暂存/恢复，不统一弹确认。Form preserve 不能代替按事件/item/时间窗保存模板、范围、终点和草稿。切响应式分区不能卸载草稿 owner。
- 多处暂存草稿需要统一查询与定位界面；现有 `MusicTextController.isOutputBlocked()` 只读闸门不足以完成保存/离开。该接口扩展先入正式方案，不把“应用全部”画成可直接循环调用现有 apply。
- 简谱字段将音组内容、当前音符时值、单 item 音高分别映射到既有命令。Modal 的影响确认必须携带文档版本与记号影响 ID；背景工具/快捷键锁定，过期确认重新预览。
- 6.4.4 新代码使用 size="medium"，不用已 deprecated 的 middle；使用 destroyOnHidden 而非 destroyOnClose/destroyInactiveTabPane；Modal 遮罩关闭使用 `mask.closable`。
- 三选项保护 Modal 使用受控 open 与自定义 footer；应用/保存失败保持打开。保存中关闭/遮罩/Esc 和背景快捷键必须统一阻止；普通取消返回原目标焦点。
- Select/Dropdown 的 popup 容器需按窗口/滚动区域选择；不要全局无条件返回 trigger.parentElement（部分调用没有 trigger，也可能被 overflow 裁剪）。模态内弹出层层级必须实测。
- App Router 的样式 SSR/主题 provider 应在正式实现方案里配置，不把字体和未注入 CSS 的首屏闪动当作设计差异忽略。
- 普通禁用按钮不能独自承载 hover 提示，使用 Tooltip 的可触达容器与旁边文案。桌面字段/按钮仍须进行键盘、IME、200% 缩放和长列表验证。

## 6. 本轮已更新的内容

58 张稿保留原业务状态，统一采用 Ant Design 的通用视觉：官方图标、标准控件高 24/32/40、输入边框、Form label/required/error、InputNumber 步进、Tabs 下划线、Segmented 模式切换、Alert 提示图标、Modal 关闭与圆角。主色和正文对比度沿用上一轮复审要求。

新增 [组件与图标映射 PNG](../01_设计稿/20261013_UI交互设计稿/00_AntDesign组件与图标映射.png)；分类与全套总览同步重生成。图标、token 和 API 证据保存在制作源文件中。

这轮视觉回归不改变 Repository/保存状态机、整批预览保护、曲谱 schema 或谱面绘制边界；继续遵循 [设计复审与落地契约](20261013_设计复审与落地契约.md)。

## 7. 参考与验证

- 主要 API 依据本机安装 antd 6.4.4 源码与 CLI 查询；官网仅补充概念说明：[Form](https://ant.design/components/form/)、[Icons](https://ant.design/components/icon/)、[主题定制](https://ant.design/docs/react/customize-theme)。
- PNG 核对：文件编码/尺寸/清单、关键表单/默认工作台/窄窗口视觉、9 组正文 token 对比度、官方图标资源完整性。
- 未修改实际 AntD React 源码，因此没有运行 antd lint 或产品构建；真实控件精确渲染、SSR、焦点/滚动和所有交互状态需要正式实现时验证。
