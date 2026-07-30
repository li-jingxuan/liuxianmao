# MVP v3 补充：时值变长后的后续 Beat 级联压缩

## 1. 背景

当前 `beat.setRhythm` 已经在核心领域命令中实现时值修改、后续 tick ripple、末尾
休止补齐和小节容量校验。现有规则把连续末尾休止视为唯一可自动伸缩的缓冲区：

- 目标 beat 变短时，后续 beat 左移，并在小节末尾补充休止；
- 目标 beat 变长时，先消耗连续末尾休止；
- 末尾休止不足且真实音符越过小节容量时，返回 `MEASURE_OVERFLOW`；
- 非休止 beat 的 `rhythm` 不会被自动修改。

该策略能够避免隐式改动真实音符，但会阻断一个常见编辑动作：用户明确把前面的短
时值改成长时值时，即使后续 beat 仍有可压缩空间，命令也会直接失败。

例如示例数据第 6 小节完整占满 `4/4 = 3840 tick`：

```text
eighth + sixteenth + sixteenth + eighth + eighth + quarter + quarter
480     + 240       + 240       + 480    + 480    + 960     + 960
```

把第一个 `eighth` 改为 `quarter` 会新增 `480 tick`，当前实现因没有末尾休止而
提示“修改时值后超出小节容量”。

本补充方案引入“局部向右借时”的后续 beat 级联压缩：先沿用已有末尾休止缓冲，
仍然溢出时，再在同一小节内从目标右侧寻找确定、可表示且容量精确匹配的压缩方案。

本方案覆盖以下旧规则：

- `technical-design.md` 2.2、5.2 中“溢出直接失败”和“不修改非休止 beat rhythm”；
- `implementation-plan.md` Step 3 中“仅通过末尾连续 rest 吸收差值”。

其他 MVP v3 时间轴、schema、语义校验、layout 和页面渲染契约保持不变。

## 2. 目标与非目标

### 2.1 目标

- 用户把 beat 从较短时值改为较长时值时，尽可能保留同一小节内的全部音符内容。
- 自动压缩只影响目标 beat 后方的 beat，并尽量限制在靠近目标的局部范围。
- 所有结果仍精确覆盖拍号容量，不产生空洞、重叠、取整或任意 tick。
- 算法结果确定：相同文档与相同命令必须产生相同结果。
- 一次命令只递增一次 `documentRevision`，成功或失败都保持现有原子语义。
- 页面只提交命令并消费结果，不参与压缩选择、tick 计算或容量修复。

### 2.2 非目标

- 不跨小节借用时值，不把溢出内容推到下一小节。
- 不删除、合并、拆分 notes beat，不改变音高、弦号、品位或 note ID。
- 不对后续 beat 做连续比例缩放，不写入非标准 tick 时长。
- 不自动增加、减少或重新拼写后续 beat 的附点数。
- 不处理连音组、复附点之外的新节奏类型或播放时长拉伸。
- 不在本补充中引入新的撤销/重做机制；未来历史模块只需把本命令视为一次原子修改。
- 不联动移动 `chordSymbols.tick`。当前模型没有 chord symbol 与 beat 的关联关系，
  继续维持现有命令行为；该问题应在和弦编辑能力中单独设计。

## 3. 核心决策

### 3.1 `beat.setRhythm` 直接获得级联压缩语义

保持现有命令 interface 不变：

```ts
export interface ILXMSetBeatRhythmCommand extends ILXMBeatCommandBase {
  type: LXMScoreCommandEnum.SetBeatRhythm;
  rhythm: ILXMRhythm;
}
```

不增加 `overflowPolicy: "reject" | "compressFollowing"`。当前只有工具栏这一种调用
语义，没有第二个真实 adapter 需要不同策略；把内部算法暴露成命令参数会扩大调用者
必须理解的 interface，也可能让不同页面产生不一致的乐谱编辑规则。

修改后的统一契约是：

1. 目标时值不变或变短：保持现有 ripple 与末尾休止补齐规则；
2. 目标时值变长：先消耗连续末尾休止；
3. 仍然溢出：尝试压缩目标右侧 beat；
4. 找到精确方案则成功，找不到则原子失败。

### 3.2 压缩只改变基础时值，保留附点数

后续 beat 的可选压缩路径由 `LXM_RHYTHM_BASES` 的长短顺序决定，且保留原
`dots`：

```text
whole → half → quarter → eighth → sixteenth → thirtySecond
```

例如：

```text
{ base: "eighth", dots: 1 }
→ { base: "sixteenth", dots: 1 }
→ { base: "thirtySecond", dots: 1 }
```

`thirtySecond` 没有更短候选。保留附点数能够避免一次基础时值编辑隐式改变后续
音符的节奏拼写；如果当前候选无法精确释放容量，命令失败，而不是自动移除附点。

### 3.3 必须精确释放溢出容量

压缩方案释放的 tick 必须严格等于末尾休止消耗后仍然存在的溢出量：

```text
sum(originalDuration - compressedDuration) === overflowTicks
```

不允许多压缩后再创建新休止来回填。否则一个“增加当前时值”的动作会同时制造新的
静音，结果虽然容量合法，但音乐意图不够可预测。

### 3.4 选择最靠近目标且压缩程度均匀的方案

多个精确方案同时存在时，按以下优先级确定唯一结果：

1. 最小化最右侧受影响 beat 与目标 beat 的距离；
2. 最小化单个 beat 被缩短的最大基础时值级数；
3. 最小化所有 beat 被缩短的总级数；
4. 最小化被修改的 beat 数量；
5. 仍相同时，按从左到右的压缩级数向量稳定比较；首个不同项中，压缩级数更大的
   方案优先，使改动落在更早的 beat。

第一条保证修改保持局部；第二条让算法优先把压力分散到相邻 beat，而不是把单个
beat 一次压缩多级；后续规则只负责消除歧义。算法不得依赖对象遍历顺序或随机数。

## 4. 领域不变量

成功结果必须同时满足：

```text
beats[0].tick === 0
beats[i].tick === beats[i - 1].tick + duration(beats[i - 1])
lastBeatEnd === getMeasureCapacityTicks(timeSignature)
```

并额外满足：

- 目标 beat 之前的 beat 对象内容与 ID 不变；
- 目标 beat 只改变 `rhythm` 与因重排得到的派生布局，不改变内容和 ID；
- 被压缩 beat 只改变 `rhythm` 和重新计算的 `tick`；
- 未被压缩的 notes beat 只允许 `tick` 改变；
- 所有 notes 内容和 note ID 保持不变；除被重建的尾部缓冲 rest 外，beat ID、顺序
  和 `kind` 保持不变；
- 目标之后的连续末尾 rest 继续由现有 ID 工厂重建，允许其数量、时值和 ID 变化；
- 即使目标自身是 rest，也必须保留目标 beat，不能把它当作可整体移除的尾部缓冲；
- 失败时输入 document、其嵌套引用和 `documentRevision` 均不改变；
- 成功时只复制目标 track/measure 路径，`documentRevision` 只增加 1；
- 最终结果必须通过 `LXMDocumentSchema` 和 `validateDocumentSemantics`。

## 5. 模块设计

### 5.1 Seam

把复杂的容量规划放入新的纯领域模块：

```text
packages/lxm-editor/src/core/rhythm-change.ts
packages/lxm-editor/src/core/rest-beats.ts
```

`commands.ts` 仍是文档级命令 seam，负责：

- 查找 track、measure、beat；
- 获取文档级 ID 工厂；
- 调用节奏修改规划模块；
- 替换目标 measure、增加 revision；
- 执行 schema 与语义校验；
- 把内部失败映射为命令错误。

`rhythm-change.ts` 隐藏以下实现复杂度：

- 新旧时值差计算；
- 连续末尾休止剥离与重建；
- 后续 beat 压缩候选生成；
- 精确容量搜索和确定性排序；
- 整个小节 tick 的重新累计。

建议的内部 interface：

```ts
export type MeasureRhythmChangeErrorCode =
  | "BEAT_NOT_FOUND"
  | "INVALID_RHYTHM"
  | "FOLLOWING_BEATS_CANNOT_COMPRESS"
  | "RHYTHM_NOT_REPRESENTABLE";

export type MeasureRhythmChangeResult =
  | {
      ok: true;
      measure: ILXMMeasure;
      compressedBeatIds: string[];
    }
  | {
      ok: false;
      code: MeasureRhythmChangeErrorCode;
    };

export const changeMeasureBeatRhythm = (
  measure: ILXMMeasure,
  beatId: string,
  rhythm: ILXMRhythm,
  createBeatId: () => string,
): MeasureRhythmChangeResult;
```

`compressedBeatIds` 先用于测试、日志和未来成功提示，不必在本次扩大
`ILXMApplyScoreCommandResult`。该模块不依赖 React、layout、document store 或完整
`ILXMDocument`。

`rest-beats.ts` 集中实现 `createRestBeats`，由小节插入和节奏重排两个真实调用方
共同复用；它把 `createRestRhythmsForTicks` 的 rhythm 序列补齐为具有 ID、连续 tick、
`kind: "rest"` 和空 notes 的领域对象。

### 5.2 rhythm 工具职责

`rhythm.ts` 继续只提供通用的音乐时间计算。可以新增一个纯函数用于生成同附点的
更短基础时值候选：

```ts
export const getShorterRhythmOptions = (
  rhythm: ILXMRhythm,
): Array<{ rhythm: ILXMRhythm; level: number; ticks: number }>;
```

约束：

- 返回顺序从缩短一级到缩短最多级；
- 不包含输入 rhythm 本身；
- 不改变 `dots`；
- 每个输出都必须通过 `calculateRhythmTicks`；
- 不重复维护第二份基础时值映射，顺序来源于 `LXM_RHYTHM_BASES`。

`rhythm-change.ts` 消费该工具，但具体搜索与方案排序不进入 `rhythm.ts`，避免让通用
时值换算模块承担编辑策略。

## 6. 算法

### 6.1 名词

```text
previousTicks  = 修改前目标 beat 时长
nextTicks      = 用户选择的目标时长
deltaTicks     = nextTicks - previousTicks
capacityTicks  = 当前拍号的小节容量
fixedBeats     = 去掉连续末尾 rest 后的 beat 序列
fixedEndTicks  = fixedBeats 的总时长
overflowTicks  = max(0, fixedEndTicks - capacityTicks)
```

小节输入已经通过语义校验，因此可按数组顺序处理，不以旧 `tick` 作为新的累计依据。

### 6.2 总流程

1. 查找目标 beat，校验新旧 rhythm 均能转换为整数 tick。
2. 目标 beat 替换为新 rhythm，但暂不修改原 document。
3. 从候选 beats 尾部剥离目标之后的连续 rest；扫描到目标 beat 时必须停止，保证
   目标即使是 rest 也仍位于 `fixedBeats`。
4. 计算 `fixedEndTicks`：
   - `fixedEndTicks <= capacityTicks`：不压缩真实内容，重建剩余尾部休止；
   - `fixedEndTicks > capacityTicks`：进入后续 beat 精确压缩搜索。
5. 压缩搜索只接收目标 beat 后方、且仍位于 `fixedBeats` 中的 beat。
6. 搜索成功后应用 rhythm 变更；失败则返回
   `FOLLOWING_BEATS_CANNOT_COMPRESS`。
7. 从 tick 0 开始重新累计所有 beat 的 tick。
8. 若末尾仍有剩余容量，使用现有 `createRestRhythmsForTicks` 和 ID 工厂重建 rest。
9. 返回新 measure，交由 `commands.ts` 完成文档替换和最终校验。

虽然压缩成功按本方案必须精确释放 `overflowTicks`，第 8 步仍保留为统一的尾部休止
重建路径，用于目标变短或已有尾部休止足以吸收增长的情况。

### 6.3 压缩候选

对目标后的每个 beat 生成以下选择：

```text
level = 0：保持原 rhythm，释放 0 tick
level = 1：基础时值缩短一级，释放 originalTicks - optionTicks
level = 2：基础时值缩短两级，释放 originalTicks - optionTicks
...
```

notes 和非尾部 rest 使用相同候选规则。连续末尾 rest 已在搜索前作为缓冲区整体移除，
不会参与候选搜索。

### 6.4 精确搜索

使用有界动态规划或回溯，不使用单向贪心。原因是附点保留后，不同 beat 可释放的
tick 不再只有单一二进制面额；局部贪心可能先选择一个合法缩短，却让剩余容量无法
精确组合。

推荐实现：

1. 按从目标相邻 beat 到小节尾部的顺序逐步扩大搜索窗口；
2. 对每个窗口运行稀疏 DP，第一级 key 为累计释放 tick，第二级 key 为当前方案的
   最大压缩级数；
3. 忽略累计释放量大于 `overflowTicks` 的状态；
4. 第一个能得到 `overflowTicks` 的窗口天然满足“最小化最右影响距离”；
5. 同一 tick 的多个状态按 3.4 的剩余评分规则保留最佳方案；
6. 找到首个精确窗口后立即停止，不继续考察更远 beat。

不能只为每个累计释放 tick 保留一个方案。`maxLevel` 不是可直接累加的分数：当前
最大级数为 1 的方案看似优于最大级数为 2 的方案，但如果后续必须追加 level 3，
两者最终最大级数都会变成 3，此时后者可能因总压缩级数更小而成为最优解。因此同一
tick 下必须按 `maxLevel` 保留帕累托状态；只有 tick 和 maxLevel 都相同时，才能按
总级数、修改数量和稳定顺序安全剪枝。

当前每个 beat 最多只有 6 个基础时值选项，小节容量也有限，使用稀疏 `Map<number,
Plan>` 足够。预期复杂度约为：

```text
O(numberOfFollowingBeats × reachableTickStates × rhythmOptionCount)
```

不需要把 tick 除以硬编码最小单位；直接使用整数 tick 可以继续复用
`calculateRhythmTicks` 的合法性保证。

### 6.5 伪代码

```ts
const changeMeasureBeatRhythm = (
  measure: ILXMMeasure,
  beatId: string,
  rhythm: ILXMRhythm,
  createBeatId: () => string,
): MeasureRhythmChangeResult => {
  const targetIndex = measure.beats.findIndex((beat) => beat.id === beatId);
  const candidate = measure.beats.map((beat, index) =>
    index === targetIndex ? { ...beat, rhythm } : beat,
  );

  const firstTrailingRestIndex = findFirstTrailingRestIndexAfterTarget(
    candidate,
    targetIndex,
  );
  const fixedBeats = candidate.slice(0, firstTrailingRestIndex);
  const capacityTicks = getMeasureCapacityTicks(measure.timeSignature);
  const fixedEndTicks = sumBeatDurationTicks(fixedBeats);
  const overflowTicks = Math.max(0, fixedEndTicks - capacityTicks);

  const compressedBeats =
    overflowTicks === 0
      ? fixedBeats
      : applyExactFollowingCompression(fixedBeats, targetIndex, overflowTicks);

  if (!compressedBeats) {
    return { ok: false, code: "FOLLOWING_BEATS_CANNOT_COMPRESS" };
  }

  const reflowedFixedBeats = reflowBeatTicks(compressedBeats, 0);
  const fixedTicks = sumBeatDurationTicks(reflowedFixedBeats);
  const trailingRestTicks = capacityTicks - fixedTicks;
  const trailingRests = createRestBeats(
    fixedTicks,
    trailingRestTicks,
    createBeatId,
  );

  if (!trailingRests) {
    return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
  }

  return {
    ok: true,
    measure: {
      ...measure,
      beats: [...reflowedFixedBeats, ...trailingRests],
    },
    compressedBeatIds: collectCompressedBeatIds(fixedBeats, compressedBeats),
  };
};
```

伪代码省略了目标不存在的处理；该错误仍由 `commands.ts` 的 `findTarget` 统一返回
`BEAT_NOT_FOUND`。

## 7. 第 6 小节结果示例

目标 beat 从 `eighth` 变为 `quarter` 后需要释放 `480 tick`。最靠近目标的精确、
均匀方案为：

| Beat | 原 rhythm | 新 rhythm    | 释放 tick | 新起始 tick |
| ---- | --------- | ------------ | --------- | ----------- |
| 1    | eighth    | quarter      | -480      | 0           |
| 2    | sixteenth | thirtySecond | 120       | 960         |
| 3    | sixteenth | thirtySecond | 120       | 1080        |
| 4    | eighth    | sixteenth    | 240       | 1200        |
| 5    | eighth    | eighth       | 0         | 1440        |
| 6    | quarter   | quarter      | 0         | 1920        |
| 7    | quarter   | quarter      | 0         | 2880        |

Beat 2～4 合计释放：

```text
120 + 120 + 240 = 480 tick
```

最终结束 tick 仍为 `3840`，所有 beat 与 note ID 保持不变，也不会产生新的尾部休止。

## 8. 错误语义

在 `ILXMScoreCommandErrorCode` 新增：

```ts
| "FOLLOWING_BEATS_CANNOT_COMPRESS"
```

映射消息：

```text
后续节拍已达到最短可用时值，无法容纳当前修改
```

以下情况返回该错误：

- 目标是小节最后一个非尾部休止 beat，右侧没有可压缩 beat；
- 所有右侧 beat 均已是 `thirtySecond`；
- 右侧 beat 理论释放总量不足；
- 能释放足够 tick，但在“保留附点、不可过度压缩”的约束下没有精确组合。

`MEASURE_OVERFLOW` 保留给不经过本规划模块的其他容量错误，或作为兼容错误码暂时
存在；`beat.setRhythm` 的“右侧无法压缩”应优先返回新错误，使页面提示可操作。

`INVALID_RHYTHM`、`RHYTHM_NOT_REPRESENTABLE`、`BEAT_NOT_FOUND` 等既有语义不变。

## 9. 页面与 layout 接入

`apps/website/components/EditorShell/index.tsx` 的时值和附点按钮继续构造原有
`beat.setRhythm` 命令，无须传入额外策略。

成功后沿用现有流程：

```text
applyScoreCommand
→ setDocument(result.document)
→ useMemo(buildLayout)
→ 使用稳定 measureId + beatId + string 恢复光标位置
```

页面不得：

- 预先计算是否溢出；
- 自行选择或修改后续 beat；
- 缓存旧 tick 或旧 SVG 坐标；
- 在核心失败后局部写入 document。

本次不要求新增成功 toast。压缩结果会直接反映在谱面时值符号、连梁、beat slot 和
命中区域中；若后续增加“已压缩 N 个节拍”提示，可再把内部
`compressedBeatIds` 映射为命令成功 metadata。

layout 无须增加压缩逻辑。`buildLayout`、`measure-spacing.ts`、
`duration-beam-layout.ts` 和 `hit-test.ts` 只消费最终合法 document，并基于更新后的
rhythm/tick 完整重建派生数据。

## 10. 文件级修改清单

### 10.1 新增

```text
packages/lxm-editor/src/core/rhythm-change.ts
packages/lxm-editor/tests/core/rhythm-change.test.ts
packages/lxm-editor/src/core/rest-beats.ts
```

### 10.2 修改

```text
packages/lxm-editor/src/core/rhythm.ts
  - 新增 getShorterRhythmOptions，复用现有基础时值与 tick 换算。

packages/lxm-editor/src/core/commands.ts
  - 删除 setBeatRhythm 内部对 tick ripple 和尾部 rest 的内联实现。
  - 把现有私有 createRestBeats 辅助函数移动到 rest-beats.ts，供节奏修改和小节插入复用。
  - 调用 changeMeasureBeatRhythm。
  - 映射 FOLLOWING_BEATS_CANNOT_COMPRESS。
  - 保留 replaceMeasure、finalize 和文档级不可变更新。

packages/lxm-editor/tests/core/rhythm.test.ts
  - 覆盖同附点的短时值候选顺序与 tick。

packages/lxm-editor/tests/core/commands.test.ts
  - 从公开命令 interface 覆盖成功压缩、失败原子性和最终语义校验。

apps/website/components/EditorShell/index.tsx
  - 不需要改变命令参数。
  - 确认新错误消息仍通过现有 errorMessage 区域展示。
```

不修改：

```text
packages/lxm-editor/src/core/types.ts
packages/lxm-editor/src/core/schema.ts
packages/lxm-editor/src/core/semantic-validation.ts
packages/lxm-editor/src/layout/**
```

其中 `types.ts` 指文档模型不变；命令内部结果类型可以定义在 `rhythm-change.ts`。

## 11. 测试方案

### 11.1 rhythm 工具测试

- `whole, dots: 0` 返回 half 至 thirtySecond，level 递增且 tick 严格递减；
- `eighth, dots: 1` 只返回同为单附点的 sixteenth、thirtySecond；
- `thirtySecond` 返回空数组；
- 双附点候选全部可由 `calculateRhythmTicks` 精确表示；
- 输入对象不被修改。

### 11.2 压缩规划测试

- 第 6 小节第一个 eighth 改 quarter，得到预期的 `1/32 + 1/32 + 1/16` 后续节奏；
- 末尾休止足够时只缩短/移除末尾休止，不修改 notes beat；
- 最靠近目标的多个 beat 可精确组合时，不修改更远 beat；
- 同一局部窗口有多个解时，优先最大压缩级数更小的均匀方案；
- 必须跳过某个 beat 才能精确组合时，允许该 beat 保持不变；
- 后续 beat 有附点时只保留 dots 的候选，不自动改写附点；
- 后续全是 thirtySecond 时返回 `FOLLOWING_BEATS_CANNOT_COMPRESS`；
- 总可释放量足够但没有精确组合时失败，不通过过度压缩制造 rest；
- 目标是最后一个 beat 且无尾部 rest 时失败；
- 目标自身是尾部 rest 时保留其 ID 和所选 rhythm，只把它之后的 rest 当作缓冲；
- 不跨越当前 measure 修改下一小节；
- 输入 measure 和所有嵌套输入对象保持不可变。

### 11.3 命令集成测试

- 成功压缩后 `documentRevision + 1`；
- 失败时 revision 和整个输入 document 不变；
- 所有 notes、note ID、beat ID、顺序和 kind 保持不变；
- 未受影响 track、measure 保持引用相等；
- 成功结果通过 `LXMDocumentSchema` 与 `validateDocumentSemantics`；
- 成功结果可以直接传入 `buildLayout`，且 system、duration mark、beam 与 hit target
  可正常生成；
- 目标变短、尾部 rest 补齐、measure insert/copy/remove 等既有测试不回归。

### 11.4 页面验收

1. 打开示例谱并选中第 6 小节第一个 beat；
2. 点击四分音符；
3. 不再出现小节容量错误；
4. 第 2、3 beat 显示为三十二分，第 4 beat 显示为十六分；
5. 后续音符内容没有丢失，光标仍指向第一个 beat；
6. 点击重排后的任意 beat，命中结果与视觉位置一致；
7. 选择无法压缩的场景，页面显示新的可读错误且谱面不变化；
8. 控制台无 error/warning。

## 12. 实施顺序

1. 在 `rhythm.test.ts` 写出短时值候选的失败测试，再实现
   `getShorterRhythmOptions`。
2. 新增 `rhythm-change.test.ts`，先固定第 6 小节、末尾休止优先和失败原子性案例。
3. 实现尾部 rest 剥离、全量 tick 重排等无搜索路径。
4. 实现精确 DP 与确定性方案评分，跑规划模块测试。
5. 用 `changeMeasureBeatRhythm` 替换 `commands.ts` 中现有内联实现并映射新错误码。
6. 扩展 `commands.test.ts`，验证公开命令 interface、revision、引用复用和最终校验。
7. 跑核心、layout、页面相关回归。
8. 在真实页面完成第 6 小节和不可压缩场景验收。

建议验证命令：

```bash
pnpm --filter @liuxianmao/lxm-editor test
pnpm --filter @liuxianmao/lxm-editor type-check
pnpm --filter @liuxianmao/lxm-editor lint
pnpm --filter @liuxianmao/website type-check
pnpm --filter @liuxianmao/website lint
pnpm build
```

## 13. 完成定义

- 第 6 小节第一个 eighth 可以成功改为 quarter，并得到本文规定的确定性结果；
- 末尾休止仍是第一容量缓冲，不发生不必要的 notes rhythm 修改；
- 压缩只发生在目标 beat 之后和同一小节之内；
- 被压缩 beat 的附点数、内容、ID、顺序与 kind 均保持不变；尾部缓冲 rest 继续遵守
  现有重建规则；
- 压缩释放 tick 与 overflow tick 精确相等；
- 无合法方案时返回 `FOLLOWING_BEATS_CANNOT_COMPRESS`，原文档完全不变；
- 所有成功结果具有从 0 到拍号容量的连续时间轴，并通过最终结构与语义校验；
- 页面没有复制领域算法，光标和命中在重新 layout 后仍基于稳定 ID；
- 核心测试、类型检查、lint、构建和真实页面验收全部通过。

## 14. 被否决的方案

### 14.1 页面捕获 `MEASURE_OVERFLOW` 后再次修改

这会让页面拥有容量算法和多次写入过程，失败时可能出现半完成状态，也无法被未来的
其他调用者、撤销和协作能力复用。

### 14.2 增加可选 overflow policy

当前不存在需要严格拒绝模式的第二个真实 adapter。提前暴露策略会扩大命令
interface，并允许不同调用者对同一编辑动作产生不同结果；等真实需求出现时再引入。

### 14.3 按比例压缩所有后续 tick

比例结果通常不落在 `ILXMRhythm` 可表示集合中，会迫使取整或引入隐藏时长，破坏
schema、记谱、layout 和播放对同一时间轴的理解。

### 14.4 删除或截断小节末尾 beat

虽然能够快速消除 overflow，但会静默丢失音符内容，风险高于显式失败。

### 14.5 允许过度压缩并补尾部休止

这种结果满足容量校验，却同时改变更多真实节奏并制造用户没有输入的静音。MVP v3
采用精确释放规则，保持行为可解释。

### 14.6 自动修改后续附点

移除附点可以提供更细的压缩粒度，但会改变后续音符的节奏拼写。第一版只沿基础时值
梯级压缩并保留 dots；如果真实编辑数据表明精确失败率过高，再作为独立规则评审。
