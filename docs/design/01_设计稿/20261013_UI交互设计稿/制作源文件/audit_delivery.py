"""核对设计文件、对比度与清单，并同步交付索引。"""
from pathlib import Path
from collections import Counter
from PIL import Image
import json
import sys
# 审核只更新明确交付文件，不改动仓库里已有的 Python 字节码缓存。
sys.dont_write_bytecode = True
from render_designs import C

ROOT = Path(__file__).resolve().parents[1]
items = json.loads((ROOT/'制作源文件/manifest.json').read_text())
counts = Counter(item['category'] for item in items)
descriptions = {
    '04_简谱_单拍多音': '紧凑单音组：定位与模式同行，输入前置，节奏、预览与内联提交随后',
    '05_简谱_连续录入与覆盖保护': '紧凑连续录入：录入范围与高级操作默认收起，默认不覆盖',
    '10_独立简谱_音高时值与技巧属性': '技巧工具栏快捷入口 + 音符技巧展开态；音高和记号分别提交',
    '16_简谱_范围复用展开操作': '范围复用展开态：复制、覆盖、插入、合并与连音组移除',
    '04_未应用草稿保护': '单草稿三选项；简谱目标切换暂存恢复；多草稿处理见最新复审 S01/S02',
    '10_曲谱打开失败与版本提示': '库/宿主加载失败保留源数据；文件导入另有显式升级确认流程',
}

# 实施注释必须覆盖且仅覆盖交付清单，避免新增画面遗漏或引用失效。
implementation_path = ROOT/'制作源文件/implementation-review.json'
implementation = json.loads(implementation_path.read_text()) if implementation_path.exists() else None
if implementation:
    reviewed = [screen['file'] for screen in implementation['screens']]
    expected = [item['file'] for item in items]
    if len(reviewed) != len(set(reviewed)) or set(reviewed) != set(expected):
        raise ValueError('实施复审与画面清单不一致')
    for screen in implementation['screens']:
        if not screen['rules'] or not screen['acceptance']:
            raise ValueError('缺少实施规则或验收条件：'+screen['file'])
        for source in screen['codeEvidence']:
            if not (ROOT.parents[3]/source).is_file():
                raise ValueError('代码依据不存在：'+source)

def luminance(hex_color):
    # 使用相对亮度公式核对实际颜色 token，不从抗锯齿边缘采样。
    channels = [int(hex_color[i:i+2],16)/255 for i in (1,3,5)]
    linear = [v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4 for v in channels]
    return sum(a*b for a,b in zip(linear,(0.2126,0.7152,0.0722)))

ratios=[]
for foreground,background in [('text','white'),('muted','white'),('muted','bg'),('blue','white'),('white','blue'),('blue','soft'),('green','greenbg'),('red','redbg'),('amber','amberbg')]:
    low,high=sorted((luminance(C[foreground]),luminance(C[background])))
    ratio=(high+0.05)/(low+0.05)
    if ratio<4.5:raise ValueError(f'文字对比度不足：{foreground}/{background}: {ratio}')
    ratios.append(dict(foreground=foreground,background=background,ratio=round(ratio,3)))

for item in items:
    with Image.open(ROOT/item['file']) as image:
        if image.size!=(item['width'],item['height']):raise ValueError(item['file'])
        image.verify()
files=[p for p in ROOT.rglob('*.png') if '制作源文件' not in p.parts]
for path in files:
    with Image.open(path) as image:image.verify()
report=dict(screens=len(items),reviewPngs=len(files),categories=dict(counts),contrastChecks=ratios,validation='PNG 编码、尺寸、索引、指定颜色组合通过；未验证应用运行时与全部无障碍行为')
antd=json.loads((ROOT/'制作源文件/antd-design-tokens.json').read_text())
for name in antd['icons']:
    if not (ROOT/'制作源文件/antd-icons'/f'{name}.png').exists():raise ValueError('Ant Design 图标缺失：'+name)
report.update(antdVersion=antd['antdVersion'],officialIconCount=len(antd['icons']),designBasis='Ant Design 品牌主题静态稿；非实际 React 控件截图')
if implementation:
    # 新增静态规格单独计数，不能计入历史日期的代码复审结论。
    revision=implementation.get('designRevision',{})
    added=set(revision.get('addedScreens',[]))
    reviewed_count=sum(screen['file'] not in added for screen in implementation['screens'])
    report.update(implementationReviewDate=implementation['date'],implementationReviewCommit=implementation['commit'],implementationReviewedScreens=reviewed_count,designSpecifiedScreens=len(implementation['screens']),originalPngsRedrawn=implementation['originalPngsRedrawn'])
    if revision:report['designRevision']=revision
(ROOT/'制作源文件/validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))

lines=['# 六线猫 UI 与交互设计稿\n','文档分类：01_设计稿 · [返回 UI 设计与重构总纲](../../README.md)。本目录为全量设计参考，当前实施范围与进度见总纲。\n',f'初版日期：2026-10-13；设计修订：2026-10-19。当前修订版：**{len(items)} 张界面/状态 PNG、7 张分类总览、封面、视觉规范及 Ant Design 映射，共 {len(files)} 张评审图片**。本次仅调整设计交付，补充内容行按钮、连续填词规则入口，并按实际界面同步段落—简谱。\n',
'## 建议查看顺序\n',
'先读 [2026-10-15 最新代码落地复审](../../02_规范与复审/20261015_最新代码与设计稿落地复审.md)与[逐画面实施清单](制作源文件/implementation-review.json)。当前 schema 8，独立简谱、原生文件导入/下载及编辑/成品用途分离已实现；曲谱库保存与管理仍待建。原 PNG 保留为布局参考，有差异时按复审的行为规则实施；补充状态 S01–S07 以复审文字规格交付，未计入 PNG 数量。\n',
'设计稿已按 **Ant Design 6.4.4** 回归；通用图标来自官方资源，通用表单/菜单/页签采用对应组件规范。查看 [组件与图标映射 PNG](00_AntDesign组件与图标映射.png)、[Ant Design 落地映射](../../02_规范与复审/20261013_AntDesign设计回归与组件映射.md)、[设计稿总览](00_设计稿总览.png)、[视觉规范](00_视觉规范.png)。PNG 为静态设计表达，非实际 React 控件截图；本次仅更新设计文档、实施注释与索引，未改产品实现或持久化层。\n',
'## 分类索引\n','| 类别 | 数量 | 总览 |\n| --- | ---: | --- |']
for category,count in counts.items():lines.append(f'| {category.replace("_"," · ")} | {count} | [查看总览]({category}_总览.png) |')
lines+=['\n## 本轮关键修订\n',
'- 最新简谱布局按用户确认改为紧凑表单：定位 → 内容 → 节奏 → 范围 → 预览提交；低频音符技巧与范围复用默认收起，自定义成员使用三列表格。以 [紧凑布局说明](20261019_段落简谱表单紧凑布局说明.md) 为当前布局依据。',
'- 段落—简谱按 localhost:3000 实际界面修订：单列表单、连续录入/单音组编辑、事件与窗口、条件模板字段、内联预览与操作；新增无目标、自定义成员时值及连音时长错误稿。详见 [实际界面对齐说明](20261019_段落简谱设计稿与实际界面对齐说明.md)。',
'- 2026-10-19：歌词/简谱切换栏下增加并排的“添加歌词行”“添加简谱行”；同步常规、无目标及窄窗口状态，详见 [入口调整说明](20261019_歌词简谱编辑入口调整说明.md)。',
'- “连续歌词”标签右侧增加问号图标；悬停提示名称，点击打开 [连续填词规则浮层](04_歌词简谱与和弦/12_歌词_连续填词规则浮层.png)，关闭后继续编辑。',
'- 简谱区域移除 H/P 等 TAB 技巧字母及关联线；TAB 符干向上伸入谱内，靠近该拍最下方品位数字，在白描边外留 2px 间隙。',
'- 品位数字按实际字形居中，符干与连梁沿同一中心轴；细化单格、范围、悬停与键盘焦点，新增 [TAB 对齐与选区细节](03_编辑工作台/09_TAB对齐与选区细节.png)。',
'- 六线谱移除小节号；仅六线谱首小节与转拍小节开头显示竖排拍号，简谱不显示拍号。谱内文字去掉白底块，改用细白描边。',
'- 简谱独立编辑音符、时值与技巧；补齐减时线/连梁、附点、八度点、升降号、连音组、延音线、圆滑线及小节线。',
'- 新增独立简谱属性稿与常用符号规范稿；详见 [本轮谱面与简谱调整说明](本轮谱面与简谱调整说明.md)。',
'- 补齐小节/拍点完整菜单、休止恢复与删除、内容行管理、和弦高级操作和技巧方向/辅助品位。',
'- 简谱支持多音输入；连续录入按简谱独立时间位置预览，不逐 TAB 拍点分配。',
'- 新建名称、小节数量与进入编辑器的空谱一致；范围选区禁用仅支持单拍的时值/附点操作。',
'- 增加打开失败、保存版本冲突、字段校验、650px 低高度和 768px 紧凑状态。',
'- 加深主操作、次级说明及状态文字颜色；9 组正文 token 对比度均达到 4.5:1，禁用与装饰单独处理。\n',
'## 核心流程\n',
'1. 管理 → 新建 → 尚未保存 → 编辑 → 首次保存 → 成功 → 管理 → 重新打开。',
'2. 检查当前及全部暂存草稿 → 单草稿应用/放弃/继续编辑，多草稿逐项定位处理 → 文档未保存再保存/放弃/继续编辑 → 导航；任一步失败取消导航。简谱目标之间切换暂存/恢复，不统一弹确认。',
'3. 保存失败保留当前内容；库版本冲突不覆盖另一窗口，允许继续编辑或另存为独立副本。',
'4. 歌词按目标拍点编辑；简谱选择自己的音符/录入位置 → 音高、时值、技巧 → 预览 → 覆盖核对 → 应用。',
'5. 选范围 → 拍点复制 → 插入/覆盖预览 → 确认影响 → 应用 → 影响详情 → 撤销。',
'6. 和弦预设/指法/起始窗口/横按 → 校验 → 应用；技巧按类型显示方向、幅度、目标音或范围。',
'7. 导出 → A4 预览 → 生成单页/全部 → 进度/取消 → 下载 PNG/ZIP；失效后重新准备。\n',
'## 画面清单\n']
for category in counts:
    lines+=['### '+category.replace('_',' · ')+'\n','| 设计稿 | 主要交互 |\n| --- | --- |']
    for item in items:
        if item['category']==category:lines.append(f'| [{item["name"]}]({item["file"]}) | {descriptions.get(item["name"], item["description"])} |')
    lines.append('')
lines+=['## 落地边界\n',
'- 曲谱库首版建议 IndexedDB 本地保存，需在正式实施技术方案中审查选型。文案是“当前浏览器”，没有云端同步或跨设备承诺。',
'- 当前设计稿表达产品路径，不能替代实际实现。行为与命令以最新代码落地复审为准；原图中的 TAB 高亮、Capo 0、固定音乐间距、连续输入位置和缺失状态不可直接照搬。',
'- 固定分类只筛选；收藏/最近是列表元数据；歌名来自曲谱文档。删除尚未设计回收站，不能承诺可恢复。',
'- 调弦入口、缩放、播放、云同步不新增。保留已有 JSON 文件导入/下载，与曲谱库保存和图片导出分别呈现；已有非标准调弦的编辑限制保留。',
'- 当前格式为 schema 8，单轨且至少一小节；库/宿主普通加载严格校验，文件导入预检支持 4/5/6/7 显式升级并确认替换；失败不改会话或源数据。\n',
'## 视觉与制作\n',
'- 常规 1440×900，输出 2880×1800；另含 1280×800、1280×650、1024×768、768×900，均为 2 倍输出。',
'- 最新简谱单音组、连续录入、无目标与高级展开稿均为 1440×900；自定义成员及连音模板校验稿为 1440×1080，展示额外条件字段与完整提交状态。',
'- 中文使用 Hiragino Sans GB，英文数字 Arial；正式应用保留自己的系统字体栈，并核对字体变化后的布局。',
'- 音符工具沿用项目 SVG。谱面为静态示意；独立简谱功能已实现，正式音乐几何消费核心 layout/scene。编辑使用 editing、预览/PNG 使用 presentation，不对编辑 SVG 截图冒充成品。',
'- 源文件位于 `制作源文件/`；`prepare_antd_assets.cjs` 提取官方图标与实际 token，`render_designs.py` / `review_additions.py` 生成稿件，`audit_delivery.py` 同步索引并写核对记录。\n',
'## 验证\n',
f'{len(items)} 张画面与 {len(files)} 张交付 PNG 已完成编码/尺寸/索引核对，代表页面与补充状态完成视觉抽查。9 组指定正文配色对比度检查通过，记录见 [validation-report.json](制作源文件/validation-report.json)。没有宣称全部产品行为或无障碍认证已通过；实际实现需按落地契约验收。\n']
(ROOT/'README.md').write_text('\n'.join(lines))
print(json.dumps(report,ensure_ascii=False))
