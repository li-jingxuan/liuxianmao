# 六线猫：设计 v2 导航

当前阅读入口：[设计导航](index.html)、[和弦快捷气泡原型](prototypes/chord-popover/index.html)、[10 · 和弦快捷气泡规格](specs/10-和弦快捷气泡.md)、[11 · 和弦气泡实施复核](records/11-和弦快捷气泡实施复核.md)。工具栏调整版已接入产品，独立原型保留设计演示用途。

## 当前规则与历史边界

和弦、歌词、简谱切换目标、页签、段号、模式或结束编辑时，直接丢弃未应用输入；回到原位置读取已应用值。重复同目标、仅收起侧栏或隐藏气泡且未结束会话时保留输入。歌曲及小节设置（settings）仍保留离开确认。当前未应用输入阻断导出，已离开位置的旧输入不再阻断。

早期规格、技术方案及编辑台原型保留历史语境，其中的和弦离开确认已被上述规则替代；最新和弦气泡规则以本说明及规格 10 为准。06、07、09 是已发生的产品实施与复核记录，不能将整个目录视为尚未实施。

## 目录与阅读顺序

- [规格 specs/](specs/)：[01 · 设计方向](specs/01-设计方向.md)、[02 · 初始交互规格（历史基线）](specs/02-交互规格.md)、[08 · 工具栏附点补充](specs/08-工具栏附点补充设计.md)、[10 · 和弦快捷气泡（当前提案）](specs/10-和弦快捷气泡.md)。
- [原型 prototypes/](prototypes/)：[和弦快捷气泡](prototypes/chord-popover/index.html)；历史编辑台的[完整交互稿](prototypes/editor/index.html)、[1440px 桌面基准](prototypes/editor/desktop.html)、[并排评审板](prototypes/editor/review.html)；[工具栏附点稿](prototypes/toolbar-rhythm/index.html)。原型使用固定演示数据。
- [实施 implementation/](implementation/)：[05 · 右侧编辑台实施技术方案（历史方案）](implementation/05-右侧编辑台实施技术方案.md)。
- [记录 records/](records/)：[03 · 第一轮评审核对](records/03-评审核对.md)、[04 · 功能回溯](records/04-功能回溯.md)、[06 · 实施验收](records/06-实施验收记录.md)、[07 · 设计对齐复核](records/07-设计对齐复核.md)、[09 · 简谱与歌词设计对齐](records/09-简谱与歌词设计对齐.md)。06、07、09 记录已完成的实现与验证，早期检查结论仍以各记录标注的范围为限。
- [截图 screenshots/](screenshots/)：历史设计与产品复核截图；截图不能代替当前产品行为验收。

## 迁移说明

原根目录的 01、02、08 移至 `specs/`，03、04、06、07、09 移至 `records/`，05 移至 `implementation/`。原 `index.html`、`desktop.html`、`review.html`、`prototype.css`、`prototype.js` 移至 `prototypes/editor/`；原 `toolbar-rhythm.html` 移至 `prototypes/toolbar-rhythm/index.html`。`screenshots/` 保留原位；根 `index.html` 现为导航入口。

## 本地查看

在仓库根目录运行：

```sh
python3 -m http.server 4178 --bind 127.0.0.1
```

浏览器访问 `http://127.0.0.1:4178/docs/design-v2/`。从仓库根目录提供服务可同时访问实施记录引用的 `artifacts/`、`.openchamber/` 与源码链接。编辑台历史设计以 1440px 及以上桌面视口为基线。
