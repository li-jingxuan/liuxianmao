# MVP v3 详细实施计划

## 1. 实施约束

- 实施顺序必须为“语义校验 → rhythm/ID 基础设施 → 领域命令 → 休止布局 → 页面工具栏”。页面不得抢先维护 tick 或直接修改文档。
- 每一个成功命令都必须返回不可变的新 `ILXMDocument`、递增 `documentRevision`，并通过 Zod 结构校验与语义校验。
- 每个步骤完成后先运行对应聚焦测试；未通过时不进入下一个步骤。
- 所有新增生产逻辑使用 TypeScript 和 ES6+；关键算法和边界规则必须保留中文注释。
- MVP v3 继续只布局第一条轨道，不在本版本扩展多轨编辑、撤销重做或保存。

## 2. Step 0：建立 V3 夹具与回归基线

### 目标

为节奏变更、休止符与小节结构命令提供稳定、可复用的规范输入，并保留 v2 行为基线。

### 修改

- 新增 `packages/lxm-editor/example/example-mvp3.json.ts`：
  - 默认导出强类型 `ILXMDocument`，命名为 `EXAMPLE_MVP_3`。
  - 基于 v2 的标准吉他轨道、八个 `4/4` 小节，所有小节的时间轴必须完整覆盖 `3840` tick。
  - 至少包含：完整休止小节、notes/rest 混合小节、末尾 rest、附点 beat、多弦 notes 和 chord symbol。
  - 所有 track、measure、beat、note、chord symbol ID 全局唯一且稳定。
  - 不在 fixture 内执行随机 ID、layout 或命令。
- 修改 `packages/lxm-editor/example/index.ts`，新增：

  ```ts
  export * as EXAMPLE_MVP_3 from "./example-mvp3.json";
  ```

- 新增 `packages/lxm-editor/tests/core/semantic-validation.test.ts` 的合法文档基线用例；此步可先使用将要实现的测试占位，不修改生产功能。

### 验收

- 夹具可在完成 Step 1 后经 `loadDocument(JSON.stringify(...))` 成功加载。
- 既有 `EXAMPLE_MVP_1`、`EXAMPLE_MVP_2` 和布局快照不被原地修改。
- 所有 v2 测试仍可运行。

## 3. Step 1：扩展数据模型与语义校验

### 目标

将“结构像乐谱”提升为“时间轴上合法的乐谱”，为后续所有命令建立唯一的业务守卫。

### 修改

- 修改 `packages/lxm-editor/src/core/constants.ts`：
  - 将 `LXM_BEAT_KINDS` 扩展为 `"notes" | "rest"`。
  - 若需要，为最大支持附点数定义命名常量，避免多个模块重复写 `2`。
- 修改 `types.ts`、`schema.ts`，使 `ILXMBeatKind` 与 Zod enum 接受 `rest`。
- 新增 `packages/lxm-editor/src/core/semantic-validation.ts`：
  - 导出 `validateDocumentSemantics(document)`、issue 类型和稳定错误码。
  - 验证：时值可计算、首 beat 从 0 起、相邻 beat 连续、最后结束 tick 等于拍号容量、rest 不含 notes、同 beat 不重复弦、实体 ID 全局唯一、chord tick 在小节容量内。
  - 校验器不依赖 React、layout 或浏览器 API。
- 修改 `core/loader.ts`：结构校验成功后调用语义校验；将语义错误转换为可展示的加载错误数组。
- 修改 `core/commands.ts` 的既有最终校验路径：成功候选文档也必须调用语义校验。
- 从 `src/index.ts` 导出新的校验 API。

### 测试

在 `semantic-validation.test.ts` 覆盖：

- 合法 `4/4`、`3/4`、`6/8` 小节。
- 无效 dots、tick 不连续、时间重叠、容量不足、容量溢出。
- rest 含 note、同 beat 重复弦、全局重复 ID、非法 chord tick。
- loader 对结构合法但语义非法文档返回失败。

### 验收

- 所有 MVP v1/v2 夹具满足新增语义规则；如不满足，先修正 fixture，不降低校验标准。
- 非法文档不会进入 layout 或命令成功结果。
- 错误码稳定、可断言，错误文本可供页面直接展示。

## 4. Step 2：补齐节奏与 ID 基础设施

### 目标

集中实现休止时间分解、tick 重排辅助函数和实体 ID 分配，避免命令层重复复杂逻辑。

### 修改

- 扩展 `packages/lxm-editor/src/core/rhythm.ts`：
  - 新增 `createRestBeatsForTicks(ticks, factory)`，将指定 ticks 分解为可表示的 rest beat 序列。
  - 新增仅处理 beat 时间轴的纯辅助函数，例如 `getBeatEndTick`、`reflowBeatTicks`；不混入 document 查找或 UI 行为。
  - 不可精确表示时返回 `RHYTHM_NOT_REPRESENTABLE`，不能向上/向下取整。
- 新增 `packages/lxm-editor/src/core/id-factory.ts`：
  - 定义 `ILXMIdFactory` 与从 document 创建的默认实现。
  - 集中生成 measure、beat、note、chord symbol ID；测试可传入确定性 factory。
  - 将现有 `commands.ts` 私有 `createNoteId` 迁移至该模块。

### 测试

- 常用容量 `4/4`、`3/4`、`2/4`、`6/8` 可生成连续且完整的 rest beats。
- 已知不可表示 ticks 返回明确失败。
- ID factory 对已有 ID 不冲突；复制连续调用生成不同 ID；注入测试 factory 输出可预测。
- rhythm helper 不读取或修改输入对象。

### 验收

- `createRestBeatsForTicks` 的输出可通过 Step 1 的语义校验。
- 新基础设施不引入 React、Zustand 或 layout 依赖。
- 现有 `note.set` 的 ID 行为不回归。

## 5. Step 3：实现节奏与休止领域命令

### 目标

完成 `beat.setRhythm` 与 `beat.setKind`，使节奏修改遵守明确的 ripple 和容量规则。

### 修改

- 扩展 `ILXMScoreCommand`、错误码和 `applyScoreCommand`：
  - `beat.setRhythm` 接收 `trackId`、`measureId`、`beatId` 与 `rhythm`。
  - `beat.setKind` 接收相同 target 与 `"notes" | "rest"`。
- `beat.setRhythm` 的顺序必须固定：
  1. 查找目标并验证 target rhythm；
  2. 计算新旧时值差；
  3. 对后续 beats 执行 tick ripple；
  4. 仅通过末尾连续 rest 吸收差值，或创建新的末尾 rest；
  5. 构造不可变候选文档、递增 revision、执行最终校验。
- `beat.setKind(rest)` 清空 notes，但不更改 tick/rhythm；改回 `notes` 仅保留空 notes。
- 对 rest beat 执行既有 `note.set` 返回 `REST_BEAT_NOT_EDITABLE`；`note.remove` 可维持 no-op 成功语义。

### 测试

- 缩短 notes beat 后后续 beat tick 正确左移，末尾 rest 扩展或新增。
- 变长时后续 beat 右移；末尾 rest 可缩短、可移除；超过容量时失败。
- 变更后每个成功结果连续覆盖完整小节容量。
- 转为 rest 清空 notes；取消 rest 后可继续 `note.set`。
- 对 rest 写品位失败，原 document 与 revision 不变。
- 成功结果仅复制目标 track/measure 路径；失败结果与输入 document 深度等价。

### 验收

- 页面无须、也不能补算后续 tick。
- 任何 overflow、不可表示时长或无效 target 都不改变原文档。
- v2 的 note.set/note.remove 通过新增语义校验。

## 6. Step 4：实现小节新增、复制与删除命令

### 目标

让用户编辑乐句结构，并确保新增或复制后仍是合法文档。

### 修改

- 在 `commands.ts` 实现：
  - `measure.insert`：在指定小节后插入；未传入 `afterMeasureId` 则插入首位。
  - `measure.copy`：在源小节后插入深拷贝。
  - `measure.remove`：删除指定小节，并阻止删除轨道最后一个小节。
- 新增小节：继承前一小节拍号；首位插入时继承后一小节；使用 `createRestBeatsForTicks(capacity)`；默认 `barline: "single"` 和空 chord symbols。
- 复制小节：保留音乐内容和拍号，但所有嵌套 ID 全部经 ID factory 重建；新副本 `barline` 固定为 `single`。

### 测试

- 在首、中、尾插入小节，拍号继承和索引顺序正确。
- 复制含多弦 notes、附点、rests、chord symbols 的小节，内容等价但所有嵌套 ID 均不同。
- 删除首、中、尾小节；最后一小节删除失败。
- 每次成功命令后的语义校验、ID 唯一性、revision 与不可变性。

### 验收

- 所有新增小节可直接被 layout，无需页面补默认 beat。
- 复制终止线或反复线不会产生双终止/双反复视觉歧义。
- 小节结构命令不改动非目标小节的引用。

## 7. Step 5：扩展休止符布局与 SVG 渲染

### 目标

使 rest 成为核心 layout 驱动的可见乐谱元素，而不是页面装饰。

### 修改

- 新增 `packages/lxm-editor/src/layout/rest-layout.ts`：
  - 维护 rhythm 到 Bravura/SMuFL glyph 的集中映射。
  - 使用目标 beat slot 与小节中线生成 `ILXMRestLayout`。
- 扩展 `layout-types.ts` 的 `ILXMMeasureLayout`，新增 `restMarks`。
- 修改 `measure-layout.ts`：为 rest beats 生成 `restMarks`；保持 notes、strings、barline 坐标逻辑不变。
- 修改 `duration-beam-layout.ts`：跳过 rest beat，不为其输出符干或连梁。
- 修改 `apps/website/components/EditorShell/index.tsx`：只消费 `measure.restMarks` 绘制 glyph；不在 JSX 推导时值或坐标。

### 测试

- 每个支持的 rest rhythm 输出正确 glyph 标识与位于 slot 内的坐标。
- notes beat 不生成 rest mark；rest beat 不生成 note layout、stem 或 beam。
- v2 夹具布局输出保持既有音符、连梁、附点和小节线结果。
- rest 小节与普通小节混排后，system 高度、命中索引和总画布尺寸正确。

### 验收

- 休止符在目标桌面浏览器、当前 Bravura 字体下清晰可见。
- React 仅渲染 layout 数据，未引入时值判断或硬编码几何。
- 点击休止所在 beat 仍能获得稳定 cursor。

## 8. Step 6：接入工具栏、错误提示与光标恢复

### 目标

完成用户可见的 V3 编辑闭环。

### 修改

- 新增 `apps/website/components/EditorToolbar/`：
  - 时值按钮、附点按钮、休止切换、新增/复制/删除小节按钮。
  - 使用 button、`aria-label` 和 disabled 状态；没有 cursor 时禁用依赖当前目标的操作。
  - 仅发出 command，不保存 document 副本。
- 在 `EditorShell` 集中新增 `executeCommand(command)`：
  - 调用 `applyScoreCommand`；成功则替换 document，失败则设置现有错误文本。
  - 成功后按技术方案恢复 cursor：保留原目标；当前小节删除时定位相邻小节首 beat。
- 清理 v2 遗留：初始 document 改为 `EXAMPLE_MVP_2.default`，移除调试 `console.log`，删除或完成 `SystemLayer.tsx` 占位组件。

### 测试与浏览器验收

- 两行以上谱面中，分别编辑首行、末行 beat 的时值、附点与 rest 状态。
- 验证 ripple 后光标仍指向相同 beat ID，且命中位置随 layout 更新。
- 验证新增、复制、删除后的自动换行、SVG `viewBox`、光标回退和 toolbar disabled 状态。
- 验证 overflow、对 rest 输入品位、删除最后小节、无 cursor 操作均显示可读错误且文档不变。
- 浏览器控制台无 error/warning，页面不出现非预期滚动。

### 验收

- 所有用户可见的持久化变更都经由核心命令。
- 工具栏不拥有节奏、容量、ID 或布局计算。
- 真实交互与单元测试中的同一文档状态一致。

## 9. Step 7：全量回归、文档和版本验收

### 必跑命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

### 最终验收清单

- V3 fixture 与已有 v1/v2 fixture 都可加载、校验和布局。
- 时值、附点、休止、新增、复制、删除在真实页面中均可操作。
- 所有失败操作保持 document、revision 与 cursor 的预期状态。
- 小节结构变化后 system 分组、整谱高度、命中索引和 SVG viewBox 全部刷新正确。
- 在固定桌面视口记录浏览器截图、使用的 `systemWidth` 和已知限制。
- 将与本计划不同的实际决策先回写到 [技术实现方案](./technical-design.md)，再标记版本完成。

## 10. 实施记录

| 日期 | 状态 | 说明 |
| --- | --- | --- |
| 2026-07-24 | 待实施 | 已完成 V3 技术方案和实施计划；尚未开始生产代码改动。 |
