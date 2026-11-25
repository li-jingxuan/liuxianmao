# MVP Layout 流转架构图

这份文档用于说明 MVP layout 方案的核心流转：原始乐谱数据先转换为音乐时间，再转换为视觉列宽，然后按可用宽度拆成多行 system，最后输出小节、弦线、音符等可渲染坐标。

## 总体流转

```mermaid
flowchart TD
  A["ILXMDocument<br/>已通过 schema 校验的乐谱文档"] --> B["buildLayout(document)<br/>整谱布局入口"]
  B --> C["选择第一条 track<br/>MVP 暂不处理多轨同步"]
  C --> D["summarizeMeasureSpacingWidth(measure)<br/>预估每个小节 minWidth / idealWidth"]
  D --> E["breakMeasuresIntoSystems<br/>根据 availableWidth 拆分多行 system"]

  E --> F["layoutSystem(systemMeasures)<br/>计算一行 system 的 x / y / height"]
  F --> G["layoutMeasure(measure)<br/>单小节布局"]
  G --> H["layoutMeasureSpacing(measure)<br/>计算节奏列和 beat slot"]
  H --> I["buildRhythmicColumns(measure)<br/>按 tick 聚合 beats"]
  I --> J["calculateRhythmTicks(rhythm)<br/>节奏转换为音乐 tick"]
  I --> K["ILXMColumnWidthContributors<br/>歌词 / 简谱 / 和弦等视觉宽度贡献"]

  J --> L["columns<br/>小节内部时间列"]
  K --> L
  L --> M["beats<br/>每个 beat 的最终 x / width"]
  M --> N["notes<br/>note.x = beat.x<br/>note.y = stringY"]
  G --> O["strings<br/>六根弦线坐标"]

  N --> P["ILXMMeasureLayout<br/>单小节可渲染布局"]
  O --> P
  M --> P
  L --> P
  P --> Q["ILXMSystemLayout<br/>一行六线谱布局"]
  Q --> R["ILXMLayout<br/>整谱可渲染布局<br/>systems -> measures"]

  R --> S["React / SVG / Canvas<br/>只消费坐标，不重新理解乐谱"]
```

## 分层职责

```mermaid
flowchart LR
  subgraph Core["core 层：音乐语义"]
    A1["types.ts<br/>ILXMDocument / ILXMMeasure / ILXMBeat"]
    A2["schema.ts<br/>运行时数据校验"]
    A3["rhythm.ts<br/>tick 与小节容量计算"]
  end

  subgraph Layout["layout 层：坐标计算"]
    B1["layout-constants.ts<br/>几何常量 / 视觉权重"]
    B2["layout-types.ts<br/>布局结果类型"]
    B3["measure-spacing.ts<br/>节奏列 / beat slot / 自适应宽度"]
    B4["measure-layout.ts<br/>弦线 / 音符 / 小节坐标"]
    B5["system-breaking.ts<br/>根据行宽拆分 systems"]
    B6["system-layout.ts<br/>一行 system 坐标"]
    B7["index.ts<br/>buildLayout 入口"]
  end

  subgraph Render["渲染层：展示"]
    C1["遍历 systems<br/>渲染每一行"]
    C2["SVG line<br/>渲染 strings"]
    C3["SVG text<br/>渲染 notes"]
    C4["外层 div<br/>固定高度 + overflow-y:auto"]
  end

  A1 --> A2
  A2 --> B7
  A3 --> B3
  B1 --> B3
  B1 --> B4
  B1 --> B6
  B2 --> B3
  B2 --> B4
  B2 --> B5
  B2 --> B6
  B3 --> B4
  B3 --> B5
  B5 --> B6
  B4 --> B6
  B6 --> B7
  B7 --> C1
  C1 --> C2
  C1 --> C3
  B7 --> C4
```

## 关键数据关系

```mermaid
flowchart TD
  A["measure.beats<br/>原始小节拍点数据"] --> B["columns<br/>按 tick 聚合后的时间列"]
  B --> C["measure width summary<br/>minWidth / idealWidth"]
  C --> D["system breaks<br/>按 availableWidth 拆成多行"]
  D --> E["systems<br/>每一行的 x / y / height"]
  B --> F["beats<br/>每个真实 beat 的 x / width"]
  F --> G["notes<br/>音符最终 x / y"]
  H["strings<br/>六根弦线 y 坐标"] --> G

  B -. "决定小节内部横向空间" .-> F
  C -. "决定一行能放几个小节" .-> D
  E -. "提供 measure.y" .-> G
  F -. "提供 note.x" .-> G
  H -. "提供 note.y" .-> G
```

## 核心原则

- `tick` 是音乐时间坐标，不是像素宽度。
- `calculateRhythmTicks` 只计算音乐时值，不参与视觉宽度决策。
- `columns` 负责小节内部横向空间分配，是未来歌词、简谱、和弦对齐的扩展点。
- `beats` 是真实 beat 的最终布局结果，包含 `x` 和 `width`。
- `systems` 是多行六线谱的行布局结果，负责承载同一行内的小节集合。
- `strings` 决定弦线位置，也为音符提供纵坐标参考。
- `notes` 是最终可渲染音符坐标，通常由 `beat.x + string.y` 得到。
- `layout.height` 是排版后的内容高度，用于设置 SVG 高度或滚动容器内容高度。
