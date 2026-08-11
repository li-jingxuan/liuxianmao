# MVP v4.1 Fix：拍号编辑与小节容量协调实施方案

## 1. 实施约束

- 以 [技术方案](./time-signature-editing-fix-technical-design.md) 为唯一功能边界。
- 实现顺序固定为“容量与拍组测试基线 → 单小节规划 → 多小节原子命令 → 连梁修复 → Store → 页面”。
- 页面不得直接写 `measure.timeSignature`、重建 Beat、展开目标小节范围或推导拍组。
- 拍号变化不得自动压缩、拆分或删除真实音符。
- 每一步先运行聚焦测试；最终运行全量 test、type-check、lint 和 build。
- 本 Fix 不改变 schema version，不收窄既有文档的拍号结构校验。

## 2. Step 0：补充拍号夹具与失败基线

### 修改

- 在核心测试 helper 中增加可配置拍号的小节构造器；
- 准备 `2/4`、`3/4`、`4/4`、`6/8` 的全休止与含真实音符小节；
- 准备一个包含连续 `4/4 → 3/4 → 4/4` 变更点的多 system 文档；
- 记录当前拍号显示、system 分组、Beat ID、selection 与连梁分组基线；
- 整理本 Fix 的聚焦用例清单；在对应类型与测试入口就位后，先写容量协调和非 `4/4` 连梁的失败用例，
  再实现生产代码。

### 验收

- 所有夹具通过 loader 与 semantic validation；
- 每个小节时间轴精确覆盖自身拍号容量；
- 失败用例只暴露本 Fix 的缺口，不混入既有不相关失败。

## 3. Step 1：建立可编辑拍号与拍组 profile

### 修改

- 在 `core/constants.ts` 增加 `LXM_EDITABLE_TIME_SIGNATURES`；
- 为白名单建立可复用的值比较 helper，避免对象引用比较；
- 增加 `ILXMTimeSignatureChangeScope`；
- 从 package public index 导出白名单、scope 和必要 helper；
- 页面不自行复制拍号选项。

### 测试

- 白名单只包含 `2/4`、`3/4`、`4/4`、`6/8`；
- 相同分子和分母按值判等；
- `3/8`、`5/8`、`7/8` 和非法数值不属于可编辑集合；
- 既有 schema 仍可加载原先允许的非白名单拍号。

## 4. Step 2：拆分小节容量与连梁拍组概念

### 修改

- 将 `getMeasureCapacityTicks` 改为直接计算完整容量，不再借用“完整拍组”函数；
- 新增 `getTimeSignatureBeatGroupTicks(timeSignature)`；
- 为四个白名单拍号返回显式拍组数组；
- 非白名单拍号返回 `null`，由 layout 降级为整小节单组；
- 移除或重命名含义错误的 `getCompleteBeatCapacityTicks`，同步所有 import 和中文注释。

### 测试

- 容量：`2/4=1920`、`3/4=2880`、`4/4=3840`、`6/8=2880`；
- 拍组：`2/4=[960,960]`、`3/4=[960,960,960]`、`4/4` 为四个 `960`、
  `6/8=[1440,1440]`；
- 所有拍组之和严格等于小节容量；
- 非白名单拍号返回 `null`，不取整、不猜测不对称拍组。

## 5. Step 3：实现单小节拍号协调深 Module

### 修改

- 新增 `core/time-signature-change.ts`；
- 实现尾部连续 rest 起点查找；
- 实现固定节奏前缀结束 tick 计算；
- 全休止小节使用 `createMeasureRestBeats` 重建单位拍网格；
- 含真实内容的小节保留固定前缀，只用 `createRestBeats` 重建尾部容量休止；
- 新容量无法容纳固定前缀时返回 `MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE`；
- chord symbol 超出新容量时返回 `CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE`；
- 无法精确表达剩余休止时返回 `RHYTHM_NOT_REPRESENTABLE`；
- 成功后从 `0` 重新累计 Beat tick，不在旧 tick 上增量平移。

### 测试

- 全休止 `4/4 → 3/4`、`4/4 → 6/8` 的 Beat 数量、rhythm、tick 与新 ID；
- 含音符小节扩容时保留固定 Beat/Note ID，并追加 rest；
- 缩容只消费尾部 rest，固定前缀对象内容不变；
- 缩容切到 notes 时失败，输入 measure 深度不变；
- chord symbol 合法时保留，越界时失败；
- `3/4 ↔ 6/8` 容量相同但拍号变化，Beat 内容按规则保留或重建；
- 无尾部 rest 且固定前缀恰好填满新容量；
- 失败规划不返回部分 measure，不修改输入。

## 6. Step 4：实现原子拍号领域命令

### 修改

- 扩展 `LXMScoreCommandEnum.SetTimeSignature`；
- 增加 `ILXMSetTimeSignatureCommand` 并纳入 `ILXMScoreCommand`；
- 增加三个拍号错误码；
- 校验 target track、measure、scope 与白名单；
- `measure` 只解析目标小节；
- `untilNextChange` 按目标原拍号向后解析连续范围；
- 使用文档 ID factory 依次规划全部目标；
- 任一规划失败时丢弃全部候选；
- 全部成功后一次替换受影响 measures、revision 加一并执行 schema 与 semantic validation；
- 所有目标均未变化时复用 `unchanged(document)`。

### 测试

- track/measure 不存在、拍号不支持、scope 非法；
- 单小节范围不影响相邻小节；
- `untilNextChange` 在下一既有变更点前停止；
- 从一段相同拍号中间开始时只影响目标及其后方；
- 多小节全部成功只增加一次 revision；
- 中间任一小节失败时 document、revision 和引用完全不变；
- no-op 返回原 document 引用；
- 其他 track 与范围外 measure 保持原引用；
- 最终结果通过结构和语义校验。

## 7. Step 5：修复非 4/4 连梁分组

### 修改

- `duration-beam-layout.ts` 消费拍组时长数组；
- 拍组 helper 返回 `null` 时使用整小节单组，保证既有非白名单文档仍可布局；
- 先累计为绝对边界，例如 `6/8` 得到 `1440/2880`；
- Beat 跨越或结束于拍组边界时按既有视觉规则 flush；
- 保留不同时值、多层 beam、partial beam、附点和休止相关既有行为；
- layout 不从页面接收拍组信息。

### 测试

- `3/4` 的八分/十六分连梁不跨三个四分音符边界；
- `6/8` 的六个八分音符形成两个 `3+3` 拍组，而不是三个 `2+2` 或四等分；
- `2/4`、`4/4` 无回归；
- `3/4` 与 `6/8` 容量相同但得到不同连梁分组；
- Beat 恰好结束于边界、跨越边界以及最后一个拍组三类边界用例。

## 8. Step 6：接入 Store 历史与选区协调

### 修改

- Store 继续通过统一 `execute(command)` 调用核心命令；
- 成功修改产生一条历史，失败和 no-op 不产生历史；
- 为拍号命令增加 selection candidate：若端点 Beat 因尾部 rest 重建而消失，优先定位目标小节首个
  Beat，并保持原弦号；
- 多小节范围中仍以命令目标小节作为回退位置；
- undo/redo 后继续通过 document 重新派生 layout 与 selection。

### 测试

- 单小节和多小节修改都只增加一条历史；
- 失败/no-op 不改变 past/future；
- undo/redo 精确恢复拍号、Beat IDs、变更点和 layout；
- 落在保留 notes Beat 上的 selection 不变；
- 落在被替换尾部 rest 上的 selection 回退到目标小节而非全谱首格；
- 拍号菜单和范围选择状态不进入历史。

## 9. Step 7：接入拍号页面工具

### 修改

- 在 `EditorShell` 的小节/结构工具区增加拍号控件；
- 根据 selection focus 解析目标 track、measure 和显示序号；
- 拍号选项从核心白名单生成；
- 增加“从当前小节起至下一拍号变化”和“仅当前小节”范围选项，默认前者；
- 提交 `measure.setTimeSignature`，页面不预计算目标范围或 Beat；
- 复用现有 disabled、错误提示、undo/redo 和自动 layout 流程；
- 补充中文可访问名称及当前值文本。

### 组件测试

- focus 跨 system 时仍命中正确小节；
- 跨小节矩形选区以 focus 而非 anchor 为目标；
- 无 document/selection 时控件禁用；
- 四个拍号与两个范围生成正确命令 payload；
- 命令失败显示核心错误且页面不残留草稿状态；
- 成功后工具显示新拍号并可撤销。

## 10. Step 8：Layout 与交互回归

### 自动化

- 第一小节拍号修改后仍只显示一次；
- 在连续相同拍号中间创建变更点时，新旧拍号都在正确小节显示；
- 将相邻段落改成同拍号后，多余变更点自动消失；
- 拍号前导宽度、measure intrinsic width 和 system 自动断行重新计算；
- hit index、focus caret、拖动和跨 system selection 使用新坐标；
- barline、TAB header、duration lane 和小节增删复制无回归。

### 浏览器验收

- 在固定 A4 桌面页面分别创建 `2/4`、`3/4`、`6/8` 变更点；
- 验证单小节临时变拍会在下一小节恢复旧拍号显示；
- 验证持续范围在下一既有变更点停止；
- 验证容量增大补 rest、可安全缩小裁尾部 rest、真实内容溢出明确报错；
- 验证 `3/4` 和 `6/8` 连梁分组视觉不同且正确；
- 验证 undo/redo、点击、键盘导航和跨 system 选区；
- 页面与控制台无 warning/error。

## 11. Step 9：全量检查与完成记录

### 必跑命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

### 完成记录

实现完成后在本文末尾追加：

- 完成日期与状态；
- 核心包、website 和总测试数量；
- 四条全量命令结果；
- 浏览器、视口与验收谱例；
- 已验证拍号、范围、容量协调、连梁、历史和选区；
- 已知限制；
- 用户审查结论。
