# 编辑工作台与谱面交互

## 工作台与会话

- 首页提供默认曲谱《理想》及新建、导入入口。编辑页顶栏提供「文件」「编辑」「视图」「帮助」和独立「导出」入口。「帮助 → 快捷键」可查询按键和适用条件。工具栏右端切换右侧面板，当前选区决定可用的谱层操作和侧栏内容。旧 REQ-062 评审稿把快捷键放在文件区域左侧。 [工具栏实现](../../../packages/lxm-editor-react/src/EditorShell/workspace/EditorToolbar.tsx) · [快捷键回归](../../../apps/website/tests/req062-063.next.browser.mjs) · [首页与选区历史确认](../../archive/mvp/design-v2/records/20261115_REQ017-030首轮实现与设计回溯.md)
- 主谱面和右侧属性正文独立滚动。经典滚动条使用透明操作槽和浅灰蓝细滑块，悬停、键盘聚焦与拖动时颜色加深。右栏页签、对象摘要和页脚位于正文滚动范围外。谱面产生横向溢出时，右下角缩放控件上移避让。 [REQ-097](../features/REQ-097-编辑器滚动条/README.md)
- 操作历史按会话记录已提交编辑，最多保留 100 条，最新在上。点击历史项回到该步执行后的状态，后续动作仍可依原顺序重做。回退后提交新编辑会清除重做分支，换谱会清空会话历史。 [历史回归](../../../apps/website/tests/editor-history.test.ts) · [REQ-086 历史评审稿](../../archive/mvp/design-v2/prototypes/req086/index.html)
- 和弦和简谱歌词在切换编辑对象时通常丢弃未应用输入，收起侧栏或气泡时同一会话仍可恢复输入。歌曲设置离开其编辑区域或收起面板时清理草稿，仍参与文件操作的离开确认。段落标记的有效输入可通过 Enter 或失焦保存，仍有未应用修改时由原小节的草稿保护处理。 [歌曲设置实现](../../../packages/lxm-editor-react/src/EditorShell/settings/ScoreSettings.tsx) · [草稿协调测试](../../../apps/website/tests/editor-draft-coordinator.test.ts) · [历史工具栏交付](../../archive/mvp/design-v2/records/REQ-044-047产品实现与验证.md)

## TAB、节奏与技巧

- TAB 单击选弦格，拖动或 Shift 扩展为可跨小节、跨谱行的矩形选区。右键菜单随落点和选区提供操作。指定位置复制小节使用焦点小节，通常点选插入位置即提交，遇到跨界内容走影响确认，成功后定位到副本首拍。选区侧栏保留「音符」「小节」，连音在音符区和工具栏处理。 [选区回归](../../../apps/website/tests/req018-range.browser.mjs) · [REQ-069 右键与小节操作回归](../../../apps/website/tests/req069.next.browser.mjs) · [REQ-084／085 评审稿](../../archive/mvp/design-v2/prototypes/req084-085/index.html)
- 品位数字即时写入，同一选区内两位品位合并为一步撤销，最高 24 品。`X` 写闷音，`-` 写弦格延音横线，`R` 设整拍休止，`Shift+R` 退为空拍。空谱层首次录入可继承另一层对应节奏，显式选择优先。 [编辑器快捷输入](../../../packages/lxm-editor-react/src/EditorShell/index.tsx) · [TAB 节奏录入测试](../../../packages/lxm-editor/tests/core/tab-input-rhythm.test.ts)
- 常见节奏型从工具栏及选区侧栏进入，共用所选范围与预览。按当前谱层对齐节奏锚点，保留顺序，空位待填，预览提示受影响内容，应用后可一次撤销。当前 4/4、3/4、6/8 各有 12、12、9 个拍内模板和 14、10、10 个整小节模板。旧 REQ-043 v2.1 记录中的 6/8 五项是当轮的拍内模板数。 [节奏型测试](../../../apps/website/tests/editor-rhythm-pattern.test.ts) · [模板定义](../../../packages/lxm-editor/src/core/rhythm/rhythm-pattern.ts) · [REQ-043 历史验收](../../archive/mvp/design-v2/records/REQ-043产品实现与验证.md)
- 工具栏提供 H／P／S 快捷技巧，滑音入口按目标判方向。扫弦支持逐音端点设置和 Alt／Option 离散选多个对象后批量改范围，模板首屏六项，共十二项。完整技巧面板的扫弦和琶音用气泡选方向再提交。 [技巧工具栏](../../../packages/lxm-editor-react/src/EditorShell/tools/TechniqueToolbar.tsx) · [REQ-077 扫弦回归](../../../apps/website/tests/req077.next.browser.mjs) · [BUG-063 历史验证路径](<../../archive/mvp/versions/v8/问题 & 需求/bug-list.md#bug-061067-验收路径>)

## 简谱与歌词

- 段落侧栏与谱面气泡使用当前编辑目标。可显式添加一条简谱和最多四段歌词，删除有内容的行或段需确认。简谱支持单项与连续录入，按输入时值替换，普通 TAB 编辑保留简谱的独立时值。歌词连续录入按空格、换行拆分并跳过休止，`_` 清一处，空输入清当前词位。连续歌词 Enter 换行，Ctrl／⌘+Enter 或「应用」提交，按与简谱共用的「应用后跳转」设置寻找下一个空位。 [段落侧栏实现](../../../packages/lxm-editor-react/src/EditorShell/music-text/MusicTextSidebar.tsx) · [连续歌词测试](../../../apps/website/tests/lyric-sequence.test.ts) · [REQ-007～016 历史验收](../../archive/mvp/design-v2/records/13-歌词与简谱侧栏实施验收.md)
- Alt／Option+←／→ 按单项音乐文字定位，仍有文字草稿时先提示处理。简谱弧线有独立入口，可手动选择延音线或圆滑线。圆滑线可覆盖连续的单音事件，新增范围排除休止、空位及多音事件。BUG-065 原修复已关闭，新增选择和连续音范围按历史记录由 REQ-089 跟进。 [REQ-058 定位回归](../../../apps/website/tests/req058.next.browser.mjs) · [简谱弧线工具测试](../../../apps/website/tests/editor-numbered-tie.test.tsx) · [历史验收路径](<../../archive/mvp/versions/v8/问题 & 需求/bug-list.md#bug-061067-验收路径>)

## 待核对的产品项

- 快捷键总览称 Ctrl／⌘+Enter 提交单项歌词后「留在原处」，共用提交入口会读取跳转设置。后续改动单项歌词或快捷键文案时，需要确认期望行为。 [快捷键说明](../../../packages/lxm-editor-react/src/EditorShell/session/editor-shortcuts.ts) · [歌词侧栏实现](../../../packages/lxm-editor-react/src/EditorShell/music-text/MusicTextSidebar.tsx)
- BUG-067 有实现和自动回归，历史记录中的人工验收仍为未通过，进入 v1.0 验收范围时需复验。 [核心回归](../../../packages/lxm-editor/tests/core/bug067-numbered-continuation.test.ts) · [历史验收记录](<../../archive/mvp/versions/v8/问题 & 需求/bug-list.md#bug-061067-验收路径>)
