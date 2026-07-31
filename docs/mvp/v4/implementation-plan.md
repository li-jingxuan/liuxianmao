# MVP v4 详细实施计划

## 1. 实施约束

- v3 全量自动化检查和浏览器验收通过后再开始 v4 生产代码。
- 实现顺序固定为“选择语义 → 导航 → 批量命令 → 历史 → 剪贴板/UI”。
- 页面不得循环调用单点命令模拟批量编辑。
- selection、clipboard payload 和 history 都不写入 `ILXMDocument` schema。
- 每个步骤先运行聚焦测试，再进入下一步。

## 2. Step 0：建立 v4 夹具与 no-op 契约

### 修改

- 新增 `packages/lxm-editor/example/example-mvp4.json.ts`：
  - 基于 v3 合法文档，至少 8 小节、2 条 system；
  - 包含可等时长互换的节奏组合；
  - 包含 notes、rest、多弦和跨小节范围；
  - 所有 ID 唯一且稳定。
- 扩展命令成功结果，增加 `changed` 和可选 `selectionHint`。
- 修正 `note.set`、`note.remove`、`beat.setRhythm`、`beat.setKind` 的 no-op：返回原 document、不增加 revision。

### 验收

- fixture 可经 loader 加载并通过 semantic validation；
- no-op 与失败均不产生新文档引用；
- v2/v3 命令行为保持兼容。

## 3. Step 1：实现选区顺序与解析

### 修改

- 新增 `src/editing/selection.ts` 和对应公开类型；
- 实现 `buildOrderedBeatIndex`、`resolveSelection`、`selectAllBeats`；
- 明确正向/反向 anchor-focus 的规范化结果；
- 从包入口导出所需 API。

### 测试

- 单 Beat、同小节范围、跨小节范围、反向范围和全选；
- 端点失效、跨轨道、非法弦和空轨道；
- 同一文档每次解析输出完全一致；
- 不修改输入 document 或 selection。

## 4. Step 2：实现键盘导航纯函数

### 修改

- 新增 `src/editing/navigation.ts`；
- 实现 `moveSelection(selection, direction, extend)`；
- 左右使用 Beat 文档顺序，上下只改变 activeString；
- 无相邻目标时返回 `changed: false`。

### 测试

- `1–6` 弦上下边界；
- Beat 左右边界及跨首/尾小节；
- Shift 扩展保持 anchor；普通移动折叠 anchor/focus；
- 自动换行变化不影响导航结果。

## 5. Step 3：实现选区 layout

### 修改

- 新增 `src/layout/selection-layout.ts`；
- 将选中 Beat ID 映射为按 system 分组的矩形；
- 同 system 连续 Beat 合并；focus 弦 caret 继续使用现有 Beat/string 坐标；
- 页面新增范围高亮层和打印隐藏样式。

### 测试

- 单 Beat、同 system 多 Beat、跨 system、反向选区；
- compact、comfortable 与稀疏末行；
- layout 重建后同一 ID 集合产生与新坐标一致的矩形。

## 6. Step 4：实现剪贴板 schema 与 codec

### 修改

- 新增 `src/editing/clipboard-schema.ts`；
- 定义 `ILXMClipboardPayloadV1` 与 Zod schema；
- 实现 `createClipboardPayload(document, beatIds)` 和 JSON codec；
- 限制载荷最多 512 Beat。

### 测试

- 合法 notes/rest/rhythm 载荷往返；
- 不导出 ID、tick 和位置字段；
- 非法版本、空 beats、非法 rhythm、rest 含 notes、重复弦、非法品位和超限载荷失败；
- 创建 payload 不修改文档。

## 7. Step 5：实现范围清除和粘贴命令

### 修改

- 扩展 `ILXMScoreCommand`：`range.clear`、`range.paste`；
- 新增连续 Beat ID 验证；
- `range.clear` 保留 tick/rhythm/ID 并转为 rest；
- `range.paste` 执行数量校验、逐 measure 等时长校验、tick 重排和 ID 重建；
- 成功 paste 返回指向新 Beat 的 `selectionHint`；
- 最后只调用一次 finalize。

### 测试

- 同小节和跨小节范围清除；
- 折叠范围 clear 的 no-op；
- 相同 rhythm 粘贴与等总时长不同 rhythm 粘贴；
- 新 Beat/Note ID 全局唯一；
- 数量、时长、目标连续性和轨道末尾失败；
- 任一失败保持 document、revision 和 ID factory 消费的预期；
- 成功只复制受影响 track/measure 分支。

## 8. Step 6：建立 editor store 与历史

### 修改

- 新增 `apps/website/stores/editor-store.ts`；
- 将 document、selection、error 和统一 `execute` 迁入 store；
- 接入 zundo 或等价受限历史，partialize 仅保存 document；
- 历史上限使用 `HISTORY_LIMIT`；
- 将 Zustand/zundo 依赖放到 website，核心包不再声明未使用的 UI 状态依赖；
- 实现 undo、redo、canUndo、canRedo 和 selection 恢复。

### 测试

- 成功、失败、no-op 的历史数量；
- undo/redo、分支编辑、100 条上限；
- selection/error 变化不进历史；
- 两位品位、range.clear、paste 各只产生一条历史；
- undo/redo 后 document 可重新通过 validation 和 layout。

## 9. Step 7：接入指针选择和键盘导航

### 修改

- `EditorShell` 从 store 读取状态，不再拥有独立 document useState；
- 普通点击、Shift+点击、pointer drag 使用统一 selection action；
- 接入方向键、Shift 扩展、Escape 和全选；
- selection 改变后把 focus 高亮滚入可见区域；
- toolbar 对范围不适用的单 Beat 操作使用明确 disabled 规则。

### 验收

- 跨两条 system 选择稳定；
- 重新排版后选择仍指向相同 Beat；
- pointer cancel 不留下拖动状态；
- 页面不使用数组下标推导业务目标。

## 10. Step 8：接入浏览器剪贴板与历史控件

### 修改

- 处理 copy/cut/paste ClipboardEvent 和内部 clipboard fallback；
- 写入自定义 MIME 与 text/plain；
- Cut 在写入成功后执行一次 `range.clear`；
- 粘贴只发送一次 `range.paste`；
- 新增 undo/redo 按钮、快捷键、aria-label 和 disabled 状态；
- 更新输入提示和错误文案。

### 验收

- Cmd/Ctrl+C/X/V/Z/Shift+Z 与 Ctrl+Y 工作；
- 非 LXM 剪贴板数据不修改文档；
- 失败 paste 保留当前 selection 和历史；
- undo/redo 按钮与快捷键状态一致；
- input、textarea、select、contenteditable 不被编辑器快捷键劫持。

## 11. Step 9：全量回归与版本验收

### 必跑命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

### 浏览器验收清单

- 在固定 A4 桌面页面完成点击、Shift+点击、拖动及跨 system 选择；
- 完成方向键和 Shift 范围导航；
- 完成单 Beat 输入、范围清除、复制、剪切、粘贴；
- 验证合法/非法容量粘贴、轨道末尾和损坏 clipboard；
- 连续 undo 到初始状态，再 redo 到最终状态；
- 验证 selection 不进入打印结果，页面和控制台无异常；
- 记录浏览器版本、视口、已知限制和用户确认结果。

## 12. 实施记录

| 日期       | 状态   | 说明                                                             |
| ---------- | ------ | ---------------------------------------------------------------- |
| 2026-07-31 | 待审查 | 已完成技术方案与实施计划，等待范围和交互规则确认后开始生产代码。 |
