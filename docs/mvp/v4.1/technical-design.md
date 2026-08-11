# MVP v4.1 技术实现方案：基础谱面标识与小节边界

## 1. 目标与现状

MVP v4 已完成 TAB 单元格矩形选择、批量品位编辑和只记录 `ILXMDocument` 的撤销历史。当前核心还具备以下基础：

- `ILXMMeasure.timeSignature` 已保存拍号，并参与小节容量、休止符生成和连梁分组；
- `ILXMMeasure.barline` 已支持 `single`、`double`、`final`、`repeatStart`、`repeatEnd`、`repeatBoth`；
- `barline-layout.ts` 已为六类小节线生成线段和反复点几何；
- website 已按 layout parts 渲染小节线；
- system 自动断行已有稳定的最终坐标、宽度分配与命中索引。

缺口不在六类小节线的基础绘制，而在谱面标识和完整编辑闭环：

- system 没有为 `TAB` 行头保留空间；
- 拍号只参与音乐计算，没有可渲染的 layout；
- 用户无法通过领域命令修改小节边界；
- “开始反复线”只能挂在小节右侧，无法表达整首谱第一小节之前的边界。

本补丁建立如下数据流：

```text
ILXMDocument
  → buildLayout(document)
  → system header + measure time signature + barline geometry
  → website 只消费 layout

用户选择边界
  → barline.setBoundary
  → schema + semantic validation
  → 新 ILXMDocument / no-op
  → v4 history
  → buildLayout(document)
```

## 2. 产品显示规则

### 2.1 TAB 行头

- 每条非空 system 都显示纵向排列的 `T`、`A`、`B` 三个字母。
- 三个字母位于六线谱内部，分别覆盖 staff 的上、中、下区域。
- 六根弦线从 system 左边缘贯穿 TAB 谱号列，再与第一小节弦线无缝衔接；行头不表现为独立空白块。
- TAB 谱号列仍保留最小必要宽度，避免字母与拍号、反复线或第一拍碰撞。
- `system.width` 继续表示整条谱面行的目标宽度，包含行头和 measure 内容区。
- 空轨道不生成只有 `TAB` 的空 system。

核心 layout 返回三个字母、行头弦线、坐标、字号和对齐方式。website 不使用 CSS margin 或固定 transform 临时把小节向右推移。

### 2.2 拍号

按文档中的 measure 顺序决定是否展示：

1. 第一小节始终展示拍号；
2. 当前小节拍号与前一小节不同时展示；
3. 普通自动换行不会导致相同拍号在 system 开头重复展示；
4. 拍号变化恰好发生在 system 首小节时，正常展示新拍号；
5. 分子在上、分母在下，二者共享水平中心，并与 TAB 六线区域垂直对齐。

基础补丁不增加拍号编辑。原因是拍号写入会同时影响小节容量、Beat 时间轴、休止符分解和连梁分组，
不能作为纯显示步骤中的顺手功能。该闭环由后续
[拍号编辑与小节容量协调 Fix](./time-signature-editing-fix-technical-design.md) 独立设计和实施。

### 2.3 小节线

本补丁保留并开放全部既有类型：

| 类型          | 显示含义                       | v4.1 |
| ------------- | ------------------------------ | ---- |
| `single`      | 普通小节分隔                   | 实现 |
| `double`      | 乐句、段落或结构边界           | 实现 |
| `final`       | 乐曲或段落终止                 | 实现 |
| `repeatStart` | 下一小节开始反复               | 实现 |
| `repeatEnd`   | 当前反复段结束                 | 实现 |
| `repeatBoth`  | 结束前一反复段并开始下一反复段 | 实现 |

这些类型只承诺可编辑、可保存和可稳定渲染。v4.1 不验证开始/结束反复是否成对，不执行播放反复，也不推导第一、第二结尾房子。

## 3. 领域模型与小节边界语义

### 3.1 保留小节右边界

现有字段继续保留，但补充明确 interface 语义：

```ts
interface ILXMMeasure {
  id: string;
  timeSignature: ILXMTimeSignature;
  /** 该小节之后的结构边界。 */
  barline: ILXMBarlineType;
  chordSymbols: ILXMChordSymbol[];
  beats: ILXMBeat[];
}
```

因此：

- `repeatStart` 表示其后一个小节开始反复；
- `repeatEnd` 表示当前小节处结束反复；
- `repeatBoth` 表示同一边界同时结束上一段并开始下一段。

### 3.2 增加轨道起始边界

第一小节之前没有前置 measure，无法复用 `measure.barline`。在 track 增加专用字段：

```ts
export const LXM_TRACK_START_BARLINE_TYPES = ["none", "repeatStart"] as const;

type ILXMTrackStartBarlineType = (typeof LXM_TRACK_START_BARLINE_TYPES)[number];

interface ILXMTrack {
  id: string;
  name: string;
  instrument: ILXMInstrumentType;
  tuning: ILXMTuning;
  /** 只描述第一小节之前的边界。 */
  startBarline: ILXMTrackStartBarlineType;
  measures: ILXMMeasure[];
}
```

`none` 保持当前谱首视觉，`repeatStart` 表达第一小节从谱首开始反复。该字段必须进入 schema、fixture 和 loader 测试。项目不维护旧版本迁移链，因此实现时必须按仓库既有 schema 版本策略一次性同步所有内置文档，不能在 layout 中偷偷补默认值。

不把左右小节线同时存入相邻 measure，避免同一共享边界出现两个互相冲突的数据来源。

### 3.3 统一边界引用

页面和 Store 只传稳定边界引用，不直接理解字段落点：

```ts
type ILXMBarlineBoundaryReference =
  | {
      kind: "trackStart";
    }
  | {
      kind: "afterMeasure";
      measureId: string;
    };

type ILXMSetBarlineBoundaryCommand = {
  type: "barline.setBoundary";
  trackId: string;
  boundary: ILXMBarlineBoundaryReference;
  barline: ILXMTrackStartBarlineType | ILXMBarlineType;
};
```

命令 Module 隐藏以下 implementation：

- `trackStart` 只接受 `none` 或 `repeatStart`；
- `afterMeasure` 只接受六类 `ILXMBarlineType`；
- `repeatStart`、`repeatBoth` 要求目标边界之后仍有 measure，避免在乐谱末尾创建没有后续内容的开始反复；
- 目标不存在或类型与边界不匹配时原子失败；
- 相同类型返回 `changed: false`、原 document 引用且不增加 revision；
- 成功时只复制受影响的 track/measure 分支并进入一条历史。

新增错误码：

```ts
type ILXMScoreCommandErrorCode =
  | ExistingErrorCode
  | "BARLINE_BOUNDARY_NOT_FOUND"
  | "INVALID_BARLINE_FOR_BOUNDARY";
```

### 3.4 小节增删复制规则

本补丁不猜测用户的结构意图：

- `measure.insert` 创建的新小节仍使用 `barline: "single"`；
- `measure.copy` 的新副本仍使用 `barline: "single"`，不复制源小节终止线或反复线；
- `measure.remove` 同时删除该小节及其右边界，不自动把该边界迁移给前一小节；
- 其他 measure 和 `track.startBarline` 保持不变；
- 用户可在结构操作后通过边界工具明确调整结果。

这延续 v3/v4 已有的保守命令语义，避免插入或删除时静默移动反复结构。

## 4. Layout Module

### 4.1 外部 interface

`buildLayout(document, options)` 继续作为渲染和测试使用的主要 interface。TAB、拍号、小节边界的判断全部位于核心 layout implementation；页面不读取相邻 measure 来判断拍号是否变化。

建议扩展布局类型：

```ts
interface ILXMTextLayout {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  textAnchor: "start" | "middle" | "end";
}

interface ILXMSystemHeaderLayout {
  width: number;
  /** 六线谱内纵向排列的 T、A、B。 */
  tabLetters: ILXMTextLayout[];
  /** 从 system 左边缘延伸到第一小节的六根弦线。 */
  strings: ILXMStringLineLayout[];
  /** 谱首或跨 system 反复边界投影出的行首小节线。 */
  leadingBarline: ILXMBarlineLayout | null;
  /** 当前 system 中六线谱正文的真实起点。 */
  staffX: number;
}

interface ILXMTimeSignatureLayout {
  measureId: string;
  numerator: ILXMTextLayout;
  denominator: ILXMTextLayout;
  width: number;
}

interface ILXMSystemLayout {
  // 既有字段保持
  header: ILXMSystemHeaderLayout;
}

interface ILXMMeasureLayout {
  // 既有字段保持
  timeSignature: ILXMTimeSignatureLayout | null;
}
```

`c` 只承载 SVG 渲染需要的最终值，不暴露字体测量器或 DOM 依赖。首版尺寸使用集中常量，保持 layout 为纯函数。

### 4.2 领域边界到视觉边界的投影

`measure.barline` 是稳定的领域边界，但自动换行可能把边界两侧的小节拆到不同 system。layout 必须根据最终 system 分组生成视觉投影，不能直接机械地把所有类型画在源 measure 右侧。

| 领域边界      | 两侧在同一 system               | 边界恰好跨 system                                      |
| ------------- | ------------------------------- | ------------------------------------------------------ |
| `repeatStart` | 在共享边界绘制开始反复线        | 上一 system 以单线收尾，下一 system 行首绘制开始反复线 |
| `repeatBoth`  | 在共享边界绘制双向反复线        | 上一 system 绘制结束反复线，下一 system 绘制开始反复线 |
| 其他类型      | 在源 measure 右侧按既有类型绘制 | 仍在上一 system 末尾绘制，下一 system 不重复           |

轨道 `startBarline: "repeatStart"` 只投影到第一条 system 行首。后续 system 的 `leadingBarline` 只可能来自跨行的 `repeatStart` 或 `repeatBoth`。

该投影只存在于 layout，不回写或拆分 `ILXMDocument`。因此改变 `systemWidth` 导致断行变化时，领域数据保持不变，视觉小节线自动重新组合。

### 4.3 横向空间与自动断行

`systemWidth` 的含义保持为调用方给定的整行逻辑宽度。布局顺序调整为：

```text
解析 systemWidth
  → 计算固定 system header width
  → 得到 staffAvailableWidth
  → 为需要显示拍号的 measure 增加 leading notation width
  → 使用完整 intrinsic width 自动断行
  → 分配 measure assignedWidth
  → 生成最终 TAB、拍号、弦线、音符和小节线坐标
```

约束：

- 每条 system 都扣除相同 TAB 行头宽度；
- 第一条 system 可投影 `track.startBarline`，后续 system 可投影跨行的开始反复边界；
- 拍号宽度属于对应 measure 的固定前导区，不参与节奏列拉伸；
- 小节 padding、拍号前导区和 barline 净空不得作为 flexible rhythm content 拉伸；
- 复合小节线的 line/dot 外延必须计入边界净空；跨行投影后的几何不得越出 layout/viewBox；
- 单个小节连同行头宽于 `systemWidth` 时仍独占一行且不压缩；
- system、measure、弦线、barline、beat slot、selection 与 hit index 使用同一套最终坐标。

### 4.4 垂直空间

- 纵向 TAB 和拍号均位于六线谱 staff 高度内，不额外增加 system 高度；
- 现有 duration lane 和 systemGapY 规则保持不变；
- 文字不得与第一根、最后一根弦外的时值符号发生碰撞；
- 字体视觉偏移集中放入 `layout-constants.ts`，页面不得二次校准。

### 4.5 页面渲染

website 新增三个纯消费层：

1. system header layer：渲染 `TAB` 和可选的行首反复线投影；
2. time signature layer：渲染 layout 返回的分子、分母；
3. barline layer：继续复用既有 line/circle parts。

页面不得：

- 根据 `system.index` 自行决定是否显示 TAB；
- 比较前后 measure 的拍号；
- 根据小节线类型重新计算粗细线和圆点；
- 用 CSS margin 修正 layout 未预留的行头空间。

## 5. 页面交互与历史

### 5.1 边界目标

- 默认小节线工具操作当前 focus 所在 measure 的右边界；
- focus 位于第一小节时，工具额外提供“谱首开始反复”开关，对应 `trackStart`；
- 选区跨多个 measure 时，以 focus 所在 measure 为目标，并在工具文案中明确显示目标小节；
- 本补丁不增加可持久化的 barline selection；工具焦点属于临时 UI 状态，不写入 `ILXMDocument`。

### 5.2 Store

- 统一调用既有 `execute(command)`；
- 成功修改产生一条历史；
- 失败和 no-op 不进入历史；
- undo/redo 后由 document 重新派生 layout；
- TAB 和拍号只属于 layout，不进入历史。

### 5.3 可访问性

- 小节线下拉选项使用完整中文名称，不只展示图标；
- 当前类型使用可读文本或 `aria-label` 表达；
- 谱首反复开关与小节右边界工具使用不同标签，避免用户误解目标；
- 禁用状态和错误信息沿用 v4 工具栏模式。

## 6. Module 与文件布局

```text
packages/lxm-editor/src/
  core/
    constants.ts              # 谱首边界类型
    types.ts                  # track.startBarline、边界引用与命令类型
    schema.ts                 # 运行时校验
    commands.ts               # barline.setBoundary 深 Module implementation
  layout/
    system-header-layout.ts   # TAB、谱首边界和固定行头宽度
    time-signature-layout.ts  # 拍号显示规则与文字几何
    system-layout.ts          # 把行头宽度纳入断行和最终坐标
    measure-layout.ts         # 接收拍号前导区并输出 timeSignature
    layout-types.ts           # 页面可直接消费的最终几何
    layout-constants.ts       # 字号、净空和视觉偏移

apps/website/
  components/EditorShell/     # layout 消费与边界工具装配
  stores/editor-store.ts      # 复用 execute/history
```

`system-header-layout.ts` 和 `time-signature-layout.ts` 是核心 layout implementation 的内部 Module。外部调用方继续只需要 `buildLayout`，不新增字体测量或显示策略配置，保持 interface 小而稳定。

## 7. 测试策略

### 7.1 schema 与命令

- `startBarline` 的合法值、缺失字段和非法值；
- 谱首与小节后边界的合法类型矩阵；
- 乐谱末尾拒绝 `repeatStart`、`repeatBoth`；
- 目标 track/measure 不存在；
- 成功、失败、no-op、revision 和不可变引用；
- insert/copy/remove 的边界保持规则；
- undo/redo 和 redo 分支清理。

### 7.2 layout

- 每条非空 system 都有 TAB，空轨道没有虚假行头；
- 第一小节拍号、相同拍号不重复、拍号变化时显示；
- 普通换行不重复拍号，换行点恰好变化时显示；
- systemWidth 包含行头，measure 不越过右边界；
- 谱首反复线只出现在第一条 system；
- `repeatStart`、`repeatBoth` 位于换行边界时生成正确的行尾/行首投影；
- 六类小节线几何无回归；
- compact/comfortable、稀疏末行、单小节行和超宽小节；
- hit index、selection 和 focus caret 与新的 staffX 对齐。

### 7.3 页面与浏览器

- 多 system 中每行 TAB 对齐；
- `4/4 → 3/4 → 3/4 → 6/8` 只在第 1、2、4 个变化点展示；
- 谱首反复和六类右边界可修改、撤销和重做；
- 改变 systemWidth 后，跨行反复边界随新断行重新投影且文档不变；
- 两位品位输入、范围选择、rhythm/rest 和小节增删复制无回归；
- TAB、拍号、品位数字、反复点和 duration lane 无重叠；
- 页面控制台无 warning/error。

## 8. 不采用的方案

### 8.1 把 TAB 和拍号直接写在 React 中

页面将被迫重复断行、相邻拍号比较和 X 坐标推导，命中与渲染会使用不同坐标来源。

### 8.2 每个 system 都重复相同拍号

首版没有强制重复拍号的产品需求。只在首次与变化时显示能减少横向占用，也与现有“显式数据变化驱动展示”的规则一致。

### 8.3 给每个 measure 同时保存左右小节线

相邻 measure 会共同拥有同一边界，必须额外解决冲突优先级。保留右边界并增加唯一的 track 起始边界，数据来源更单一。

### 8.4 删除 repeatBoth 以缩小范围

该类型已经存在于 schema、layout 模板和 SVG 消费路径。保留它的边际成本低于删除后的兼容、测试和未来恢复成本。

### 8.5 同时实现播放反复

播放语义需要反复配对、嵌套、次数、结尾房子和播放游标状态，远超本补丁的谱面展示与编辑目标。

## 9. 完成定义

- TAB、拍号与边界规则全部由核心 Module 输出，页面只消费最终 layout；
- 六类小节线和谱首开始反复均可编辑、保存、撤销和重做；
- 新增模型通过 schema 与语义校验，失败/no-op 不污染历史；
- 所有核心测试、Store 测试和既有回归通过；
- 固定 A4 桌面页面完成多 system 浏览器视觉验收；
- 已知限制和用户确认结果记录在实施计划中。
