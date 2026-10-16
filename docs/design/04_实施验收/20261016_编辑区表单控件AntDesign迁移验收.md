# 编辑区表单控件 Ant Design 迁移验收

日期：2026-10-16。分支：`codex/ui`。基线：`27c42a0` 加本地已有工作；本批尚未提交。对应[迁移方案](../03_技术方案/20261016_编辑区现有表单控件AntDesign迁移方案.md)。

## 交付范围

- 歌词：模式/段号 Select、单行 Input、连续 TextArea、覆盖 Checkbox、取消/应用/下一拍/删除 Button。
- 和弦：名称 Input、预设及六弦品位/手指 Select、起始品位/横按 InputNumber、所有动作 Button。沿用真实指法 SVG；预览位于六弦表上方，名称/预设保持两列。
- 独立简谱：全部模式/模板/时值/附点/时间窗/事件与技巧目标 Select、音高 Input、连续 TextArea、覆盖 Checkbox、原有内容/时值/单 item 音高/技巧/复制粘贴 Button。
- 段落子栏目采用 Segmented，切换仍经过原 request 和草稿保护。
- 小节、拍点、技巧和连音工具浮层的现有选择器、数值框、确认框和按钮；文件导入与图片预览按钮、图片下载链接按钮同步统一组件外观。
- `Form.Item` 只负责标签和布局，已有 draft owner 和提交入口保持。控件使用 htmlFor/id；全局 Form token 管理间距和标签色。
- 保留唯一必要的原生隐藏 file input。检索 EditorShell 源码未发现其他原生 input/select/textarea/button 标签。

## 样式清理

删除原生按钮/输入框/select/textarea/checkbox 皮肤、`toolbarButton` / `toolbarSelect` / `toolbarNumberInput`、`primaryButton` / `chordPrimaryButton` / `dangerButton` / `linkButton` / `iconButton`，以及未再使用的旧 `trackSettings` 样式。导入和图片预览取消对按钮的后代样式覆盖；下载链接改由 Button 提供外观。段落按钮皮肤删除，保留 Segmented 外部布局间距。

侧栏布局、提示、表格、滚动、响应式和谱面样式继续保留。本批 `index.module.scss` 相对 HEAD 删除 216 行、增加 17 行；另外删除导入/导出浮层的重复按钮皮肤。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| 全量 `pnpm exec vitest run` | 73 个文件、664 项通过 |
| `pnpm --dir apps/website type-check` | 通过，生产构建后再次确认 |
| `pnpm --dir apps/website lint` | 通过 |
| `pnpm --dir apps/website build` | 通过，三条页面路由生成成功 |
| `antd lint apps/website/components/EditorShell --format json` | 0 issues，无跳过文件 |
| `git diff --check` | 通过 |

简谱 SSR 草稿测试原先检查原生 `<option selected>`，本批改为检查可见模板“前八后十六”、字段标签与 combobox 语义；草稿正文断言保留。全量测试也包含曲谱往返、命令、历史、图片输出与布局回归，但这些不等于浏览器逐个操作所有按钮的完整验收。

CLI 文档查询按安装的 Ant Design 6.4.4 执行；CLI 自身提示升级，尝试升级因 `/usr/local/bin/antd` 权限失败，继续使用现有查询工具与安装类型定义，项目组件版本未升级。

## 浏览器实际操作结果

在重新构建并重启的 `http://127.0.0.1:3100/` 生产预览验证：

| 项目 | 观察结果 |
| --- | --- |
| 1440/1280 桌面侧栏 | 实测宽度 440px；1280 下 clientWidth/scrollWidth 均 439，无表单横向溢出 |
| 和弦主按钮 | 计算样式背景 `rgb(40,91,224)`，文字 `rgb(255,255,255)` |
| 预设 Select Esc | 关闭候选后名称字段继续可见，未退出和弦编辑 |
| 起始品位清空 | 输入保持为空，原校验报错，应用禁用；重新填 1 后恢复 |
| 和弦脏草稿换页 | 显示应用并切换/放弃并切换/继续编辑；继续编辑恢复输入 |
| 横按新增 | 四个 InputNumber 与原错误校验保留；不合法横按阻止应用 |
| 歌词模式 Select | ArrowUp + Enter 可从连续切至单拍 |
| 歌词快捷键 | Shift+Enter 应用后仍在第1拍；Enter 应用并切至第2拍 |
| 段落 Segmented | 点击标签可切换；Home 可返回歌词且聚焦相应控件 |
| 简谱 A→B→A | 第2拍输入 `2 3 5`，切至其他事件再返回，原草稿恢复，暂存提示存在 |
| 小节边界 Select | 从单小节线切为双小节线后显示更新；Esc 收起候选，字段继续可见 |
| 1024×768 | 侧栏转下方，实测宽 992px，无表单横向溢出 |
| 768×650 | 侧栏转下方，实测宽 736px，无表单横向溢出；正文在侧栏内部滚动，底部动作可见 |
| 跨断点草稿 | 名称输入 `C窗口草稿` 后缩至768宽，文本保持 |
| 页面日志 | 本批操作未捕获 warn/error |

浏览器测试产生的示例编辑仅在临时页面内，结束已刷新为原始示例。3100 本地预览保持后台运行。

## 验收截图

截图位于 `验收截图/20261016_AntDesign表单/`，由本次生产预览直接截取：

- [和弦 1440](验收截图/20261016_AntDesign表单/和弦_1440.jpg)
- [和弦 1280](验收截图/20261016_AntDesign表单/和弦_1280.jpg)
- [和弦 1024](验收截图/20261016_AntDesign表单/和弦_1024.jpg)
- [和弦 768×650](验收截图/20261016_AntDesign表单/和弦_768x650.jpg)
- [连续歌词 1440](验收截图/20261016_AntDesign表单/连续歌词_1440.jpg)
- [单拍歌词 1440](验收截图/20261016_AntDesign表单/单拍歌词_1440.jpg)
- [独立简谱 1440](验收截图/20261016_AntDesign表单/独立简谱_1440.jpg)
- [横按校验 1440](验收截图/20261016_AntDesign表单/横按校验_1440.jpg)

## 设计偏差与验收边界

- **UI-D04 延续**：简谱保留独立内容、事件时值、单音符音高等应用动作，以及复制/粘贴、自定义时值和技巧字段。完整控件量超过 PNG 的简化画面，沿用可滚动属性区，未删除功能。
- **UI-D09**：单拍歌词继续使用单行 Input，未复刻 PNG 的高文本框；确保单行校验、Enter 和 Shift+Enter 约定不变。
- **440px**：用户新要求覆盖旧稿侧栏宽度。
- **真实中文 IME 待人工复核**：保留 composition 处理，程序填字不能证明系统输入法候选窗行为通过。
- 本批覆盖的是现有控件迁移、皮肤清理与上述实际操作；没有宣称阶段2完整更多菜单、所有图片异常、全部40张状态稿的逐一视觉验收完成。
