# REQ-043 · 节奏型独立设计原型 v2.1

本目录保留独立设计原型。用户已确认 v2.1 并授权实施，真实产品的范围与证据见[产品实现与验证](../../records/REQ-043产品实现与验证.md)。直接打开 [index.html](./index.html)；原型仍无构建、外部字体或网络依赖，只写当前页面内存，不读写真实曲谱。配套 [PRD](../../specs/REQ-043常见节奏型PRD.md)、[交互规格](../../specs/REQ-043常见节奏型交互设计.md) 为 v2.1。

本轮更新独立原型、配套设计资料及 [review.cjs](./review.cjs)。最新核对结果与截图位于 [screenshots/v2.1/](./screenshots/v2.1/)；根目录旧截图和 `v2/` 为历史材料。

## 产品交互

- 入口原位替换拍点，顺序为「小节 → 节奏型 → 连音」。初始浮层关闭；默认场景「一个四分音符」，打开即看到「前八后十六」的 `1(八分)、空(十六分)、空(十六分)`。
- 仅当前活动谱层。模板库共用，浮层内只读显示层、位置、拍号，没有换层、双谱或范围按钮。评审活动层下拉位于产品框外，每次载入单层样例。
- 4/4、3/4 每个演奏拍为四分，扩充为 12 张模板（常用 8 张、三十二分细分 4 张）；6/8 仍为 5 张附点四分单拍模板，上下文明确显示「每拍附点四分」。模板卡没有搜索或细分格。
- 模板改为上方全宽四列，下方「当前 → 应用后」紧凑并排对照；SVG 高 90px。手机两列模板、上下对照；正文滚动而底部按钮保持可见。多拍谱例可横向滚动，保留每拍可读宽度。
- 单点自动处理所属完整拍；不足一拍短选区回到焦点所属完整拍（样例故意让短选区擦过下一拍，仍只处理焦点拍）；长度至少一拍时覆盖首末所属完整拍。连续两拍样例的原始选区边界不对齐拍线，高亮显示计算后的完整两拍。仍限同轨同小节，跨小节首期阻断。
- 每拍按时间顺序提取有内容的起音位置：发声音符、明确休止、带歌词空位。复音与同起音多弦算一个位置。纯空白、持久 gap、隐式空隙、混合音/空隙均忽略无内容间隙，再按模板顺序放入。剩余槽位生成真正的 `kind: 'gap'`；TAB 为无弦品位的空 beat，非休止、不复制音高/品位、不加 tie。
- 两个八分 `1、3` → 前八后十六为 `1(八分)、3(十六分)、空(十六分)`。四分休止 → `0(八分)、空、空`，只保留一个原有休止。纯空全部生成空位。
- **补充建议，待最终评审**：单拍原有内容位置多于模板槽位时阻断整个提交，避免静默丢弃尾音。各拍独立，不将第一拍超额内容挤入第二拍。选择更多槽位的模板可解除对应超额阻断。
- **补充建议，待最终评审**：原发声事件、明确休止或带词 gap 跨出完整处理范围时阻断并要求扩大范围。只有连接跨出范围时可移除连接，范围外音符保留；纯无内容 gap 可切分并保留范围外部分。Tie 相连的独立原事件各自映射，不因去掉连接而丢后续原拍点；单一长事件若整个包含在范围内，只在其 start 所属拍映射一次。
- 技巧、连音、延音线及其他演奏标记不构成硬阻断。预览列出实际目标相关标记；点击应用后出现浮层内确认区与「返回预览 / 确认调整」，无 native confirm 或新弹窗。返回、关闭或取消都不改谱；无标记直接应用。只移除与目标内容相关的连接，范围外事件和无关标记保留。
- 确认绑定预览 key（文档版本、活动层、模板、选区）。换模板、载入目标层/文档/选区样例、重新预览、撤销均清除确认；同预览提交失败保留确认态并可直接重试。原型没有真实外部文档切换，版本钩子仅演示失效语义。
- **补充建议，待最终评审**：歌词和和弦作为内容独立保护；歌词跟随原 event，和弦保留原拍点，带词 gap 占内容槽位。`content` 样例展示保留标签，无法保留全部歌词与和弦则阻断。本稿只演示这些简化内容样例，**没有验证生产核心锚点或真实歌词迁移**。
- 只有最终应用/确认成功才修改内存谱面。成功关闭并回焦入口；撤销恢复内容、标记、空位。无变化不增加 history。过期需重新预览，首次失败可重试。Esc、关闭、取消、点击产品浮层外部都会退出未应用预览。

## 评审场景

评审控件均在产品框外；更改或重置会载入稳定样例，清空历史与失败次数，并清除之前的确认。拍号、范围、活动层可组合。`single` 在 6/8 中相应为一个附点四分音符；菜单的「四分」用于默认 4/4 示例。

- `single`：每拍 1 个音；`two`：2 个音；`notes`：稳定 `1、3、5`，4/4 初始时值 `[1,1,2]`，单位十六分。
- `blank`：半拍持久 gap + 半拍隐式空白；`mixed`：音 / gap / 音；`rest`：1 个明确休止；`mixed-rest`：音 / 休止。
- `overflow`：每拍 4 个内容；`uneven`：第 1 拍 4 内容，第 2 拍 1 内容（配「连续 2 拍」看独立计划与整次阻断）。
- `decorated`：每拍两音 `1、3`；首拍击弦、首拍第二音连到第二拍的延音线，另有末拍无关滑音。默认预览 `1、3、gap`，只处理首拍时应移除 2 项并保留第二拍音与末拍滑音。选整小节时实际移除 3 项，提示同步变化。
- `content`：音符「风」+ 带词 gap「来」，和弦 C 在第 1 拍原点。和弦仅演示首拍首点未移动时保留，不代表已验证所有原拍点的迁移。
- `polyphonic`：单事件的简谱 `1/3/5` 或 TAB 三弦齐奏，只占 1 个槽位。
- `crossing-note`：首拍发声延续到第二拍；单点/短选区阻断，连续两拍或整小节可容纳后再逐拍排布。
- `none`、`crossbar`、`stale` 分别演示无选区、跨小节、过期需重新预览。
- `failure`：无标记、每拍一个音的独立提交失败样例；首次应用失败，原谱不变，再次应用成功。模型也支持同预览确认失败后保留确认态，但本稿不另加复合失败样例。

## 模板与数据钩子

十六分音符时值为 1，四分为 4，附点四分为 6，三十二分为 0.5，规划不得取整。

- 4/4、3/4 常用：`quarter [4]`、`eighths [2,2]`、`eight-sixteen [2,1,1]`、`sixteen-eight [1,1,2]`、`sixteenths [1,1,1,1]`、`dotted-eight [3,1]`、`small-syncopation [1,2,1]`、`reverse-dotted [1,3]`。
- 4/4、3/4 三十二分细分：`dotted-two-thirtyseconds [3,0.5,0.5]`、`two-thirtyseconds-dotted [0.5,0.5,3]`、`eighth-four-thirtyseconds [2,0.5,0.5,0.5,0.5]`、`four-thirtyseconds-eighth [0.5,0.5,0.5,0.5,2]`。每种仍只覆盖一拍，不代表跨拍或整小节组合。
- 6/8：`dotted-quarter [6]`、`three-eighths [2,2,2]`、`quarter-eight [4,2]`、`eight-quarter [2,4]`、`six-sixteenths [1,1,1,1,1,1]`。

`window.__req043` 为只读 getter，每次返回脱离实时状态的 JSON 快照。重点字段：`scope` 与 `selection`（自动最终范围，`scope.raw` 为原始选区，独立 `rawSelection` 同样可读）、`plans` / `perBeatPlans`（逐拍 before/after、contentCount、slotCount、addedGaps、error）、`status`、`score`（仅一个活动层的 events、marks、chords）、`preview`（key、version、removedMarks、after）、`proposed.{jian或tab}`（活动层范围内的预览事件数组）、`validation`、`confirmationKey`、`historyCount`、`undo`、`version`、`open`、`stale`、`busy`、`failed`。兼容读取 `score.jian / score.tab`，仅活动层数组有内容，另一数组为空，不代表支持双谱。状态包括 `closed / preview / blocked / confirming / applying / stale / failed`。

事件包含 `id / start / duration / kind`，`kind` 为 `note / rest / gap`；简谱 note 含 `pitches`，TAB note 含 `positions: [{string,fret}]`；gap 另有 `gap: true`，rest 另有 `rest: true`，二者无音高或弦品位字段。`lyric` 可附在 note 或 gap。多个相同起音事件也按一个起音位置规划。谱面、预览 SVG 的无障碍名称包含内容和常见时值（1/4、1/8、1/16、附点），TAB 按时值绘制休止、符干与连梁，用户界面不展示十六分格实现单位。

稳定 ID：

- 入口与浮层：`rhythm-trigger`、`rhythm-dialog`、`close-rhythm`、`cancel-rhythm`、`apply-rhythm`。
- 确认：`confirmation`、`confirmation-text`、`confirm-change`、`back-preview`。
- 评审：`review-scenario`、`review-meter`、`review-range`、`review-layer`、`review-reset`。
- 预览：`template-grid`、`template-{模板id}`、`comparison`、`result-summary`、`content-note`、`protection-note`、`validation-message`、`refresh-preview`。
- 谱面与历史：`active-score`、`active-layer-label`、`undo-button`、`toast-undo`。

已删除旧 `scope-beat / scope-bar / target-jian / target-tab / target-both / template-search / activate-jian / activate-tab`。提交约 300ms，检查应等待 `busy === false` 或浮层关闭。支持一次以上顺序撤销，无重做。

## 验证范围

Chrome 浏览器核对 **15 组通过，无运行错误**，已刷新 15 张截图。覆盖顺序映射与补空、休止、复音／TAB 多弦、逐拍超额阻断、三种拍号全部 17 种模板、新增三十二分时值与撤销、紧凑布局、标记确认与失效、取消／撤销、过期／失败重试及窄屏审稿布局。详见 [结果 JSON](./screenshots/v2.1/review-result.json)。

截图：[紧凑面板](./screenshots/v2.1/01-single-note.png) · [标记移除确认](./screenshots/v2.1/06-remove-marks-confirm.png) · [小切分](./screenshots/v2.1/13-small-syncopation.png) · [3/4 反附点](./screenshots/v2.1/14-3-4-reverse-dotted.png) · [TAB 三十二分](./screenshots/v2.1/15-tab-thirtyseconds.png)。

本稿为设计样例模型，未实现生产命令、真实事务、真实保存、打印、导出、复杂连音迁移、音频、普通音符编辑或歌词编辑。模型只载入一个活动谱层，**真实双层文档的隔离未验证**；内容样例也不证明完整歌词／和弦锚点迁移。未来产品按 PRD 验收，不能把原型结果当作已实施的证据。
