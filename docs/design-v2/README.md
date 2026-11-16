# 六线猫：设计 v2 导航

**当前维护版本：design-v2。** `docs/design/` 已完结并停止维护，只保留历史资料。新增设计稿、技术方案和评审记录统一放入本目录；原型放 `prototypes/`，技术方案放 `implementation/`。

当前实现：[REQ-043 · 常见节奏型 PRD](specs/REQ-043常见节奏型PRD.md) · [交互规格](specs/REQ-043常见节奏型交互设计.md) · [可点击设计稿](prototypes/req043/index.html) · [产品实现与验证](records/REQ-043产品实现与验证.md)。**用户已确认 v2.1 并授权实施，产品已接入、待验收**：紧凑并排对照，4/4、3/4 共用 12 种拍内模板，6/8 保留 5 种。原位替换“拍点”，只处理当前谱层，自动归拍，逐拍顺序保留音符与休止、不足补待填空位，相关标记经确认后移除。每拍超额与跨界内容整体保护，歌词／和弦保留；支持一次撤销、过期重算与保存重载后补音继承时值。未回填飞书状态。

当前实现：[REQ-031 / 033 / 038 / 039 · 设计稿 v1](prototypes/req031-039/README.md) · [交互口径](specs/REQ-031-039交互设计待确认.md) · [产品实现、验证和截图](records/REQ-031-039产品实现与验证.md)。已接入 AntD 默认页签、库覆盖自定义弹窗、192 项完整调性分组及空拍顶部状态；真实 `3001/editor` 已核对。飞书保持“待验收”。

上一轮：[REQ-019～021 重验收与 REQ-031～037](prototypes/req019-037/README.md) · [已确认口径与验收条件](specs/REQ-019-037交互设计待确认.md) · [产品实现与验证](records/REQ-019-037产品实现与验证.md)。已接入正式产品。用户验收后，REQ019～021、032、034～037 八项已更新“已完成”；031、033 的重验收修复与新增 038、039 现已实现，四项“待验收”。代码随本轮交付提交。

本轮实现与验收：[REQ-017～030 · 首页、连续选区与和弦编辑](prototypes/req017-030/README.md) · [需求与已确认口径](specs/20261115_REQ-017-030需求与口径.md) · [实现与设计回溯](records/20261115_REQ017-030首轮实现与设计回溯.md)。实际产品在 `/`、`/editor`；2026-11-16 用户确认 REQ-017、018、022～030 已完成，REQ-019～021 保留“不通过”，并授权提交及合并至 `feat/mvp-v8-gap-review`。

已完成（用户确认）：[REQ-007～016 · 歌词与简谱侧栏](prototypes/lyrics-numbered/README.md) · [可点击设计稿](prototypes/lyrics-numbered/index.html) · [交互规格与已确认口径](specs/13-歌词与简谱侧栏设计.md) · [本地实施验收](records/13-歌词与简谱侧栏实施验收.md)。简谱按输入时值自动替换，歌词空输入与 `_` 留空，八度／变音跟随谱面单音；产品实现及验证已完成，本地保留，未提交或推送。

本轮 BUG021 / 026–029：[界面验收与实际成品截图](records/14-BUG021-029界面验收.md)，包含和弦更多箭头、歌词同行应用、上下文定位按钮移除、固定展开复制范围及区内确认，按 1400px 最小桌面宽度复核。

已撤销节奏同步专项：按用户最新决定，移除“细分简谱”“拆分并同步”入口及专用实现、原型和规格，普通 TAB 编辑继续保留简谱独立时值。[历史与撤销记录](../mvp/v8/20261109_TAB节奏细分与简谱歌词占位同步修复方案.md#12-撤销显式同步操作)。

最新实施：[和弦库与指法编辑交互稿 v2.3](prototypes/chord-library/README.md)、[可点击原型](prototypes/chord-library/prototype.html)、[配套技术方案](implementation/20261107_和弦库与指法编辑优化技术方案.md)、[设计回溯记录](records/20261111_和弦设计与近期改动对齐复核.md)、[实施验收与归档记录](records/20261111_和弦库实施验收与归档.md)。独立 worktree 已实现共享“更多”、完整库、配置、图形编辑与曲谱调性；192 identities/212 voicings 通过自动校验，人工演奏性、真实 IME 与辅助技术验收待完成。紧凑排版及并行节奏录入仍属于原专项。

最新数据口径：系统和弦预置采用项目内 JSON，通过网站同源 HTTP 静态加载；当前不接第三方存储。文件放 `apps/website/public/assets/chords/`，对象存储仅作为未来迁移方向，详见技术方案 v2.3 第 3.7、5.4 节。已有[加载、设置冲突与配置故障状态稿](prototypes/chord-library/failure-states.html)，86 项原型复核保留历史，真实应用验证另记于实施记录。

重构后产品修正见[和弦交互对齐复核](records/20261111_重构后和弦交互对齐复核.md)：按交付原型补齐卡片／指法版本、配置搜索与入口预览、图形指板、共享入口和设置返回，并附真实浏览器对照证据。

当前阅读入口：[设计导航](index.html)、[和弦快捷气泡原型](prototypes/chord-popover/index.html)、[10 · 和弦快捷气泡规格](specs/10-和弦快捷气泡.md)、[11 · 和弦气泡实施复核](records/11-和弦快捷气泡实施复核.md)。工具栏调整版已接入产品，独立原型保留设计演示用途。

## 当前规则与历史边界

本轮工具栏／历史专项：[交互稿及截图](prototypes/toolbar-history/README.md) · [可点击原型](prototypes/toolbar-history/index.html) · [12 · 技术方案](implementation/12-工具栏历史与响应式优化技术方案.md) · [实施回溯](records/12-工具栏历史与响应式实施回溯.md)。包含上下扫快捷、H/P/滑音直接展示及可收起历史，沿用 px 基线。**已接入应用并执行自动化复核，仍待人工产品验收**；原型仍仅用于设计演示，实际测试边界以实施回溯为准。

面板入口最新修订：工具栏右端使用纯图标开关，右侧移除“编辑面板”标题及收起按钮整行，直接显示编辑类别页签。先更新上述交互稿，再同步应用；开关提示、展开态、草稿保护与窄屏关闭方式见专项说明。

和弦、歌词、简谱切换目标、页签、段号、模式或结束编辑时，直接丢弃未应用输入；回到原位置读取已应用值。重复同目标、仅收起侧栏或隐藏气泡且未结束会话时保留输入。歌曲及小节设置（settings）仍保留离开确认。当前未应用输入阻断导出，已离开位置的旧输入不再阻断。

早期规格、技术方案及编辑台原型保留历史语境，其中的和弦离开确认已被上述规则替代；最新和弦气泡规则以本说明及规格 10 为准。06、07、09 是已发生的产品实施与复核记录，不能将整个目录视为尚未实施。

## 目录与阅读顺序

- [规格 specs/](specs/)：[01 · 设计方向](specs/01-设计方向.md)、[02 · 初始交互规格（历史基线）](specs/02-交互规格.md)、[08 · 工具栏附点补充](specs/08-工具栏附点补充设计.md)、[10 · 和弦快捷气泡（当前提案）](specs/10-和弦快捷气泡.md)。
- [原型 prototypes/](prototypes/)：[和弦快捷气泡](prototypes/chord-popover/index.html)；历史编辑台的[完整交互稿](prototypes/editor/index.html)、[1440px 桌面基准](prototypes/editor/desktop.html)、[并排评审板](prototypes/editor/review.html)；[工具栏附点稿](prototypes/toolbar-rhythm/index.html)。原型使用固定演示数据。
- [实施 implementation/](implementation/)：[05 · 右侧编辑台实施技术方案（历史方案）](implementation/05-右侧编辑台实施技术方案.md)。
- [记录 records/](records/)：[03 · 第一轮评审核对](records/03-评审核对.md)、[04 · 功能回溯](records/04-功能回溯.md)、[06 · 实施验收](records/06-实施验收记录.md)、[07 · 设计对齐复核](records/07-设计对齐复核.md)、[09 · 简谱与歌词设计对齐](records/09-简谱与歌词设计对齐.md)。06、07、09 记录已完成的实现与验证，早期检查结论仍以各记录标注的范围为限。
- [截图 screenshots/](screenshots/)：历史设计与产品复核截图；截图不能代替当前产品行为验收。

## 迁移说明

本轮原 `docs/design/01_设计稿/20261107_工具栏历史与响应式/` 整体移至 `prototypes/toolbar-history/`，主原型更名为 `index.html`；说明、评审截图及核对脚本／记录随原型保留。配套技术方案移至 `implementation/12-工具栏历史与响应式优化技术方案.md`，相互链接与脚本访问路径同步修正。

原根目录的 01、02、08 移至 `specs/`，03、04、06、07、09 移至 `records/`，05 移至 `implementation/`。原 `index.html`、`desktop.html`、`review.html`、`prototype.css`、`prototype.js` 移至 `prototypes/editor/`；原 `toolbar-rhythm.html` 移至 `prototypes/toolbar-rhythm/index.html`。`screenshots/` 保留原位；根 `index.html` 现为导航入口。

## 本地查看

在仓库根目录运行：

```sh
python3 -m http.server 4178 --bind 127.0.0.1
```

浏览器访问 `http://127.0.0.1:4178/docs/design-v2/`。从仓库根目录提供服务可同时访问实施记录引用的 `artifacts/`、`.openchamber/` 与源码链接。编辑台历史设计以 1440px 及以上桌面视口为基线。
