# 歌词与简谱 · REQ-007～016 设计稿

[打开交互设计稿](index.html) · [截图评审页](review.html) · [完整交互规格](../../specs/13-歌词与简谱侧栏设计.md) · [飞书原需求](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=tcgLfi)

本轮交付为独立交互设计稿，使用固定示例数据；未修改产品源码。沿用编辑器蓝白视觉，展示侧栏与谱面气泡的同步编辑、连续输入、符号按钮和紧凑布局。

## 已确认口径

- 移除拆分与合并。
- 简谱按输入时值自动替换，覆盖默认允许，无固定范围、手动覆盖开关及强制填满。
- 歌词空输入清空当前位置；`_` 清空一个位置；普通空格仅分词。
- 八度、变音跟随谱面选中的单音，多音组不整体改变。

## 查看方式

可直接用浏览器打开 `index.html`，不依赖远程字体、图片或服务。

也可在仓库根目录启动静态服务：

```sh
python3 -m http.server 4178 --bind 127.0.0.1
```

浏览器访问 <http://127.0.0.1:4178/docs/design-v2/prototypes/lyrics-numbered/>。

## 需求覆盖

| 需求 | 本轮设计内容 | 原参考图 |
| --- | --- | --- |
| REQ-007 | 简谱未选择态精简，按钮改为“录入简谱” | [参考图](references/REQ-007.png) |
| REQ-008 | 删除单音组模式，只保留连续录入 | [参考图](references/REQ-008.png) |
| REQ-009 | 问号按需展示语法，移除重复摘要 | [参考图](references/REQ-009.png) |
| REQ-010 | 单行 Input、默认展开节奏、时值附点符号按钮 | [参考图](references/REQ-010.png) |
| REQ-011 | 紧凑位置与底栏，移除拆分合并及高级固定范围 | [参考图](references/REQ-011.png) |
| REQ-012 | 八度变音符号按钮即时应用，移除音高选择与连接 | [参考图](references/REQ-012.png) |
| REQ-013 | 删除专用复制粘贴及移除当前事件区域 | [参考图](references/REQ-013.png) |
| REQ-014 | 精简歌词未选择态，删除长说明与返回简谱 | [参考图](references/REQ-014.png) |
| REQ-015 | 连续歌词、空位置、侧栏气泡同步、“应用”原地停留 | [参考图](references/REQ-015.png) |
| REQ-016 | 删除下一处、移除歌词和冗余提示，收紧上下区域 | [参考图](references/REQ-016.png) |

十张参考图通过 `lark-cli` 从飞书表格下载并归档，后续评审可直接对照。

## 建议评审顺序

先看默认简谱面板的输入与节奏是否紧凑，再点击谱面检查气泡同步；接着看歌词留空和多音组的单音属性修改。最后通过产品下方的评审控制检查未选择与非法输入状态。详细操作例子见[规格第 6 节](../../specs/13-歌词与简谱侧栏设计.md#6-可点击评审场景)。

## 交付画面与原型复核

- [01 · 简谱与气泡同步编辑](screenshots/01-numbered-desktop.png)
- [02 · 连续歌词及空位置](screenshots/02-lyrics-desktop.png)
- [03 · 未选简谱、已有 TAB 位置](screenshots/03-numbered-empty.png)
- [04 · 390px 窄屏完整画面](screenshots/04-mobile.png)

已用 Chrome / Playwright 完成 34 项主要行为与布局断言：四分事件替换为两个八分事件、应用原地停留、无变化禁用应用、撤销、共享草稿与关闭重开、恢复、非法输入、单音属性修改、空歌词与 `_` 留空、多字词不逐字拆分、四段隔离、未选择及 TAB 起点、模拟输入法组合输入保护、帮助聚焦、正文草稿与独立属性互斥、跨断／连音组错误态，以及 1440／720／390px 布局。另检查窄屏定位、浮窗边界和底栏遮挡，修正为窄屏底栏随内容排列。

脚本语法检查、交付文件链接与截图检查通过；最终原型浏览器控制台无错误。上述结果仅适用于设计原型，模拟 composition 事件不能代替真实系统中文输入法验收。

自动化定位：`#sidebar-input`、`#popover-input`、`[data-template="eighth"]`、`#actions [data-action="apply"]`、`[data-action="restore"]`、`[data-action="undo"]`、`[data-note-target="7"][data-member="1"]`、`[data-accidental="#"]`、`[data-lyric-target="4"]`、`[data-scene]`、`[data-verse]`。`window.designDemo` 提供只用于设计演示的状态查看和场景重置方法。

## 范围边界

原型演示输入、预览、应用、恢复与撤销；不承担生产编辑器的文件保存、导出、完整音乐排版和复杂连音保真。REQ-018 的连续范围选择不在本轮范围。自动替换和 `_` 的新语义需要后续在真实核心、解析器与表单中一起实施。

文件组织：`index.html` 为原型页面，`prototype.css`／`prototype.js` 为可编辑设计源文件，`review.html` 为截图评审页，`screenshots/` 保存交付画面，`references/` 保存飞书原始参考图。
