"""生成吉他进阶 MVP UI 评审 PNG；仅设计交付，不修改应用业务代码。"""
from pathlib import Path
import json
import sys

# 复用现有设计稿的 Canvas、字体、Ant Design 图标和颜色基线，保证两套稿件视觉一致。
BASE = Path(__file__).resolve().parents[2] / "01_设计稿" / "20261013_UI交互设计稿" / "制作源文件"
sys.path.insert(0, str(BASE))
import render_designs as legacy  # noqa: E402

Canvas = legacy.Canvas
C = legacy.C
font = legacy.font
ROOT = Path(__file__).resolve().parents[1]
S = legacy.S


def header(c, active="吉他进阶"):
    c.box(0, 0, c.w, 66, "white")
    c.box(24, 18, 36, 36, "blue", 8)
    c.txt(35, 25, "六", 18, "white", True)
    c.txt(76, 25, "六线猫", 20, "navy", True)
    c.txt(290, 27, "曲谱工作台", 13, "muted")
    c.txt(410, 27, active, 13, "blue", True)
    c.pill(c.w - 180, 21, "当前浏览器", "blue", 108)


def sidebar(c, selected="学习路径", narrow=False):
    width = 214 if not narrow else 72
    c.box(0, 66, width, c.h - 66, "white")
    c.line(width, 66, width, c.h, "divider")
    if narrow:
        for y, icon, color in [(118, "FileTextOutlined", "blue"), (174, "FormOutlined", "muted"), (230, "FileTextOutlined", "muted"), (286, "HistoryOutlined", "muted")]:
            c.icon(icon, 27, y, 18, color)
        return
    c.txt(24, 104, "吉他进阶", 12, "muted")
    items = [("学习路径", "FileTextOutlined"), ("理论课程", "FileTextOutlined"), ("练习中心", "FormOutlined"), ("综合考试", "FileTextOutlined"), ("学习进度", "HistoryOutlined")]
    for i, (label, icon) in enumerate(items):
        y = 140 + i * 48
        if label == selected:
            c.box(14, y - 6, width - 28, 40, "soft", 7)
        c.icon(icon, 28, y + 4, 16, "blue" if label == selected else "muted")
        c.txt(54, y + 3, label, 13, "blue" if label == selected else "muted")
    c.line(24, 408, width - 24, 408)
    c.txt(24, 438, "学习记录", 11, "muted")
    c.txt(24, c.h - 76, "本地保存", 12, "navy")
    c.txt(24, c.h - 50, "仅当前浏览器", 11, "muted")


def progress_bar(c, x, y, w, value, label=None):
    c.box(x, y, w, 8, "bg", 4)
    c.box(x, y, w * value, 8, "blue", 4)
    if label:
        c.txt(x + w + 12, y - 5, label, 12, "blue", True, latin=True)


def module_card(c, x, y, w, title, description, status, progress, color="blue", action="开始学习"):
    c.box(x, y, w, 156, "white", 8, "border")
    c.pill(x + 18, y + 18, status, color, 68 if status != "学习中" else 68)
    c.txt(x + 18, y + 56, title, 18, "navy", True)
    c.wrap(x + 18, y + 86, description, w - 36, 12, "muted", 19)
    progress_bar(c, x + 18, y + 130, w - 130, progress, f"{round(progress * 100)}%")
    c.button(x + w - 102, y + 117, 84, action, "primary" if status == "学习中" else "secondary", 32)


def score_preview(c, x, y, w):
    c.box(x, y, w, 140, "soft", 8)
    c.txt(x + 20, y + 18, "谱例 · 八分音符与十六分音符", 13, "navy", True)
    c.line(x + 22, y + 72, x + w - 22, y + 72, "muted")
    for i, n in enumerate(["0", "2", "3", "0", "2", "3", "5", "3"]):
        xx = x + 48 + i * ((w - 96) / 7)
        c.score_center(xx, y + 72, n, 14, "text")
        c.line(xx, y + 42, xx, y + 60, "text", 2)
    c.txt(x + 20, y + 106, "每拍两次 · 强弱拍保持稳定", 11, "muted")


def path_page(c):
    header(c)
    sidebar(c)
    x = 250
    c.txt(x, 108, "吉他进阶", 28, "navy", True)
    c.txt(x, 148, "从读懂节奏，到能把知识用在一段真正的演奏里。", 14, "muted")
    c.button(c.w - 210, 108, 160, "继续学习", "primary", 40)
    c.box(x, 198, c.w - x - 50, 112, "white", 8, "border")
    c.txt(x + 22, 220, "当前阶段 · 进阶基础", 13, "muted")
    c.txt(x + 22, 247, "学习进度", 20, "navy", True)
    progress_bar(c, x + 180, 258, 520, 0.43, "43%")
    c.txt(x + 22, 286, "已完成 7 / 16 项内容 · 最近学习：八分音符与十六分音符", 12, "muted")
    c.txt(x, 350, "学习路径", 18, "text", True)
    c.txt(x + 105, 354, "完成理论与练习后解锁综合考试", 12, "muted")
    module_card(c, x, 390, 355, "节奏与拍点", "八分音符、十六分音符、切分与三连音", "学习中", 0.75, "blue", "继续学习")
    module_card(c, x + 377, 390, 355, "和弦与进行", "三和弦构成与常见 I-IV-V 进行", "已完成", 1, "green", "查看复习")
    module_card(c, x, 566, 355, "音阶与指板", "A 小调五声音阶与有限区域根音定位", "未开始", 0, "muted", "查看内容")
    module_card(c, x + 377, 566, 355, "弹奏技巧", "击勾弦、滑音、推弦和闷音的读谱", "未开始", 0, "muted", "查看内容")
    c.box(x + 754, 390, 385, 332, "white", 8, "border")
    c.txt(x + 778, 416, "下一步", 15, "text", True)
    c.pill(x + 778, 450, "理论学习", "blue", 80)
    c.txt(x + 778, 488, "八分音符与十六分音符", 16, "navy", True)
    c.wrap(x + 778, 520, "掌握每拍两次与每拍四次的基本时值关系。", 330, 12, "muted", 20)
    score_preview(c, x + 778, 575, 337)
    c.button(x + 778, 685, 150, "打开理论", "primary", 32)
    c.txt(x + 778, 735, "学习记录保存在当前浏览器", 11, "muted")


def module_page(c):
    header(c)
    sidebar(c, "理论课程")
    x = 250
    c.txt(x, 106, "节奏与拍点", 26, "navy", True)
    c.txt(x, 144, "从基础时值开始，建立稳定的拍点感。", 13, "muted")
    c.button(c.w - 210, 106, 160, "继续学习", "primary", 40)
    c.box(x, 194, 760, 88, "white", 8, "border")
    c.txt(x + 22, 216, "模块进度", 12, "muted")
    progress_bar(c, x + 22, 246, 550, 0.75, "3 / 4")
    c.txt(x + 22, 261, "完成全部理论与练习后进入阶段考试", 11, "muted")
    c.txt(x, 330, "本模块内容", 18, "text", True)
    lessons = [("01", "八分音符与十六分音符", "理论 · 8 分钟", "已完成", "green"), ("02", "切分与重音位置", "理论 · 10 分钟", "学习中", "blue"), ("03", "三连音与律动", "理论 · 8 分钟", "未开始", "muted"), ("练习", "节奏选择与拍点判断", "练习 · 6 题", "待完成", "amber")]
    for i, (num, title, meta, status, color) in enumerate(lessons):
        y = 370 + i * 76
        c.box(x, y, 760, 58, "white", 7, "border")
        c.box(x + 16, y + 13, 32, 32, "soft" if color != "green" else "greenbg", 6)
        c.txt(x + 26, y + 21, num, 12, color, True, latin=True)
        c.txt(x + 72, y + 13, title, 14, "text", True)
        c.txt(x + 72, y + 35, meta, 11, "muted")
        c.pill(x + 575, y + 17, status, color, 66 if status != "学习中" else 66)
        c.icon("RightOutlined", x + 720, y + 21, 14, "muted")
    c.box(x + 790, 194, 350, 386, "soft", 8)
    c.txt(x + 814, 220, "阶段考试", 16, "navy", True)
    c.wrap(x + 814, 258, "完成本模块的 3 个理论小节和 1 项练习后，解锁 12 题综合考试。", 300, 13, "muted", 22)
    c.pill(x + 814, 344, "尚未解锁", "amber", 80)
    c.txt(x + 814, 390, "还需完成", 12, "muted")
    c.txt(x + 814, 420, "三连音与律动", 14, "text", True)
    c.txt(x + 814, 448, "节奏选择与拍点判断", 14, "text", True)
    c.button(x + 814, 512, 180, "查看未完成内容", "secondary", 32)


def theory_page(c):
    header(c, "理论课程")
    sidebar(c, "理论课程")
    x = 250
    c.txt(x, 98, "‹ 节奏与拍点", 13, "blue")
    c.txt(x, 138, "八分音符与十六分音符", 26, "navy", True)
    c.txt(x, 178, "理论 01 · 预计学习 8 分钟", 12, "muted")
    c.box(x, 220, 720, 462, "white", 8, "border")
    c.txt(x + 24, 246, "本节目标", 15, "text", True)
    for i, text in enumerate(["理解每拍两次与每拍四次的时值关系", "能在谱面中识别八分音符和十六分音符", "为后续节奏练习建立稳定的数拍方式"]):
        c.icon("CheckOutlined", x + 24, 285 + i * 28, 13, "green")
        c.txt(x + 48, 284 + i * 28, text, 12, "text")
    c.line(x + 24, 374, x + 696, 374)
    c.txt(x + 24, 396, "核心概念", 15, "text", True)
    c.wrap(x + 24, 434, "八分音符把一拍分成两份，十六分音符把一拍分成四份。练习时先用稳定的口数确认拍点，再把右手动作放到对应位置。", 650, 13, "muted", 23)
    score_preview(c, x + 24, 526, 650)
    c.box(x + 748, 220, 392, 462, "white", 8, "border")
    c.txt(x + 774, 246, "学习提示", 15, "text", True)
    c.notice(x + 774, 284, 340, "易错点", "不要把十六分音符误读成更快的八分音符；先确认一拍内的分割数量。", "amber")
    c.txt(x + 774, 390, "本节状态", 12, "muted")
    c.pill(x + 774, 420, "学习中", "blue", 68)
    c.button(x + 774, 474, 340, "进入节奏练习", "primary", 40)
    c.button(x + 774, 528, 340, "标记本节完成", "secondary", 40)
    c.txt(x + 774, 606, "完成后可随时回来复习", 11, "muted")


def answer_option(c, x, y, w, label, selected=False, correct=False):
    fill = "greenbg" if correct else "soft" if selected else "white"
    stroke = "green" if correct else "blue" if selected else "border"
    c.box(x, y, w, 48, fill, 7, stroke)
    c.box(x + 16, y + 14, 20, 20, fill, 10, stroke)
    if selected:
        c.circle(x + 26, y + 24, 6, "blue")
    if correct:
        c.icon("CheckOutlined", x + 18, y + 16, 16, "green")
    c.txt(x + 54, y + 16, label, 13, "text", True)


def practice_page(c):
    header(c, "练习中心")
    sidebar(c, "练习中心")
    x = 250
    c.txt(x, 102, "节奏与拍点 / 练习 01", 13, "blue")
    c.txt(x, 140, "从谱例中选出八分音符节奏", 24, "navy", True)
    c.txt(x, 180, "第 2 题 · 共 6 题", 12, "muted")
    progress_bar(c, x, 214, 660, 2 / 6, "2 / 6")
    c.box(x, 258, 730, 440, "white", 8, "border")
    c.txt(x + 24, 284, "下面哪一个谱例表示“一拍两次”的八分音符节奏？", 15, "text", True)
    for i, label in enumerate(["A  每拍一次", "B  每拍两次", "C  每拍四次"]):
        answer_option(c, x + 24, 338 + i * 62, 682, label, selected=i == 1, correct=i == 1)
    c.notice(x + 24, 548, 682, "回答正确", "八分音符把一拍分成两份；本题对应 B。", "green")
    c.button(x + 24, 644, 130, "重新练习", "secondary", 32)
    c.button(x + 168, 644, 174, "下一题", "primary", 32)
    c.box(x + 760, 258, 380, 440, "soft", 8)
    c.txt(x + 784, 286, "解析", 15, "navy", True)
    score_preview(c, x + 784, 328, 332)
    c.wrap(x + 784, 488, "数拍时可以使用“1-and-2-and”的方式。每个 and 都代表一处八分音符位置。", 330, 13, "muted", 23)
    c.pill(x + 784, 596, "关联理论 · 八分音符与十六分音符", "blue", 252)
    c.txt(x + 784, 646, "错误时仍可继续学习，解析会保留在错题记录中。", 11, "muted")


def exam_page(c):
    header(c, "综合考试")
    sidebar(c, "综合考试")
    x = 250
    c.txt(x, 102, "综合考试", 24, "navy", True)
    c.pill(x + 170, 104, "进行中", "blue", 62)
    c.txt(x + 260, 110, "满分 100 · 80 分及格", 12, "muted")
    c.button(c.w - 210, 101, 160, "暂存并退出", "secondary", 32)
    c.box(x, 160, c.w - x - 50, 58, "white", 8, "border")
    c.txt(x + 20, 181, "考试进度", 12, "muted")
    progress_bar(c, x + 108, 186, 610, 7 / 12, "7 / 12")
    c.txt(x + 825, 181, "已答 7 题 · 剩余 5 题", 12, "muted")
    c.box(x, 250, 730, 510, "white", 8, "border")
    c.txt(x + 24, 276, "第 7 题 · 和弦与进行", 13, "blue", True)
    c.txt(x + 24, 316, "下列哪个和弦进行对应 I - IV - V？", 16, "text", True)
    for i, label in enumerate(["A  C - F - G", "B  Am - F - C", "C  Dm - G - C", "D  Em - Am - Bm"]):
        answer_option(c, x + 24, 370 + i * 58, 682, label, selected=i == 0)
    c.button(x + 24, 630, 100, "上一题", "secondary", 32)
    c.button(x + 574, 630, 132, "下一题", "primary", 32)
    c.box(x + 760, 250, 380, 510, "white", 8, "border")
    c.txt(x + 784, 276, "题目导航", 15, "text", True)
    for i in range(12):
        xx = x + 784 + (i % 4) * 70
        yy = 324 + (i // 4) * 58
        kind = "blue" if i == 6 else "green" if i < 6 else "white"
        c.box(xx, yy, 48, 36, kind, 6, "blue" if kind == "white" else None)
        c.txt(xx + 19, yy + 10, str(i + 1), 12, "white" if kind != "white" else "text", True, latin=True)
    c.line(x + 784, 520, x + 1116, 520)
    c.icon("InfoCircleFilled", x + 784, 550, 16, "amber")
    c.wrap(x + 810, 548, "提交前可以返回修改答案；还有 5 道题未完成。", 290, 12, "muted", 20)
    c.button(x + 784, 678, 332, "检查答卷并提交", "primary", 40)


def result_page(c):
    header(c, "综合考试")
    sidebar(c, "综合考试")
    x = 250
    c.txt(x, 102, "综合考试结果", 26, "navy", True)
    c.txt(x, 144, "进阶基础 · 第一次考试", 13, "muted")
    c.box(x, 198, 370, 230, "white", 8, "border")
    c.pill(x + 24, 222, "已通过", "green", 68)
    c.txt(x + 24, 270, "86", 48, "navy", True, latin=True)
    c.txt(x + 94, 292, "/ 100 分", 14, "muted")
    c.txt(x + 24, 350, "及格线 80 分 · 用时 12 分 08 秒", 12, "muted")
    c.button(x + 24, 382, 142, "复习错题", "primary", 32)
    c.button(x + 178, 382, 142, "再次考试", "secondary", 32)
    c.box(x + 396, 198, 744, 230, "white", 8, "border")
    c.txt(x + 420, 222, "模块得分", 15, "text", True)
    for i, (label, score, color) in enumerate([("节奏与拍点", "25 / 25", "green"), ("和弦与进行", "20 / 25", "blue"), ("音阶与指板", "21 / 25", "blue"), ("弹奏技巧", "20 / 25", "blue")]):
        yy = 264 + i * 36
        c.txt(x + 420, yy, label, 12, "text")
        c.box(x + 560, yy + 4, 250, 8, "bg", 4)
        c.box(x + 560, yy + 4, 250 * (int(score[:2]) / 25), 8, color, 4)
        c.txt(x + 838, yy - 3, score, 12, color, True, latin=True)
    c.txt(x, 466, "需要复习的题目", 18, "text", True)
    c.txt(x + 160, 470, "按知识点归类 · 2 题", 12, "muted")
    wrong = [("第 04 题", "A 小调五声音阶", "把第 5 品根音误判为第 3 品", "查看理论"), ("第 09 题", "击勾弦与滑音", "目标音符方向选择错误", "重新练习")]
    for i, (num, topic, reason, action) in enumerate(wrong):
        y = 510 + i * 86
        c.box(x, y, 890, 68, "white", 7, "border")
        c.pill(x + 18, y + 20, num, "red", 82)
        c.txt(x + 120, y + 14, topic, 13, "text", True)
        c.txt(x + 120, y + 38, reason, 11, "muted")
        c.button(x + 746, y + 18, 120, action, "secondary", 32)
    c.box(x + 914, 466, 226, 154, "soft", 8)
    c.txt(x + 936, 490, "学习建议", 14, "navy", True)
    c.wrap(x + 936, 526, "先复习音阶与指板，再重新完成对应练习。", 182, 12, "muted", 21)


def progress_page(c):
    header(c, "学习进度")
    sidebar(c, "学习进度")
    x = 250
    c.txt(x, 106, "学习进度", 26, "navy", True)
    c.txt(x, 146, "查看已完成内容、考试成绩和需要复习的题目。", 13, "muted")
    cards = [("理论小节", "6 / 8", "blue"), ("练习题", "4 / 6", "blue"), ("考试最好成绩", "86", "green")]
    for i, (label, value, color) in enumerate(cards):
        xx = x + i * 246
        c.box(xx, 204, 224, 108, "white", 8, "border")
        c.txt(xx + 18, 224, label, 12, "muted")
        c.txt(xx + 18, 254, value, 28, color, True, latin=True)
        c.txt(xx + 130, 262, "持续进步", 11, "muted")
    c.txt(x, 364, "模块进度", 18, "text", True)
    for i, (label, value, note, color) in enumerate([("节奏与拍点", 0.75, "3 / 4 节内容", "blue"), ("和弦与进行", 1, "4 / 4 节内容", "green"), ("音阶与指板", 0.25, "1 / 4 节内容", "amber"), ("弹奏技巧", 0, "尚未开始", "muted")]):
        y = 408 + i * 62
        c.txt(x, y, label, 13, "text", True)
        c.txt(x + 150, y, note, 11, "muted")
        progress_bar(c, x + 320, y + 5, 400, value, f"{round(value * 100)}%")
    c.box(x + 770, 364, 370, 346, "white", 8, "border")
    c.txt(x + 794, 390, "错题复习", 15, "text", True)
    c.pill(x + 794, 426, "2 题待复习", "red", 92)
    c.txt(x + 794, 474, "按模块查看", 12, "muted")
    for i, label in enumerate(["音阶与指板 · 1 题", "弹奏技巧 · 1 题"]):
        c.box(x + 794, 506 + i * 54, 320, 40, "redbg", 6)
        c.txt(x + 810, 518 + i * 54, label, 12, "red", True)
        c.icon("RightOutlined", x + 1080, 520 + i * 54, 14, "red")
    c.button(x + 794, 636, 160, "开始复习", "primary", 32)


def narrow_page(c):
    header(c)
    sidebar(c, narrow=True)
    x = 98
    c.txt(x, 104, "吉他进阶", 24, "navy", True)
    c.txt(x, 142, "继续完成你的学习路径", 13, "muted")
    c.box(x, 190, 1160, 98, "white", 8, "border")
    c.txt(x + 20, 212, "当前学习 · 八分音符与十六分音符", 15, "navy", True)
    progress_bar(c, x + 20, 250, 760, 0.43, "43%")
    c.button(x + 930, 220, 190, "继续学习", "primary", 40)
    c.txt(x, 338, "学习模块", 18, "text", True)
    module_card(c, x, 376, 560, "节奏与拍点", "八分音符、十六分音符、切分与三连音", "学习中", 0.75, "blue", "继续学习")
    module_card(c, x + 588, 376, 560, "和弦与进行", "三和弦构成与常见 I-IV-V 进行", "已完成", 1, "green", "查看复习")
    module_card(c, x, 550, 560, "音阶与指板", "A 小调五声音阶与有限区域根音定位", "未开始", 0, "muted", "查看内容")
    module_card(c, x + 588, 550, 560, "弹奏技巧", "击勾弦、滑音、推弦和闷音的读谱", "未开始", 0, "muted", "查看内容")
    c.box(0, 828, c.w, 72, "white")
    c.line(0, 828, c.w, 828, "border")
    c.txt(98, 852, "当前浏览器本地保存", 11, "muted")
    c.button(c.w - 250, 842, 150, "继续学习", "primary", 40)


def save(c, category, name, description, flow):
    folder = ROOT / category
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.png"
    c.im.save(path, optimize=True)
    return {"category": category, "name": name, "file": f"{category}/{name}.png", "description": description, "flow": flow, "width": c.w * 2, "height": c.h * 2}


def overview(items):
    c = Canvas(1440, 1120)
    c.box(0, 0, c.w, c.h, "bg")
    c.txt(48, 44, "六线猫 · 吉他进阶 MVP", 28, "navy", True)
    c.txt(48, 92, "理论、练习、考试与进度的独立学习闭环", 14, "muted")
    c.pill(1120, 50, "8 张界面/状态稿", "blue", 150)
    for i, item in enumerate(items):
        x = 48 + (i % 4) * 340
        y = 158 + (i // 4) * 460
        c.box(x, y, 312, 400, "white", 8, "border")
        img = legacy.Image.open(ROOT / item["file"])
        img.thumbnail((288 * 2, 230 * 2), legacy.Image.Resampling.LANCZOS)
        c.im.paste(img, (round((x + 12) * 2), round((y + 12) * 2)))
        c.d = legacy.ImageDraw.Draw(c.im)
        c.txt(x + 16, y + 266, item["name"], 13, "text", True, maxw=280)
        c.wrap(x + 16, y + 298, item["description"], 280, 11, "muted", 18)
    c.im.save(ROOT / "00_设计稿总览.png", optimize=True)


def category_overview(items, category, title):
    c = Canvas(1080, 610)
    c.txt(36, 28, title, 22, "navy", True)
    c.txt(36, 66, "静态设计总览 · 1440×900 交互稿缩略图", 11, "muted")
    for i, item in enumerate(items):
        x = 36 + i * 340
        c.box(x, 112, 312, 420, "white", 8, "border")
        img = legacy.Image.open(ROOT / item["file"])
        img.thumbnail((288 * 2, 260 * 2), legacy.Image.Resampling.LANCZOS)
        c.im.paste(img, (round((x + 12) * 2), round((124) * 2)))
        c.d = legacy.ImageDraw.Draw(c.im)
        c.txt(x + 16, 412, item["name"], 12, "text", True, maxw=280)
        c.wrap(x + 16, 442, item["description"], 280, 10, "muted", 16)
    c.im.save(ROOT / f"{category}_总览.png", optimize=True)


def visual_spec():
    c = Canvas(1440, 980)
    c.txt(48, 42, "吉他进阶 MVP · 视觉规范", 26, "navy", True)
    c.txt(48, 84, "沿用六线猫现有 Ant Design 6.4.4 设计基线，补充学习模块状态语义。", 13, "muted")
    swatches = [("页面底色", "#F4F6FA", "bg"), ("主操作", "#285BE0", "blue"), ("正文", "#202838", "text"), ("成功", "#19734F", "green"), ("错误", "#BC3547", "red"), ("提醒", "#92600C", "amber")]
    for i, (label, value, color) in enumerate(swatches):
        x = 48 + (i % 3) * 220
        y = 150 + (i // 3) * 108
        c.box(x, y, 190, 74, color, 8, "border" if color == "bg" else None)
        c.txt(x, y + 84, label, 12, "text", True)
        c.txt(x, y + 105, value, 11, "muted", latin=True)
    c.line(48, 410, 1392, 410, "border")
    c.txt(48, 444, "状态表达", 18, "text", True)
    for i, (label, detail, kind) in enumerate([("学习中", "蓝色状态 + 继续学习", "blue"), ("已完成", "绿色状态 + 查看复习", "green"), ("待复习", "红色状态 + 进入复习", "red"), ("未解锁", "琥珀提示 + 列出前置条件", "amber")]):
        x = 48 + (i % 2) * 420
        y = 492 + (i // 2) * 72
        c.pill(x, y, label, kind, 82)
        c.txt(x + 104, y + 6, detail, 13, "muted")
    c.line(48, 660, 1392, 660, "border")
    c.txt(48, 694, "组件约束", 18, "text", True)
    for i, detail in enumerate(["页面级导航不嵌入编辑器属性侧栏", "内容卡片圆角不超过 8px，避免卡中卡", "主操作使用文字 + 官方图标，不只使用颜色", "长内容独立滚动，继续学习/提交动作保持可达"]):
        c.icon("CheckOutlined", 52, 744 + i * 38, 14, "green")
        c.txt(78, 742 + i * 38, detail, 13, "text")
    c.im.save(ROOT / "00_视觉规范.png", optimize=True)


def main():
    items = []
    screens = [
        ("01_学习总览", "01_吉他进阶_学习路径", path_page, "学习路径、模块状态、总体进度和继续学习", "入口 → 学习路径 → 继续学习"),
        ("01_学习总览", "02_吉他进阶_模块详情", module_page, "展示单个模块的理论、练习和考试前置条件", "学习路径 → 模块 → 理论 / 练习"),
        ("02_理论学习", "01_理论学习_节奏与拍点", theory_page, "理论目标、知识卡片、谱例、易错点和完成本节", "模块 → 理论 → 完成 / 进入练习"),
        ("03_练习作答", "01_练习作答_节奏选择与解析", practice_page, "选择答案、提交、即时解析和错题关联", "理论 → 练习 → 提交 → 解析"),
        ("04_考试与结果", "01_综合考试_进行中", exam_page, "12 题考试、题号导航、暂存和统一提交", "四模块完成 → 考试 → 提交"),
        ("04_考试与结果", "02_综合考试_结果与错题", result_page, "总分、模块分数、通过状态和错题复习", "考试提交 → 结果 → 复习 / 重考"),
        ("05_进度与窄窗口", "01_学习进度_错题复习", progress_page, "理论、练习、考试进度和错题归类", "侧栏 → 学习进度 → 错题复习"),
    ]
    for category, name, builder, description, flow in screens:
        c = Canvas()
        builder(c)
        items.append(save(c, category, name, description, flow))
    c = Canvas(1280, 900)
    narrow_page(c)
    items.append(save(c, "05_进度与窄窗口", "02_学习总览_窄窗口", "1024/1280 宽度下侧栏收纳、单列模块和固定继续学习动作", "窄窗口 → 学习路径 → 继续学习"))
    overview(items)
    for category, title in [("01_学习总览", "01 · 学习总览"), ("04_考试与结果", "04 · 考试与结果"), ("05_进度与窄窗口", "05 · 进度与窄窗口")]:
        category_overview([i for i in items if i["category"] == category], category, title)
    visual_spec()
    with (ROOT / "制作源文件" / "manifest.json").open("w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"generated {len(items)} screens")


if __name__ == "__main__":
    main()
