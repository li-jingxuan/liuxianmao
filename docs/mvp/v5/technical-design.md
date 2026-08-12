# MVP v5 技术实现方案：吉他演奏技巧

## 1. 目标与基线

MVP v4.1 完成后，仓库已具备以下实现基础：

- `ILXMDocument` 是唯一持久化乐谱状态；
- 所有用户写入通过 `applyScoreCommand`，成功候选经过 schema 与语义校验；
- website store 只把成功且非 no-op 的 document 快照加入历史；
- Note 具有全局唯一稳定 ID，Beat 按 track、measure、tick 形成确定顺序；
- `buildLayout(document, options)` 统一生成 system、measure、Note、拍号、小节线、命中与选择几何；
- 自动断行可把领域小节边界投影为跨 system 的视觉结果；
- 页面只消费 layout，不自行计算节奏列和小节坐标。

v5 在这一基线上增加吉他技巧闭环：

```text
用户选择技巧与音符目标
  → technique.add / technique.update / technique.remove
  → 技巧规则 + schema + 全文档语义校验
  → 新 ILXMDocument / no-op
  → v4 history
  → buildLayout(document)
  → 技巧解析 + system 分段 + lane 分配 + SVG 几何
  → website 纯渲染
```

## 2. 产品语义与首版取舍

### 2.1 技巧分类

| 分类     | 类型                                    | 目标引用              | 首版视觉                         |
| -------- | --------------------------------------- | --------------------- | -------------------------------- |
| 双音连接 | `hammerOn`、`pullOff`                   | 起始 Note + 目标 Note | 上方弧线与 `H` / `P` 标签        |
| 双音连接 | `slideUp`、`slideDown`                  | 起始 Note + 目标 Note | 两个品位数字间的上/下斜线        |
| 双音连接 | `tie`                                   | 起始 Note + 目标 Note | 无文字弧线                       |
| 单音标记 | `bend`                                  | Note                  | 上方推弦曲线、箭头与 `Full` 标签 |
| 单音标记 | `vibrato`                               | Note                  | 音符上方短波浪线                 |
| 单音标记 | `naturalHarmonic`、`artificialHarmonic` | Note                  | 品位数字两侧 `< >` 与 `[ ]`      |
| 单音标记 | `tapping`                               | Note                  | 音符上方 `T`                     |
| 单音标记 | `trill`                                 | Note + 辅助 fret      | `tr`、辅助品位和短波浪线         |
| 整拍标记 | `strum`                                 | Beat                  | 和弦左侧直线扫弦方向记号         |
| 整拍标记 | `arpeggio`                              | Beat                  | 和弦左侧波浪线及上行/下行箭头    |
| 整拍标记 | `pickStroke`                            | Beat                  | 音符上方拨片上拨/下拨符号        |
| 区间标记 | `palmMute`                              | 起始 Beat + 结束 Beat | 上方 `P.M.` 与延续虚线           |
| 区间标记 | `letRing`                               | 起始 Beat + 结束 Beat | 上方 `let ring` 与延续虚线       |

首版 `bend` 固定表示全音推弦，持久化 `semitones: 2`。先保存参数而不只保存标签，避免未来播放或半音推弦扩展时反推文本。

### 2.2 连接约束

- 所有引用 Note 必须存在且位于命令指定的 track。
- `hammerOn`、`pullOff`、`slideUp`、`slideDown`、`tie` 的两端必须在同一根弦，起点严格早于终点。
- `hammerOn` 要求目标 fret 大于起始 fret；`pullOff` 要求目标 fret 小于起始 fret。
- `slideUp` 要求目标 fret 大于起始 fret；`slideDown` 要求目标 fret 小于起始 fret。
- `tie` 要求两端实际音高相同；同一 track、同一弦下等价为 fret 相同。
- `palmMute` 可覆盖多根弦上的演奏，但 Beat 端点仍必须按 track 的文档时间顺序递增。
- `strum`、`arpeggio` 的目标 Beat 必须为 notes 且至少包含两颗 Note；`pickStroke` 首版只用于恰好一颗 Note 的 Beat，避免与扫弦方向重复表达。
- `strum.stroke` 使用吉他演奏术语 `down/up`：down 表示从低音弦扫向高音弦，不能直接等同于 SVG Y 轴方向；视觉映射只由 layout 处理。
- `arpeggio.direction` 使用音高语义 `ascending/descending`，避免与扫弦手部方向混淆。
- 扫弦/琶音保留目标 Beat 的全部源 Note；按 [扫弦/琶音优先记谱 Fix](./strum-arpeggio-note-exclusivity-fix.md)，核心 layout 完成技巧与时值几何后，在最终投影中隐藏该 Beat 的品位文本。
- `tapping` 作用于一颗 Note；`trill` 保存主 Note 与 `auxiliaryFret`，不虚构第二个具有独立时值的 Note。辅助品位必须合法且不同于主品位。
- `palmMute` 与 `letRing` 改为稳定 Beat 区间引用；端点 Beat 必须为 notes、顺序递增，区间内不能经过全局 rest。
- 休止 Beat 不能作为任何技巧端点。
- `tie` 的目标必须位于紧接起始 Beat 之后的 Beat，可跨小节但中间不能有 Beat 或 rest；它表达前一时值持续到后一时值，而不是一般的相同音高连线。
- `hammerOn`、`pullOff` 和 slide 的目标必须是起点之后同弦的下一颗 Note，且两端之间不能经过全局 rest；页面快捷查询与领域校验复用同一个解析函数。

为了让“早于”“下一音”和跨小节规则只有一个事实来源，核心提供按以下键排序的 Note 索引：

```text
measure document index → beat.tick → note.string → note.id
```

双音技巧比较到 Beat 时间位置即可；同一 Beat 中的两个 Note 视为同时发生，不能互相连接。

### 2.3 叠加与重复规则

同一个 Note 可以同时拥有不同类别的技巧，例如自然泛音与颤音。首版限制如下：

- 相同 type、目标和参数的技巧只能存在一个；重复新增是 no-op。
- 同一 Note 最多一个泛音类型，`naturalHarmonic` 与 `artificialHarmonic` 互斥。
- 同一 `fromNoteId` 最多一个 `bend`、一个 `vibrato`。
- 同一 Note 最多一个 `tapping` 和一个 `trill`；`trill` 与从该 Note 开始的 H/P 首版互斥，避免同一段连奏重复表达。
- 同一 `fromNoteId` 最多一个向外连接的 `hammerOn/pullOff`，最多一个向外连接的 `slideUp/slideDown`，最多一个向外 `tie`。
- 同一 Beat 最多一个 `strum` 或 `arpeggio`，二者互斥；单音 Beat 最多一个 `pickStroke`。
- 相同类型和起止 Beat 的区间标记不重复创建；`palmMute` 与 `letRing` 的时间区间不能相交，因为“闷住”和“保持振动”是冲突的演奏指令。同类型区间可以并存，由 lane 分配避免重叠。

这些限制由领域命令和语义校验共同保证，页面 disabled 状态只用于提前反馈，不能成为唯一守卫。

### 2.4 新增常用技巧的优先级

本轮扩展按“TAB 输入频率、模型独立性、能否复用现有 layout”排序：

| 优先级 | 能力                        | 决策                  | 原因                                                          |
| ------ | --------------------------- | --------------------- | ------------------------------------------------------------- |
| P0     | 扫弦、琶音                  | v5 实现               | 都锚定和弦 Beat，但直线扫弦与波浪琶音具有不同演奏和视觉语义   |
| P0     | Let Ring                    | v5 实现               | 与 P.M. 同属可跨 system 的吉他文本线，可复用区间与续接 layout |
| P1     | 点弦、颤音奏、拨片方向      | v5 实现               | 分别补齐单音、带参数单音和单音 Beat 的常用演奏标记            |
| 后续   | 轮指/震音拨弦               | v5.1 候选             | 会表达时值内重复次数并影响 rhythm lane，应与节奏模型共同设计  |
| 后续   | 幽灵音、死音、倚音          | 独立 Note/Rhythm 候选 | 它们改变 Note 外观或时间结构，不应伪装成 track technique      |
| 后续   | 摇把、拍弦/勾弦（slap/pop） | 高级技巧候选          | 需要曲线预设、力度或乐器适用范围，超过当前固定参数 MVP        |

记谱取舍参考常见编辑器的对象归属：arpeggio/strum 作用于和弦并具有可调纵向跨度；P.M.、Let Ring、Vibrato 属于可延续的吉他线；短 trill 是单音 ornament，长 trill line 则是范围对象。可核对 MuseScore Studio Handbook 的 [Arpeggios and glissandos](https://handbook.musescore.org/fr/notation/expressive-markings/arpeggios-and-glissandos)、[Other lines](https://handbook.musescore.org/notation/expressive-markings/other-lines) 与 [Ornaments](https://handbook.musescore.org/notation/expressive-markings/ornaments)。v5 只实现上表明确列出的简化形式，不复制外部编辑器的全部属性。

### 2.5 圆滑线（Slur）与延音线（Tie）

Slur 和 Tie 视觉上都是弧线，但领域语义不能合并：

| 记号     | 领域含义                                         | 音高要求       | 时间要求                          | v5 决策                 |
| -------- | ------------------------------------------------ | -------------- | --------------------------------- | ----------------------- |
| Tie      | 同一音高跨两个写法时值持续发声，目标音不重新起音 | 同弦、同 fret  | 目标 Beat 紧接起始 Beat，可跨小节 | 实现                    |
| Slur     | 一段乐句或发音法范围，不改变任何 Note 时值       | 可不同音高     | 可跨多个 Note，可能嵌套           | 不实现                  |
| H/P 弧线 | 明确的吉他左手击弦/勾弦动作                      | 同弦且方向合法 | 同弦下一颗 Note，中间无 rest      | 实现，以 `H` / `P` 区分 |

通用 Slur 不进入 MVP v5，原因是当前最高频的 TAB 连奏已经由 H/P 覆盖；若同时开放无标签 Slur，用户很难区分它与 Tie，领域层还必须新增嵌套范围、弧线方向、与 H/P 重叠优先级以及乐句级编辑。它不影响 v5 的技巧输入闭环，投入产出比不足。

未来若加入 Slur，应作为独立的 phrasing Module，保存起止 Note 引用并复用 v5 的弧线分段与 lane adapter；不应把 Slur 伪装成 Tie，也不应通过 `hammerOn` / `pullOff` 的空标签表达。

### 2.6 连音组（Tuplet）版本归属

中文“连音”容易同时指 Slur/连奏和三连音。三连音、四连音等 Tuplet 不是演奏技巧，而是改变 Beat 实际时长的节奏结构。它会同时影响：

- `calculateRhythmTicks` 和持久化 `beat.tick`；
- 小节容量、尾部休止生成和 rhythm 修改；
- 连梁分组、数字/括号和 rhythm lane 高度；
- 小节复制、拍号变更、撤销以及语义校验。

因此 v5 不实现 Tuplet，建议在 v5 后、歌词和和弦之前增加独立的 MVP v5.1 节奏补丁。仓库已有 duplet/triplet/quadruplet 等工具图标，只代表视觉资产可用，不代表领域时间模型已经支持。

v5.1 推荐的外部 seam 是小节内连音组，而不是给每个 Beat 重复保存比例：

```ts
type ILXMTupletRatio =
  | { actual: 2; normal: 3 }
  | { actual: 3; normal: 2 }
  | { actual: 4; normal: 3 }
  | { actual: 5; normal: 4 }
  | { actual: 5; normal: 3 }
  | { actual: 6; normal: 4 };

interface ILXMTuplet {
  id: string;
  beatIds: string[];
  ratio: ILXMTupletRatio;
}

interface ILXMMeasure {
  // 既有字段保持
  tuplets: ILXMTuplet[];
}
```

首批开放明确比例 `2:3`、`3:2`、`4:3`、`5:4`、`5:3`、`6:4`，使用 union 避免组合出未定义的 `2:2`、`6:3` 等比例。一个 group 的 Beat 数必须等于 `actual`，成员必须位于同一 measure、按时间连续、不嵌套、不重叠，首版使用相同无附点 base rhythm；允许成员是 rest。实际时长按“书写时值 × normal / actual”计算，所有结果必须是整数 tick 且小节容量精确闭合。

建议命令使用稳定的首尾 Beat 引用：

```ts
type ILXMSetTupletCommand = {
  type: "tuplet.set";
  trackId: string;
  measureId: string;
  startBeatId: string;
  endBeatId: string;
  ratio: ILXMTuplet["ratio"];
};

type ILXMRemoveTupletCommand = {
  type: "tuplet.remove";
  trackId: string;
  measureId: string;
  tupletId: string;
};
```

命令内部展开连续 Beat、重算 group 与后续 Beat tick、验证容量并原子提交。`beat.setRhythm` 若只修改 group 中一个成员会破坏 group，首版应返回 `BEAT_IN_TUPLET`，由整组编辑入口处理；`measure.copy` 复制 group 并重建 tuplet/Beat 引用；拍号缩容若无法保留整个 group 则拒绝。

layout 在 rhythm lane 输出数字与可选括号：连续连梁已清楚覆盖整个 group 时只显示数字，否则显示带两端短钩的 bracket。Tuplet 首版禁止跨 measure，因此自然不会跨 system；这条限制避免同时引入跨行节奏括号和不完整小节语义。

## 3. 文档模型

### 3.1 独立技巧实体

技巧属于 track，而不是 Note 的内嵌字段：

```ts
export const LXM_TECHNIQUE_TYPES = [
  "hammerOn",
  "pullOff",
  "slideUp",
  "slideDown",
  "bend",
  "vibrato",
  "naturalHarmonic",
  "artificialHarmonic",
  "palmMute",
  "tie",
  "tapping",
  "trill",
  "strum",
  "arpeggio",
  "pickStroke",
  "letRing",
] as const;

type ILXMTechnique =
  | {
      id: string;
      type: "bend";
      fromNoteId: string;
      semitones: 2;
    }
  | {
      id: string;
      type: "vibrato" | "naturalHarmonic" | "artificialHarmonic" | "tapping";
      fromNoteId: string;
    }
  | {
      id: string;
      type: "trill";
      fromNoteId: string;
      auxiliaryFret: number;
    }
  | {
      id: string;
      type: "hammerOn" | "pullOff" | "slideUp" | "slideDown" | "tie";
      fromNoteId: string;
      toNoteId: string;
    }
  | {
      id: string;
      type: "strum";
      beatId: string;
      stroke: "down" | "up";
    }
  | {
      id: string;
      type: "arpeggio";
      beatId: string;
      direction: "ascending" | "descending";
    }
  | {
      id: string;
      type: "pickStroke";
      beatId: string;
      stroke: "down" | "up";
    }
  | {
      id: string;
      type: "palmMute" | "letRing";
      fromBeatId: string;
      toBeatId: string;
    };

interface ILXMTrack {
  // 既有字段保持
  techniques: ILXMTechnique[];
}
```

选择该模型的理由：

- 一个技巧只有一个稳定实体和 ID，不会在起止 Note 上保存互相可能漂移的副本；
- 跨小节和跨 system 不需要特殊持久化结构；
- 删除、更新、历史、schema 和语义校验均以技巧为原子对象；
- layout 可以先建立 Note/Beat 的时间与几何索引，再统一投影技巧；
- Note 和 Beat interface 不因十六种技巧膨胀为大量可空字段。

代价是 Note 删除需要处理引用完整性。v5 明确采用领域命令级联删除相关技巧；外部非法 JSON 则由语义校验拒绝。

### 3.2 Schema 与版本策略

- `ILXMTrack.techniques` 为必填数组；项目当前不维护旧版本迁移链，所有内置示例与测试 fixture 同步补齐。
- 技巧 schema 使用按 `type` 判别的 discriminated union，并对对象执行 `strict()`。
- `id` 进入既有全局实体 ID 唯一性校验。
- Note/Beat 引用不参与实体 ID 注册，但必须解析到当前 track；引用种类必须匹配技巧判别类型。
- 若仓库在实现 v5 前启用 schema 版本升级策略，则随该策略提升版本；否则保持现有一次性同步策略，不在 loader 中偷偷填默认值。

## 4. Technique 领域 Module

### 4.1 外部 interface

页面只提交明确目标和技巧参数，不提交小节索引、tick、路径、lane 或受影响对象列表：

```ts
enum LXMScoreCommandEnum {
  AddTechnique = "technique.add",
  UpdateTechnique = "technique.update",
  RemoveTechnique = "technique.remove",
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type ILXMTechniqueDraft = DistributiveOmit<ILXMTechnique, "id">;

interface ILXMAddTechniqueCommand {
  type: LXMScoreCommandEnum.AddTechnique;
  trackId: string;
  technique: ILXMTechniqueDraft;
}

interface ILXMUpdateTechniqueCommand {
  type: LXMScoreCommandEnum.UpdateTechnique;
  trackId: string;
  techniqueId: string;
  technique: ILXMTechniqueDraft;
}

interface ILXMRemoveTechniqueCommand {
  type: LXMScoreCommandEnum.RemoveTechnique;
  trackId: string;
  techniqueId: string;
}
```

这是 v5 的主要外部 seam。Module implementation 隐藏 Note/Beat 索引、音乐规则、互斥关系、ID 分配、不可变 track 替换和最终校验。测试也从 `applyScoreCommand` 穿过同一 interface，不绕过它断言私有辅助函数。

### 4.2 命令语义

`technique.add`：

1. 查找 track 和技巧需要的全部 Note/Beat 引用；
2. 执行类型特定规则与叠加规则；
3. 检测完全重复；重复时返回原 document、原 revision 和 `changed: false`；
4. 使用 document ID factory 创建技巧 ID；
5. 只复制目标 track 分支，增加一次 revision；
6. 执行 schema 与全文档语义校验。

`technique.update`：

- `techniqueId` 必须属于指定 track；
- 保留原技巧 ID，只替换 draft 中的类型、端点与参数；
- 允许修改类型，但候选结果必须重新通过所有规则；
- 与原值完全相同是 no-op；
- 更新后若与另一个既有技巧冲突，原子失败。

`technique.remove`：

- 找不到 track 返回 `TRACK_NOT_FOUND`；
- 找不到技巧返回 `TECHNIQUE_NOT_FOUND`；
- 成功删除一项、增加一次 revision 并产生一条历史；
- 页面再次删除过期目标按 not-found 失败，不把竞态掩盖为 no-op。

建议新增错误码：

```ts
type ILXMScoreCommandErrorCode =
  | ExistingErrorCode
  | "TECHNIQUE_NOT_FOUND"
  | "TECHNIQUE_NOTE_NOT_FOUND"
  | "TECHNIQUE_BEAT_NOT_FOUND"
  | "TECHNIQUE_TARGET_INVALID"
  | "TECHNIQUE_NOTES_NOT_ORDERED"
  | "TECHNIQUE_REQUIRES_SAME_STRING"
  | "TECHNIQUE_REQUIRES_SAME_PITCH"
  | "TECHNIQUE_DIRECTION_MISMATCH"
  | "TECHNIQUE_CONFLICT";
```

所有失败保持 document、revision、历史和当前 selection 不变。

### 4.3 同弦下一音解析

核心提供纯查询 Module：

```ts
findNextNoteOnSameString(
  document: ILXMDocument,
  trackId: string,
  fromNoteId: string,
): ILXMNoteReference | null;
```

它按文档时间顺序返回严格晚于起始 Beat 的第一颗同弦 Note，可以跨越没有该弦 Note 的普通 Beat 和小节；遇到全局 rest 时返回 `null`。system 是 layout 结果，不参与查询。页面的“连接到同弦下一音”快捷操作先调用该查询，再提交包含明确 `toNoteId` 的命令。查询失败只显示错误，不产生领域写入。

### 4.4 既有编辑命令与引用完整性

持久化引用不能因已有命令产生悬挂：

- `note.remove` / `note.removeRect`：删除 Note 的同一原子命令内，级联删除所有引用该 Note 的技巧；
- 删除 Note 后若 Beat 已不满足整拍技巧约束，例如和弦只剩一颗 Note，则同一命令级联删除该 Beat 的 `strum` / `arpeggio`；
- `beat.setKind` 变为 rest：清空 notes，并删除该 Beat 上的单音/连接/整拍技巧，以及以该 Beat 为端点或经过该 Beat 的区间技巧；
- `measure.remove`：级联删除引用该小节任意 Note/Beat 的技巧；
- `measure.copy`：复制 Note 并重建 Note ID，但不复制技巧；技巧可能跨越源小节边界，自动复制会产生含糊语义；
- `measure.insert`：新 track 技巧不变；
- `beat.setRhythm` 和 `measure.setTimeSignature`：只要保留真实 Note ID，技巧引用保持；若未来算法会删除真实 Note，必须显式拒绝或复用同一引用清理函数。

将“根据候选 track 重新解析并裁剪已失效技巧”做成核心内部纯函数，由允许级联的删除路径复用。它必须区分两类结果：因用户删除内容而失效的依赖可以随同删除；用户直接 add/update 一个非法技巧仍必须返回错误，不能被静默过滤。

## 5. 语义校验

`validateDocumentSemantics` 在建立每个 track 的 Note/Beat 索引后校验技巧：

- 技巧实体 ID 全文档唯一；
- 每个 Note/Beat 引用存在且属于当前 track；
- 连接、单音、整拍和区间类型只具有各自允许的引用与参数字段（schema 负责形状）；
- 同弦、时间顺序、品位方向与 tie 同音规则成立；
- bend 固定 `semitones: 2`；
- strum/arpeggio 的和弦数量、pickStroke 的单音数量、trill 辅助品位和区间无 rest 规则成立；
- 重复和互斥规则成立。

新增语义 issue code 与命令错误保持可映射，但语义校验返回精确 path，例如：

```text
score.tracks.0.techniques.3.toNoteId
```

loader 遇到悬挂引用或非法关系必须失败；layout 不静默跳过非法技巧来伪造成功加载。

## 6. Layout Module

### 6.1 布局阶段

技巧可能跨 measure 和 system，也会改变垂直空间。因此 layout 使用明确的多阶段 pipeline：

```text
1. measure intrinsic width + system 贪心断行
2. measure / Note 的最终 X 与 system 内局部 Y 几何
3. 建立 noteId → systemIndex + local x/y + beat 位置索引
4. 把领域技巧投影为每个 system 内的候选 segment
5. 按碰撞区间分配 technique lane
6. 生成最终 path / text / continuation 几何
7. 用 lane 高度确定每个 system.height 和下一 system.y
8. 构建 hit index 与整谱 width / height
```

当前 `layoutSystems` 在布局一行后立即累计 `systemY`。v5 应把“横向 system 规划”和“纵向 system 定位”拆成内部阶段，或在生成技巧后统一平移后续 system。推荐前者：断行与 X 坐标是第一阶段的纯结果，所有 vertical lane 都完成后再一次性分配 Y，减少后续歌词、和弦 lane 接入时的返工。

`buildLayout(document, options)` 仍是唯一主要外部 interface；新增阶段属于其 implementation，不暴露给 website。

### 6.2 Layout 输出

系统级输出最适合表达跨小节技巧：

```ts
type ILXMTechniqueContinuation = "none" | "fromPrevious" | "toNext" | "both";

interface ILXMTechniquePathLayout {
  d: string;
  strokeWidth: number;
  dashArray?: string;
  markerEnd?: "arrow";
}

interface ILXMTechniqueSegmentLayout {
  techniqueId: string;
  type: ILXMTechnique["type"];
  systemIndex: number;
  segmentIndex: number;
  continuation: ILXMTechniqueContinuation;
  lane: number;
  path: ILXMTechniquePathLayout | null;
  texts: ILXMTextLayout[];
}

interface ILXMSystemLayout {
  // 既有字段保持
  techniques: ILXMTechniqueSegmentLayout[];
  techniqueLaneCount: number;
}
```

路径以 SVG `d` 返回，页面不根据类型拼折线、弧线、波浪或箭头。`key` 使用 `techniqueId + segmentIndex`。

泛音是 Note 文本装饰，layout 仍将它们标准化为 technique segment，以便所有技巧共用同一渲染和选择入口；其 `lane` 可固定为 `-1`，表示占用 staff 内局部空间而非上方 lane。

### 6.3 跨 system 分段

- 单音技巧只有一个 segment，不跨 system。
- 双端点在同一 system 时生成一个完整 segment，`continuation: "none"`。
- 双端点跨 system 时：起点 system 从起点延伸到 staff 右侧净空，使用 `toNext`；中间 system 从 staff 左侧净空延伸到右侧净空，使用 `both` 并输出两个短续接标记；终点 system 从 staff 左侧净空延伸到终点，使用 `fromPrevious`。
- 续接端使用短缺口或钩形端点，明确表示该技巧仍在前/后 system 延续；标签只在首 segment 出现，避免每行重复 `H`、`P` 或 `P.M.`。
- segment 端点使用 system 的真实 `header.staffX` 与最后小节视觉右边界，不假设 `systemWidth`。
- 改变 `systemWidth` 只重算 segment 数量与几何，不改写 `track.techniques[]`。

Tie 和其他连接技巧共享 segment interface，但使用不同的续接模板：

- Tie 同 system 时，从起始 fret 文本右侧到目标 fret 文本左侧生成一条浅弧线；弧线不能穿过品位数字。
- Tie 跨 system 时，行尾段从起始 Note 延伸到当前 staff 的右侧安全边，下一行段从 `header.staffX` 后的安全边延伸到目标 Note。由于 Tie 强制连接相邻 Beat，它最多跨一次 system，不会产生中间行。
- Tie 的跨行端保持开放弧线，不绘制箭头、文字或人为钩子；两段弧线的切线方向要让读者能识别它们是同一持续关系。
- H/P 跨行沿用相同的开放弧线分段，但 `H` / `P` 标签只出现在首段；palm mute 与 let ring 保持各自文本和虚线并使用短垂直结束钩；slide 使用朝目标方向的短斜线续接，不冒充 Tie 弧线。
- 每个 Tie 无论产生几个 segment，命中任一段都返回同一个 `techniqueId`；换行永远不生成额外领域实体或历史记录。

### 6.4 Lane 与基础碰撞规避

除滑音、泛音、扫弦和琶音外，技巧放在六线谱上方的 system technique area：

- 每个 segment 先计算包含文字和 stroke 外延的水平碰撞区间 `[x1, x2]`；
- 按 `x1`、`x2`、`techniqueId` 稳定排序；
- 使用 first-fit interval partitioning 分配最低可用 lane；同 lane 的区间必须保留固定水平净空；
- 越大的 lane 越远离 staff，lane 高度和间距使用 `layout-constants.ts` 集中配置；
- bend 曲线、vibrato、tapping、trill、pickStroke、hammer/pull/tie 弧线、palm mute 和 let ring 使用同一 lane 分配器；
- slide 位于同弦两个 fret 文本之间，不占 system 上方 lane，但其端点避开文本包围区；
- natural/artificial harmonic 扩大对应 Note 的文本装饰范围，不改变 Beat X；
- strum/arpeggio 位于和弦左侧并纵向覆盖该 Beat 的最高、最低目标弦；strum 使用直线方向记号，arpeggio 使用波浪线，direction 决定可选箭头；二者不占上方 lane；源 Note 先参与跨度与时值计算，再从最终可见 Note layout 中移除；
- strum 的 down/up 是演奏手方向，arpeggio 的 ascending/descending 是音高方向；layout 结合 TAB 弦序映射到最终箭头，不允许页面直接把枚举值映射为 SVG `y1/y2`；
- technique area 高度进入 system.height，相邻 system 的 Y 位置必须在该高度确定后计算；
- v5 只处理技巧彼此、TAB 行头、拍号、staff 与页面裁切的碰撞。歌词、和弦名称等 v6 lane 尚不存在。

首版不做任意曲线优化；使用固定模板和确定性 lane 算法，以相同 document/options 得到完全相同几何。

### 6.5 横向宽度

技巧通常不改变节奏列宽，避免长跨音连线把小节无意义撑宽。仅以下局部标记可贡献最小宽度：

- 泛音括号后的 fret 文本包围宽度；
- 极短距离的 `H` / `P` 标签；
- bend 的起点箭头与 `Full` 文本。
- strum/arpeggio 在和弦左侧的纵向记号及其水平净空。

实现时扩展 `summarizeMeasureSpacingWidth` 的内部 contributor，而不是从 website 传 `widthContributors`。贡献按 Beat ID 汇总到节奏列最小宽度；长区间的 path 本身不贡献宽度。

## 7. 页面交互与历史

### 7.1 目标解析

既有 selection 是 Beat × String 单元格范围。页面从 selection 稳定解析技巧目标：

- 单音技巧：使用 focus 单元格中的 Note；空单元格禁用并显示“请先输入品位”；
- tapping 使用 focus Note；trill 还要求用户选择合法辅助品位；
- 双音技巧：若选区在同一弦且起止单元格都有 Note，按文档顺序作为两端；
- 双音快捷：折叠选区时可使用“连接到同弦下一音”；
- strum/arpeggio：使用 focus Beat，要求该 Beat 至少两颗 Note；pickStroke 要求单音 Beat；
- palm mute/let ring：使用选区首尾 Beat；跨弦矩形允许，弦范围不进入持久化目标；
- 点击已渲染技巧进入临时 `selectedTechniqueId`，可修改或删除；该 UI 状态不进入 document/history。

技巧需要可点击，因此 layout 的技巧 segment 增加稳定命中 bounds，或把 `ILXMHitIndex` 扩展为 `techniqueBounds`。页面不能从 SVG DOM event target 反推领域端点。

### 7.2 工具栏

- 新增“技巧”分组，使用完整中文名称和 `aria-label`；
- 可用状态由当前稳定 selection、Note 是否存在及核心查询结果决定；
- 连接技巧提供“使用选区两端”和“连接同弦下一音”两种明确动作；
- 扫弦提供下扫/上扫，琶音提供上行/下行，拨片方向提供下拨/上拨；术语完整显示，不能只靠易混淆的箭头图标；
- trill 的辅助品位使用受限数字输入并由核心校验；
- 选中既有技巧时显示类型、起止目标摘要、更新与删除入口；
- 领域失败沿用 store `errorMessage`；页面不吞掉错误或自行修正端点；
- v5 可以先使用文本按钮/下拉，不以绘制完整技巧图标作为功能完成前置条件。

### 7.3 历史和选区

- 每次 add/update/remove 是一条历史；no-op 和失败不进入历史；
- undo/redo 从 document 重新派生技巧 layout；
- 技巧命令不改变 TAB selection；
- 删除 Note 导致技巧级联删除时，音符删除和全部关联技巧删除仍是同一条历史；
- `selectedTechniqueId` 在技巧删除或历史切换后失效时清空，不回退到其他技巧；
- 工具展开、hover、选中技巧和错误提示不进入历史。

## 8. Module 与文件影响

```text
packages/lxm-editor/src/
  core/
    constants.ts                 # 技巧类型与 bend 参数白名单
    types.ts                     # ILXMTechnique discriminated union
    schema.ts                    # technique schema、track.techniques
    technique-rules.ts           # Note/Beat 索引、目标规则、冲突和下一同弦音
    commands.ts                  # add/update/remove 与候选 track 引用裁剪
    semantic-validation.ts       # 引用完整性、顺序、冲突
    id-factory.ts                # technique ID
  layout/
    technique-layout.ts          # 分段、弧线、扫弦/琶音及局部标记
    technique-lanes.ts           # 确定性区间 lane 分配
    layout-types.ts              # system technique 输出和 hit bounds
    layout-constants.ts          # lane、标签、曲线和净空常量
    measure-spacing.ts           # 局部技巧宽度 contributor
    system-layout.ts             # 横向规划与纵向定位分阶段
    hit-test.ts                  # 技巧命中索引
  index.ts                       # 公开类型、命令与纯查询

packages/lxm-editor/example/
  example-mvp5.json.ts           # 覆盖全部技巧及跨小节/system

apps/website/
  stores/editor-store.ts         # selectedTechniqueId 临时状态协调
  components/EditorShell/        # 工具栏、技巧 SVG 与命中交互
```

`technique-rules.ts` 是领域深 Module；`technique-layout.ts` 是几何深 Module。不要为每一种技巧建立一个只有一两个透传函数的公开 Module。不同路径模板可作为 layout implementation 的私有纯函数。

## 9. 测试策略

### 9.1 Schema 与语义

- 十六种技巧的合法最小对象与方向/辅助品位参数；
- 缺字段、多余字段、非法 type、非法 bend 参数；
- 技巧 ID 重复、悬挂 Note/Beat、跨 track 引用；
- 同 Beat、逆序、非法跨弦、方向错误、tie 异音；
- tie 非相邻 Beat、跨休止，以及 H/P/slide 跳过同弦下一音；
- strum/arpeggio 目标不是和弦、pickStroke 目标不是单音 Beat、trill 辅助品位非法；
- palm mute 与 let ring 区间相交、区间经过 rest；
- 重复与互斥技巧；
- 内置 v2-v4.1 fixture 同步后继续通过 loader。

### 9.2 领域命令

- 每种技巧 add 的成功分支；
- update 保留 ID，允许合法换型，拒绝冲突；
- remove、not-found、no-op、revision 与不可变引用；
- “同弦下一音”可跨普通 Beat 和小节、遇到 rest 截止，并且不依赖 system 分组；
- note/removeRect、rest、measure.remove 的级联；
- measure.copy 不复制技巧；
- 命令失败不产生部分修改。

### 9.3 Layout

- 每种技巧的确定性 path/text 输出；
- strum 直线与 down/up 映射、arpeggio 波浪线与 ascending/descending 箭头、和弦垂直跨度；
- strum/arpeggio 目标 Beat 的源 Note 保持不变，但最终 layout 不输出对应品位 Note；删除技巧后品位自然恢复；
- tapping `T`、trill 辅助品位/波浪、pickStroke 符号和 let ring 虚线；
- slide 上/下方向、tie/H/P 弧线、bend 箭头、vibrato、泛音括号和 palm mute 虚线；
- 同 system、跨一个 system、跨多个 system 的 segment 与 continuation；
- Tie 行尾/下一行开放弧线和端点文字净空；H/P、slide、palm mute、let ring 覆盖多 system 时的中间 `both` 分段；
- 调整 `systemWidth` 后领域数据不变、segment 重新投影；
- 重叠区间进入不同 lane，不重叠区间复用 lane；
- technique area 扩大 system height，后续 system 不碰撞；
- 紧凑/舒适密度、稀疏末行、超宽小节和跨行反复线组合；
- Note、技巧 hit bounds 与最终视觉坐标一致。

### 9.4 Store 与页面

- add/update/remove 各产生一条历史；
- no-op、失败不进入历史；
- 级联删除仍只有一条历史；
- undo/redo 恢复技巧并重新 layout；
- 空单元格、非法选区和找不到下一音时的 disabled/error；
- 技巧命中、选择、删除及 history 后临时选择协调；
- 页面不读取相邻 measure 或拼装技巧 SVG 路径。

## 10. 性能与确定性

- 每次 `buildLayout` 先用一次线性遍历建立 Note/Beat 索引，避免每个技巧反复扫描全文档；
- 技巧规则解析为 `O(beats + notes + techniques)`；lane 分配首版使用按区间排序后的确定性扫描，MVP 数据量下足够；
- path 和 hit bounds 随 layout 一次生成，不在 React render 中重复计算；
- 所有排序都有稳定 tie-breaker，禁止依赖对象键枚举或 SVG DOM 测量；
- 文本宽度首版使用核心集中常量或确定性估算，不引入浏览器字体测量 seam。

## 11. 风险与控制

| 风险                          | 控制方式                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| 技巧引用因删除命令悬挂        | 删除路径统一复用候选 track 引用裁剪；最终语义校验兜底                   |
| system Y 在技巧布局后整体漂移 | 拆分横向规划和纵向定位，最终几何只生成一次                              |
| 多种技巧叠加遮挡              | system 级 lane 分配、稳定排序与统一净空                                 |
| 跨 system 逻辑污染持久化模型  | 仅 layout 分段，领域实体保持单一                                        |
| 页面与核心重复判断合法性      | 页面只做即时可用性提示，核心命令与语义校验拥有最终规则                  |
| `EditorShell` 继续膨胀        | 将技巧工具和技巧 SVG layer 拆为函数式 React 子模块，props 只传结果/事件 |
| v6 文本 lane 接入时返工       | v5 先建立通用 vertical lane 概念，但只实现 technique lane adapter       |

## 12. 验收标准

- 十六种技巧都可新增、修改、删除、保存于 document，并可撤销/重做；
- 刷新式重新加载与重新 layout 后，技巧类型、端点和视觉一致；
- 不存在的目标、非法跨弦、同 Beat、逆序、方向错误和异音 tie 被原子拒绝；
- 同弦下一音快捷连接可跨普通 Beat 和小节稳定工作，遇到 rest 明确拒绝；
- 扫弦、琶音和拨片方向锚定 Beat；布局正确区分演奏手方向、音高方向与 SVG 坐标方向；
- 扫弦、琶音不删除或改写源 Note；最终屏幕与打印投影隐藏目标 Beat 的品位文本，删除技巧后重新显示；
- tapping、trill 与 let ring 的参数、互斥、区间和跨 system 续接符合规则；
- 音符、Beat 或小节删除不会留下悬挂技巧引用；
- 技巧跨 measure、跨一个或多个 system 时具有明确续接视觉；
- 重叠技巧分配到不同 lane，且不与 TAB 行头、拍号、staff、相邻 system 或页面边缘碰撞；
- website 不推导技巧关系、断行分段、lane 或 SVG 路径；
- 全量测试、TypeScript 检查、lint、build 和固定桌面浏览器验收通过。

## 13. 明确不在 v5 解决的问题

- 技巧的真实音频播放、MIDI 弯音和发音法；
- 半音/一音半等自由推弦参数与复杂推弦链；
- 无目标滑音、跨弦连奏和任意曲线控制点；
- 通用 Slur、乐句范围、嵌套弧线和自动弧线方向；
- Tuplet 连音组；按独立 MVP v5.1 节奏补丁实现；
- 技巧复制粘贴、批量技巧变换和跨轨道技巧；
- v6 的歌词、和弦名称、和弦图碰撞；
- 移动端、响应式、多页打印和服务端字体测量。
