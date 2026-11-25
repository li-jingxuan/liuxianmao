# MVP v5 详细实施计划：吉他演奏技巧

## 1. 实施约束

- v4.1 全量自动化检查通过后再修改 v5 生产代码。
- 实现顺序固定为“模型 → 规则与命令 → 引用生命周期 → 横向 layout → 分段与 lane → 页面交互 → 全量验收”。
- `applyScoreCommand` 是持久化修改的唯一 interface；`buildLayout` 是 SVG 几何的唯一 interface。
- website 不计算技巧合法性、跨 system 分段、lane 或 SVG path。
- v5 实现 Tie 但不实现通用 Slur；Tuplet 按独立 v5.1 节奏补丁规划，不进入 technique 模型。
- 每一步先运行聚焦测试；任一步不得用静态 mock 掩盖尚未接通的领域或 layout 行为。
- 当前项目不维护旧 schema 迁移链，模型变更必须一次性同步所有 fixture。

## 2. Step 0：冻结 v4.1 基线与建立 v5 fixture

### 修改

- 确认 v4.1 拍号编辑 Fix 已完成并通过全量检查；
- 新增 v5 规范谱例，至少 8 小节、2 条以上 system；
- fixture 覆盖十六种技巧、方向/辅助品位参数、重叠技巧、跨小节、跨一个 system 和跨多个 system；
- 保存 v4.1 的 system 分组、Note 坐标、选择、拍号与边界基线。

### 验收

- v5 修改前全量测试可重复通过；
- 规范谱例中的所有实体 ID 唯一；
- 记录当前浏览器固定 A4 截图或明确的视觉检查基线。

## 3. Step 1：增加技巧文档模型

### 修改

- 在 `constants.ts` 增加十六种 `LXM_TECHNIQUE_TYPES`；
- 在 `types.ts` 增加 `ILXMTechnique` discriminated union；
- 为 `ILXMTrack` 增加必填 `techniques`；
- 在 `schema.ts` 增加严格判别 union；
- 更新 ID factory 支持 `createTechniqueId`；
- 同步所有 example、fixture 和测试文档。

### 测试

- 十六种合法对象均可加载；
- 缺字段、多余字段、非法 type 和非法 bend 参数被拒绝；
- 所有旧 fixture 补齐后仍通过 loader；
- 技巧 ID 与其他实体 ID 冲突被语义校验捕获。

## 4. Step 2：实现 Note/Beat 时间索引与技巧规则 Module

### 修改

- 新增 `core/technique-rules.ts`；
- 一次遍历建立 Note 与 Beat 的 track/measure/tick/order 索引；
- 实现同弦、严格时间顺序、方向、tie 同音与相邻 Beat、同弦下一音、重复和互斥检查；
- 实现 chord Beat、单音 Beat、trill 辅助品位及 palmMute/letRing 区间规则；
- 实现 `findNextNoteOnSameString` 纯查询；
- 扩展 semantic validation 校验已有文档中的技巧引用和关系。

### 测试

- 同 Beat、逆序、跨弦、方向不匹配、异音 tie、非相邻 tie 与跨休止连接；
- 悬挂引用和跨 track 引用；
- 下一同弦音可跨普通 Beat 和小节、遇到 rest 返回空，并忽略同时发生的同 Beat；
- 合法重叠与非法互斥矩阵；
- strum/arpeggio/pickStroke 目标数量、方向参数、trill 辅助品位及 palmMute/letRing 冲突；
- issue code 与 path 精确到目标技巧字段。

## 5. Step 3：实现技巧领域命令

### 修改

- 增加 `technique.add/update/remove` 命令与错误码；
- add 在全部校验后分配 ID；
- update 保留技巧 ID 并重新执行完整规则；
- remove 只按稳定技巧 ID 删除；
- 成功只复制目标 track，增加一次 revision，并执行一次最终校验；
- 完全重复 add 与等值 update 返回 no-op。

### 测试

- 十六种 add 成功；
- update 合法换型、端点修改、ID 保持和冲突失败；
- remove 成功与 not-found；
- track/note/beat/technique not-found 和全部音乐规则错误；
- 成功、失败、no-op、revision 与不可变引用；
- 任一失败不泄漏部分写入或已消费 ID。

## 6. Step 4：维护既有编辑命令的引用完整性

### 修改

- 新增内部纯函数，根据候选 track 的 Note/Beat 引用和目标约束裁剪相关技巧；
- 接入 `note.remove`、`note.removeRect`、`beat.setKind(rest)` 与 `measure.remove`；
- 明确 `measure.copy` 只复制小节内容并重建 ID，不复制技巧；
- 审计 rhythm 和 time-signature 变更是否可能删除真实 Note ID；若会，改为保留、拒绝或显式级联。

### 测试

- 删除起点、终点和 palm mute 任一端点均级联；
- 删除和弦 Note 导致 strum/arpeggio 不再满足两音要求时级联；rest 转换清理 Beat 与区间技巧；
- 批量删除多个被引用 Note 不重复处理；
- measure.remove 清理跨小节技巧；
- 无关联 Note 删除保持 techniques 数组引用（若命令的结构复制允许）；
- 级联与原编辑仍只增加一次 revision、形成一个命令结果；
- measure.copy 后新 Note 不被旧技巧引用，源技巧保持。

## 7. Step 5：扩展 layout 数据与局部技巧几何

### 修改

- 在 `layout-types.ts` 增加 technique segment、path、text 和 technique hit bounds；
- 在 `layout-constants.ts` 集中 lane、曲线、标签、箭头、虚线和文本净空；
- 新增 `technique-layout.ts`，实现十六种技巧的确定性局部几何模板；
- 泛音和极短标签作为 measure spacing 的内部 contributor；
- website 尚不渲染，但核心 layout 测试直接断言输出。

### 测试

- 每种技巧的 path/text/bounds；
- 上下滑方向和端点文字净空；
- bend `Full`、箭头，vibrato 波形，泛音括号；
- strum 直线方向、arpeggio 波浪线/箭头、tapping、trill、pickStroke 和 let ring；
- strum/arpeggio 使用完整 Note anchor 计算路径和时值，但最终 layout 隐藏目标 Beat 的品位 Note；源 document Note 保持不变；
- 相同输入重复构建得到深相等输出；
- comfortable/compact 下不低于可读净空。

## 8. Step 6：实现跨 system 分段

### 修改

- 布局完成 Note 最终 X 后建立几何索引；
- 同 system 生成完整 segment；
- 跨 system 生成 `toNext/fromPrevious/both` segment；
- 标签只放首 segment；
- 续接端点消费真实 staff 起止坐标；
- Tie 使用无箭头、无文字的开放弧线，H/P、slide、palm mute 和 let ring 分别使用自己的续接模板；
- 技巧分段只存在于 layout，不修改 document。

### 测试

- 同小节、跨小节同 system；
- 跨一个 system 和跨多个 system；
- Tie 行尾/行首开放弧线、fret 文本净空与统一 technique hit；H/P、slide、palm mute、let ring 覆盖中间行的双向续接；
- 起点或终点位于 system 首尾；
- 稀疏末行、单小节行、超宽小节；
- 与 repeatStart/repeatBoth 跨行投影组合；
- 改变 systemWidth 后只改变 segment，领域技巧深相等。

## 9. Step 7：实现 lane 分配与 system 垂直布局

### 修改

- 新增 `technique-lanes.ts`；
- 候选区间稳定排序并 first-fit 分配 lane；
- 区分 staff 内技巧和 system 上方技巧；
- 把 system 横向规划与最终 Y 定位拆开；
- technique area 高度进入 system.height、下一 system.y 和整谱 height；
- hit index 使用最终平移后的几何。

### 测试

- 相交区间使用不同 lane；
- 不相交区间复用最低 lane；
- 相同起点以稳定 type/id tie-breaker 排列；
- 多 lane 不与 TAB/拍号/staff 或前一 system rhythm lane 碰撞；
- 无技巧文档保持 v4.1 既有几何基线；
- layout height/viewBox 完整包住曲线、箭头与文字。

## 10. Step 8：接入 Store 和页面工具

### 修改

- store 增加 `selectedTechniqueId` 临时状态和协调逻辑；
- 页面从稳定 selection 解析单音或双音目标；
- 增加十六种技巧的中文工具入口；
- 为 strum/arpeggio/pickStroke 提供不混淆的方向选项，为 trill 提供辅助品位输入；
- 接入“选区两端”和“同弦下一音”连接动作；
- add/update/remove 统一调用 store `execute`；
- 将技巧工具拆为函数式 React 子模块，使用 Hooks 和纯派生函数。

### 测试

- 空单元格、单格、同弦范围、跨弦范围的工具可用性；
- 找不到下一音和核心规则失败的错误反馈；
- add/update/remove 各一条历史；
- no-op、失败不进入历史；
- undo/redo 与临时 selectedTechniqueId 协调；
- Note 级联删除技巧仍只有一条历史。

## 11. Step 9：接入 SVG 渲染与技巧命中

### 修改

- 新增纯消费 technique layer；
- 按 layout 的 `path.d`、stroke、dash、marker 和 texts 渲染；
- 技巧层不参与 TAB 单元格 pointer hit；独立 technique bounds 负责技巧选择；
- 使用 `techniqueId + segmentIndex` 作为稳定 key；
- 样式层只定义颜色、linecap、hover/selected 状态，不修正业务坐标。

### 验收

- 页面没有按 type 重新拼 path 或判断跨 system；
- 技巧可点击选择、更新和删除；
- 多 segment 点击任一段都选择同一领域技巧；
- 选区、focus caret 与技巧命中互不抢占；
- print 样式保留技巧，交互高亮在打印时隐藏。

## 12. Step 10：全量回归与版本验收

### 必跑命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

### 浏览器验收清单

- 十六种技巧在固定 A4 桌面页面可读；
- 同一 Note 的允许技巧叠加不遮挡，互斥组合无法写入；
- 扫弦、琶音方向含义正确，目标 Beat 的品位数字不进入最终屏幕与打印 SVG；删除技巧后原 Note 自动重新显示；
- 跨小节 Tie 及跨多个 system 的 H/P、slide、palm mute、let ring 续接明确；
- Tie 与 H/P 可从标签和端点语义明确区分，页面不提供通用 Slur 入口；
- 多 lane 不与上一 system rhythm lane、当前 staff 或页面边缘碰撞；
- systemWidth 改变后技巧重新分段，领域数据与历史不变；
- 新增、修改、删除、级联删除、undo 和 redo 行为正确；
- 点击、拖动、Shift 扩展、方向键、品位、rhythm、rest、小节、拍号和边界编辑无回归；
- 页面与控制台无 warning/error。

## 13. 完成定义

- 技术方案中的全部验收标准有自动化测试或明确浏览器检查覆盖；
- v5 fixture 通过 loader 与 semantic validation；
- website 没有直接修改 `ILXMDocument`，没有重复布局或技巧关系算法；
- 无悬挂技巧引用，无未记录的领域写入，无跨 system 持久化分片；
- 已知限制写入 `README.md` 或发布验收记录；
- 全量命令和固定桌面浏览器验收通过后，才标记 v5 完成。
