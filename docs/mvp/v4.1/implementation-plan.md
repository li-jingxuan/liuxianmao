# MVP v4.1 详细实施计划：基础谱面标识与小节边界

## 1. 实施约束

- MVP v4 全量自动化检查保持通过后再修改生产代码。
- 实现顺序固定为“模型语义 → 边界命令 → 行头与拍号 layout → 自动断行接入 → 页面工具 → 全量验收”。
- `buildLayout(document)` 继续是渲染使用的主要 interface。
- website 不比较相邻拍号、不推导行头宽度、不重建小节线几何。
- 基础补丁中的拍号只展示；拍号编辑按独立
  [Fix 实施方案](./time-signature-editing-fix-implementation-plan.md) 在本计划完成后接入。
- 反复线只表达记谱视觉，不实现播放流程。
- 每一步先运行聚焦测试，再进入下一步。

## 2. Step 0：建立 v4.1 夹具与布局基线

### 修改

- 新增或扩展 v4.1 规范谱例：
  - 至少 8 小节和 2 条 system；
  - 包含连续相同拍号和至少两次拍号变化；
  - 覆盖六类小节线；
  - 包含谱首 `repeatStart`；
  - 保留 notes、rest、多弦、高品位和跨 system 选区数据。
- 保存 v4 当前 system 分组、measure 顺序、选择目标和右边界对齐基线。

### 验收

- 夹具通过 loader 与 semantic validation；
- 所有 ID 唯一稳定；
- 修改前的 v4 自动化检查可重复通过。

## 3. Step 1：补充小节边界模型

### 修改

- 在 `constants.ts` 增加 `LXM_TRACK_START_BARLINE_TYPES`；
- 在 `types.ts` 为 `ILXMTrack` 增加必填 `startBarline`；
- 在 `schema.ts` 增加运行时校验；
- 同步所有 example、fixture 和测试文档；
- 明确 `measure.barline` 是 measure 之后的边界。

### 测试

- `none` 与 `repeatStart` 可加载；
- 缺失或非法谱首边界被 schema 拒绝；
- 六类既有 measure barline 全部保持合法；
- 内置示例和 v2-v4 夹具无遗漏。

## 4. Step 2：实现统一边界领域命令

### 修改

- 扩展 `LXMScoreCommandEnum`：`barline.setBoundary`；
- 定义 `ILXMBarlineBoundaryReference` 和命令 interface；
- 实现谱首边界与 measure 后边界的目标解析；
- 增加 `BARLINE_BOUNDARY_NOT_FOUND`、`INVALID_BARLINE_FOR_BOUNDARY`；
- no-op 返回原 document 和原 revision；
- 成功只复制受影响分支，并调用一次最终校验。

### 测试

- 谱首 `none ↔ repeatStart`；
- 每个 measure 后六种类型的完整矩阵；
- 最后一个 measure 后设置 `repeatStart`、`repeatBoth` 时原子失败；
- track/measure 不存在和边界类型不匹配；
- 成功、失败、no-op、revision 与不可变引用；
- insert/copy/remove 继续遵守既有保守边界规则。

## 5. Step 3：实现 TAB system header layout

### 修改

- 新增 `layout/system-header-layout.ts`；
- 增加 TAB 字号、宽度、右侧净空和视觉偏移常量；
- 输出 `ILXMSystemHeaderLayout` 和最终 `staffX`；
- 第一条 system 根据 `track.startBarline` 输出可选行首反复线；
- 为后续跨行反复边界预留统一的 `leadingBarline` 几何槽位。

### 测试

- 单 system、多 system、空轨道；
- 每条非空 system 的 TAB 坐标和宽度一致；
- 谱首反复线只出现一次；
- header 几何为纯计算且不修改输入。

## 6. Step 4：实现拍号显示规则与 layout

### 修改

- 新增 `layout/time-signature-layout.ts`；
- 实现第一小节与拍号变化检测；
- 为分子、分母生成最终文字几何；
- 将拍号 leading width 计入 measure 固有宽度；
- `ILXMMeasureLayout` 增加可空 `timeSignature`。

### 测试

- 第一小节显示；
- 连续相同拍号不重复；
- numerator 或 denominator 任一变化时显示；
- 普通换行不触发重复；
- 变化点位于 system 首小节时仍显示；
- 两位数分子/分母保持居中并得到足够宽度。

## 7. Step 5：接入 system 断行与最终坐标

### 修改

- system 断行先扣除固定 header width；
- spacing summary 区分固定前导区与可伸展节奏内容；
- 根据最终 system 分组投影跨行小节边界：`repeatStart` 拆为行尾单线和下一行开始反复，`repeatBoth` 拆为行尾结束反复和下一行开始反复；
- measure 正式 layout 使用 `staffX` 后的坐标；
- 将复合小节线的 line/dot 外延计入固定边界净空；
- system width、measure width、barline、beat slot、hit index 和 selection 使用相同最终坐标；
- 保持 compact/comfortable 和稀疏 system 拉伸上限。

### 测试

- 相同 `systemWidth` 下加入行头后的确定性断行；
- 正文多小节行、稀疏末行、单小节行与超宽小节；
- 拍号前导区不参与节奏内容拉伸；
- 最后一条小节线与 system 目标右边界一致；
- repeatStart/repeatBoth 在 system 内与跨 system 两种情况下均正确投影；
- 改变 systemWidth 只改变视觉投影，不修改领域边界；
- 点击、拖动、focus caret 和跨 system 选区无横向漂移。

## 8. Step 6：接入 SVG 渲染

### 修改

- 在 system header layer 渲染 `TAB` 和可选行首反复线投影；
- 在 measure time-signature layer 渲染分子与分母；
- 继续复用既有 barline line/circle renderer；
- 增加只负责视觉样式的 class，不使用 margin/transform 修正业务坐标；
- 确认打印隐藏规则不会错误隐藏谱面标识。

### 验收

- 页面没有自行判断 TAB 或拍号显示条件；
- 文本基线、粗细线和反复点均消费 layout；
- viewBox、页面宽度和内容区没有被行头裁切。

## 9. Step 7：接入边界工具与历史

### 修改

- 增加小节右边界类型工具；
- focus 位于第一小节时提供独立的谱首开始反复开关；
- 工具调用 `barline.setBoundary`，不直接修改 document；
- 完整中文标签、当前状态、disabled 与错误提示；
- 复用 editor store 的 execute、undo 和 redo。

### 测试

- 六类右边界均可设置；
- 谱首反复可开启和关闭；
- 每次成功修改只产生一条历史；
- no-op 与失败不产生历史；
- undo/redo 恢复对应边界并重新 layout；
- selection、hover 和工具展开状态不进入历史。

## 10. Step 8：全量回归与版本验收

### 必跑命令

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

### 浏览器验收清单

- 固定 A4 桌面页面中，每条 system 行头 TAB 对齐；
- 第一小节和拍号变化点显示正确，普通换行不重复拍号；
- TAB、拍号、第一拍品位数字之间保持可读净空；
- 谱首开始反复与六类小节右边界显示正确；
- 边界修改、no-op、撤销和重做行为正确；
- 点击、拖动、Shift 扩展、跨 system 选区和两位品位输入无回归；
- rhythm、附点、rest、小节新增复制删除无回归；
- duration lane、反复点、小节线和页面边缘不重叠或裁切；
- 页面和控制台无 warning/error。

## 11. 完成记录

- 日期与状态：2026-08-12，基础谱面标识与小节边界功能已实现，等待用户代码审查。
- 自动化检查：全仓库 `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 均通过。核心包 18 个测试文件、124 个测试通过；网站 2 个测试文件、10 个测试通过。
- 浏览器验收：在 1280 × 720 桌面视口使用内置 MVP 谱例检查多 system 布局。
- 已验证交互：每行 `TAB` 行头、首次拍号、六类右边界选择、谱首反复开关，以及边界编辑的撤销/重做。
- 已验证布局：跨 system 的 `repeatStart`/`repeatBoth` 被投影为行尾与下一行行首两段视觉结果；谱首反复、反复点、拍号与第一拍之间保留独立净空。
- 已知限制：本补丁只保存记谱边界，不实现反复播放、次数或配对校验；谱首反复增加真实前导宽度，在紧凑页面上可能使自动断行结果改变。
- 视觉修复：根据用户审查意见，TAB 已调整为六线谱内纵向排列的 `T/A/B`；行头弦线贯穿谱号列，不再呈现独立空白区域。
- 视觉修复验收：核心几何回归测试和生产构建已通过；本轮本地开发服务器启动未获执行许可，修复后的真实浏览器外观留待用户页面审查。
- 用户审查结论：待审查。
