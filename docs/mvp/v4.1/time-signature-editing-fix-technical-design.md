# MVP v4.1 Fix：拍号编辑与小节容量协调技术方案

## 1. 问题说明

MVP v4.1 已经完成拍号 layout：第一小节和拍号变更点显示拍号，普通 system 换行不重复显示。
文档模型也已经在每个 `ILXMMeasure.timeSignature` 中保存分子和分母，并将其用于小节容量、
默认休止 Beat 和连梁分组。

当前缺少用户编辑闭环：页面示例虽然可以预置不同拍号，用户却只能查看，不能在工具栏中创建或
修改拍号变更点。不能把这个缺口实现成页面直接修改两个数字，因为拍号变化还会影响：

- 小节总容量及 Beat 时间轴合法性；
- 尾部容量休止的增删和节奏拼写；
- 超出新容量的真实音符与和弦标记；
- 单拍与复拍子的连梁分组；
- 拍号显示、固有小节宽度、自动断行、命中与选区；
- v4 历史中的原子性、no-op、撤销和重做。

本 Fix 在不扩展持久化模型的前提下，增加拍号领域命令、保守容量协调、拍组解析和页面编辑入口。

## 2. 领域术语

### 2.1 拍号属于小节

拍号仍是 `ILXMMeasure` 的值，不新增 track 级“当前拍号”。相邻小节可以保存相同拍号；第一小节，
或拍号与前一小节不同的小节，称为“拍号变更点”。layout 继续通过相邻值比较决定是否显示。

### 2.2 修改单小节与创建变更点

“修改拍号”包含两种明确范围：

| 范围              | 语义                                                             | 典型用途                       |
| ----------------- | ---------------------------------------------------------------- | ------------------------------ |
| `measure`         | 只修改目标小节                                                   | 临时变拍，例如单独一小节 `2/4` |
| `untilNextChange` | 从目标小节开始，修改连续使用原拍号的小节，遇到下一既有变更点停止 | 从当前位置开始进入新的节拍段落 |

页面默认使用 `untilNextChange`，同时允许用户选择“仅当前小节”。这样既不会把整首谱误改，也不会让
用户为了创建一个持续拍号逐小节重复操作。

`untilNextChange` 的停止条件以命令执行前目标小节的拍号为准。例如第 1 至 4 小节为 `4/4`、
第 5 小节为 `3/4`，从第 3 小节改为 `6/8` 时只修改第 3、4 小节，第 5 小节保持不变。

### 2.3 尾部容量休止

小节末尾连续的 rest Beat 视为“尾部容量休止”。它承担填满拍号容量的结构职责，可以在拍号变化时
整体重新生成。尾部休止之前的所有 Beat 都是固定节奏前缀；其中即使包含 rest，也不会被跨越或重写。

## 3. 产品范围

### 3.1 首版可编辑拍号

工具栏首版只开放以下常用拍号：

| 拍号  |    小节容量 | 默认空白 Beat | 连梁拍组             |
| ----- | ----------: | ------------- | -------------------- |
| `2/4` | `1920 tick` | 2 个四分休止  | `1+1` 个四分音符     |
| `3/4` | `2880 tick` | 3 个四分休止  | `1+1+1` 个四分音符   |
| `4/4` | `3840 tick` | 4 个四分休止  | `1+1+1+1` 个四分音符 |
| `6/8` | `2880 tick` | 6 个八分休止  | `3+3` 个八分音符     |

核心 schema 暂不收窄，既有文档中其他合法数值仍可加载和展示；但命令与页面入口只承诺上述集合。
这避免首版误以为仅凭分子、分母就能确定 `5/8` 的 `2+3` 或 `3+2` 等拍组语义。

建议在 `constants.ts` 中建立唯一产品白名单：

```ts
export const LXM_EDITABLE_TIME_SIGNATURES = [
  { numerator: 2, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 4, denominator: 4 },
  { numerator: 6, denominator: 8 },
] as const;
```

页面选项、命令校验和测试都消费该常量，不各自维护字符串列表。

### 3.2 非范围

- 自定义分子、分母输入及 `5/8`、`7/8` 等不对称拍组配置；
- 拍号符号 `C`、`¢` 和自由拍；
- 弱起小节、不完整小节和跨小节移动 Beat；
- 自动压缩、删除、拆分真实音符；
- 因拍号变化自动移动和弦标记到其他小节；
- 一次修改不连续小节、多轨道同步拍号和播放速度；
- 连音组；它仍不属于 v4.1。

## 4. 领域命令

### 4.1 命令 interface

```ts
export type ILXMTimeSignatureChangeScope = "measure" | "untilNextChange";

export interface ILXMSetTimeSignatureCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.SetTimeSignature;
  measureId: string;
  timeSignature: ILXMTimeSignature;
  scope: ILXMTimeSignatureChangeScope;
}
```

命令使用稳定的 `trackId + measureId`，不传 measure index。页面只表达目标、拍号和范围，不提交
容量、新 Beat、tick 或受影响小节 ID 列表。

新增命令枚举：

```ts
SetTimeSignature = "measure.setTimeSignature";
```

新增错误码：

```ts
type ILXMScoreCommandErrorCode =
  | ExistingErrorCode
  | "UNSUPPORTED_TIME_SIGNATURE"
  | "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE"
  | "CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE";
```

无法精确生成尾部休止时继续复用 `RHYTHM_NOT_REPRESENTABLE`。

### 4.2 目标范围解析

领域命令先找到 target track 与 measure：

- track 不存在：`TRACK_NOT_FOUND`；
- measure 不存在：`MEASURE_NOT_FOUND`；
- 拍号不在产品白名单：`UNSUPPORTED_TIME_SIGNATURE`；
- `measure`：目标集合只有当前小节；
- `untilNextChange`：从目标向后收集拍号等于目标原拍号的连续小节，遇到第一个不同值停止。

范围解析必须位于核心命令层。页面不能根据当前 document 自行展开目标集合，否则页面状态过期时可能
覆盖错误小节，也会破坏命令的原子性。

## 5. 单小节容量协调算法

新增深 Module，例如：

```text
packages/lxm-editor/src/core/time-signature-change.ts
```

建议纯函数 interface：

```ts
type MeasureTimeSignatureChangeResult =
  | { ok: true; measure: ILXMMeasure }
  | {
      ok: false;
      code:
        | "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE"
        | "CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE"
        | "RHYTHM_NOT_REPRESENTABLE";
    };

changeMeasureTimeSignature(
  measure,
  timeSignature,
  createBeatId,
): MeasureTimeSignatureChangeResult;
```

### 5.1 共同不变量

无论容量变大、变小或保持不变，成功结果必须满足：

- `timeSignature` 等于目标值；
- Beat 从 tick `0` 开始，连续、不重叠，并精确结束于新容量；
- 不修改尾部容量休止之前的 Beat rhythm、notes、kind 和 ID；
- 不修改任何 Note ID 或 fret/string；
- 不修改合法范围内的 chord symbol、barline 和 measure ID；
- 只为重新生成的 rest Beat 分配新 ID；
- 输入 measure 不被原地修改。

### 5.2 全休止小节

若小节所有 Beat 都是 rest，则使用现有 `createMeasureRestBeats(newTimeSignature)` 完整重建，得到与拍号
一致的单位拍网格。例如 `4/4 → 3/4` 后产生 3 个四分休止，而不是一个二分加一个四分休止。

和弦标记可以保留，但其 tick 必须小于新容量；否则命令失败。

### 5.3 含真实音符的小节

1. 找到末尾连续 rest 的起始位置；其前方为固定节奏前缀。
2. 使用 rhythm 计算固定前缀结束 tick，不相信旧 tick 的偶然值。
3. 若任一 chord symbol 的 tick 大于等于新容量，失败。
4. 若固定前缀结束 tick 大于新容量，失败，绝不缩短或删除真实内容。
5. 保留固定前缀，并从其结束 tick 到新容量重新生成尾部容量休止。
6. 剩余容量为 `0` 时不生成 rest；否则调用 `createRestBeats` 精确分解。
7. 重新从 `0` 累计所有结果 Beat 的 tick，作为单一时间轴来源。

这一规则同时覆盖：

- 容量增大：真实内容保持不变，尾部追加或扩展休止；
- 容量缩小但只切到尾部休止：缩短并重新拼写尾部休止；
- 容量缩小会切到真实内容：原子拒绝；
- 容量相同但拍组不同，例如 `3/4 ↔ 6/8`：Beat 内容保持，拍号与连梁分组更新。

### 5.4 多小节原子规划

`untilNextChange` 可能修改多个小节。命令必须先为全部目标完成规划；任一目标失败时返回错误，原文档、
revision 和所有对象引用保持不变。全部成功后才一次性替换目标 measures，并将 `documentRevision` 加一。

成功但所有目标值均未变化时返回 `changed: false` 和原 document 引用。成功修改无论涉及多少小节，都只
形成一条历史记录。

## 6. 拍组与连梁修复

当前 `getCompleteBeatCapacityTicks(timeSignature)` 同时被用于计算小节容量和连梁拍组，其
`TICKS_PER_QUARTER * numerator / denominator` 只在当前 `4/4` 基线下恰好得到四分音符拍组。
例如它会为 `3/4` 和 `6/8` 都返回 `720 tick`，既不是 `3/4` 的四分音符拍，也不是 `6/8` 的
附点四分音符拍。

本 Fix 将两个概念拆开：

```ts
getMeasureCapacityTicks(timeSignature): number;
getTimeSignatureBeatGroupTicks(timeSignature): number[] | null;
```

- 小节容量直接按 `TICKS_PER_QUARTER * 4 * numerator / denominator` 计算；
- 可编辑拍号使用显式 profile 返回拍组时长数组；
- `duration-beam-layout.ts` 根据累计拍组边界断开连梁，不再假设所有拍组等长或等于小节四分之一；
- 非产品白名单但可加载的拍号返回 `null`；layout 以整小节单组作为保守 fallback，不假装推导复杂拍子的专业分组。

白名单预期：

```ts
2/4 => [960, 960]
3/4 => [960, 960, 960]
4/4 => [960, 960, 960, 960]
6/8 => [1440, 1440]
```

该调整是开放非 `4/4` 编辑入口的前置正确性修复，不能只添加下拉框而保留旧连梁分组。

## 7. Layout、选区与页面

### 7.1 Layout

命令成功后仍以新 document 调用 `buildLayout`：

- `shouldShowTimeSignature` 自动产生或移除拍号变更点；
- 拍号固定前导宽度进入 measure intrinsic width；
- system 自动断行、assigned width、barline、hit index 和 selection 全部重新派生；
- website 不比较相邻拍号，也不修正坐标。

### 7.2 选区协调

真实内容 Beat ID 被保留，因此落在真实内容上的 selection 保持稳定。落在被重建尾部休止上的 selection
可能失效；Store 应针对 `measure.setTimeSignature` 优先回退到目标小节第一个合法 Beat 的同一根弦，
再交给通用 `reconcileSelection`，不能直接跳到整首谱第一格。

undo/redo 继续从文档快照恢复 selection；临时的拍号菜单、范围选项和错误提示不进入历史。

### 7.3 页面交互

在当前 focus 对应小节上提供拍号工具：

- 下拉选项来自 `LXM_EDITABLE_TIME_SIGNATURES`；
- 显示完整文本 `2/4`、`3/4`、`4/4`、`6/8`；
- 范围默认“从当前小节起至下一拍号变化”，可切换“仅当前小节”；
- 工具文案显示目标小节序号，防止跨 system 选区时误解 focus；
- 提交后调用 Store `execute(command)`；
- 失败沿用现有错误提示，成功后自动重新 layout；
- 选区跨多个小节时仍以 focus 所在小节为命令起点。

## 8. 错误与边界场景

| 场景                                                        | 结果                             |
| ----------------------------------------------------------- | -------------------------------- |
| `4/4` 全休止小节改 `3/4`                                    | 成功，重建 3 个四分休止          |
| 有两个四分音符和尾部休止的 `4/4` 改 `3/4`                   | 成功，保留音符并补 1 个四分休止  |
| 四个四分音符填满的 `4/4` 改 `3/4`                           | 失败，真实内容超出容量           |
| 和弦标记位于 tick `3000` 的 `4/4` 改 `3/4`                  | 失败，和弦标记超出新容量         |
| `3/4` 改 `6/8`                                              | 容量相同，内容保持，连梁拍组改变 |
| 从第 3 小节以 `untilNextChange` 修改，后方第 5 小节已有变拍 | 只修改第 3、4 小节               |
| 多小节范围中第 4 小节无法缩短                               | 整条命令失败，第 3 小节也不改变  |
| 设置为当前有效拍号                                          | no-op，不增加 revision 和历史    |

## 9. Module 影响范围

```text
packages/lxm-editor/src/core/
  constants.ts                    # 可编辑拍号白名单与拍组 profile
  types.ts                        # scope type
  commands.ts                     # measure.setTimeSignature 分发与原子范围提交
  time-signature-change.ts        # 单小节容量协调深 Module
  rhythm.ts                       # 容量与拍组概念拆分
  rest-beats.ts                   # 复用休止 Beat 构造

packages/lxm-editor/src/layout/
  duration-beam-layout.ts         # 按拍组边界数组分梁
  time-signature-layout.ts        # 继续负责变更点显示

apps/website/
  components/EditorShell/         # 拍号与作用范围工具
  stores/editor-store.ts          # 失效尾部 rest selection 的局部回退
```

## 10. 验收标准

- 用户可将 focus 小节修改为 `2/4`、`3/4`、`4/4` 或 `6/8`；
- 单小节和延续到下一变更点两种范围符合文档顺序；
- 只自动重建尾部容量休止，真实音符和合法和弦标记不被静默修改；
- 任一目标无法协调时，多小节命令原子失败；
- 成功、失败、no-op、undo 和 redo 与 v4 历史语义一致；
- `3/4` 按四分音符、`6/8` 按两个附点四分音符拍组断开连梁；
- 拍号变化显示、measure 宽度、断行、命中和选区均来自最新 layout；
- 所有结构与语义校验、单元测试、类型检查、lint、build 和浏览器验收通过。
