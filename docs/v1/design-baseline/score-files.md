# 曲谱文件、成品与试听

## 新建、导入和离开保护

- 首页与编辑器均可新建和导入。直接打开 `/editor` 加载示例曲《理想》。新建必填曲名，作者可选，默认 C 大调、4/4、标准调弦，生成四个空小节。导入可选文件或拖拽，支持单个不超过 10 MiB 的六线猫原生 JSON。校验后先预览元数据，再确认换谱。当前文件格式为 v8，导入时可升级 v4–v7。 [REQ-048 产品回归](../../../apps/website/tests/req048.next.browser.mjs) · [文件格式测试](../../../apps/website/tests/score-file.test.ts) · [历史评审稿](../../archive/mvp/design-v2/prototypes/req048/README.md)
- 「导出 → JSON 曲谱」下载 `曲名.lxm.json`，发起下载后更新当前曲谱的文件基线。新建或修改后未导出时，换谱、回首页、进入吉他进阶有离开确认。用户可继续编辑、不导出并继续，或下载后手动确认继续。若有登记的未应用输入，先处理草稿，定位或放弃后再发起原操作。图片和打印保留待导出的 JSON 状态。 [文件流程实现](../../../apps/website/components/EditorShell/output/use-score-file-flow.ts) · [流程测试](../../../apps/website/tests/score-file-flow.test.tsx)

## A4 图片和打印

- PNG 和打印使用已提交的曲谱、排版密度与全谱和弦图开关。PNG 为 A4 纵向白底、300 DPI、2480×3508，可生成当前页或全部页。多页打包 ZIP，超过 100 页时逐页处理。生成与下载分步，支持取消和重试。打印先预览 A4 分页，随后打开浏览器打印界面，可选打印机或另存 PDF。 [成品数据测试](../../../apps/website/tests/score-presentation.test.ts) · [图片回归](../../../apps/website/tests/image-export.browser.mjs) · [历史分页方案](../../archive/mvp/versions/v7/20261012_MVP7.2分页输出与编辑器质量技术方案.md)

## 木吉他试听与曲谱速度

- 耳机按钮进入试听模式，点击播放后从谱首或进入前选中的 TAB 小节起播。可暂停、继续、停止和跟随谱面，试听模式中谱面只读，退出后恢复编辑选区。单轨木吉他按已提交的 TAB 发声，数字按品位取音，`x` 按所在弦取和弦指法，无法解析时跳过并提示，`-` 可承接前音，单层反复回跳一次。影响演奏的修改会停止使用当前播放计划。 [REQ-076／BUG-060 产品回归](../../../apps/website/tests/req076.next.browser.mjs) · [播放计划测试](../../../packages/lxm-editor/tests/core/playback-plan.test.ts)
- 歌曲页可应用变调夹、曲谱速度和谱首速度显示开关。曲谱速度和试听速度均为 20–300 BPM，未设置时为 90 BPM。隐藏谱首速度后，试听仍使用已保存速度。临时调速可恢复曲谱速度，退出试听时重置。 [歌曲设置实现](../../../apps/website/components/EditorShell/settings/ScoreSettingsForm.tsx) · [试听会话测试](../../../apps/website/tests/score-playback-session.test.ts) · [REQ-081 历史设计](../../archive/mvp/design-v2/prototypes/req081/README.md)

REQ-048 文件流程可追溯到 `16268a8`，曲谱速度可追溯到 `7d5bb1b`。木吉他技巧的实际听感仍需按发布范围复核。 [试听历史方案](../../archive/mvp/versions/v8/REQ-076-六线谱木吉他试听技术方案.md)
