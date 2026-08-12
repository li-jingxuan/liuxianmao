# MVP v5.1 详细实施计划：连音组节奏

## 1. 实施约束

- v5 吉他技巧的模型、命令、layout、页面和全量测试完成后，再合入 v5.1 生产代码；开发期间可以先建立独立 fixture 和纯领域测试。
- `applyScoreCommand` 是持久化修改的唯一外部 interface；`buildLayout` 是 SVG 几何的唯一外部 interface。
- `beat.rhythm` 始终表达书写时值，`beat.tick` 始终表达应用连音比例后的实际起点；页面不得维护第二套时间轴。
- 首版只支持 `2:3`、`3:2`、`4:3`、`5:4`、`5:3`、`6:4`。
- group 成员必须位于同一 measure、连续、数量等于 `actual`，并具有完全相同的 `rhythm.base` 与 `dots`；实际时长必须为整数 tick。
- 首版允许整组使用相同附点，但不支持同组内混合基础时值或不同附点数。混合时值未来需要显式 `unitRhythm`，不得在本版本靠推断补齐。
- group 不跨 measure，不重叠、不嵌套；自动换行不改变领域实体。
- website 只提交稳定 Beat/tuplet 引用并消费 layout，不计算比例时长、容量、连梁覆盖或 bracket 几何。
- 任一命令成功只增加一次 `documentRevision` 和一条历史；失败或 no-op 不改变文档、revision、对象引用和历史。
- 当前项目不维护旧 schema 迁移链。模型变化必须一次性更新 schema version、example、fixture 和测试文档，不在 loader/layout 中补 `tuplets: []` 默认值。
- 每个步骤先完成聚焦测试和类型检查，再进入下一步；不得用页面静态数据或 mock layout 掩盖尚未接通的领域行为。

## 2. 目标结构与依赖顺序

```text
模型 / schema / ID
  ↓
tuplet 时间 Module
  ↓
语义校验 ───────────────┐
  ↓                     │
measure timeline Module │
  ↓                     │
tuplet 命令 ────────────┤
  ↓                     │
既有 rhythm / 拍号 / 小节命令
  ↓
spacing / beam seam
  ↓
tuplet annotation layout
  ↓
store / React 工具 / SVG
  ↓
全量回归与发布验收
```

两个核心深 Module：

1. `core/tuplet.ts`：隐藏比例白名单、小节索引和实际时长换算；调用方只学习带 measure 上下文的 Beat duration interface。
2. `core/measure-timeline.ts`：隐藏明确内容识别、尾部容量休止、实际 tick 重排和剩余容量分解；命令只提交候选 measure 与受保护 Beat。

如果删除任一 Module 会让比例公式、group 扫描或尾部休止规则重新散落到多个调用方，说明它有足够 Depth；若 Module 只是转发现有函数，应在该步骤内重新收敛 interface。

## 3. Step 0：冻结 v5 基线并建立 v5.1 规范谱例

### 修改

- 确认 v5 技巧已通过 core、layout、website 全量检查；
- 记录无 tuplet 时的 rhythm tick、measure spacing、beam segments、system 高度与固定桌面截图基线；
- 新增 `example-mvp5.1` 或等价测试 fixture，至少包含 8 个小节和 2 条 system；
- fixture 覆盖六种 ratio、notes/rest 混合、同附点成员、数字-only、bracket、尾部容量休止、小节复制和拍号切换；
- 单独保留一个无 tuplet 的 v5 fixture，作为几何兼容基线；
- 为所有预期 group、成员和实际 tick 写出表格化测试数据，不从待测 implementation 动态生成期望值。

### 最小谱例矩阵

| 小节 | 场景                        | 预期重点                           |
| ---- | --------------------------- | ---------------------------------- |
| 1    | 三个八分音符 `3:2`          | 每个 320 tick，完整连梁只显示 `3`  |
| 2    | 两个八分音符 `2:3`          | 每个 720 tick，消耗尾部容量休止    |
| 3    | 四个十六分音符 `4:3`        | 每个 180 tick，多层 beam           |
| 4    | 五个十六分音符 `5:4`        | 每个 192 tick，显示 `5`            |
| 5    | 五个十六分音符 `5:3`        | 每个 144 tick，与 `5:4` 领域值不同 |
| 6    | 六个十六分音符 `6:4`        | 每个 160 tick                      |
| 7    | 三个附点八分音符 `3:2`      | 先算附点再缩放，每个 480 tick      |
| 8    | 含 rest 或空 notes 的 group | 显示数字和 bracket                 |

### 测试与退出条件

- v5 当前全量测试可重复通过；
- fixture 中所有实体 ID 全局唯一；
- 每个小节的预期实际 tick 和容量由人工常量断言；
- 保存固定浏览器截图或记录可复现的视觉验收尺寸；
- 本步骤不修改生产时间模型。

## 4. Step 1：增加连音组文档模型

### 修改

- 在 `core/constants.ts` 增加 `LXM_TUPLET_RATIOS`；
- 在 `core/types.ts` 增加 `ILXMTupletRatio`、`ILXMTuplet` 和必填 `ILXMMeasure.tuplets`；
- `beatIds` 的 interface 明确要求按 `measure.beats` 时间顺序保存；
- `tuplets` 的 interface 明确要求按首成员时间顺序保存；
- 在 `core/schema.ts` 建立六种 ratio 的严格 union 与严格 tuplet schema；
- 在 `core/id-factory.ts` 增加 `createTupletId()`；
- 更新 `core/index.ts` 或包根导出，确保 website 只从公开入口消费类型和命令；
- 在实施时当前基线之上递增 `CURRENT_SCHEMA_VERSION` 一次；
- 为全部 example、fixture、测试 helper 的 measure 补齐 `tuplets`；
- 空白小节和新建小节 fixture 使用 `tuplets: []`。

### 测试

- 六种 ratio 的合法对象均通过 schema；
- 未定义 ratio、缺字段、多余字段、非法 beatIds 类型被 schema 拒绝；
- 缺少 `measure.tuplets` 的旧结构被明确拒绝，而不是静默补默认值；
- tuplet ID factory 不与既有 score/track/measure/beat/note/chord/technique ID 冲突；
- 更新后的所有 example 通过 loader；
- 包根导出的类型可由 website TypeScript 正常消费。

### 退出条件

- 模型与 schema 完整，但尚不允许文档写入非空 tuplets；
- 无 tuplet fixture 的语义和 layout 结果保持基线；
- core 聚焦测试、type-check 和 lint 通过。

## 5. Step 2：实现 Tuplet 时间 Module

### 修改

- 新增 `core/tuplet.ts`；
- 实现 ratio 值比较，禁止依赖对象引用；
- 一次遍历 measure 建立 `tupletById` 和 `tupletByBeatId`；
- 保留 `calculateRhythmTicks(rhythm)` 的现有书写时长语义；
- 新增带 measure 上下文的 `getBeatDurationTicks(measure, beat)`；
- 将 `getBeatEndTick` 改为消费 measure 上下文，或新增等价的实际结束 tick interface；
- 附点先由现有 multiplier 进入 written ticks，再乘 `normal / actual`；
- 使用整数分子/分母和取模判断，禁止 `Math.round` 与浮点容差；
- 为 Module 内部索引提供一次构建、多次读取的路径，避免 layout 或校验对每个 Beat 重扫 `tuplets`。

### interface 预期

```ts
type BeatDurationResult =
  | { ok: true; ticks: number }
  | {
      ok: false;
      code: "INVALID_RHYTHM" | "NON_INTEGER_TUPLET_TICKS";
    };

getBeatDurationTicks(
  measure: ILXMMeasure,
  beat: ILXMBeat,
): BeatDurationResult;
```

可在 implementation 内接受预构建索引，但不要让所有调用方学习两套公共接口。若性能路径需要暴露上下文，使用单一 `createMeasureRhythmContext(measure)` interface，并让 context 同时提供 duration/index 查询。

### 测试

- 无 group 的 Beat 与 `calculateRhythmTicks` 完全一致；
- 六种 ratio 对 quarter/eighth/sixteenth/thirtySecond 的实际 tick；
- 相同单附点成员：先应用附点，再应用比例；
- 可精确表示的双附点组合成功；
- 不能整除的组合返回 `NON_INTEGER_TUPLET_TICKS`，不取整；
- 不存在于 group 的 Beat 不受同 measure 其他 group 影响；
- ratio 使用等值对象时结果一致，不依赖引用身份；
- 大量 Beat/group 的测试证明只建立一次索引，不做 `O(beats × tuplets)` 扫描。

### 退出条件

- 命令、校验和 layout 后续都可以通过同一 interface 获取实际 duration；
- 比例公式只存在于该 Module implementation；
- `rhythm.test.ts` 与新增 `tuplet.test.ts` 通过。

## 6. Step 3：扩展语义校验

### 修改

- 在 `core/semantic-validation.ts` 注册 tuplet ID；
- 单个 measure 一次建立 `beatId → index`，再校验所有 group；
- 校验 ratio 白名单、成员数量、成员存在性、无重复和有序连续切片；
- 校验所有成员 `rhythm.base`、`dots` 完全一致；
- 校验 Beat 不属于多个 group，因而同时禁止重叠和嵌套；
- 校验 `tuplets` 按首成员时间顺序排列；
- 使用实际 duration 从 tick 0 重建预期时间轴；
- 将现有 `BEAT_TICK_NOT_CONTIGUOUS`、`MEASURE_CAPACITY_MISMATCH` 改为基于实际 duration；
- 增加精确的 tuplet issue code 和 path。

### issue code

```ts
"TUPLET_BEAT_NOT_FOUND";
"TUPLET_MEMBER_COUNT_MISMATCH";
"TUPLET_BEATS_NOT_CONTIGUOUS";
"TUPLET_RHYTHM_MISMATCH";
"TUPLET_OVERLAP";
"TUPLET_ORDER_INVALID";
"NON_INTEGER_TUPLET_TICKS";
```

### 测试

- 合法六种 ratio 与同附点 group 通过；
- 成员缺失、重复、逆序、不连续和数量不符分别命中确定 issue；
- 不同 base、不同 dots 分别命中 `TUPLET_RHYTHM_MISMATCH`；
- 两个 group 部分重叠、包含嵌套和复用一个 Beat 均命中 `TUPLET_OVERLAP`；
- tuplets 数组乱序命中 `TUPLET_ORDER_INVALID`；
- 非整数实际 tick 命中具体 group/member path；
- 使用书写 duration 伪造的旧 tick 被判为不连续；
- 最后 Beat 实际结束点不等于容量时仍命中容量错误；
- tuplet ID 与其他实体 ID 重复被统一唯一性规则捕获。

### 退出条件

- loader 可以读取合法非空 tuplets，并对非法持久化文档提供稳定 issue；
- schema 形状错误和 semantic 音乐错误职责清晰；
- `semantic-validation.test.ts`、`loader.test.ts` 通过。

## 7. Step 4：提取 Measure Timeline 容量协调 Module

### 修改

- 新增 `core/measure-timeline.ts`；
- 接收候选 measure、`createBeatId` 和可选 `protectedBeatIds`；
- 把 notes Beat、任一 group 成员和 protected Beat 视为明确内容；
- 只把最后一个明确内容之后连续、未分组、未保护的 rest 视为容量缓冲；
- 使用实际 duration 累计固定前缀；
- 固定前缀超过容量返回 `MEASURE_OVERFLOW`；
- 固定前缀未溢出时，从 0 重排 tick，并调用 `createRestBeats` 精确生成剩余容量；
- 只为被重建的容量 rest 分配新 ID，其他实体引用尽量复用；
- 输入 measure 不得被原地修改；失败不返回部分候选。

### interface 预期

```ts
reconcileMeasureTimeline(
  measure: ILXMMeasure,
  options: {
    createBeatId: () => string;
    protectedBeatIds?: ReadonlySet<string>;
  },
):
  | { ok: true; measure: ILXMMeasure }
  | {
      ok: false;
      code: "MEASURE_OVERFLOW" | "RHYTHM_NOT_REPRESENTABLE";
    };
```

### 测试

- group 缩短时后续 Beat 前移，尾部 rest 增加；
- group 拉长时后续 Beat 后移，尾部 rest 减少；
- 拉长超过容量时失败且输入深相等；
- 尾部普通 rest 可以全部重建；
- 尾部 group rest 不被当成容量缓冲；
- protected 尾部 rest 保留 ID，只有其后容量 rest 可重建；
- notes/rest 混合前缀保持 rhythm、kind、notes 和 ID；
- 剩余容量不可表达时返回 `RHYTHM_NOT_REPRESENTABLE`；
- 相同输入和确定性 ID factory 得到深相等结果；
- 未变化的非目标对象尽量保持引用。

### 退出条件

- tuplet set/remove、拍号和 rhythm change 不需要自己实现尾部 rest 识别与 tick 重排；
- 删除该 Module 会迫使至少三个调用方重复容量规则；
- 新增 `measure-timeline.test.ts` 通过。

## 8. Step 5：实现 `tuplet.set/remove` 命令

### 修改

- 在 `LXMScoreCommandEnum` 增加 `SetTuplet = "tuplet.set"`、`RemoveTuplet = "tuplet.remove"`；
- 增加 `ILXMSetTupletCommand`、`ILXMRemoveTupletCommand` 并纳入 union/export；
- set 按 measure.beats 顺序解析稳定首尾 Beat 闭区间；
- 校验 track/measure/Beat、端点顺序、ratio、数量、rhythm 一致性和整数 tick；
- 与现有 group 完全同范围时保留 tuplet ID 并更新 ratio；
- 同范围同比例返回 no-op；
- 与现有 group 部分相交时返回 `TUPLET_OVERLAP`；
- 新建 group 由局部 document ID factory 分配 ID；
- set/remove 都把目标成员传入 `protectedBeatIds`；
- remove 按 measure 内稳定 tuplet ID 定位，删除关系但保留成员 Beat；
- 容量协调成功后统一调用既有 finalize；
- 增加领域错误码和面向用户的稳定错误信息。

### 测试

- 六种 ratio 的 set 成功；
- 同附点成员 set 成功，混合 dots 失败；
- 非整数 tick 失败；
- start/end 逆序、不存在、跨错误 measure、成员数不符失败；
- 部分重叠与嵌套意图失败；
- 同范围同比例 no-op，保持文档引用和 revision；
- `5:4 → 5:3 → 5:4` 保留同一 tuplet ID；
- set 缩短/拉长正确协调尾部容量；容量不足原子失败；
- remove 后成员 Beat、Note 和 v5 technique 引用保持；
- 删除尾部全 rest group 时成员 ID 仍保留；
- tuplet not-found、track/measure not-found 使用确定错误码；
- success 只复制目标 track/measure，增加一次 revision；
- 局部 factory 已取号后的失败不向文档泄漏 ID。

### 退出条件

- core 命令可完成完整新增、改比例、删除、no-op 与错误闭环；
- store 尚不需要了解 group implementation；
- 新增 `tuplet-commands.test.ts` 通过。

## 9. Step 6：协调既有领域命令

### 6.1 `beat.setRhythm`

#### 修改

- 目标 Beat 属于 group 时返回 `BEAT_IN_TUPLET`；
- 后续压缩 DP 不把 group 成员作为单 Beat rhythm 候选；
- group rest 不进入可任意重建的尾部容量缓冲；
- 压缩候选和最终 reflow 使用实际 duration；
- 修改 group 外 Beat 后保持 tuplets、成员和 tuplet ID；
- 若现有 DP 无法在不破坏 group 的前提下得到精确容量，则明确失败。

#### 测试

- group 内目标失败且无历史；
- group 前方 rhythm 变更会整体移动 group，但不改 group；
- group 后方普通 Beat 仍按既有策略协调；
- DP 跳过 group 成员，并保持原有确定性排序；
- 无 group 的既有 rhythm-change 全部回归。

### 6.2 `beat.setKind` 与 Note 命令

#### 修改

- notes/rest 转换保持 group 与 rhythm；
- rest 成员合法；
- Note 新增、删除、矩形编辑不改 tuplet；
- v5 技巧引用生命周期仍按既有规则执行，与 tuplet 修改形成同一候选文档。

#### 测试

- group 内 notes→rest→notes 保持成员关系；
- 删除最后一个 Note 产生空 notes 时 group 仍合法；
- Note 批量编辑不复制无关 tuplets；
- 技巧级联和 tuplet 保持同时成立。

### 6.3 小节增删复制

#### 修改

- insert 使用 `tuplets: []`；
- remove 随 measure 删除 tuplets，并继续清理 v5 技巧引用；
- copy 先建立完整 `oldBeatId → newBeatId`；
- copy 再复制 tuplets、重建 tuplet ID 和成员 Beat 引用；
- 副本 tuplets/group 成员顺序与源一致，不引用任何源 Beat；
- 复制仍不复制 v5 技巧，barline 仍重置为 `single`。

#### 测试

- insert 空数组；
- remove 无悬挂 tuplet/technique 引用；
- copy ratio 等价但所有 measure/Beat/Note/chord/tuplet ID 全新；
- 源和副本任一后续编辑互不影响；
- undo/redo 恢复完整 group。

### 6.4 拍号变更

#### 修改

- 固定内容长度改用实际 duration；
- 同容量拍号切换保留 group；
- 扩容增加尾部 rest，缩容只消费未分组容量 rest；
- 全休止且无 group 时保留既有单位拍重建策略；
- 全休止但有 group 时按明确内容处理，不丢 group；
- `untilNextChange` 继续先规划全部目标 measure，再一次提交。

#### 测试

- `3/4 ↔ 6/8` 保留 tuplets，只有 beam profile 改变；
- 扩容、可安全缩容、group 阻挡缩容；
- 全休止有/无 group 两条分支；
- 多小节中任一 group 导致失败时全部 measure 不变；
- 合法 chord symbol 保留，超出新容量仍按既有规则失败。

### 退出条件

- 所有可能重排 Beat tick、替换 Beat 或复制 measure 的命令都已审计；
- 无 group 文档保持 v5 既有命令行为；
- `commands`、`rhythm-change`、`time-signature-change`、store history 聚焦测试通过。

## 10. Step 7：让 Spacing 与 Beam 消费连音组时间

### 10.1 Measure spacing

#### 修改

- `measure-spacing.ts` 不再仅凭 `beat.rhythm` 得到 column `rhythmTicks`；
- 通过统一时间 Module 获取实际 duration；
- `durationWeight`、基础 `minWidth` 仍由书写 `rhythm.base` 决定；
- 为 tuplet label 建立内部 width contributor；
- 当成员覆盖宽度不足以容纳 `5` 或未来 ratio label 时，把差值稳定分配给 group 成员列；
- comfortable/compact 都保持最小可读宽度；
- 页面不通过 margin/transform 修正 label。

#### 测试

- column tick、rhythmTicks 与实际时间轴一致；
- 相同书写 rhythm 的普通 Beat 与 tuplet Beat 保持相同基础视觉权重；
- label contributor 只在必要时扩宽；
- system 分配额外宽度后残差仍由最后列稳定吸收；
- 无 group spacing 坐标深等于 v5 基线。

### 10.2 Beam seam

#### 修改

- 在 `duration-beam-layout.ts` 一次建立 tuplet membership；
- group 首成员之前、末成员之后形成明确 beam seam；
- group 内短时值作为独立 beam group，优先保持 group 完整，不被拍号内部拍组边界从中间拆开；
- group 外仍按既有拍号拍组、连续性、dots 和 beam level 规则；
- rest/空 notes 没有 duration mark，因此不能成为完整 shared beam；
- 输出足够信息，让 annotation Module 确定 level 1 shared beam 是否精确覆盖 group。

#### 测试

- 三连音短时值形成独立 shared beam；
- group 前后相邻短音符不会加入该 shared beam；
- group 内部跨普通拍组边界时仍保持领域 group 完整；
- rest/空 notes 打断完整覆盖；
- 单附点 group 沿用现有高层 beam/partial beam 规则；
- group 外 beam 与 v5 基线一致；
- 相同输入 beam segment 顺序稳定。

### 退出条件

- layout 的所有横向时间与 beam 范围都已消费同一领域时间；
- 还未渲染数字/bracket，但 core layout 已能回答是否完整连梁覆盖；
- `measure-spacing.test.ts`、`duration-beam-layout.test.ts` 通过。

## 11. Step 8：实现 Tuplet Annotation 与动态高度

### 修改

- 在 `layout-types.ts` 增加 `ILXMTupletLayout` 和 bracket 最终几何；
- 在 `layout-constants.ts` 集中 label 字号、gap、stroke、hook、图形净空和底部 padding；
- 新增 `layout/tuplet-layout.ts`；
- label 默认显示 `actual`，领域 ratio 原样保留在 layout 中；
- label X 使用首末成员节奏锚点的中点；
- level 1 shared beam 的有序 beatIds 与 group 完全相等时 `bracket: null`；
- 其他情况输出横线、中央文字 gap 和两端短钩；
- annotation Y 使用目标范围内 beam、flag、rest、dots 的最低视觉 bounds 加净空；
- 同一 measure group 不重叠，首版复用一个 annotation lane；
- `measure-layout.ts` 在 duration/rest 完成后调用 tuplet layout；
- annotation 最低点进入 measure height；
- system height、下一 system Y、document height 和 hit bounds 使用最终高度；
- 无 group 时保持 v5 既有 measure/system/document 几何。

### 测试

- 完整 shared beam 只输出数字；
- bracket 的 x1/x2、y、hook、gap 与 label 坐标；
- rest、空 notes、quarter/half 等无完整 beam 场景显示 bracket；
- 相邻普通 beam 不会错误触发数字-only；
- `5:4`、`5:3` 都显示 `5`，但 layout ratio 不同；
- 多层 beam、flag、附点与 rest 的净空；
- 同一 measure 多个不重叠 group 共用 lane 且互不覆盖；
- measure/system/document height 完整包住 annotation；
- 后续 system Y 不与前一行 annotation 碰撞；
- 改变 systemWidth 不改领域 tuplets；
- 无 group fixture 的布局深等于基线。

### 退出条件

- core layout 已输出页面可直接渲染的全部最终值；
- React 不需要读取 source measure 或 beamSegments 再推导 bracket；
- 新增 `tuplet-layout.test.ts`，并通过 system/hit-test 回归。

## 12. Step 9：接入 Store 与 React 工具

### 修改

- 复用现有 TAB 选择，增加纯函数将矩形选择归一为有序 Beat 范围；
- 弦号维度不参与 tuplet，跨 measure 选择在页面即时禁用；
- 增加 `2:3`、`3:2`、`4:3`、`5:4`、`5:3`、`6:4` 工具入口；
- 使用已有 duplet/triplet/quadruplet/quintuplet/sextuplet SVG 资产；
- tooltip/menu 始终显示完整 ratio，不能仅凭 `5` 区分两个五连音；
- 页面可根据成员数量和明显的 selection 形状做即时可用性提示；
- base、dots、重叠和整数 tick 仍由核心命令最终裁决；
- 完全选中既有 group 时提供删除和可用的 ratio 修改；
- set/remove 统一调用 store `execute`；
- 错误提示映射核心错误码，不复制音乐判断；
- 使用 TypeScript、函数式 React、Hooks 和纯派生函数；
- 不把 tuplets 复制进 store 临时状态，选区/hover/菜单属于 UI 状态。

### 测试

- 空选择、单 Beat、跨 measure、非连续选择的禁用状态；
- 2/3/4/5/6 个 Beat 对应 ratio 入口；
- 同附点选择可提交，混合 dots 收到核心错误；
- `5:4` 与 `5:3` 可明确选择；
- 部分重叠错误提示；
- 完整 group 的删除与 `5:4 ↔ 5:3` 修改；
- set/remove 各一条 history；no-op/失败不入 history；
- undo/redo 后工具状态从 document + selection 重新派生；
- 与 v5 技巧工具、键盘导航、矩形选择不冲突。

### 退出条件

- 不依赖 SVG 渲染也能通过 store/interaction 测试完成编辑闭环；
- 页面没有比例公式、tick 重排或 bracket 判断；
- `editor-store.test.ts`、`editor-interaction.test.ts` 通过。

## 13. Step 10：接入 SVG 渲染与浏览器验收

### 修改

- 新增纯消费 tuplet layer；
- `<text>` 直接消费 label 的 text/x/y/fontSize/textAnchor；
- bracket 直接消费 layout 的横线、gap、hook 和 stroke；
- 使用 `tuplet.id` 作为稳定 key；
- 首版不增加 bracket 拖拽或独立领域命中；编辑仍由 Beat 选区驱动；
- selection/hover 颜色只由样式控制，不改几何；
- print 保留数字和 bracket，隐藏交互高亮；
- 确保 SVG viewBox 和容器高度消费最终 document height。

### 浏览器验收

- 六种 ratio 在固定桌面页面清晰可读；
- notes-only 完整连梁只显示数字；
- notes/rest 混合、长时值和空 notes 显示 bracket；
- 同附点 group 的 dot、beam 与数字不碰撞；
- `5:4`、`5:3` 工具语义明确，谱面均按预期显示 `5`；
- measure 尾部、system 末尾和稀疏末行不裁切 bracket；
- 多 system 下相邻行不重叠；
- comfortable/compact 均可读；
- undo/redo、复制小节、拍号切换后视觉与领域数据一致；
- 打印预览保留 tuplet 标记且无交互样式。

### 退出条件

- JSX 中不存在 Beat 坐标平均、beam 覆盖扫描或 bracket path 推导；
- 固定截图与人工检查通过；
- website lint、type-check、test、build 通过。

## 14. Step 11：全量回归与版本验收

### 必跑命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

### 领域验收

- 六种 ratio 可新增、改比例、删除、保存、加载、撤销和重做；
- 实际时长严格等于 `written × normal / actual` 且为整数 tick；
- 同附点成员可用，混合 base/dots 被明确拒绝；
- 任一成功文档从 tick 0 连续到 measure capacity；
- overlap、nested、cross-measure、not-found 和 capacity overflow 原子失败；
- group 内单 Beat rhythm 修改被拒绝，其他既有命令不会破坏 group；
- measure copy 重建所有相关 ID，remove/insert/time signature 行为符合技术方案；
- v5 technique 引用在 tuplet 时间重排后仍有效。

### Layout 验收

- 完整连梁只显示数字，其他情况显示数字和 bracket；
- group 的 beam seam 不被相邻普通短音符污染；
- 标注不与 beam、flag、rest、dots、staff 或下一 system 碰撞；
- 无 tuplet 文档保持 v5 视觉和几何基线；
- 改变 `systemWidth` 只改变布局，不改变领域 tuplet；
- layout 相同输入得到确定性深相等输出。

### 页面验收

- 工具 ratio 含义明确，特别是两个五连音；
- 页面只做临时可用性提示，核心错误可读；
- 每次成功编辑只有一条历史；
- 键盘导航、TAB 选择、v5 技巧选择与 tuplet 工具无回归；
- 固定桌面、compact 和打印视图通过。

### 文档收尾

- 将实施中确认的 interface、错误码或限制回写到 `technical-design.md`；
- 更新 `docs/mvp/mvp-version-roadmap.md` 的 v5.1 状态；
- 在 `docs/mvp/v5.1/README.md` 汇总技术方案、实施计划和验收结果；
- 记录任何延期项，尤其是混合时值、显式 `unitRhythm`、嵌套和跨 measure group，不把未实现能力留成含糊 TODO。

## 15. 建议提交切片

为降低回归定位成本，建议按以下可独立检查的切片提交：

1. `model`: constants、types、schema、ID、fixture；
2. `time`: tuplet Module 与 duration 测试；
3. `validation`: semantic rules 与 loader；
4. `timeline`: measure timeline 与容量测试；
5. `commands`: set/remove 与 history；
6. `compat`: rhythm、拍号、小节和技巧引用协调；
7. `layout-time`: spacing 与 beam seam；
8. `layout-annotation`: 数字、bracket 与动态高度；
9. `website`: 工具、store、SVG 和交互测试；
10. `acceptance`: 全量回归、视觉验收和文档收尾。

每个切片必须保持仓库可构建；不要在前一个切片中导出尚无实现的页面 interface，也不要在后一个切片中回头复制前面已经建立的时间或容量规则。

完整设计依据见 [MVP v5.1 技术实现方案](./technical-design.md)，版本边界见 [MVP 版本路线图](../mvp-version-roadmap.md)。
