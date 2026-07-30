# MVP v3 Fix：符干连接与长时值延时占位符

## 1. 背景与问题

现有 [谱面时值符号补全方案](./duration-notation-symbols-fix.md) 已在六线谱下方建立 rhythm lane，并输出节奏头、符干、孤立旗帜和连续连梁。实际视觉评审后需要调整两个决策：

1. 当前符干从固定 rhythm lane 的节奏头开始，没有连接到 TAB 中实际演奏的音符。和弦或单音的符干看起来悬空，难以判断它属于哪个起音。
2. `mark.head.glyph` 暂不在页面显示。隐藏节奏头后，whole、half、quarter 都可能只剩相同的裸符干，仍需要一套不依赖音符头的长时值表达。

本 fix 保留上一方案建立的核心边界：时值图形全部由核心 layout 生成，页面只渲染最终几何；`ILXMDocument`、rhythm schema 和编辑命令保持不变。

## 2. 最终视觉契约

### 2.1 notes beat

| 基础时值       | 节奏头           | 符干 | 延时占位符 | 旗帜或连梁 |
| -------------- | ---------------- | ---- | ---------- | ---------- |
| `whole`        | 数据保留，不渲染 | 显示 | 3 条       | 无         |
| `half`         | 数据保留，不渲染 | 显示 | 1 条       | 无         |
| `quarter`      | 数据保留，不渲染 | 显示 | 0 条       | 无         |
| `eighth`       | 数据保留，不渲染 | 显示 | 0 条       | 1 层       |
| `sixteenth`    | 数据保留，不渲染 | 显示 | 0 条       | 2 层       |
| `thirtySecond` | 数据保留，不渲染 | 显示 | 0 条       | 3 层       |

示意：

```text
TAB staff       ───3────────5────────7──────
                   │        │        │
                   │        │        │
rhythm lane        │        │  —     │  —  —  —
                 quarter      half       whole
```

此处 `—` 是由 SVG line primitive 绘制的 sustain mark，不是文本连字符，也不是隐藏的四分音符 glyph。

### 2.2 rest beat

休止 beat 继续由 `rest-layout.ts` 的 Bravura/SMuFL 休止符 glyph 表达完整时值：

- 不生成 `durationMark`；
- 不生成符干、sustain mark、flag 或 beam；
- 不把音符的延时占位符规则套到休止符。

## 3. 设计原则

- 符干表达起音归属：必须连接到当前 beat 实际存在的 TAB 音符。
- sustain mark 表达长时值占用：whole、half 在起音之后占据多少个四分时值单位。
- flag/beam 表达短时值细分：eighth 及更短时值沿用现有规则。
- `head` 仍是核心 layout 数据，但本轮页面不渲染，不能从类型中删除。
- 一个和弦 beat 只生成一根符干和一组时值图形。
- 页面不得读取 `rhythm.base` 重新计算 sustain 数量或符干可见性。
- 所有坐标和长度使用逻辑 SVG 单位，不依赖 CSS 字符宽度。

## 4. 符干连接到最大音符位置

### 4.1 “最大音符位置”的定义

SVG 坐标 Y 向下递增。本 fix 中“最大音符位置”明确指：

```ts
Math.max(...beatNoteLayouts.map((note) => note.y));
```

即当前 beat/和弦中画面最靠下弦的音符。它不是最大品位值，也不是 `string` 数字最大值的重新计算；layout 必须直接消费最终 `ILXMNoteLayout.y`。

### 4.2 符干坐标

```text
lowestNoteY = 当前 beat 所有 note layout 的最大 y
stemX       = beatLayout.x
stemY1      = lowestNoteY + LXM_DURATION_STEM_NOTE_GAP
stemY2      = 固定 rhythm lane 的 beam baseline
```

建议恢复并集中定义：

```ts
export const LXM_DURATION_STEM_NOTE_GAP = 6;
```

`stemY2` 继续由第六弦和固定 rhythm lane 常量推导，保证同一 System 的符干终点、beam 和 sustain mark 垂直对齐。

由于 head 本轮不渲染，符干不再为连接节奏头而应用 `LXM_DURATION_STEM_ATTACH_OFFSET_X`。`stemX` 必须与该 beat 的 TAB 音符时间锚点一致；该常量若没有其他消费者，应在实现时删除。

### 4.3 note 索引

`layoutDurationBeams` 重新接收 `noteLayouts`：

```ts
layoutDurationBeams(measure, beatLayouts, noteLayouts, strings);
```

进入 `buildDurationMark` 前一次性构建索引：

```ts
const noteLayoutsByBeatId = noteLayouts.reduce((map, note) => {
  const notes = map.get(note.beatId) ?? [];
  notes.push(note);
  map.set(note.beatId, notes);
  return map;
}, new Map<string, ILXMNoteLayout[]>());
```

不能在每个 beat 内使用 `noteLayouts.filter(...)` 重复扫描全数组。

上层仍只为以下 beat 生成 duration mark：

```ts
beat.kind === "notes" && beat.notes.length > 0;
```

若 source beat 存在但索引中找不到任何 note layout，说明 layout 流程内部数据不一致，应抛出包含 `measureId + beatId` 的明确错误，不能产生 `Math.max(...[]) === -Infinity`。

## 5. 保留 head 数据但停止渲染

### 5.1 核心类型保持不变

`ILXMDurationMarkLayout.head` 继续存在：

```ts
export interface ILXMDurationMarkLayout {
  beatId: string;
  measureId: string;
  head: ILXMDurationGlyphLayout;
  // ...
}
```

原因：

- 后续可能恢复标准节奏头或提供显示模式；
- 导出、打印或其他渲染器可能消费该语义；
- 不需要为一次视觉调整破坏 layout 接口。

核心仍根据 `rhythm.base` 输出正确的 `head.glyph/x/y/fontSize`，相关单元测试继续保留。

### 5.2 页面不创建 head DOM

从 `EditorShell/index.tsx` 的 duration layer 中移除：

```tsx
<text>{mark.head.glyph}</text>
```

不使用以下方式：

```css
display: none;
visibility: hidden;
opacity: 0;
```

数据保留但页面不创建无意义 SVG 元素，避免 DOM 膨胀和无障碍树噪声。

## 6. sustain mark 数据结构

在 `layout-types.ts` 新增：

```ts
export interface ILXMDurationSustainMarkLayout {
  /** 当前占位符对应的四分时值单元，从 1 开始。 */
  unitIndex: number;
  x1: number;
  x2: number;
  y: number;
  thickness: number;
}
```

扩展 `ILXMDurationMarkLayout`：

```ts
export interface ILXMDurationMarkLayout {
  // 现有字段保持不变

  /** 起音后的四分时值延时占位符；短时值和 quarter 为空数组。 */
  sustainMarks: ILXMDurationSustainMarkLayout[];
}
```

使用数组而不是 `sustainCount`，是为了保持核心 layout 为唯一坐标来源。页面不应根据数量、slot width 或拍号重新推导线段位置。

## 7. sustain 数量规则

### 7.1 固定以 quarter 为显示单位

首版 sustain mark 使用四分音符作为固定显示单位，不随拍号分母变化：

```ts
const BASE_QUARTER_UNIT_COUNT = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0,
  sixteenth: 0,
  thirtySecond: 0,
} satisfies Record<ILXMRhythmBase, number>;

const sustainCount = Math.max(0, BASE_QUARTER_UNIT_COUNT[rhythm.base] - 1);
```

结果：

```text
whole        → 3
half         → 1
quarter      → 0
eighth       → 0
sixteenth    → 0
thirtySecond → 0
```

选择固定 quarter 单位的原因：

- whole/half/quarter 的视觉含义在 4/4、3/4、6/8 中保持一致；
- 不会因拍号 denominator 改变同一个基础时值的图形；
- 与用户提出的“二分 = 起音 + 一个四分延时占位”一致。

语义校验仍负责阻止无法放入当前小节容量的时值。例如 3/4 小节不能合法包含从 tick 0 开始的 whole beat；layout 不重复实现容量校验。

### 7.2 附点不增加 sustain 数量

本 fix 的 sustain marks 只表达 `rhythm.base`，附点仍由 `dotAnchors` 表达：

```text
half, dots=0    → stem + 1 sustain
half, dots=1    → stem + 1 sustain + 1 dot
quarter, dots=1 → stem + 0 sustain + 1 dot
```

不把附点额外时值转换成半条或额外一条 sustain mark，避免同一时值被重复表达。

## 8. sustain 横向布局算法

### 8.1 使用 beat slot 的最终宽度

System 行宽拉伸后，`ILXMBeatLayout.width` 已经是最终 slot 宽度。sustain mark 必须只在这个最终 slot 内分配，不能使用 intrinsic width 或重新读取 `systemWidth`。

对 total quarter units 大于 1 的 beat：

```text
unitWidth = beatLayout.width / totalQuarterUnits
```

第 `unitIndex` 个延时单元，`unitIndex` 从 1 到 `totalQuarterUnits - 1`：

```text
unitCenterX
  = beatLayout.x
  + unitWidth * (unitIndex + 0.5)

x1 = unitCenterX - sustainHalfWidth
x2 = unitCenterX + sustainHalfWidth
```

示意：

```text
half slot
┌───────────────┐
│ onset │ hold  │
│   │   │   —   │
└───────────────┘

whole slot
┌───────────────────────────────┐
│ onset │ hold │ hold │ hold    │
│   │   │  —   │  —   │  —     │
└───────────────────────────────┘
```

### 8.2 线段长度保护

在 `layout-constants.ts` 增加建议初值：

```ts
export const LXM_DURATION_SUSTAIN_WIDTH = 10;
export const LXM_DURATION_SUSTAIN_MIN_WIDTH = 4;
export const LXM_DURATION_SUSTAIN_HORIZONTAL_PADDING = 2;
export const LXM_DURATION_SUSTAIN_THICKNESS = 1;
```

一个单元内可用宽度：

```text
availableWidth
  = unitWidth - 2 * LXM_DURATION_SUSTAIN_HORIZONTAL_PADDING

lineWidth
  = min(LXM_DURATION_SUSTAIN_WIDTH, availableWidth)
```

若 `availableWidth < LXM_DURATION_SUSTAIN_MIN_WIDTH`，核心 layout 抛出明确错误或返回结构化布局错误。本次 System 算法只扩张固有宽度，正常 V3 文档不应触发此分支；不能静默输出负宽度或反向线段。

### 8.3 Y 坐标

sustain mark 位于第一弦与第六弦之间的垂直中线：

```ts
const firstStringLine = strings.find((line) => line.index === 1);
const lastStringLine = strings.find((line) => line.index === 6);

staffCenterY = (firstStringLine.y1 + lastStringLine.y1) / 2;
sustainY = staffCenterY + LXM_DURATION_SUSTAIN_OFFSET_Y;
```

必须使用最终弦线布局坐标并按 `line.index` 定位边界弦线，不能假设输入数组有序，
也不能只返回谱表高度的一半。若缺少第一弦或第六弦，核心布局抛出包含
`measureId` 的错误。

如需做像素级视觉校准，只能通过集中常量调整相对六线谱中线的 offset：

```ts
export const LXM_DURATION_SUSTAIN_OFFSET_Y = 0;
```

页面不得对 whole/half 写不同 Y 偏移。stem、beam、flag 继续留在下方 rhythm
lane，不随 sustain line 移入六线谱内部。

## 9. stem、sustain、flag 和 beam 的组合

`buildDurationMark` 负责生成：

- 保留但不展示的 `head`；
- 从最大音符 Y 延伸到 rhythm lane 的 `stem`；
- `sustainMarks`；
- `beamLevel` 和 `dotAnchors`。

`layoutDurationBeams` 随后负责：

1. 生成 shared/partial `beamSegments`；
2. 计算 beam coverage；
3. 为完全没有 beam 覆盖的孤立短时值回填 composite `flag`。

互斥规则：

```text
whole / half  → sustainMarks 非空，flag null，beamSegments 无该 beat
quarter       → sustainMarks 空，flag null，beamSegments 无该 beat
孤立短时值   → sustainMarks 空，flag 非空
连续短时值   → sustainMarks 空，flag null，beamSegments 覆盖该 beat
```

不允许一个 beat 同时出现 sustain mark 与 flag/beam。

## 10. 附点位置

head 不再渲染后，附点不能继续表现为“跟随一个不可见节奏头”。将附点放在 sustain/beam 所占区域的上方：

```text
dot.x = stemX + LXM_DURATION_DOT_OFFSET_X
      + index * LXM_DURATION_DOT_GAP_X

topRhythmY
  = beamLevel > 0
    ? beamY - (beamLevel - 1) * LXM_DURATION_BEAM_LEVEL_GAP
    : beamY

dot.y = topRhythmY - LXM_DURATION_DOT_CLEARANCE_Y
```

建议初值：

```ts
export const LXM_DURATION_DOT_CLEARANCE_Y = 4;
```

附点继续位于下方 rhythm lane，并应避开：

- 第一层 beam；
- composite flag 的主体。

由于 sustain line 已移动到六线谱内部，附点不能跟随 sustain Y，否则会进入弦线和
TAB 数字区域。二分/全音符的附点仍以 `beamY` 为基准，短时值附点位于最高层
beam 上方。composite flag 的字形边界仍需要浏览器视觉验收；如有碰撞，只调整
集中 clearance/flag offset 常量，坐标仍由核心 layout 输出。

## 11. 页面渲染

修改 `EditorShell/index.tsx` 的 duration layer：

```tsx
<g className={styles.durationLayer} pointerEvents="none">
  {measure.durationMarks.map((mark) => (
    <g key={mark.beatId}>
      {/* mark.head 数据保留，本轮不创建对应 SVG text。 */}

      <line
        x1={mark.stemX}
        y1={mark.stemY1}
        x2={mark.stemX}
        y2={mark.stemY2}
        stroke="black"
        strokeWidth={1}
      />

      {mark.sustainMarks.map((sustain) => (
        <line
          key={sustain.unitIndex}
          x1={sustain.x1}
          y1={sustain.y}
          x2={sustain.x2}
          y2={sustain.y}
          stroke="black"
          strokeWidth={sustain.thickness}
        />
      ))}

      {mark.flag && <text ...>{mark.flag.glyph}</text>}
      {mark.dotAnchors.map(...)}
    </g>
  ))}
</g>
```

所有 notes duration marks 都有符干，因此 `stemVisible` 可以：

- 暂时保留并固定为 `true`，兼容现有接口；或
- 在后续明确没有其他模式消费时单独清理。

本 fix 不删除 `stemVisible`，避免将视觉调整与类型清理混在一个改动中。

## 12. 高度和裁剪

符干起点上移到实际音符，不会增加 rhythm lane 的最下方范围。sustain mark 位于 `beamY`，也不比现有 flag 更低。因此：

- 保留 `LXM_DURATION_FLAG_DESCENT`；
- 保留 `LXM_DURATION_LANE_BOTTOM_PADDING`；
- `calculateMeasureHeight()` 原则上不需要继续增高；
- 必须保留浏览器包围框验收，确认隐藏 head 后 SVG 高度仍覆盖 flag、dot 和 sustain。

System 高度继续使用最高 measure 的高度，相邻 System 的 Y 仍由：

```text
previousSystem.y + previousSystem.height + systemGapY
```

推导。

## 13. 预计修改范围

```text
packages/lxm-editor/src/layout/
  layout-constants.ts       # stem gap、sustain、dot offset 常量
  layout-types.ts           # ILXMDurationSustainMarkLayout
  duration-beam-layout.ts   # 最大音符索引、stem 与 sustain 算法
  measure-layout.ts         # 重新向 duration layout 传入 noteLayouts

packages/lxm-editor/tests/layout/
  duration-beam-layout.test.ts
  system-layout.test.ts

apps/website/components/EditorShell/
  index.tsx                 # 不渲染 head，渲染 sustain lines
```

原则上不修改：

- `core/types.ts`、`core/schema.ts`；
- `core/commands.ts`；
- `rest-layout.ts`；
- System 横向宽度分配；
- hit test 和选中模型。

## 14. 测试方案

### 14.1 符干连接

- 单音 beat：`stemY1 === note.y + gap`。
- 多音和弦：`stemY1 === max(note.y) + gap`。
- 单音与和弦：`stemX === beatLayout.x`，不再应用节奏头连接偏移。
- 两个和弦最低音位于不同弦时，`stemY1` 不同，但 `stemY2` 相同。
- source beat 缺少 note layout 时抛出包含 `measureId + beatId` 的错误。

### 14.2 基础时值矩阵

断言：

```text
whole        → stemVisible true, sustainMarks.length 3, beamLevel 0
half         → stemVisible true, sustainMarks.length 1, beamLevel 0
quarter      → stemVisible true, sustainMarks.length 0, beamLevel 0
eighth       → stemVisible true, sustainMarks.length 0, beamLevel 1
sixteenth    → stemVisible true, sustainMarks.length 0, beamLevel 2
thirtySecond → stemVisible true, sustainMarks.length 0, beamLevel 3
```

`head.glyph` 映射测试继续保留，确保只是停止渲染，没有删除数据。

### 14.3 sustain 坐标

- half 的唯一 sustain 位于 slot 后半单元中心。
- whole 的三条 sustain 按 X 单调递增。
- 每条线满足 `beat.x <= x1 < x2 <= beat.x + beat.width`。
- System 拉伸后重新布局，sustain 仍留在最终 slot 内。
- 线段过窄时不生成负宽度。

### 14.4 flag/beam 互斥

- 孤立 eighth/sixteenth/thirtySecond 继续输出 composite flag。
- 连续短时值继续输出 beam 且 flag 为 null。
- whole/half/quarter 不输出 flag，也不出现在 beam segment 中。
- 所有短时值的 `sustainMarks` 为空。

### 14.5 附点

- 0/1/2 dots 输出相同数量 anchor。
- dot Y 位于配置后的 beam/sustain lane。
- dotted half 仍只有一个 sustain mark。
- dot 与 sustain/beam/flag 在目标浏览器中无明显重叠。

### 14.6 页面

- duration layer 中不存在 `mark.head.glyph` 对应的 SVG text。
- whole/half/quarter 分别可通过 3/1/0 条 sustain line 区分。
- 和弦符干连接到画面最靠下的实际音符。
- Bravura 只用于休止符和孤立 flag，不影响 sustain line 尺寸。
- 多 System 无裁剪、无纵向重叠，行宽仍为目标 `systemWidth`。

## 15. 不采用的方案

### 15.1 用文本 `-` 作为延时占位符

文本连字符依赖字体基线、字符宽度和字距，难以稳定放入拉伸后的 beat slot。SVG line 能明确控制坐标、长度和粗细。

### 15.2 删除 `mark.head`

本轮只是停止页面渲染，不代表核心语义永久废弃。直接删除会破坏其他潜在 renderer，并增加未来恢复标准记谱的迁移成本。

### 15.3 根据拍号 denominator 改变 sustain 单位

这会导致同一个 half/quarter 在 4/4 与 6/8 中显示不同数量的延时符号。首版固定 quarter 单位，拍号只影响语义容量和连梁拍组。

### 15.4 用符干长度区分 whole/half/quarter

本 fix 已要求符干连接实际音符，符干长度会随最低音所在弦变化，不能同时承担可靠的时值编码。

## 16. 实施顺序

1. 为和弦最大 Y 符干连接写失败测试。
2. 重新向 duration layout 传入 note layouts，并建立 `beatId` 索引。
3. 为 whole/half/quarter 的 3/1/0 sustain 数量写失败测试。
4. 扩展 layout types 和常量，生成 sustain marks。
5. 补充最终 slot 内坐标和窄宽度边界测试。
6. 调整附点到 stem/sustain lane，并更新附点测试。
7. 页面删除 head `<text>`，新增 sustain `<line>` 渲染。
8. 运行 duration、System、hit-test 和 commands 回归测试。
9. 运行 `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build`。
10. 在固定桌面视口检查和弦符干、3/1/0 sustain、孤立 flag、连续 beam、附点和多 System 裁剪。

## 17. 验收标准

- 所有 notes beat 的符干连接到该 beat 最大 `note.y` 对应的音符。
- `mark.head` 数据和 glyph 映射仍存在，但页面不创建 head SVG text。
- 4/4 示例中 whole、half、quarter 分别显示 3、1、0 条 sustain line。
- sustain lines 全部位于当前 beat 的最终 slot 内。
- 附点不改变基础 sustain 数量，并与 rhythm lane 对齐。
- 孤立短时值继续显示正确 composite flag。
- 连续短时值继续显示 shared/partial beam，且不重复显示 flag。
- 休止符不生成 notes duration mark。
- System 行宽、命中索引、编辑命令和文档 schema 无回归。
- SVG viewBox 不裁切 flag、dot 或 sustain，多 System 不重叠。
- 核心测试、类型检查、lint、生产构建和目标浏览器视觉验收全部通过。

## 18. Fix TODO：将 sustain line 移到六线谱垂直中线（已实施）

实施状态：核心布局、自动化测试、类型检查、lint、生产构建和当前演示谱面的浏览器
坐标验收已完成。下列清单保留作为变更记录。

### 18.1 调整目标

当前 `buildDurationSustainMarks` 使用 `beamBaseY` 作为 `sustainY`，占位线与符干
终点、连梁位于同一条 rhythm lane。下一轮修复需要把 sustain line 移到六根弦线
围成区域的垂直中线，即第一弦和第六弦 Y 坐标的中点：

```ts
staffCenterY = firstStringY + (lastStringY - firstStringY) / 2;
// 等价于：
staffCenterY = (firstStringY + lastStringY) / 2;
```

这里的“`string[0]` 到 `string[6]`”按业务含义解释为第一弦到第六弦。代码中的
`strings` 是六元素集合时，有效数组下标通常是 `0...5`，因此实现不能直接读取
`strings[6]`。应按 `ILXMStringLineLayout.index` 找到 `index === 1` 和 `index === 6`
的弦线，或使用已按弦序验证过的首尾元素。

不能只计算 `(lastStringY - firstStringY) / 2` 作为最终 Y；当谱面起始 Y 不为 0
时，这只是高度的一半，必须再加上 `firstStringY`。

### 18.2 数据流调整

- [x] 在 `layoutDurationBeams` 中同时取得第一弦与第六弦布局。
- [x] 若任一边界弦线缺失，抛出包含 `measureId` 的明确布局错误，不静默回退到
      `beamBaseY`。
- [x] 使用最终 `ILXMStringLineLayout` 坐标计算 `staffCenterY`，不从
      `LXM_STRING_SPACING` 或固定弦数反推，确保整体 Y 偏移后仍然正确。
- [x] 将 `staffCenterY` 传给 `buildDurationMark`，再传给
      `buildDurationSustainMarks`。
- [x] 将 `buildDurationSustainMarks` 的第三个参数由含义模糊的 `sustainY` 改名为
      `staffCenterY`。
- [x] `sustainMark.y` 使用 `staffCenterY`；如果继续保留
      `LXM_DURATION_SUSTAIN_OFFSET_Y`，默认值必须为 `0`，并在注释中明确它是相对
      六线谱中线的视觉校准量。

建议调用关系：

```ts
const firstStringLine = strings.find((line) => line.index === 1);
const lastStringLine = strings.find((line) => line.index === 6);

if (!firstStringLine || !lastStringLine) {
  throw new Error(`时值布局缺少边界弦线：measureId=${measure.id}`);
}

const staffCenterY = (firstStringLine.y1 + lastStringLine.y1) / 2;

buildDurationSustainMarks(currentBeat, beat.rhythm.base, staffCenterY);
```

弦线当前为水平线，示例使用 `y1`。若未来允许斜线谱表，需要先定义 sustain line
是否跟随斜率；本 fix 仍以水平六线谱为前提。

### 18.3 保持不变的行为

- [x] sustain 的 X 坐标算法保持不变，继续在 beat slot 内按四分音符单位等分。
- [x] whole、half、quarter 的 sustain 数量继续为 `3 / 1 / 0`。
- [x] `stemY2`、`beamY`、flag 和 beam segment 仍使用 rhythm lane，不随 sustain
      上移到谱表内部。
- [x] `mark.head` 继续保留数据且不创建 SVG head 节点。
- [x] 附点继续以最高 beam 或原 rhythm lane 为避让基准；不能因为 sustain 移入
      谱表中线而同步落入六根弦线区域。
- [x] 休止符布局保持不变，不生成 sustain mark。

### 18.4 测试 TODO

- [x] 先增加失败测试：弦线 Y 为 `20, 32, 44, 56, 68, 80` 时，half 与 whole
      的所有 `sustainMark.y` 均为 `50`。
- [x] 增加非零整体偏移测试：第一弦 Y 为 `120`、第六弦 Y 为 `180` 时，结果必须
      为 `150`，防止错误地只返回高度的一半 `30`。
- [x] 增加弦线数组顺序打乱测试，确保实现依据 `line.index`，而非未验证的数组位置。
- [x] 增加缺少第一弦或第六弦测试，断言错误信息包含 `measureId`。
- [x] 保留现有 sustain X 坐标与 slot 边界测试，确保本轮只改变 Y。
- [x] 保留附点、flag、shared/partial beam 回归测试，确保这些元素仍位于 rhythm
      lane 且不受 sustain Y 调整影响。

### 18.5 页面与视觉验收 TODO

- [x] React 页面继续直接消费 `sustainMark.y`，不得自行读取 strings 重新计算中线。
- [x] 检查 sustain line 位于第三弦和第四弦之间，而不是压在某根弦线上。
- [x] 检查 sustain line 不遮挡当前演示谱面中的 TAB 品位数字。
- [x] 检查多 System 以及整体 Y 偏移后的谱面，sustain 均保持相对六线谱
      居中。
- [ ] 在目标浏览器补充包含 whole 的专用 fixture，确认 `3` 条占位线的最终视觉；
      当前演示谱面已确认 half 的 1 条占位线 Y 等于第一、六弦中点。
- [x] 完成后运行 `pnpm test`、`pnpm type-check`、`pnpm lint` 和网站生产构建。
