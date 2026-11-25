六线谱编辑器原始 SVG 素材说明

一、使用约束

- 本目录保存原始参考素材，不是应用运行时目录。
- 历史上的 icons 子目录素材已经全部平铺到当前目录，后续请直接在本目录维护。
- 接入前必须确认来源与许可证，并完成尺寸、颜色和元数据标准化。
- 工具栏可以直接使用标准化后的图标组件；谱面中的延音线和连音括号必须动态绘制。
- 运行时目标目录：apps/website/assets/svg/music-controls/

二、当前已接入的音乐控制图标（15 个）

[已提供] note-whole.svg               全音符
[已提供] note-half.svg                二分音符
[已提供] note-quarter.svg             四分音符
[已提供] note-eighth.svg              八分音符
[已提供] note-sixteenth.svg           十六分音符
[已提供] note-thirty-second.svg       三十二分音符
[已提供] note-dot.svg                 单附点命令图标，原始 data-icon 为 noteDot32
[已提供] note-double-dotted.svg       双附点命令图标
[已提供] note-tie.svg                 延音线命令图标，仅用于工具栏
[已提供] duplet.svg                   二连音（2:3 或按上下文确定）
[已提供] triplet.svg                  三连音（3:2）
[已提供] quadruplet.svg               四连音（4:3 或按上下文确定）
[已提供] quintuplet-5-4.svg           五连音（5:4）
[已提供] quintuplet-5-3.svg           五连音（5:3）
[已提供] sextuplet.svg                六连音（6:4）

注意：二连音、四连音和六连音的完整比例不能只从图标文件名推断，实际比例必须保存在 TupletGroup.actualNotes/normalNotes 中。

三、已完成语义化重命名并补充含义的素材

[已提供] ottava-15ma-above32.svg          上方十五度记号，表示高两个八度演奏（原文件：icon15-ma32.svg）
[已提供] ottava-15ma-below32.svg          下方十五度记号，表示低两个八度演奏（原文件：icon15-ma-below32.svg）
[已提供] ottava-8va32.svg                 上方八度记号，表示高八度演奏（原文件：icon8-va32.svg）
[已提供] ottava-8ba32.svg                 下方八度记号，表示低八度演奏（原文件：icon8-ba32.svg）
[已提供] minus-circle24.svg               圆形减号，常用于缩减、移除或折叠一级操作（原文件：svg-006-24x24.svg）
[已提供] plus-circle24.svg                圆形加号，常用于新增、插入或展开一级操作（原文件：svg-007-24x24.svg）
[已提供] play-rectangle24.svg             矩形容器内播放按钮，可用于媒体面板或预览入口（原文件：svg-008-24x24.svg）
[已提供] processor24.svg                  芯片/处理器图标，可用于设备、引擎或高级设置入口（原文件：svg-009-24x24.svg）
[已提供] metronome-off24.svg              关闭节拍器（原文件：svg-010-24x24.svg）
[已提供] metronome24.svg                  节拍器（原文件：svg-012-24x24.svg）
[已提供] metronome-off-alt24.svg          关闭节拍器的备用版本（原文件：svg-013-24x24.svg）
[已提供] speaker24.svg                    扬声器/音频输出图标（原文件：svg-015-24x24.svg）
[已提供] midi16.svg                       MIDI 连接/传输图标（原文件：svg-016-16x16.svg）
[已提供] circle-number-1-16.svg           圆形数字 1，可用于第一声部、第一步或第一方案标记（原文件：svg-023-16x16.svg）
[已提供] close-circle15.svg               圆形关闭图标（原文件：svg-026-15x15.svg）
[已提供] triplet-reference-01.svg         三连音参考素材（原文件：svg-045-45x42.svg）
[已提供] duplet-reference-01.svg          二连音参考素材（原文件：svg-046-45x42.svg）
[已提供] triplet-reference-02.svg         三连音参考素材，和 triplet.svg 内容重复（原文件：svg-047-45x42.svg）
[已提供] quadruplet-reference-01.svg      四连音参考素材（原文件：svg-048-45x42.svg）
[已提供] quintuplet-reference-01.svg      五连音参考素材，具体比例需结合上下文判断（原文件：svg-049-45x42.svg）
[已提供] quintuplet-reference-02.svg      五连音参考素材，具体比例需结合上下文判断（原文件：svg-050-45x42.svg）
[已提供] sextuplet-reference-01.svg       六连音参考素材（原文件：svg-051-45x42.svg）
[已提供] caret-down-stroke16-01.svg       描边下拉箭头（原文件：svg-072-16x16.svg）
[已提供] caret-down-stroke16-02.svg       描边下拉箭头，和 caret-down-stroke16-01.svg 内容重复（原文件：svg-073-16x16.svg）
[已提供] caret-down-stroke16-03.svg       描边下拉箭头，和 caret-down-stroke16-01.svg 内容重复（原文件：svg-074-16x16.svg）
[已提供] caret-down-stroke16-04.svg       描边下拉箭头，和 caret-down-stroke16-01.svg 内容重复（原文件：svg-078-16x16.svg）
[已提供] caret-down-stroke16-05.svg       描边下拉箭头，和 caret-down-stroke16-01.svg 内容重复（原文件：svg-081-16x16.svg）

说明：无法稳定推断用途的历史编号素材仍保留原名，等后续接入业务时再继续收敛。

四、平铺后的原始素材清单（新增 244 个，当前总计 259 个 SVG）

[操作类图标] 10 个
- actions-backspace24.svg
- actions-change-view-horizontal24.svg
- actions-copy24.svg
- actions-cut24.svg
- actions-export24.svg
- actions-paste24.svg
- actions-piano-keyboard24.svg
- actions-print24.svg
- actions-redo24.svg
- actions-undo24.svg

[新增/成员类图标] 1 个
- add-people24.svg

[演奏法图标] 12 个
- articulations-accent24.svg
- articulations-breathmark24.svg
- articulations-caesura24.svg
- articulations-detached-legato24.svg
- articulations-fermata24.svg
- articulations-fingering24.svg
- articulations-grace-slur24.svg
- articulations-marcato24.svg
- articulations-slurs24.svg
- articulations-staccatissimo24.svg
- articulations-staccato24.svg
- articulations-tenuto24.svg

[箭头变体图标] 1 个
- carat-down16.svg

[折叠/展开图标] 26 个
- caret-down16-2.svg
- caret-down16.svg
- caret-down24-10.svg
- caret-down24-11.svg
- caret-down24-12.svg
- caret-down24-2.svg
- caret-down24-3.svg
- caret-down24-4.svg
- caret-down24-5.svg
- caret-down24-6.svg
- caret-down24-7.svg
- caret-down24-8.svg
- caret-down24-9.svg
- caret-down24.svg
- caret-up24-10.svg
- caret-up24-11.svg
- caret-up24-12.svg
- caret-up24-2.svg
- caret-up24-3.svg
- caret-up24-4.svg
- caret-up24-5.svg
- caret-up24-6.svg
- caret-up24-7.svg
- caret-up24-8.svg
- caret-up24-9.svg
- caret-up24.svg

[状态类图标] 1 个
- check-circle-bg16.svg

[谱号图标] 17 个
- clef-c140.svg
- clef-c240.svg
- clef-c340.svg
- clef-c440.svg
- clef-c540.svg
- clef-f340.svg
- clef-f415-ma40.svg
- clef-f415-mb40.svg
- clef-f440.svg
- clef-f48-va40.svg
- clef-f48-vb40.svg
- clef-f540.svg
- clef-g215-ma40.svg
- clef-g215-mb40.svg
- clef-g240.svg
- clef-g28-va40.svg
- clef-g28-vb40.svg

[音高/调音图标] 1 个
- concert-pitch24.svg

[双向箭头图标] 2 个
- doublearrow-left24.svg
- doublearrow-right24.svg

[力度记号图标] 14 个
- dynamics-crescendo24.svg
- dynamics-decrescendo24.svg
- dynamics-forte32.svg
- dynamics-fortepiano32.svg
- dynamics-fortissimo32.svg
- dynamics-fortississimo32.svg
- dynamics-mezzo-forte32.svg
- dynamics-mezzo-piano32.svg
- dynamics-pianissimo32.svg
- dynamics-pianississimo32.svg
- dynamics-piano-forte32.svg
- dynamics-piano32.svg
- dynamics-rinforzando32.svg
- dynamics-sforzando32.svg

[编辑类图标] 2 个
- edit-outline24.svg
- edit16.svg

[升降记号与调性类图标] 1 个
- flat-power-icon24.svg

[八度记号图标（十五度）] 2 个
- ottava-15ma-below32.svg
- ottava-15ma-above32.svg

[八度记号图标（八度）] 2 个
- ottava-8ba32.svg
- ottava-8va32.svg

[乐器分类图标] 1 个
- instruments-pluckedstrings24.svg

[键盘与输入类图标] 2 个
- keyboard24-2.svg
- keyboard24.svg

[调号图标] 14 个
- keysignature-b140.svg
- keysignature-b240.svg
- keysignature-b340.svg
- keysignature-b440.svg
- keysignature-b540.svg
- keysignature-b640.svg
- keysignature-b740.svg
- keysignature-s140.svg
- keysignature-s240.svg
- keysignature-s340.svg
- keysignature-s440.svg
- keysignature-s540.svg
- keysignature-s640.svg
- keysignature-s740.svg

[小节与反复记号图标] 33 个
- measure-accelerando32.svg
- measure-add-on-left24.svg
- measure-add24.svg
- measure-atempo32.svg
- measure-coda32.svg
- measure-da-capo32.svg
- measure-dal-segno32.svg
- measure-double-barline32.svg
- measure-ending132.svg
- measure-ending232.svg
- measure-ending332.svg
- measure-ending432.svg
- measure-fine32.svg
- measure-line-break24.svg
- measure-multi-measure-rest32.svg
- measure-page-break24.svg
- measure-rehearsal-custom24.svg
- measure-rehearsal-letter24.svg
- measure-rehearsal-number24.svg
- measure-remove24.svg
- measure-repeat-left32.svg
- measure-repeat-right32.svg
- measure-repeat-xtimes32.svg
- measure-repeat224.svg
- measure-repeat24.svg
- measure-rhythmic32.svg
- measure-ritardando32.svg
- measure-segno32.svg
- measure-slash32.svg
- measure-swing1624.svg
- measure-swing32.svg
- measure-tempo24.svg
- measure-to-coda32.svg

[misc 分类图标] 1 个
- flat.svg

[音符与音高编辑图标] 25 个
- note-acciaccatura24.svg
- note-beam24.svg
- note-beaming-policy16.svg
- note-dead-note24.svg
- note-dot32.svg
- note-double-dotted32.svg
- note-eighth32.svg
- note-flat24.svg
- note-ghost-note24.svg
- note-grace-note24.svg
- note-half32.svg
- note-natural24.svg
- note-note-color24.svg
- note-quarter32.svg
- note-sharp24.svg
- note-sixteenth32.svg
- note-sixty-fourth32.svg
- note-switch-enharmonic32.svg
- note-thirty-second32.svg
- note-tie32.svg
- note-transposition16.svg
- note-unbeam24.svg
- note-voice-voice124.svg
- note-voice-voice224.svg
- note-whole32.svg

[装饰音图标] 14 个
- ornament-arpeggio24.svg
- ornament-glissando24.svg
- ornament-mordent-inverted24.svg
- ornament-tremolo124.svg
- ornament-tremolo2124.svg
- ornament-tremolo2224.svg
- ornament-tremolo224.svg
- ornament-tremolo2324.svg
- ornament-tremolo2424.svg
- ornament-tremolo324.svg
- ornament-tremolo424.svg
- ornament-trills32.svg
- ornament-turn-inverted24.svg
- ornament-turn24.svg

[播放状态图标] 1 个
- play-fill16.svg

[搜索图标] 1 个
- search-outline24.svg

[弓法图标] 2 个
- strings-downbow32.svg
- strings-upbow32.svg

[历史编号素材与后续语义化素材] 31 个
- svg-005-24x24.svg
- minus-circle24.svg
- plus-circle24.svg
- play-rectangle24.svg
- processor24.svg
- metronome-off24.svg
- svg-011-24x24.svg
- metronome24.svg
- metronome-off-alt24.svg
- speaker24.svg
- midi16.svg
- circle-number-1-16.svg
- close-circle15.svg
- svg-027-15x15.svg
- svg-029-15x15.svg
- triplet-reference-01.svg
- duplet-reference-01.svg
- triplet-reference-02.svg
- quadruplet-reference-01.svg
- quintuplet-reference-01.svg
- quintuplet-reference-02.svg
- sextuplet-reference-01.svg
- svg-052-45x42.svg
- svg-053-45x42.svg
- svg-054-45x42.svg
- svg-055-51x42.svg
- caret-down-stroke16-01.svg
- caret-down-stroke16-02.svg
- caret-down-stroke16-03.svg
- caret-down-stroke16-04.svg
- caret-down-stroke16-05.svg

[六线谱技巧图标] 13 个
- tablature-bend-full32.svg
- tablature-bend-half32.svg
- tablature-bend-release-half32.svg
- tablature-bend-release32.svg
- tablature-hammer-on-pull-off24.svg
- tablature-harmonic-artificial-touching32.svg
- tablature-harmonic-natural-sounding32.svg
- tablature-harmonic-natural-touching32.svg
- tablature-let-ring24.svg
- tablature-palm-mute24.svg
- tablature-pre-bend-full32.svg
- tablature-pre-bend-half32.svg
- tablature-slide24.svg

[文本类图标] 5 个
- text-annotation24.svg
- text-chords24.svg
- text-classic-chords24.svg
- text-figured-bass24.svg
- text-lyric24.svg

[时间与节拍工具图标] 1 个
- time16.svg

[拍号图标] 6 个
- timesignature-common24.svg
- timesignature-cut24.svg
- timesignature-eighth624.svg
- timesignature-quarter224.svg
- timesignature-quarter324.svg
- timesignature-quarter424.svg

[缩放图标] 2 个
- zoom-in24.svg
- zoom-out24.svg

说明：
- `icon15-*`、`icon8-*`、`svg-*` 仍然保留原始命名，后续若进入业务代码，建议补充语义化别名或重命名映射。
- `carat-*` 与 `caret-*` 文件名拼写并不一致，当前保持原样，仅在清单中分开记录。

五、标准化验收

[已完成] 已记录 source 与 license
[已完成] 保留 viewBox，移除固定 width/height
[已完成] 单色路径改为 currentColor
[已完成] 移除编辑器元数据、脚本、外部链接和位图
[已完成] 已运行 SVG 优化；外观等待本迭代浏览器验收
[已完成] 已注册到 svg-assets-manifest.ts
[ ] 默认、hover、active、disabled 视觉回归通过

六、整理结果

- 已将历史 icons 子目录中的 SVG 全部平铺到当前目录。
- 当前目录 SVG 总数：259 个
- 历史 icons 子目录状态：已删除
