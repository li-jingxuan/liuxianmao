"""仅用于设计稿：独立简谱声部的图形示例和 Ant Design 属性面板。"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

def arc(c,x1,y1,x2,y2,raise_by=8):
    # 连线采用平滑采样曲线，端点保持音符语义，避免直接画成小节横线。
    points=[]
    for i in range(25):
        t=i/24;points.append((x1+(x2-x1)*t,y1+(y2-y1)*t-math.sin(math.pi*t)*raise_by))
    for a,b in zip(points,points[1:]):c.line(*a,*b,'text',.9)

def pitch(c,x,y,digit,octave=0,accidental=None,size=14):
    if accidental:
        name='note-sharp24' if accidental=='#' else 'note-flat24'
        source=Path(__file__).parent/'icons'/f'{name}.png'
        glyph=Image.open(source).convert('RGBA').resize((round(size*2),round(size*2)),Image.Resampling.LANCZOS)
        # 升降号同样沿字形加白描边，不使用背景色块。
        outlined=Image.new('RGBA',(glyph.width+4,glyph.height+4))
        alpha=Image.new('L',outlined.size);alpha.paste(glyph.getchannel('A'),(2,2))
        white=Image.new('RGBA',outlined.size,'white');white.putalpha(alpha.filter(ImageFilter.MaxFilter(5)))
        outlined.alpha_composite(white);outlined.alpha_composite(glyph,(2,2))
        c.im.paste(outlined,(round((x-size-5)*2)-2,round((y-1)*2)-2),outlined);c.d=ImageDraw.Draw(c.im)
    c.score_txt(x-4,y,str(digit),size,'text',latin=True)
    for i in range(abs(octave)):c.circle(x+1,y-5-i*4 if octave>0 else y+size+4+i*4,1.1,'text')

def vertical_signature(c,x,y,numerator,denominator):
    c.score_center(x+5,y+7,str(numerator),18);c.score_center(x+5,y+30,str(denominator),18)

def tuplet_bracket(c,left,right,y,number=3,size=10,end_height=3,line_width=.8):
    # 连音组使用开口向上的短端括号，与音符减时连梁形成明确区分。
    c.line(left,y-end_height,left,y,'text',line_width)
    c.line(left,y,right,y,'text',line_width)
    c.line(right,y,right,y-end_height,'text',line_width)
    c.score_txt((left+right)/2-size*.28,y-size-3,str(number),size,'text',latin=True)

def draw_numbered_measure(c,x,y,w,variant=0,meter=4):
    # 简谱示意按自己的音符时值安排水平位置，绝不逐 TAB 音符一对一抄写。
    left=x+15;available=w-28
    if meter==3:
        tokens=[('1',0,None),('2',0,None),('3',1,None)];starts=[0,1,2];bases=['q','q','q']
    elif variant==0:
        tokens=[('1',0,None),('2',0,None),('3',1,None),('5',0,None)];starts=[0,.5,1,2];bases=['e','e','q','h']
    elif variant==1:
        tokens=[('4',0,'#'),('6',-1,None),('0',0,None),('5',1,None)];starts=[0,1.5,2,3];bases=['d','e','q','q']
        left+=9;available-=9
    elif variant==2:
        tokens=[('1',0,None),('2',0,None),('3',0,None),('5',0,None)];starts=[0,2/3,4/3,2];bases=['t','t','t','h']
    else:
        tokens=[('5',1,None),('-',0,None),('5',1,None),('6',0,'b')];starts=[0,1,2,3];bases=['q','q','q','q']
    xs=[left+available*t/meter for t in starts]
    for index,((digit,octave,accidental),xx,base) in enumerate(zip(tokens,xs,bases)):
        pitch(c,xx,y,digit,octave,accidental,12)
        if base=='e':c.line(xx-5,y+20,xx+8,y+20,'text',1)
        if base=='d':c.circle(xx+11,y+6,1.2,'text')
        if base=='h':c.score_txt(xx+16,y,'—',12,'text',latin=True)
    if meter==4 and variant==0:c.line(xs[0]-5,y+20,xs[1]+8,y+20,'text',1)
    if meter==4 and variant==2:
        tuplet_bracket(c,xs[0]-5,xs[2]+9,y-12)
    if meter==4 and variant==3:arc(c,xs[0],y-8,xs[2]+5,y-8,5)
    # 简谱小节线覆盖简谱自身上下点与减时线，和 TAB 小节边界共用时间分界。
    c.line(x+w,y-8,x+w,y+25,'text',.8)

def numbered_panel(c,x,y,w,bottom,single=False,view='form',template='uniform',empty=False):
    # 高频定位和内容前置；窗口与高级操作按目标和展开状态呈现，独立提交语义保持不变。
    from render_designs import Canvas, content_row_actions, panel_tabs
    from PIL import ImageDraw
    body=Canvas(round(w+40),1900)
    body.box(0,0,w+40,1900,'white')
    bx=20;by=12;column=(w-8)/2
    custom=template=='custom';tuplet=template=='tuplet';new_range=custom or tuplet
    expanded_techniques=view=='techniques'
    expanded_reuse=view=='reuse'
    techniques_start=0
    reuse_start=0

    def disclosure(yy,label,summary='',opened=False):
        # 折叠标题保留摘要，展开与收起只控制显示，不清空目标或草稿。
        body.box(bx,yy,w,32,'bg',5)
        body.icon('DownOutlined' if opened else 'RightOutlined',bx+10,yy+10,12,'muted')
        body.txt(bx+30,yy+9,label,13,'text',True)
        if summary:body.txt(bx+132,yy+10,summary,11,'muted',maxw=w-144)
        return yy+32

    content_row_actions(body,bx,by,w)
    panel_tabs(body,bx,by+40,w,'简谱')
    yy=by+84
    body.field(bx,yy,column,'当前简谱事件','新增时间范围' if new_range else '第1拍 · 1' if not empty else '尚未选择',select=not empty)
    if empty:
        body.box(bx,yy+24,column,32,'bg',6,'border');body.txt(bx+11,yy+33,'尚未选择',14,'subtle')
    body.field(bx+column+8,yy,column,'录入方式','单音组编辑' if single else '连续录入',select=True)
    yy+=68
    advanced_start=yy
    if empty:
        body.notice(bx,yy+8,w,'请选择简谱音符或录入窗口','可直接选择简谱音符，或从六线谱选拍建立录入窗口。')
        content_end=yy+100
    else:
        # 文本输入在节奏与窗口之前，语法提示单行化，完整语法通过问号入口查看。
        body.txt(bx,yy,'单音组简谱' if single else '连续简谱',14)
        body.icon('QuestionCircleOutlined',bx+w-18,yy,14,'muted')
        body.box(bx,yy+22,w,56,'white',6,'border')
        body.txt(bx+12,yy+38,'1 2' if custom else '1+3+5' if single else '1',14)
        body.txt(bx,yy+90,'空格分先后音 · + 同时音',11,'muted')
        yy+=122
        body.field(bx,yy,w,'节奏模板','自定义成员时值' if custom else '自选节奏连音' if tuplet else '自选时值',select=True)
        yy+=68
        if custom:
            # 成员时值使用紧凑三列表格；每个输入项仅占一行，时值和附点同行。
            row_h=40;index_w=44;cell=(w-index_w-16)/2
            body.box(bx,yy,w,24+2*row_h+8,'white',6,'border')
            body.box(bx+1,yy+1,w-2,23,'bg',5)
            body.txt(bx+12,yy+6,'音序',11,'muted')
            body.txt(bx+index_w+8,yy+6,'时值',11,'muted')
            body.txt(bx+index_w+cell+16,yy+6,'附点',11,'muted')
            for index in range(2):
                ry=yy+28+index*row_h
                body.txt(bx+16,ry+10,str(index+1),12,'muted',latin=True)
                body.button(bx+index_w,ry,cell,'四分 ⌄')
                body.button(bx+index_w+cell+8,ry,cell,'无附点 ⌄')
            yy+=124
        if tuplet:
            body.field(bx,yy,w,'连音比例','3 : 2',select=True);yy+=68
        body.field(bx,yy,column,'简谱时值','四分',select=True)
        body.field(bx+column+8,yy,column,'时值附点','无',select=True)
        if not new_range:body.icon('QuestionCircleOutlined',bx+64,yy,12,'muted')
        yy+=76
        yy=disclosure(yy,'录入范围','新增窗口' if new_range else '第1拍 · 当前范围',new_range)
        if new_range:
            yy+=12
            body.field(bx,yy,column,'录入起点','第1拍',select=True)
            body.field(bx+column+8,yy,column,'覆盖时长','两个四分拍' if custom else '当前范围',select=True)
            yy+=56
        yy+=20
        # 校验失败只展示错误，不同时绘制成功预览；覆盖默认关闭，动作紧跟当前内容。
        body.box(bx,yy,w,56 if tuplet else 40,'redbg' if tuplet else 'soft',6)
        if tuplet:
            body.wrap(bx+12,yy+11,'模板时长 640 tick 与窗口 960 tick 不一致',w-24,12,'red',20)
            yy+=56
        else:
            body.txt(bx+12,yy+14,'预览：1（四分） · 2（四分）' if custom else '预览：1+3+5（四分）' if single else '预览：1（四分）',12,'text',maxw=w-24)
            yy+=40
        yy+=12
        body.txt(bx,yy,'□ 允许覆盖此时间范围的简谱',12)
        yy+=28
        body.button(bx,yy,96,'删除简谱','disabled' if new_range else 'secondary')
        body.button(bx+w-160,yy,72,'取消')
        body.button(bx+w-80,yy,80,'应用','disabled' if tuplet else 'primary')
        yy+=52
        advanced_start=yy
        if not new_range:
            techniques_start=yy
            yy=disclosure(yy,'音符技巧','时值、音高、连接',expanded_techniques)
            if expanded_techniques:
                # 时值与单音符音高各自提交，按钮紧随所属字段，不合并进内容应用。
                yy+=12
                body.txt(bx,yy,'当前时值：四分 · 无附点',12,'muted');yy+=24
                body.button(bx,yy,176,'应用当前音符时值');body.button(bx+184,yy,144,'等分持续音');yy+=52
                body.field(bx,yy,column,'起始音符','1 : 1',select=True)
                body.field(bx+column+8,yy,column,'单音符音高','1');yy+=68
                bw=(w-32)/5
                for index,label in enumerate(['升音','降音','还原','低一八度','高一八度']):body.button(bx+index*(bw+8),yy,bw,label)
                yy+=44
                body.button(bx,yy,160,'应用单音符音高');yy+=52
                body.field(bx,yy,w,'连接终点','请选择',select=True);yy+=68
                bw=(w-16)/3
                body.button(bx,yy,bw,'添加延音线','disabled')
                body.button(bx+bw+8,yy,bw,'添加连音线','disabled')
                body.button(bx+2*(bw+8),yy,bw,'切换延长记号');yy+=52
                body.txt(bx,yy,'已有记号：延长记号',12,'muted');yy+=24
                body.button(bx,yy,152,'更新记号端点');body.button(bx+160,yy,112,'删除记号');yy+=32
            yy+=12
        reuse_start=yy
        yy=disclosure(yy,'范围复用','复制、覆盖、插入、合并' if not new_range else '复制、覆盖、插入',expanded_reuse)
        if expanded_reuse:
            yy+=10
            body.box(bx,yy,w,28,'soft',5)
            body.txt(bx+10,yy+8,'作用范围：第2拍 – 第4拍 · 共 3 个音符',11,'blue')
            yy+=38;bw=(w-16)/3
            body.button(bx,yy,bw,'复制简谱范围')
            body.button(bx+bw+8,yy,bw,'覆盖简谱')
            body.button(bx+2*(bw+8),yy,bw,'插入简谱');yy+=44
            if not new_range:
                body.button(bx,yy,136,'合并至终点');body.button(bx+144,yy,176,'移除简谱连音组');yy+=32
        content_end=yy+20
    # 默认首屏完整呈现高频操作；高级展开态滚到对应区域，表单草稿仍保留在上方。
    # 展开态定位到对应分区，同时让全局简谱快捷工具栏固定可见。
    section_start=techniques_start if expanded_techniques else reuse_start if expanded_reuse else advanced_start
    scroll=max(0,section_start-12) if expanded_techniques or expanded_reuse else 0
    top=y-20;visible=c.h-29-top
    crop=body.im.crop((0,round(scroll*2),round((w+40)*2),round((scroll+visible)*2)))
    c.im.paste(crop,(round((x-20)*2),round(top*2)))
    c.d=ImageDraw.Draw(c.im)
    if content_end>visible:
        rail=visible-12;thumb=max(40,rail*visible/content_end)
        thumb_y=top+6+(rail-thumb)*scroll/max(1,content_end-visible)
        c.line(x+w+11,top+6,x+w+11,top+visible-6,'divider',4)
        c.line(x+w+11,thumb_y,x+w+11,min(thumb_y+thumb,top+visible-6),'border',4)

def build_notation_sheets(d):
    Canvas,editor,save=[d[k] for k in ['Canvas','editor','save']]
    c=Canvas();x,y,w,b=editor(c,'single',panel='numbered');numbered_panel(c,x,y,w,b,view='techniques')
    save(c,'04_歌词简谱与和弦','10_独立简谱_音高时值与技巧属性','常用延音、连音与延长记号提供工具栏快捷入口；展开区编辑音高和技巧端点','选中简谱音符 → 工具栏快捷加技巧，或展开音符技巧编辑与应用')
    c=Canvas(1440,900);x,y,w,b=editor(c,'single',panel='numbered');numbered_panel(c,x,y,w,b,view='reuse')
    save(c,'04_歌词简谱与和弦','16_简谱_范围复用展开操作','范围复用展开态：复制、覆盖、插入、合并及连音组移除按操作风险与范围分组','选中范围 → 展开范围复用 → 复制后选择覆盖或插入 → 按需合并或移除连音组')
    # 补充实际无目标、模板成员时值与连音校验；均为段落—简谱，不混入歌词或和弦。
    c=Canvas();x,y,w,b=editor(c,panel='numbered');numbered_panel(c,x,y,w,b,empty=True)
    save(c,'04_歌词简谱与和弦','13_简谱_无目标与录入窗口提示','紧凑无目标：事件禁用提示、录入方式与建立窗口说明','段落 → 简谱 → 选择简谱音符或 TAB 录入窗口')
    c=Canvas(1440,1080);x,y,w,b=editor(c,'single',panel='numbered');numbered_panel(c,x,y,w,b,view='custom',template='custom')
    save(c,'04_歌词简谱与和弦','14_简谱_自定义成员时值','成员时值按音序、时值、附点三列表格排布；新增窗口自动展开','输入两项 → 自定义成员时值 → 三列表格配置 → 核对窗口')
    c=Canvas(1440,1080);x,y,w,b=editor(c,'single',panel='numbered');numbered_panel(c,x,y,w,b,view='error',template='tuplet')
    save(c,'04_歌词简谱与和弦','15_简谱_连音模板与时长校验','自选节奏连音显示比例；模板与窗口时长不一致时禁用应用','选择自选节奏连音 → 核对比例与窗口 → 修正校验错误')
    c=Canvas();c.box(0,0,1440,900,'white');c.txt(40,30,'简谱常用记谱 / 视觉规则',28,'navy');c.txt(40,82,'独立音符、时值和技巧编辑；简谱不显示拍号，谱内文字使用白色描边',14,'muted')
    examples=['时值与连梁','高低八度与升降','三连音组','延音与圆滑连线','小节线与反复','拍号仅在六线谱显示']
    for i,title in enumerate(examples):
        xx=40+(i%2)*695;yy=136+(i//2)*226;c.box(xx,yy,650,203,'bg',8);c.txt(xx+20,yy+18,title,17)
        if i==0:
            for k,base in enumerate(['q','e','s','h','d']):
                nx=xx+55+k*114;pitch(c,nx,yy+71,k+1,size=24)
                if base in ['e','s']:c.line(nx-10,yy+100,nx+17,yy+100,'text',1.5)
                if base=='s':c.line(nx-10,yy+106,nx+17,yy+106,'text',1.5)
                if base=='h':c.score_txt(nx+27,yy+71,'—',24)
                if base=='d':c.circle(nx+24,yy+83,2,'text')
                c.txt(nx-13,yy+144,['四分','八分','十六分','二分','附点'][k],13,'muted')
            c.line(xx+159,yy+100,xx+300,yy+100,'text',1.5)
        elif i==1:
            for k,(digit,octave,accidental) in enumerate([('1',1,None),('2',2,None),('3',-1,None),('4',0,'#'),('7',0,'b')]):pitch(c,xx+63+k*112,yy+79,digit,octave,accidental,24)
            c.txt(xx+24,yy+148,'上方点为高八度，下方点为低八度；左侧为升降号。',13,'muted')
        elif i==2:
            xs=[xx+80,xx+165,xx+250]
            for k,nx in enumerate(xs):pitch(c,nx,yy+79,k+1,size=24)
            tuplet_bracket(c,xs[0]-8,xs[-1]+18,yy+60,size=18,end_height=5,line_width=1)
            c.txt(xx+24,yy+148,'短竖端括号标记连音组，数字居中；如 3:2。',13,'muted')
        elif i==3:
            pitch(c,xx+62,yy+81,'5',size=24);c.score_txt(xx+103,yy+81,'—',24);pitch(c,xx+210,yy+81,'5',size=24);arc(c,xx+62,yy+72,xx+213,yy+72,18)
            pitch(c,xx+377,yy+81,'1',size=24);pitch(c,xx+454,yy+81,'2',size=24);pitch(c,xx+531,yy+81,'3',size=24);arc(c,xx+377,yy+72,xx+535,yy+72,18)
            c.txt(xx+28,yy+148,'同音延音：保持音高',13,'muted');c.txt(xx+330,yy+148,'圆滑连线：连接旋律音符',13,'muted')
        elif i==4:
            for k,nx in enumerate([xx+80,xx+210,xx+340,xx+480]):
                c.line(nx,yy+70,nx,yy+118,'text',3 if k==2 else 1)
                if k>0:c.line(nx-7,yy+70,nx-7,yy+118,'text',1)
                if k==3:c.circle(nx-20,yy+88,2,'text');c.circle(nx-20,yy+101,2,'text')
            c.txt(xx+24,yy+148,'单线 / 双线 / 终止线 / 反复线；与全曲结构一致。',13,'muted')
        else:
            for st in range(6):c.line(xx+35,yy+70+st*7,xx+580,yy+70+st*7,'text',.8)
            vertical_signature(c,xx+50,yy+64,4,4);c.score_center(xx+128,yy+77,'3',18)
            c.line(xx+298,yy+65,xx+298,yy+142,'text',1)
            vertical_signature(c,xx+318,yy+64,3,4);c.score_center(xx+398,yy+84,'5',18)
            pitch(c,xx+128,yy+119,'1',size=18);pitch(c,xx+398,yy+119,'2',size=18)
            c.txt(xx+24,yy+157,'TAB 首小节 / 转拍处竖排拍号；下方简谱不显示拍号。',13,'muted')
    c.txt(40,851,'谱面不显示小节序号；谱内文字无白底块，仅使用白描边；状态栏与编辑预览保留位置编号。',13,'muted')
    save(c,'04_歌词简谱与和弦','11_简谱常用符号与拍号视觉规范','连梁、八度升降、连音、延音、连线、小节线与竖拍拍号','常用记号视觉参考')
