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

def numbered_panel(c,x,y,w,bottom,single=False):
    c.box(x,y,w,32,'bg',6);c.box(x+w/2+2,y+2,w/2-4,28,'white',4)
    c.txt(x+w/4-15,y+9,'歌词',14,'muted');c.txt(x+3*w/4-15,y+9,'简谱',14,'text')
    c.pill(x,y+49,'独立简谱 · 第 1 小节 / 音符 1','blue',w)
    if single:
        c.field(x,y+94,w,'同拍音高','1+3+5')
        c.field(x,y+182,w/2-6,'时值','八分音符',select=True);c.field(x+w/2+6,y+182,w/2-6,'附点','无附点',select=True)
        c.field(x,y+270,w/2-6,'八度','高一组',select=True);c.field(x+w/2+6,y+270,w/2-6,'升降','原音',select=True)
        c.button(x,y+368,w,'连音 / 延音 / 常用记号  ⌄')
        c.notice(x,y+426,w,'简谱独立编辑','修改这里的时值、音高或技巧不会修改 TAB 内容。')
        c.button(x,y+532,w,'删除简谱音符','danger')
    else:
        c.field(x,y+94,w/2-6,'录入方式','连续音高',select=True);c.field(x+w/2+6,y+94,w/2-6,'默认时值','八分音符',select=True)
        c.txt(x,y+180,'连续音高',14);c.box(x,y+204,w,65,'white',6,'blue');c.txt(x+12,y+221,"1 2 3 5' 1+3+5",14)
        c.txt(x,y+286,'空格分音符 · 每项使用当前默认时值',11,'muted')
        c.txt(x,y+319,'□ 允许替换所选简谱音符',12,'amber')
        c.txt(x,y+358,'对应预览 · 简谱独立时间位置',13)
        c.box(x,y+386,w,151,'white',6,'border')
        for i,(position,value) in enumerate([('1 / 0','1 · 1/8'),('1 / 1/2','2 · 1/8'),('1 / 1','3 · 1/8'),('1 / 3/2',"5' · 1/8"),('1 / 2','1+3+5 · 1/8')]):
            c.txt(x+10,y+398+i*27,position,11,'muted',latin=True);c.txt(x+101,y+398+i*27,value,11,'text',latin=True)
        c.notice(x,y+538,w,'按简谱位置预览，不逐 TAB 拍点分配',kind='blue')
    c.line(x-20,bottom-65,x+w+20,bottom-65);c.button(x,bottom-49,74,'取消');c.button(x+86,bottom-49,w-86,'应用简谱' if single else '应用全部','primary')

def build_notation_sheets(d):
    Canvas,editor,save=[d[k] for k in ['Canvas','editor','save']]
    c=Canvas();x,y,w,b=editor(c,'single',panel='numbered');numbered_panel(c,x,y,w,b,True)
    save(c,'04_歌词简谱与和弦','10_独立简谱_音高时值与技巧属性','独立时值、升降八度、连音和延音，不改变 TAB','选择简谱音符 → 属性 → 应用')
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
