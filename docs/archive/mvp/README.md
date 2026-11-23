# 六线猫 MVP 归档

这里保存 MVP 阶段的需求依据、设计稿、技术方案与验收记录。日期、范围和状态沿用当轮结论。新需求见 [v1.0 工作区](../../v1/README.md)，当前分支的产品行为见 [v1.0 设计基线](../../v1/design-baseline/README.md)。

## 版本资料

- [MVP 路线图](versions/mvp-version-roadmap.md) · [可用性差距与后续规划](versions/20261010_六线谱编辑器可用性差距与后续规划.md)
- [v2 多行谱面与最小输入](versions/v2/README.md) · [v3 小节与节奏](versions/v3/README.md) · [v4 选区、复制与历史](versions/v4/README.md) · [v4.1 拍号与小节边界](versions/v4.1/README.md)
- [v5 演奏技巧](versions/v5/README.md) · [v5.1 连音组](versions/v5.1/README.md) · [v6 音乐文字](versions/v6/README.md) · [v7 编辑完善与输出](versions/v7/README.md) · [v8 查漏补缺](versions/v8/README.md)
- [v8 需求快照](<versions/v8/问题 & 需求/story.md>) · [缺陷与验收路径](<versions/v8/问题 & 需求/bug-list.md>) · [暂停的技术专项](versions/v8/archive/)
- [吉他进阶 MVP 计划、技术方案与验收](versions/进阶能力建设/README.md) · [吉他进阶设计稿](design/进阶能力建设/README.md)

## 历史设计与专项分析

- [旧版设计总纲](design/README.md) · [逐画面设计稿](design/01_设计稿/20261013_UI交互设计稿/README.md) · [技术方案](design/03_技术方案/) · [实施验收与截图](design/04_实施验收/)
- [原始 SVG 图标素材](extracted-svg-icons/README.txt)
- [设计 v2 完整归档](design-v2/README.md) · [浏览器原型导航](design-v2/index.html) · [规格](design-v2/specs/) · [实施方案](design-v2/implementation/) · [验收记录](design-v2/records/)
- [编辑台初始交互规格](design-v2/specs/02-交互规格.md) · [完整原型](design-v2/prototypes/editor/index.html) · [附点补充稿](design-v2/prototypes/toolbar-rhythm/index.html) · [早期评审与实施记录](design-v2/records/) · [配套截图](design-v2/screenshots/)
- [REQ-048 曲谱文件流程历史方案](design-v2/specs/REQ-048本地曲谱文件流程与交互方案.md) · [v1.4 评审原型](design-v2/prototypes/req048/README.md) · [来源与复核](design-v2/records/REQ-048设计来源与复核.md)
- [密集谱面技巧布局复核](notes/20261019_密集谱面击弦标签与弧线定位方案.md) · [核心包早期布局方案](notes/core-layout/) · [早期项目流程图](notes/20261020_项目流程图.md)

## 查看与复核

从仓库根目录运行 `python3 -m http.server 4178 --bind 127.0.0.1`，按原型说明在浏览器打开对应路径。截图、样例和制作源文件随原目录保留。部分早期记录引用当时的源码位置或本地生成的 `artifacts/`、`output/`。这些引用沿用当轮记录，部分目标已经迁移或未进入仓库。

[100 小节性能基线](versions/v7/验收数据/20261012_100小节性能基线.json)保留 MVP 当轮采样。重新运行[基线测试](../../../scripts/editor-quality-baseline.test.ts)时，新报告写入 `output/editor-quality/`。
