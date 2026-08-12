# MVP v4 详细实施计划

## 1. 实施约束

- v3 全量自动化检查和浏览器验收通过后再开始 v4 生产代码。
- 实现顺序固定为“矩形选择语义 → 导航 → 批量 Note 命令 → 历史 → 页面集成”。
- 页面不得循环调用单点 `note.set` / `note.remove` 模拟批量编辑。
- selection 和 history 不写入 `ILXMDocument` schema。
- TAB 单元格选区不承担 Beat 剪贴板、批量 rhythm/rest 或多小节结构编辑。
- 每个步骤先运行聚焦测试，再进入下一步。

## 2. Step 0：建立 v4 夹具与 no-op 契约

### 修改

- 新增 `packages/lxm-editor/example/example-mvp4.json.ts`：
  - 基于 v3 合法文档，至少 8 小节、2 条 system；
  - 包含 notes、rest、多弦和可跨小节选择的连续 Beat；
  - 覆盖空单元格、已有同弦 Note 和高品位；
  - 所有 ID 唯一且稳定。
- 扩展命令成功结果，增加 `changed`。
- 修正 `note.set`、`note.remove`、`beat.setRhythm`、`beat.setKind` 的 no-op：返回原 document、不增加 revision。

### 验收

- fixture 可经 loader 加载并通过 semantic validation；
- no-op 与失败均不产生新 document 引用；
- v2/v3 命令行为保持兼容。

## 3. Step 1：实现 TAB 单元格范围解析

### 修改

- 新增 `src/editing/tab-cell-selection.ts`；
- 定义 `ILXMTabCellReference`、`ILXMTabCellSelection` 和 `ILXMResolvedTabCellRange`；
- 实现 Beat 文档顺序索引和 `resolveTabCellSelection`；
- 规范化正向、反向和对角 anchor/focus；
- 限制单次最多 512 个单元格；
- 错误优先级固定为“端点/轨道/弦合法性 → 单元格数量”，只有两个合法端点实际形成超大矩形时才返回 `TAB_CELL_RANGE_TOO_LARGE`；
- 从包入口导出所需 interface 和纯函数。

### 测试

- 单格、同弦横向、同 Beat 纵向、二维对角矩形；
- 正向与反向得到相同规范范围；
- 跨小节与跨 system 对应的文档顺序；
- 端点失效、跨轨道、非法弦、空轨道和超限范围；
- 不修改输入 document 或 selection。

## 4. Step 2：实现键盘导航纯函数

### 修改

- 新增 `src/editing/navigation.ts`；
- 实现普通四方向移动、范围折叠和 Shift 四方向扩展；
- 左右使用 Beat 文档顺序，上下使用 `1–6` 弦号；
- 无相邻目标时返回 `changed: false`；
- 导航函数不读取 layout 或执行滚动。

### 测试

- `1–6` 弦上下边界；
- Beat 左右边界及跨首/尾小节；
- Shift 扩展保持 anchor；
- 左右范围分别折叠到起始/结束 Beat；
- 上下范围折叠到 focus 后移动弦；
- 自动换行变化不影响导航结果。

## 5. Step 3：实现矩形选区 layout

### 修改

- 新增 `src/layout/selection-layout.ts`；
- 将规范单元格范围映射为按 measure/system 拆分的矩形；
- X 使用最终 beat slot，Y 使用最终 string layout；
- focus 单元格生成独立 caret 几何；
- 页面新增范围高亮层和打印隐藏样式。

### 测试

- 单格、同 measure 横向/纵向/二维范围；
- 跨 measure 和跨 system 拆分；
- compact、comfortable 与稀疏末行；
- layout 重建后同一业务选区使用新坐标；
- 选区几何不改变 layout 总尺寸。

## 6. Step 4：实现原子批量 Note 命令

### 修改

- 扩展 `ILXMScoreCommand`：`note.setRect`、`note.removeRect`；
- 命令复用 Step 1 的范围解析 Module，不接收页面展开后的单元格数组；
- `note.setRect` 覆盖已有 Note、为空格生成 Note ID，并自动将目标 rest 转为 notes；
- `note.removeRect` 只删除目标弦 Note，空 Beat 继续保持 notes；
- 两个命令只构造一个候选 document、增加一次 revision、调用一次 finalize；
- 增加 `INVALID_TAB_CELL_RANGE` 与 `TAB_CELL_RANGE_TOO_LARGE` 错误码；
- 所有目标无变化时返回 `changed: false`。

### 测试

- 单格行为与既有 `note.set/remove` 等价；
- 横向、纵向、二维和跨小节批量设置；
- 同弦覆盖、空格新增、多弦并存和 rest 自动转 notes；
- 批量删除只影响选中弦，其他弦保持；
- 删除到空 notes 不自动转 rest；
- 非法 fret、失效端点、跨轨道和超限范围原子失败；
- 成功只复制受影响 track/measure 分支；
- revision、ID 唯一性、语义校验和 no-op。

## 7. Step 5：建立 editor store 与历史

### 修改

- 新增 `apps/website/stores/editor-store.ts`；
- 将 document、selection、error 和统一 `execute` 迁入 store；
- 接入 zundo 或等价受限历史，partialize 仅保存 document；
- 历史上限使用 `HISTORY_LIMIT`；
- 将 Zustand/zundo 依赖放到 website，核心包不再声明未使用的 UI 状态依赖；
- 实现 undo、redo、canUndo、canRedo 和 selection 恢复。

### 测试

- 成功、失败和 no-op 的历史数量；
- 两位品位、矩形设置、矩形删除和小节复制各一条历史；
- undo/redo、分支编辑和 100 条上限；
- selection/error 变化不进历史；
- undo/redo 后 document 通过 validation 和 layout；
- 端点仍存在时保留 selection，失效时回退到首个合法单元格。

## 8. Step 6：接入指针选择和键盘编辑

### 修改

- `EditorShell` 从 store 读取状态，不再拥有独立 document useState；
- 普通点击、Shift+点击和 pointer drag 使用统一 selection action；
- 支持水平、纵向和对角矩形；
- 接入四方向、Shift+四方向、Escape、Delete/Backspace；
- 数字草稿最终只发送一次 `note.setRect`；
- selection 改变后把 focus caret 滚入可见区域；
- pointerup/cancel 清理 drag 状态。

### 验收

- 单格和跨两条 system 的二维选区稳定；
- 重新排版后选区仍指向相同 Beat/string；
- 输入品位一次更新所有目标；
- 删除不影响范围外 Note；
- 页面不使用数组下标、固定弦距或循环单点命令推导业务结果。

## 9. Step 7：接入工具状态与历史控件

### 修改

- 选区只有一个 Beat 时启用 rhythm、附点和 rest；跨多个 Beat 时禁用；
- 选区只在一个 measure 时启用新增、复制、删除小节；跨 measure 时禁用；
- 新增 undo/redo 按钮、aria-label 和 disabled 状态；
- 接入 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z 和 Ctrl+Y；
- 更新输入提示、范围计数和错误文案；
- 不接入 Cmd/Ctrl+A/C/X/V。

### 验收

- Toolbar 状态与选区 Beat/measure 范围一致；
- 范围状态下不会静默只修改 focus Beat；
- 整小节复制继续生成新 ID 并自动断行；
- undo/redo 按钮与快捷键状态一致；
- input、textarea、select、contenteditable 不被编辑器快捷键劫持。

## 10. Step 8：全量回归与版本验收

### 必跑命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

### 浏览器验收清单

- 在固定 A4 桌面页面完成点击、Shift+点击、水平/纵向/对角拖动；
- 完成跨弦、Beat、小节和 system 的矩形选择；
- 完成一位/两位品位批量设置与范围删除；
- 验证 rest 自动转 notes、其他弦保持和空 notes 不转 rest；
- 验证单 Beat rhythm/rest、单 measure 复制及跨范围 disabled 状态；
- 连续 undo 到初始状态，再 redo 到最终状态；
- 验证 selection 不进入打印结果，页面和控制台无异常；
- 记录浏览器版本、视口、已知限制和用户确认结果。

## 11. 实施记录

| 日期       | 状态     | 说明                                                                                                                                                   |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-31 | 初版完成 | 完成文档审查与 V4 初版；补充范围错误优先级，明确规范范围与 focus caret 的独立布局入口，并完成核心、store、页面、自动化测试和固定桌面浏览器验收。       |
| 2026-08-12 | 边界修复 | 收敛品位草稿取消时序，扩大历史快捷键的编辑器焦点范围，并补齐 A4 空白与工作区点击清除选区；删除指针选择调试输出，增加交互纯函数测试和关键位置中文注释。 |

### 2026-07-31 验收结果

- 自动化：核心包 108 项测试、website store 6 项测试全部通过；`pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过。
- 浏览器：Codex In-app Browser（Chromium，运行时未暴露具体版本），1280 × 720 视口。
- 已验证：单格选择、Shift+方向键扩展、两位品位批量提交、跨两条 system 的 126 格二维拖动、跨范围 toolbar disabled、批量删除和撤销/重做。
- 渲染观测：跨 system 选区按 5 个 measure 片段绘制，focus caret 独立显示，控制台无 warning/error。
- 已知验收限制：打印隐藏规则已由 `.selectionLayer` 的 `@media print` 样式落实，但本轮自动浏览器未打开系统打印预览；正式发布前仍需人工确认一次打印预览。

### 2026-08-12 边界修复备注

- 品位草稿：新增可取消的延迟提交 Module。每次重新调度或取消都会推进内部 generation；即使旧回调已经进入任务队列，也会因为 generation 不匹配而跳过，避免撤销、重做、节奏或小节操作后出现过期 `note.setRect`。
- 即时操作：Toolbar 中所有会改变 document、selection 或历史位置的操作统一先取消品位草稿，再执行实际动作。该顺序是页面交互不变量，后续新增工具按钮时也必须复用同一入口。
- 键盘作用域：历史快捷键移动到编辑器根节点，使 SVG 与 Toolbar button 持有焦点时均可撤销/重做；方向键、数字、Escape 和删除键仍只由 SVG 处理，避免劫持 Toolbar 的原生键盘行为。
- 空白点击：工作区只在事件目标不属于谱面 SVG 且未按 Shift 时清空选区。SVG 内的点击和拖动仍由既有命中与 pointer capture 流程负责，Toolbar 位于工作区之外，不会被误判为空白点击。
- 自动化：新增品位草稿取消、重新调度和历史快捷键解析测试；website 测试文件统一内聚到 `apps/website/tests/`，测试脚本以该目录作为唯一入口。核心 117 项测试与 website 9 项测试通过，`pnpm type-check`、`pnpm lint`、`pnpm build` 通过。
- 浏览器：Codex In-app Browser，本地网站 `http://localhost:3000/`。先提交即时品位，再输入待提交的 `1` 并立即点击 Undo；等待超过 600ms 后 Undo 仍不可用、Redo 仍可用，证明旧草稿没有重新写入历史。
- 快捷键：点击“设置单附点”让 Toolbar button 保持焦点，再执行 `Ctrl+Z`，修改成功撤销且焦点仍位于原按钮，证明历史快捷键不再依赖 SVG 焦点。
- 空白点击：在单格选区存在时点击 SVG 下方的 A4 空白区域，范围计数消失，Beat/Measure 工具恢复 disabled，证明工作区空白可以稳定清除选区。
- 控制台：本轮交互无应用 warning/error，也不再输出指针 anchor/focus 调试日志；仅观察到 Next.js 开发环境的 HMR 连接日志。
