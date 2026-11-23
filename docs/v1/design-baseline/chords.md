# 和弦与指法

## 谱面编辑

- `/editor` 的工具栏和弦入口、谱面和弦气泡与右侧和弦区围绕所选 TAB 单拍工作。气泡和侧栏共用名称与指法草稿，同拍跨弦保留草稿，换拍读取新目标，范围选区提示选择单拍。快捷卡、库内「选用此指法」和自定义「完成编辑」均回填草稿，点击「应用」才写入谱面。 [编辑接线](../../../apps/website/components/EditorShell/music-text/MusicTextSidebar.tsx) · [同拍、换拍与范围回归](../../../apps/website/tests/req032-036-chords.browser.mjs)
- 已有和弦可清空名称后「应用」，也可用侧栏名称旁「删除」直接移除谱上的名称和指法，均进入撤销历史。工具栏也提供「删除和弦」，未应用的和弦草稿会锁住该按钮。空拍的侧栏「删除」只清空草稿，新建和弦名称为空或全为空白时无法应用。 [工具栏实现](../../../apps/website/components/EditorShell/workspace/EditorToolbar.tsx) · [气泡校验测试](../../../apps/website/tests/chord-quick-editor.test.tsx) · [删除与撤销回归](../../../apps/website/tests/chord-delete.browser.mjs)
- 侧栏「谱面显示」的「仅名称」「名称与指法」即时切换全谱指法图，打印和图片导出沿用该视图设置。切换是编辑会话中的视图操作，保留未应用草稿、原指法和编辑历史。BUG-033 的归档记录了当轮用户验收通过。 [侧栏实现](../../../apps/website/components/EditorShell/chords/ChordEditor.tsx) · [全谱与输出回归](../../../apps/website/tests/bug031-033.browser.mjs) · [BUG-033 验收记录](../../archive/mvp/versions/v8/BUG-031-033-修复与回溯.md#bug-033)

## 常用和弦与和弦库

- 气泡和侧栏复用「常用和弦」，标题旁显示 `1=…` 和「和弦库」入口，最多八张指法卡。推荐使用曲谱已确认的调性。旧谱若只有可解析的数字 1，卡片按同主音大调给出建议。此类旧谱打开和弦库时仍提示「大小调未确认」，可临时选主音和大小调浏览，或用「跟随曲谱」退出临时浏览。此操作只影响库内浏览。 [常用和弦实现](../../../apps/website/components/EditorShell/chords/ChordPresetControls.tsx) · [库内调性实现](../../../apps/website/components/EditorShell/chords/ChordLibraryModal.tsx) · [库内调性测试](../../../apps/website/tests/chord-library.test.tsx)
- 库默认打开「全部和弦」，可切至「我的指法」。全部和弦支持按名称搜索、按根音和类型筛选。按调浏览且未搜索筛选时，分为自然三和弦、七和弦、小调和声补充（仅小调）和其他和弦。搜索或筛选时平铺结果，左侧列表切换条件后回到顶部，右侧保留选中指法的详情、级数（适用时）与版本。非标准调弦下系统指法可查看并用作自定义起点，直接选用禁用。收藏须与当前轨道调弦匹配才能选用。 [和弦库实现](../../../apps/website/components/EditorShell/chords/ChordLibraryModal.tsx) · [分类与调弦测试](../../../apps/website/tests/chord-library.test.tsx)
- 系统目录 `2026.11.11.2` 收录 192 个和弦、224 套指法，同音异名计入同一和弦。 [目录数据](../../../apps/website/public/assets/chords/catalog-2026.11.11.2.json) · [目录测试](../../../packages/lxm-editor/tests/core/chord-catalog.test.ts)

## 自定义指法

- 通过「创建指法」「编辑指法」或库内「基于此指法自定义」打开指板。可按弦、在同品选择两端建立横按、擦除、设空弦或不弹、调整观察窗口起始品位，以及撤销和重做。选中按点或横按后可用 `1`–`4` 或 `T` 标注手指，用 `0` 清除指号。 [指板编辑实现](../../../apps/website/components/EditorShell/chords/ChordDiagramEditorModal.tsx) · [编辑器回归](../../../apps/website/tests/chord-diagram-editor.test.tsx)
- 「另存为我的指法」保存到本地收藏。「查看我的指法」从上层打开库，返回时保留当前编辑和撤销记录。选用收藏需先确认替换，替换后可在自定义中撤销。要写入曲谱，先「完成编辑」回到共享草稿，再「应用」。 [收藏实现](../../../apps/website/components/EditorShell/chords/chord-preferences.ts) · [替换确认实现](../../../apps/website/components/EditorShell/chords/ChordLibraryReturn.tsx) · [收藏往返与撤销回归](../../../apps/website/tests/req032-036-chords.browser.mjs)

## 历史验收

- REQ-019～023、029、030 的记录提供当轮气泡、侧栏与库的实现和浏览器证据。其「更多」布局和显示方式按该轮记录查阅。 [首轮和弦实现验收](../../archive/mvp/design-v2/records/20261115_REQ019-030和弦实现验收.md)
- REQ-038、040、041、042 的后续记录确认恢复旧分类、调性只读和当轮推荐样式已通过用户验收。 [后续产品实现与验证](../../archive/mvp/design-v2/records/REQ-038-040-042产品实现与验证.md)

## 待核对的产品项

- 统一 REQ-042 的现行口径。旧验收记录使用「C大调·和弦推荐」等标题及「更多」弹层，现行气泡和侧栏使用「常用和弦」、`1=…` 与直接打开和弦库的入口。核对标题、入口及旧谱的同主音大调建议是否按当前实现纳入 v1.0。 [现行组件](../../../apps/website/components/EditorShell/chords/ChordPresetControls.tsx) · [REQ-042 历史验收](../../archive/mvp/design-v2/records/REQ-038-040-042产品实现与验证.md#产品行为)
- 按 `2026.11.11.2` 目录逐项核对实体吉他的可演奏性，记录指法版本与试弹结果。历史审核仍标记待人工试弹。 [当前目录审核记录](../../archive/mvp/design-v2/records/20261111_chord-catalog-data-audit-v2.json)
- 用操作系统中文输入法复核组字、选字确认和取消时的应用与关闭行为。用键盘与辅助技术走查气泡、和弦库和自定义指板，包括弹层往返后的焦点、按点和横按的读报。历史记录仍列为待验。 [和弦库人工验收边界](../../archive/mvp/design-v2/records/20261111_和弦库实施验收与归档.md#人工验收边界)
