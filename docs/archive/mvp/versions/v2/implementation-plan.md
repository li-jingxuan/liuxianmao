# MVP v2 详细实施计划

## 1. 实施约束

- 实现顺序必须是“多行布局 → 命中 → 命令 → 页面输入”。不得先在页面层拼接坐标或直接修改 document。
- 每个步骤完成后先运行其聚焦测试，再继续下一个步骤。
- 当前仓库依赖安装状态必须先恢复到可运行状态；不要把由缺失 workspace 依赖引起的测试失败误判为功能回归。
- 本计划不包含 v3 的时值或小节结构编辑。

## 2. Step 0：建立基线与测试夹具

### 目标

为多行排版、命中和单音命令准备唯一的规范 `ILXMDocument` 夹具，并记录当前单行输出作为回归基线。

### 修改

- 新增 `packages/lxm-editor/example/example-mvp2.json.ts`：
  - 默认导出一个强类型 `ILXMDocument`，并命名为 `EXAMPLE_MVP_2`。
  - 固定一条标准调弦吉他轨道与 8 个连续 `4/4` 小节；每个小节的节奏总量必须为 `3840` tick。
  - 使用稳定且全局唯一的 `track`、`measure`、`beat`、`note` ID。
  - 覆盖开放弦、同拍多弦、高品位 `12/24`、四分至三十二分、单/双附点、和弦标记、全部六根弦与最终小节线。
  - 不含 v2 非范围内的休止、连音组、技巧、歌词或和弦图；附点和和弦标记只用于布局回归。
- 修改 `packages/lxm-editor/example/index.ts`，新增：

  ```ts
  export * as EXAMPLE_MVP_2 from "./example-mvp2.json";
  ```

- 新增 `packages/lxm-editor/tests/layout/system-layout.test.ts`，从 `EXAMPLE_MVP_2.default` 加载 fixture。
- 不修改生产布局逻辑。

### 验收

- `EXAMPLE_MVP_2.default` 可经 `loadDocument(JSON.stringify(...))` 加载为成功结果。
- 所有 ID 唯一，所有品位在 `0–24` 范围，所有 beat 的 tick 与 rhythm 总量均符合 `4/4` 容量。
- fixture 作为只读输入使用；测试不得就地修改导入对象。
- 现有 rhythm、measure-spacing、barline 与 duration-beam 测试保持可运行。

## 3. Step 1：扩展 layout 类型与常量

### 目标

建立 system 输出的数据契约，先让 TypeScript 明确未来 layout 的形状。

### 修改

- 修改 `packages/lxm-editor/src/layout/layout-types.ts`：
  - 为 `ILXMLayoutOptions` 新增 `systemWidth`、`systemGapY`。
  - 新增 `ILXMSystemLayout`。
  - 为 `ILXMMeasureLayout` 新增 `systemIndex`。
  - 将 `ILXMLayout.measures` 改为 `systems` 与 `hitIndex`；不要保留重复的扁平 measures 字段。
- 修改 `packages/lxm-editor/src/layout/layout-constants.ts`：
  - 新增 `LXM_SYSTEM_DEFAULT_WIDTH`。
  - 新增 `LXM_SYSTEM_GAP_Y`。
  - 新增弦命中半径常量，例如 `LXM_STRING_HIT_RADIUS_Y`。

### 验收

- 受影响调用方全部以新类型编译；此时允许测试因 layout 实现未跟随而暂时失败，但不得使用 `any` 绕过。

## 4. Step 2：实现 system 断行

### 目标

让纯函数将按顺序的小节分为多条谱面行，并以最终坐标重新布局每个小节。

### 修改

- 新增 `packages/lxm-editor/src/layout/system-layout.ts`：
  - 导出 `layoutSystems(measures, options)`。
  - 使用技术方案的贪心断行规则。
  - 返回 `ILXMSystemLayout[]`，并保证 `systemIndex` 与小节顺序稳定。
- 重构 `packages/lxm-editor/src/layout/index.ts` 或拆出 `score-layout.ts`：
  - 只保留 `buildLayout(document, options)` 作为公开门面。
  - 空轨道返回空 `systems` 和空 `hitIndex`。
  - 宽度为所有 system 的最大宽度，高度为最后一行底部。
- 视需要调整 `layoutMeasure` 的 context，使 `systemIndex` 可以写入小节产物。

### 测试

在 `system-layout.test.ts` 添加：

- 恰好容纳时不换行。
- 加入一个小节后超过宽度时从该小节换行。
- 单个超宽小节独占一行。
- 空数组返回空系统。
- 第二行 `y` 等于第一行 `y + height + systemGapY`。
- 每行内部小节间距等于 `measureGap`，且所有内部坐标随 system Y 一起移动。

### 验收

- 对同一夹具和 options，连续运行布局的 JSON 结果完全相同。
- 所有旧单小节布局测试继续通过。

## 5. Step 3：实现命中索引与 hit test

### 目标

将 SVG 逻辑坐标稳定映射为业务编辑目标。

### 修改

- 新增 `packages/lxm-editor/src/layout/hit-test.ts`：
  - 定义 `ILXMHitTarget`、`ILXMHitIndex` 和 `hitTestLayout`。
  - 从所有 `systems[].measures[]` 构建小节边界索引。
  - 在小节内依据 beat slot X/width 和弦线 Y 返回目标。
- 修改 `layout-types.ts` 与 `buildLayout`，将 hit index 置入 `ILXMLayout`。
- 从 `packages/lxm-editor/src/index.ts` 导出 hit test API。

### 测试

新增 `packages/lxm-editor/tests/layout/hit-test.test.ts`：

- 单行每条弦和每个 beat slot 的中心点。
- 第二条 system 中的点。
- slot 左右边界的归属规则。
- 行与行之间、小节外、弦线外点击都返回 `null`。
- 布局重新构建后，相同业务位置仍得到相同 ID。

### 验收

- hit test 不依赖 DOM、React 或浏览器 API。
- 返回值含 `trackId`、`systemIndex`、`measureId`、`beatId`、`string`。

## 6. Step 4：实现最小领域命令

### 目标

建立唯一的 v2 乐谱写入口。

### 修改

- 新增 `packages/lxm-editor/src/core/commands.ts`：
  - 定义 `ILXMScoreCommand`、错误码、结果类型与 `applyScoreCommand`。
  - 实现 `note.set` 和 `note.remove`。
  - 定义 `createNoteId`；生成策略须可注入或可测试，不能直接依赖不稳定随机数。
- 修改 `packages/lxm-editor/src/index.ts`，导出命令 API。
- 若 `LXMDocumentSchema` 不能完整表达命令约束，新增集中式语义校验函数，不在组件内补校验。

### 测试

新增 `packages/lxm-editor/tests/core/commands.test.ts`：

- 在空弦添加合法品位。
- 同 beat、同弦覆盖，且 notes 不重复。
- 同 beat、不同弦并存。
- 删除目标音，其他弦不受影响。
- 重复删除保持 no-op 成功。
- 不存在的 track/measure/beat、弦号 0 或 7、品位 -1 或 25 全部失败。
- 失败保持输入 document 深度等价；成功只复制修改路径并增加 revision。

### 验收

- 命令层不导入 React、layout 或 website 文件。
- `ILXMNote.fret` 仍是数值；不得在此步骤加入闷音字符串。

## 7. Step 5：迁移 SVG 渲染到 systems

### 目标

让页面正确消费新 layout 数据，且 React 不拥有换行逻辑。

### 修改

- 修改 `apps/website/components/EditorShell/index.tsx`：
  - 将 `layout.measures.map` 改为 `layout.systems.map(system => system.measures.map(...))`。
  - 渲染 system `<g>` 和 measure `<g>`，key 使用稳定的 `system.index` 与 `measure.id`。
  - `viewBox`、`width`、`height` 直接使用 `ILXMLayout`。
- 仅在必要时抽取 `SystemLayer.tsx` / `MeasureLayer.tsx`；抽取组件不得重算坐标。

### 验收

- 至少 8 小节示例可显示为两行以上。
- 现有弦线、品位、符干、附点和连梁的视觉位置随小节换行同步移动。
- 页面不出现 React key warning。

## 8. Step 6：接入光标和指针命中

### 目标

让用户可见并可验证当前编辑位置。

### 修改

- 在 `EditorShell` 加入 `ActiveCursor | null` 和错误状态。
- 在 SVG 的 `onPointerDown` 中把 client 坐标转换为 SVG 逻辑坐标，再调用 `hitTestLayout`。
- 添加当前 beat 列与弦交点的视觉高亮；高亮位于音乐图层下方，不遮挡点击。
- 如果重新 layout 后 cursor 的 `measureId` 或 `beatId` 不存在，清空 cursor。

### 验收

- 每条 system 的首尾小节均能点击选中正确位置。
- 点击行间空白不更改光标。
- 页面层不根据数组 index 推断 beat 或 string。

## 9. Step 7：接入键盘输入与命令结果

### 目标

完成单音输入、覆盖和删除的用户闭环。

### 修改

- 让 `EditorShell` 持有当前 document；初始文档来自现有 example loader。
- 数字键输入实现有限状态草稿：
  - `0–9` 可构成一位或两位品位。
  - 只在值落入 `0–24` 时提交 `note.set`。
  - 超时、Enter、失焦时提交合法草稿；Escape 清除草稿。
- Backspace/Delete 调用 `note.remove`。
- 命令成功时替换 document，失败时显示错误并保持当前文档。
- 编辑器容器必须可聚焦；当焦点在 input/textarea/select/contenteditable 中时跳过快捷键。

### 验收

- 用户能在两条不同 system 中输入、覆盖和删除音符。
- 输入 `12` 只生成一次 `note.set`，不会先写入 `1` 再覆盖。
- 非法输入不会修改文档，错误可见且不会污染 layout。

## 10. Step 8：回归、文档与版本验收

### 必跑命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

### 浏览器验收

- 固定桌面视口，使用至少 8 小节谱例。
- 验证自动换行、每行点击、单音输入、覆盖、删除和非法输入提示。
- 确认根页面无非预期滚动条，控制台无 error/warning。
- 记录截图、使用的 `systemWidth` 和已知限制。

### 文档收尾

- 若 API 或断行规则与本方案不同，先更新 [技术实现方案](./technical-design.md)，再合入代码。
- 将最终行为、测试结果和用户验收结论补到本文件末尾的“实施记录”。

## 11. 实施记录

| 日期       | 状态   | 说明                                                                                                                                                                                                                         |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-23 | 已完成 | Step 0–4：新增 MVP v2 fixture、system 自动换行、命中索引与单音领域命令；35 项核心单元测试、类型检查和 lint 均通过。浏览器交互验收留待 Step 5–7 页面接入完成后执行。                                                          |
| 2026-07-23 | 已完成 | Step 5–8：页面已按 system 渲染并接入 SVG 命中、光标、两位品位草稿、覆盖、删除和错误提示。浏览器验证了两行断行、输入 `12`、删除及非法 `25` 提示；控制台无 error/warn。当前固定 `systemWidth = 1380`，同一行小节外间距为 `0`。 |
