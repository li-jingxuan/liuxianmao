"""生成六线猫 UI 评审 PNG；仅设计交付，不修改应用业务代码。"""
from pathlib import Path
from functools import lru_cache
import json
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
S = 2
RENDER_CATEGORIES = None
C = dict(bg='#F4F6FA', white='#FFFFFF', text='#202838', muted='#626E82', subtle='#A3ADBC', border='#D9D9D9', divider='#F0F0F0', blue='#285BE0', soft='#F0F7FF', navy='#15356D', green='#19734F', greenbg='#EAF7F0', red='#BC3547', redbg='#FFF0F2', amber='#92600C', amberbg='#FFF6E5')
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
LATIN = '/System/Library/Fonts/Supplemental/Arial.ttf'
LATIN_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'

@lru_cache(None)
def font(size, bold=False, latin=False):
    # 中文保持系统无衬线字形；英文数字使用 Arial，避免音乐数字字形含混。
    return ImageFont.truetype(LATIN_BOLD if bold and latin else LATIN if latin else FONT, round(size*S))

class Canvas:
    def __init__(self, w=1440, h=900):
        self.w, self.h = w, h
        self.im = Image.new('RGB', (w*S, h*S), C['bg'])
        self.d = ImageDraw.Draw(self.im)
    def icon(self,name,x,y,size=16,color='text'):
        # 直接使用 Ant Design Icons 的官方 path；只按当前控件语义着色。
        asset=ROOT/'制作源文件/antd-icons'/f'{name}.png'
        if not asset.exists():raise FileNotFoundError(asset)
        source=Image.open(asset).convert('RGBA').resize((round(size*S),round(size*S)),Image.Resampling.LANCZOS)
        tinted=Image.new('RGBA',source.size,C.get(color,color));tinted.putalpha(source.getchannel('A'))
        self.im.paste(tinted,(round(x*S),round(y*S)),tinted);self.d=ImageDraw.Draw(self.im)
    def box(self,x,y,w,h,fill='white',radius=0,stroke=None):
        color=C.get(fill,fill); border=C.get(stroke,stroke) if stroke else None
        self.d.rounded_rectangle((x*S,y*S,(x+w)*S,(y+h)*S),round(radius*S),fill=color,outline=border,width=S)
    def line(self,x,y,x2,y2,color='divider',width=1):
        self.d.line((x*S,y*S,x2*S,y2*S),fill=C.get(color,color),width=max(1,round(width*S)))
    def circle(self,x,y,r,fill='blue',stroke=None):
        self.d.ellipse(((x-r)*S,(y-r)*S,(x+r)*S,(y+r)*S),fill=C.get(fill,fill),outline=C.get(stroke,stroke) if stroke else None,width=S)
    def txt(self,x,y,text,size=14,color='text',bold=False,maxw=None,latin=False):
        text=str(text); f=font(size,bold,latin)
        # 文字中的通用控件符号映射为官方图标；音乐标记保留项目记谱语义。
        symbols={'⌕':'SearchOutlined','⌄':'DownOutlined','▦':'AppstoreOutlined','☷':'BarsOutlined','↶':'UndoOutlined','↷':'RedoOutlined','☆':'StarOutlined','···':'MoreOutlined'}
        if text in symbols:self.icon(symbols[text],x,y,min(size,18),color);return
        if text=='×' and size>=14:self.icon('CloseOutlined',x,y,size-2,color);return
        if text.startswith('‹ '):self.icon('LeftOutlined',x,y,12,color);self.txt(x+18,y,text[2:],size,color,bold,maxw,latin);return
        if text.startswith('☑') or text.startswith('□'):
            checked=text.startswith('☑');self.box(x,y,16,16,'blue' if checked else 'white',4,'blue' if checked else 'border')
            if checked:self.icon('CheckOutlined',x+2,y+2,12,'white')
            self.txt(x+24,y,text[1:].strip(),size,color,bold,maxw,latin);return
        text=text.replace('⌘','Cmd').replace('‹','<').replace('✓','已选')
        if '\n' in text:
            for i,row in enumerate(text.split('\n')):self.txt(x,y+i*(size+3),row,size,color,bold,maxw,latin)
            return
        # 有固定容器时只在长单行上省略；正文用 wrap 明确换行。
        if maxw:
            while self.d.textlength(text,font=f)>maxw*S and len(text)>1:
                text=text[:-2]+'…'
        # 谱内文字只沿字形绘制白色描边，不铺矩形白底遮挡谱线。
        self.d.text((x*S,y*S),text,font=f,fill=C.get(color,color),stroke_width=S if getattr(self,'music_text',False) else 0,stroke_fill=C['white'],anchor='lt')
    def score_txt(self,*args,**kwargs):
        previous=getattr(self,'music_text',False);self.music_text=True
        try:self.txt(*args,**kwargs)
        finally:self.music_text=previous
    def score_center(self,x,y,text,size=12,color='text',latin=True):
        # 用字形实际包围盒居中，单/双位品位均与弦线和符干共用中心轴。
        f=font(size,False,latin);bounds=self.d.textbbox((0,0),str(text),font=f,anchor='lt')
        origin=(round(x*S-(bounds[0]+bounds[2])/2),round(y*S-(bounds[1]+bounds[3])/2))
        self.d.text(origin,str(text),font=f,fill=C.get(color,color),stroke_width=S,stroke_fill=C['white'],anchor='lt')
    def score_highlight(self,x,y,w,h,alpha=22):
        # 选区薄蓝叠层放在谱线下方，保留音乐内容，不用不透明底块重画音符。
        layer=Image.new('RGBA',self.im.size);draw=ImageDraw.Draw(layer)
        rgb=tuple(int(C['blue'][i:i+2],16) for i in (1,3,5))
        draw.rounded_rectangle((x*S,y*S,(x+w)*S,(y+h)*S),3*S,fill=(*rgb,alpha))
        self.im.paste(layer,(0,0),layer);self.d=ImageDraw.Draw(self.im)
    def wrap(self,x,y,text,w,size=13,color='muted',line=22):
        row=''; yy=y
        for ch in str(text):
            if ch=='\n' or self.d.textlength(row+ch,font=font(size))>w*S:
                self.txt(x,yy,row,size,color); yy+=line; row='' if ch=='\n' else ch
            else: row+=ch
        if row:self.txt(x,yy,row,size,color); yy+=line
        return yy
    def button(self,x,y,w,label,kind='secondary',h=32):
        h=40 if h>=40 else 24 if h<=24 else 32
        fill={'primary':'blue','secondary':'white','ghost':'white','selected':'soft','danger':'white','disabled':'bg'}[kind]
        col={'primary':'white','secondary':'text','ghost':'muted','selected':'blue','danger':'red','disabled':'subtle'}[kind]
        self.box(x,y,w,h,fill,6,'border' if kind=='secondary' else 'red' if kind=='danger' else None)
        music={'全':'note-whole','二':'note-half','四':'note-quarter','八':'note-eighth','十六':'note-sixteenth','三二':'note-thirty-second'}
        if label in music and (ROOT/'制作源文件/icons'/f'{music[label]}.png').exists():
            icon=Image.open(ROOT/'制作源文件/icons'/f'{music[label]}.png').convert('RGBA');tinted=Image.new('RGBA',icon.size,C.get(col,col));tinted.putalpha(icon.getchannel('A'));self.im.paste(tinted,(round((x+(w-24)/2)*S),round((y+(h-24)/2)*S)),tinted);self.d=ImageDraw.Draw(self.im);return
        chevron='⌄' in label;label=label.replace('⌄','').strip()
        prefix=None
        if label.startswith('＋'):prefix='PlusOutlined';label=label.lstrip('＋').strip()
        elif label=='保存' or label.startswith('保存曲谱'):prefix='SaveOutlined'
        elif label.startswith('下载'):prefix='DownloadOutlined'
        elif label.startswith('删除'):prefix='DeleteOutlined'
        elif label.startswith('复制'):prefix='CopyOutlined'
        elif label.startswith('重试'):prefix='RedoOutlined'
        elif label=='视图':prefix='EyeOutlined'
        elif label=='导出图片':prefix='PictureOutlined'
        elif label=='正在保存…':prefix='LoadingOutlined'
        tw=self.d.textlength(label,font=font(14))/S
        if prefix and tw+24>w-16:prefix=None
        if label in ['▦','☷','↶','↷']:tw=14
        start=x+(w-tw-(22 if prefix else 0)-(14 if chevron else 0))/2
        if prefix:self.icon(prefix,start,y+(h-14)/2,14,col);start+=22
        self.txt(start,y+(h-14)/2-1,label,14,col)
        if chevron:self.icon('DownOutlined',x+w-20,y+(h-12)/2,12,col)
        if h<=32 and w>=70 and (label.isdigit() or label in ['空弦','禁奏 ×','—']):self.icon('DownOutlined',x+w-19,y+(h-10)/2,10,'muted')
    def pill(self,x,y,label,kind='blue',w=None):
        w=w or self.d.textlength(label,font=font(12))/S+20
        self.box(x,y,w,24,{'blue':'soft','green':'greenbg','red':'redbg','amber':'amberbg','muted':'bg'}[kind],4)
        self.txt(x+10,y+6,label,12,kind,maxw=w-20,latin=label.isdigit())
        return w
    def field(self,x,y,w,label,value='',error=None,select=False):
        required=label=='曲谱名称'
        if required:self.txt(x,y,'*',14,'red',latin=True)
        self.txt(x+(12 if required else 0),y,label,14,'text')
        self.box(x,y+24,w,32,'white',6,'red' if error else 'border')
        self.txt(x+11,y+33,value or '请输入',14,'text' if value else 'muted',maxw=w-38)
        if select:self.icon('DownOutlined',x+w-23,y+34,12,'muted')
        elif label in ['Capo','初始小节数','起始品位','横按品位','辅助品位']:
            self.line(x+w-23,y+25,x+w-23,y+55,'border');self.icon('UpOutlined',x+w-17,y+28,8,'muted');self.icon('DownOutlined',x+w-17,y+44,8,'muted');self.line(x+w-23,y+40,x+w,y+40,'border')
        if error:self.txt(x,y+63,error,12,'red',maxw=w)
    def section(self,x,y,label,sub=None):
        self.txt(x,y,label,15,'text',True)
        if sub:self.txt(x,y+28,sub,12,'muted')
    def notice(self,x,y,w,title,detail='',kind='blue'):
        fill={'blue':'soft','green':'greenbg','red':'redbg','amber':'amberbg'}[kind]
        self.box(x,y,w,72 if detail else 44,fill,6)
        self.icon({'blue':'InfoCircleFilled','green':'CheckCircleFilled','red':'CloseCircleFilled','amber':'ExclamationCircleFilled'}[kind],x+12,y+13,16,kind)
        self.txt(x+38,y+14,title,13,kind,maxw=w-50)
        if detail:self.wrap(x+16,y+38,detail,w-32,11,'muted',18)
    def shadow(self,x,y,w,h):
        layer=Image.new('RGBA',self.im.size)
        ld=ImageDraw.Draw(layer);ld.rounded_rectangle((x*S,(y+5)*S,(x+w)*S,(y+h+5)*S),12*S,fill=(31,48,85,24))
        self.im.paste(layer.filter(ImageFilter.GaussianBlur(12*S)),(0,0),layer.filter(ImageFilter.GaussianBlur(12*S)))
        self.d=ImageDraw.Draw(self.im)

def brand(c,x=24,y=18):
    c.box(x,y,30,30,'blue',9);c.txt(x+7,y+7,'六',17,'white',True)
    c.txt(x+42,y+6,'六线猫',18,'navy',True)

def chord(c,x,y,scale=1,name='C'):
    # 六弦指法示意和谱面正文共享视觉规则。
    c.score_txt(x+20*scale,y-21*scale,name,12*scale,'text',latin=True)
    for j in range(6):c.line(x+j*9*scale,y,x+j*9*scale,y+45*scale,'text',.7)
    for j in range(5):c.line(x,y+j*11.25*scale,x+45*scale,y+j*11.25*scale,'text',1.5 if j==0 else .7)
    dots=[(2,2),(3,2),(4,1)] if name=='Am' else [(1,3),(2,3),(3,2)] if name=='F' else [(1,3),(2,2),(4,1)]
    for string,fret in dots:c.circle(x+string*9*scale,y+(fret-.5)*11.25*scale,3*scale,'text')
    if name=='F':c.line(x,y+5.625*scale,x+45*scale,y+5.625*scale,'text',5*scale)
    else:
        for string,ch in ([(0,'×'),(1,'○'),(5,'○')] if name=='Am' else [(0,'×'),(3,'○'),(5,'○')]):c.score_txt(x+string*9*scale-3,y-11*scale,ch,8*scale)

def tab_stem(c,x,note_y,baseline,value,size=12):
    # 从连梁基线向上延伸至本拍最下方数字下缘，保留描边外 2px 间隙。
    bounds=c.d.textbbox((0,0),str(value),font=font(size,False,True),anchor='lt')
    glyph_half_height=(bounds[3]-bounds[1])/(2*S)
    c.line(x,note_y+glyph_half_height+3,x,baseline,'text',.9)

def note(c,x,y,fret,stem=True,scale=1,color='text'):
    c.score_center(x,y,str(fret),12*scale,color)
    if stem:tab_stem(c,x,y,y+52*scale,fret,12*scale)

def score_selection(c,x,y,w=18,h=15,handles=False):
    # 焦点框只圈当前格，范围框只覆盖 TAB 弦行；端点控制柄不占用数字中心。
    c.box(x-w/2,y-h/2,w,h,None,3,'blue')
    if handles:
        for xx,yy in [(x-w/2,y-h/2),(x+w/2,y+h/2)]:c.circle(xx,yy,2,'blue','white')

def score(c,x,y,w=770,selected=False,range_=False,blank=False,compact=False,pageheight=None,pageindex='1 / 1',measure_count=12):
    text_mode_before=getattr(c,'music_text',False);c.music_text=True
    h=pageheight or (710 if not compact else 560)
    c.shadow(x,y,w,h);c.box(x,y,w,h,'white',3)
    c.txt(x+w/2-60,y+30,'风吹过山谷',24,'text',True)
    c.txt(x+w/2-36,y+68,'编谱：六线猫',11,'muted')
    c.txt(x+34,y+94,'1=C    Capo 0',12,'text',latin=True)
    if blank:c.pill(x+w-137,y+91,'标准六弦吉他','muted',108)
    sy=y+200
    available=w-68;mw=(available-24)/4
    for row in range(3 if not compact else 2):
        if row*4>=measure_count:break
        yy=sy+row*165
        first_axis=x+58+28+16
        third_axis=first_axis+(.64 if w<650 else 3/8)*(mw-28-28)
        if range_ and row==0:c.score_highlight(first_axis-10,yy+4,third_axis-first_axis+20,42)
        for st in range(6):c.line(x+34,yy+st*10,x+w-34,yy+st*10,'text',.8)
        c.line(x+34,yy,x+34,yy+70,'text',1)
        for label,offset in [('T',10),('A',25),('B',40)]:c.score_center(x+42,yy+offset,label,11)
        for m in range(4):
            xx=x+58+m*mw
            c.line(xx+mw,yy,xx+mw,yy+50,'text',.8)
            # 谱面不绘制小节号；仅首小节和转拍小节绘制竖排拍号。
            signature=(4,4) if row==0 and m==0 else (3,4) if row==1 and m==1 and not blank else None
            if signature:
                c.score_center(xx+12,yy+13,str(signature[0]),18)
                c.score_center(xx+12,yy+36,str(signature[1]),18)
            if row==0 and m in [0,2] and not blank:chord(c,xx+20,yy-67,.72,'C' if m==0 else 'Am')
            for beat in range(4):
                lead=28 if signature else 4
                fractions=[0,1/3,1/2,2/3] if row*4+m>=5 and not blank else [0,1/4,3/8,1/2]
                # 窄谱面按最小字形间距展开时间列，防止歌词和品位挤在一起。
                if w<650:fractions=[0,.32,.64,.96]
                nx=xx+lead+16+fractions[beat]*(mw-lead-28)
                if blank:
                    if beat==1:c.txt(nx,yy+66,'—',12,'muted')
                    continue
                fret=[3,3,2,0,5,7,5,3][(m*4+beat+row)%8]
                string=[1,3,2,4][beat]
                active=(bool(selected) and not range_ and ((row==0 and selected!='tail' and m==0 and beat==0) or (row==2 and selected=='tail' and m==3 and beat==3)))
                note(c,nx,yy+string*10,fret,False,color='blue' if active or (range_ and row==0 and m==0 and beat<3) else 'text')
                tab_stem(c,nx,yy+string*10,yy+77,fret)
                c.score_center(nx,yy+139,['风','吹','过','谷'][beat],11,latin=False)
                if active:score_selection(c,nx,yy+string*10)
                if beat==2:
                    previous=xx+lead+16+fractions[1]*(mw-lead-28)
                    c.line(previous,yy+77,nx,yy+77,'text',3)
            # 简谱区域不展示 H/P 等 TAB 专用技巧字母或关联线。
            if not blank:
                from notation_design import draw_numbered_measure
                draw_numbered_measure(c,xx,yy+104,mw,variant=(row*4+m)%4,meter=3 if row*4+m>=5 else 4)
                if getattr(c,'numbered_focus',False) and row==0 and m==0:
                    # 简谱目标只在自己的音符上显示焦点，不借用 TAB 单元格蓝框。
                    c.box(xx+6,yy+99,20,24,None,3,'blue')
                    c.score_txt(xx+11,yy+104,'1',12,'blue',latin=True)
        if range_ and row==0:
            score_selection(c,(first_axis+third_axis)/2,yy+25,third_axis-first_axis+20,42,True)
            score_selection(c,first_axis,yy+10)
    c.txt(x+w/2-16,y+h-24,pageindex,10,'muted',latin=True)
    c.music_text=text_mode_before

def library(c,view='grid',empty=False,search=False,selected=False):
    c.box(0,0,c.w,66,'white');brand(c)
    c.txt(250,26,'曲谱工作台',13,'muted');c.pill(c.w-180,21,'本地曲谱库','blue',108)
    c.box(0,66,208,c.h-66,'white');c.line(208,66,208,c.h)
    c.txt(24,108,'我的曲谱',11,'muted')
    for i,(label,num) in enumerate([('全部曲谱','12'),('最近编辑','5'),('已收藏','3')]):
        if i==0:c.box(14,140+i*48,180,40,'soft',7)
        c.txt(28,153+i*48,label,13,'blue' if i==0 else 'muted');c.txt(170,153+i*48,'0' if empty else num,11,'muted',latin=True)
    c.line(24,304,183,304);c.txt(24,334,'分类',11,'muted')
    for i,label in enumerate(['指弹练习','歌曲编配','节奏练习','未分类']):
        c.circle(30,378+i*40,3,['blue','green','amber','subtle'][i]);c.txt(46,371+i*40,label,13,'muted')
    c.txt(24,c.h-74,'从一个乐句开始',12,'navy');c.txt(24,c.h-47,'让灵感成为可读的谱。',11,'muted')
    c.txt(248,103,'你的音乐，在这里继续。',28,'navy',True)
    c.txt(250,146,'整理曲谱、继续编配，或从空白开始新的作品。',13,'muted')
    c.button(c.w-190,112,150,'＋ 新建曲谱','primary',42)
    c.box(248,193,c.w-288,49,'white',8,'border')
    c.txt(269,210,'⌕',18,'muted');c.txt(300,210,'风吹' if search else '搜索曲谱名称或编谱作者',13,'text' if search else 'muted')
    c.button(c.w-326,201,122,'全部调性  ⌄',h=32);c.button(c.w-192,201,134,'最近修改  ⌄',h=32)
    c.txt(250,272,'搜索结果 · 0 首' if search else '全部曲谱 · 0 首' if empty else '全部曲谱 · 12 首',14,'text',True)
    c.button(c.w-129,260,40,'▦','selected' if view=='grid' else 'secondary',32);c.button(c.w-81,260,40,'☷','selected' if view=='list' else 'secondary',32)
    if empty or search:
        c.box(250,313,c.w-290,493,'white',12,'border')
        c.box(c.w/2+24,430,74,83,'soft',15);c.txt(c.w/2+48,455,'谱',30,'blue')
        c.txt(c.w/2-36,553,'还没有找到曲谱' if search else '第一首曲谱，从这里开始',20,'navy',True)
        c.txt(c.w/2-83,594,'换个关键词试试，或清除筛选条件。' if search else '创建一份空白谱，把你的旋律记录下来。',13,'muted')
        c.button(c.w/2+5,640,150,'清除搜索与筛选' if search else '＋ 新建曲谱','primary')
        return
    names=['风吹过山谷','小星星 · 指弹练习','晨光里的旋律','Amazing Grace','午后练习曲','节奏与和弦练习']
    if view=='list':
        c.box(250,314,c.w-290,476,'white',10,'border')
        c.box(251,315,c.w-292,44,'bg',9)
        for xx,tx in [(277,'曲谱名称'),(694,'分类'),(892,'调性 / 拍号'),(1083,'修改时间')]:c.txt(xx,330,tx,12,'muted')
        for i,name in enumerate(names):
            yy=370+i*64;c.line(269,yy+51,c.w-61,yy+51)
            c.box(272,yy,35,36,'soft',6);c.txt(283,yy+9,'谱',15,'blue')
            c.txt(325,yy+4,name,14,'text',True);c.txt(325,yy+27,'六线猫 · 12 小节',11,'muted')
            c.txt(694,yy+14,['歌曲编配','指弹练习','未分类'][i%3],12,'muted')
            c.txt(892,yy+14,'C · 4/4',12,'muted',latin=True);c.txt(1083,yy+14,'今天 10:42',12,'muted');c.txt(c.w-83,yy+11,'···',18)
        return
    cw=(c.w-326)/3
    for i,name in enumerate(names):
        xx=250+(i%3)*(cw+18);yy=316+(i//3)*259
        c.box(xx,yy,cw,239,'white',8,'blue' if selected and i==0 else 'border')
        c.box(xx+12,yy+12,cw-24,116,'bg',7)
        for st in range(6):c.line(xx+31,yy+47+st*8,xx+cw-31,yy+47+st*8,'#C7CED9',.7)
        for nn in range(8):
            nx=xx+43+nn*(cw-86)/8;c.score_txt(nx,yy+44+(nn%3)*8,str([0,3,2,5][nn%4]),10,'muted',latin=True)
        c.txt(xx+19,yy+148,name,17,'navy',True,maxw=cw-55);c.txt(xx+cw-35,yy+147,'☆',18,'muted')
        c.txt(xx+19,yy+176,'六线猫 · C 调 · 4/4 · 12 小节',11,'muted')
        c.pill(xx+18,yy+201,['歌曲编配','指弹练习','未分类'][i%3],'muted',76)
        c.txt(xx+cw-101,yy+209,'今天 10:42',10,'muted');c.txt(xx+cw-29,yy+208,'···',13)

def editor(c,state='default',panel='selection',blank=False,saved=False):
    c.box(0,0,c.w,58,'white');brand(c,20,14)
    c.line(157,16,157,43);c.txt(178,23,'‹ 曲谱管理',12,'muted')
    c.txt(301,16,'风吹过山谷',15,'navy',True)
    c.txt(301,38,'尚未保存' if blank else '已保存 · 今天 10:42' if saved else '有未保存的修改',10,'green' if saved else 'amber')
    c.button(c.w-315,12,82,'视图',h=32);c.button(c.w-223,12,82,'保存','primary',32);c.button(c.w-131,12,111,'导出图片',h=32)
    c.box(0,59,c.w,52,'white');c.line(0,111,c.w,111)
    c.button(20,67,34,'↶','disabled' if state=='default' else 'secondary',32);c.button(60,67,34,'↷','disabled' if state=='default' else 'secondary',32);c.line(108,72,108,96)
    for i,l in enumerate(['全','二','四','八','十六','三二']):c.button(121+i*43,67,38,l,'disabled' if state in ['default','range'] else 'selected' if i==3 else 'ghost',32)
    c.button(388,67,33,'·','ghost',32);c.button(426,67,37,'··','ghost',32)
    c.line(476,72,476,96);c.button(490,67,49,'x','ghost',32);c.button(546,67,58,'休止','ghost',32)
    if c.w<=900:c.button(624,67,112,'更多工具 ⌄','ghost',32)
    else:
        for i,l in enumerate(['小节 ⌄','拍点 ⌄','连音 ⌄','技巧 ⌄']):c.button(624+i*84,67,76,l,'selected' if state in ['measure','paste','tuplet','technique'] and i==['measure','paste','tuplet','technique'].index(state) else 'ghost',32)
        if panel=='numbered' and state!='default':
            # 简谱选中稳定音符时，将最高频的连接/延长操作放到工具栏；其余操作保留在技巧菜单。
            for tx,label in [(970,'⌒ 延音'),(1035,'⌒ 连音'),(1100,'𝄐 延长')]:c.button(tx,67,62,label,'secondary',32)
    if c.w>1200:c.txt(c.w-224,79,'当前编辑：简谱 · 时值独立' if panel=='numbered' else '当前编辑：六线谱 · 品位输入',11,'muted')
    narrow=c.w<=1024
    pw=(440 if panel=='numbered' else 344) if not narrow else c.w-48
    px=c.w-pw if not narrow else 24
    py=112 if not narrow else 493
    c.numbered_focus=panel=='numbered' and state!='default'
    if narrow:score(c,113,130,min(c.w-220,770),state!='default',range_=state=='range',compact=True)
    else:score(c,(c.w-pw-800)/2+15,140,770,False if panel=='numbered' else 'tail' if state=='tail' else state not in ['default','song','view'],state=='range',blank,measure_count=8 if blank else 12)
    c.box(px,py,pw,c.h-py-29,'white',0 if not narrow else 12,'border')
    for i,l in enumerate(['选区','段落','和弦','歌曲']):
        tx=px+16+i*(pw-32)/4
        active=i=={'selection':0,'lyric':1,'numbered':1,'chord':2,'song':3}.get(panel,0)
        col='blue' if active else 'muted'
        c.icon(['SettingOutlined','FileTextOutlined','FormOutlined','FolderOutlined'][i],tx+6,py+24,14,col)
        c.txt(tx+27,py+24,l,14,col)
        if active:c.line(tx+4,py+58,tx+(pw-38)/4-4,py+58,'blue',2)
    c.line(px+16,py+59,px+pw-16,py+59)
    c.box(0,c.h-28,c.w,28,'white');c.line(0,c.h-28,c.w,c.h-28)
    c.txt(20,c.h-19,('简谱 · 第 1 小节 / 第 1 拍' if state!='default' else '请选择简谱音符或录入窗口') if panel=='numbered' else '第 12 小节 / 第 3 拍 / 第 2 弦' if state=='tail' else '第 1 小节 / 第 1 拍 / 第 2 弦' if state!='default' else '点击谱面，选择一个编辑位置',10,'muted')
    if c.w>900:c.txt(360,c.h-19,'简谱音符与时值独立编辑' if panel=='numbered' else '已选 12 格 · 3 拍' if state=='range' else '数字输入品位 · 方向键移动 · Shift 扩展',10,'muted')
    c.txt(c.w-212,c.h-19,'紧凑排版  ·  指法图显示',10,'muted')
    return px+20,py+80,pw-40,c.h-61

def panel_tabs(c,x,y,w,first='歌词'):
    # 两个内容模式用 Segmented；上层属性栏目使用 Tabs 下划线导航。
    c.box(x,y,w,32,'bg',6)
    for i,label in enumerate(['歌词','简谱']):
        xx=x+2+i*w/2
        if label==first:c.box(xx,y+2,w/2-4,28,'white',4)
        c.txt(xx+w/4-16,y+9,label,14,'text' if label==first else 'muted')

def content_row_actions(c,x,y,w,lyrics_full=False,numbered_exists=False):
    # 两个添加入口始终并排；歌词满段时禁用新增，已有简谱行时复用该行。
    bw=(w-8)/2
    c.button(x,y,bw,'＋ 添加歌词行','disabled' if lyrics_full else 'secondary')
    c.button(x+bw+8,y,bw,'＋ 添加简谱行','selected' if numbered_exists else 'secondary')

def lyric_label(c,x,y,active=False):
    # 帮助图标紧随字段标签，24px 热区支持点击与键盘聚焦，展开态保持蓝色。
    c.txt(x,y,'连续歌词',12,'muted')
    if active:c.box(x+54,y-5,24,24,'soft',4)
    c.icon('QuestionCircleOutlined',x+59,y,14,'blue' if active else 'muted')

def lyric_rules_popover(c,x,y,w):
    # 浮层向谱面侧展开，不遮挡文本框、对应预览及底部提交操作。
    pw=352;px=x-pw-28;py=y-14
    c.shadow(px,py,pw,420);c.box(px,py,pw,420,'white',8,'border')
    c.d.polygon([((px+pw)*S,(py+12)*S),((px+pw+9)*S,(py+21)*S),((px+pw)*S,(py+30)*S)],fill=C['white'])
    c.line(px+pw,py+12,px+pw+9,py+21,'border');c.line(px+pw+9,py+21,px+pw,py+30,'border')
    c.icon('QuestionCircleOutlined',px+18,py+18,16,'blue')
    c.txt(px+42,py+18,'连续填词规则',15,'text',True);c.icon('CloseOutlined',px+pw-32,py+19,14,'muted')
    c.line(px+16,py+52,px+pw-16,py+52)
    yy=py+68
    for title,detail in [
        ('空格分拍','每项对应一拍，休止拍也占一格；连续空格合并，首尾空格忽略。'),
        ('下划线跳过','独立的 _ 跳过一拍并保留原歌词，例如：风 _ 过。'),
        ('同拍短句','英文按空格拆词；同一拍放 a song 时，切到单拍编辑。'),
        ('先预览，再应用','默认允许替换已有歌词；取消勾选可保留原词。超出谱尾时整批不写入。'),
    ]:
        c.txt(px+18,yy,title,12,'text',True)
        yy=c.wrap(px+18,yy+22,detail,pw-36,12,'muted',19)+14
    c.line(px+16,py+376,px+pw-16,py+376)
    c.txt(px+18,py+391,'点击外部 / Esc 关闭，输入草稿保留。',11,'muted')

def selection_panel(c,x,y,w,bottom,mode='default'):
    c.section(x,y,'当前选区' if mode!='default' else '开始编写你的曲谱')
    if mode=='default':
        c.wrap(x,y+37,'点击六线谱中的一个位置，输入品位。拖动可选择多个拍点与弦。',w)
        for i,(a,b) in enumerate([('01','选择音符位置'),('02','输入品位与节奏'),('03','添加歌词、简谱或和弦')]):
            yy=y+135+i*80;c.pill(x,yy,a,'blue',35);c.txt(x+50,yy+5,b,13);c.line(x+50,yy+37,x+w,yy+37)
        c.notice(x,y+417,w,'快捷键随时可查看','数字 0–24 输入 · X 闷音 · R 休止')
        c.button(x,bottom-41,w,'查看快捷键')
        return
    c.pill(x,y+34,'3 拍 · 12 格' if mode=='range' else '第 1 小节 · 第 1 拍','blue',158)
    c.section(x,y+93,'音符与节奏')
    c.field(x,y+126,w,'品位','混合值' if mode=='range' else '3' if mode!='input' else '1… 等待第二位数字')
    if mode=='range':
        c.txt(x,y+193,'多个品位 · 输入后统一设置',11,'muted')
        c.txt(x,y+213,'时值 / 附点',12,'muted');c.button(x,y+240,w,'仅单拍可修改时值与附点','disabled',40)
    else:c.field(x,y+212,w/2-6,'时值','八分音符',select=True);c.field(x+w/2+6,y+212,w/2-6,'附点','无附点',select=True)
    c.button(x,y+301,w/2-6,'设为闷音 x');c.button(x+w/2+6,y+301,w/2-6,'设为休止')
    c.line(x,y+357,x+w,y+357);c.section(x,y+380,'关联内容')
    for i,l in enumerate(['歌词 / 简谱  →','和弦标记  →','弹奏技巧  →']):c.button(x,y+419+i*44,w,l,'ghost')
    c.notice(x,y+571,w,'作用范围','休止影响所选 3 拍的全部弦音符。' if mode=='range' else '休止会清空当前拍的全部弦音符。','amber')

def preview_table(c,x,y,w,numbered=False,error=False,compact=False):
    c.txt(x,y,'对应预览',13,'text',True);c.pill(x+w-106,y-5,'整批未写入' if error else '待写入 5 项','red' if error else 'blue',104)
    c.box(x,y+31,w,176 if compact else 190,'white',7,'border');c.box(x+1,y+32,w-2,30,'bg',5)
    c.txt(x+10,y+42,'位置',10,'muted');c.txt(x+87,y+42,'原内容 → 新内容',10,'muted');c.txt(x+w-47,y+42,'操作',10,'muted')
    vals=['1 → 2','空 → 3',"空 → 5'",'6 → 保留','空 → 1+3+5','空 → 0'] if numbered else ['风 → 轻','空 → 轻','空 → 唱','过 → 保留','空 → 山','空 → 谷']
    for i,val in enumerate(vals):
        yy=y+68+i*(22 if compact else 23)
        if i==0:c.box(x+2,yy-4,w-4,23,'soft')
        c.txt(x+10,yy,('12 / 3' if i==0 else '12 / 4' if i==1 else '超出谱尾') if error else f'1 / {i+1}' if i<4 else f'2 / {i-3}',10,'red' if error and i>1 else 'muted',latin=not(error and i>1))
        c.txt(x+87,yy,('无目标 → '+['唱','保留','山','谷'][i-2]) if error and i>1 else val,11,'text');c.txt(x+w-47,yy,'错误' if error and i>1 else '覆盖' if i==0 else '跳过' if i==3 else '新增',10,'red' if error and i>1 else 'amber' if i==0 else 'muted')
        c.line(x+9,yy+18,x+w-9,yy+18)
    if error:
        c.line(x+w-4,y+65,x+w-4,y+(200 if compact else 210),'border',2);c.line(x+w-4,y+65,x+w-4,y+165,'muted',2)

def text_panel(c,x,y,w,bottom,numbered=False,single=False,error=False,rules_open=False):
    if numbered:
        from notation_design import numbered_panel
        numbered_panel(c,x,y,w,bottom,single,view='form' if single else 'input')
        return
    panel_tabs(c,x,y,w,'歌词');content_row_actions(c,x,y+44,w);yy=y+96
    c.pill(x,yy,'起点 · 第 12 小节 / 第 3 拍' if error else '起点 · 第 1 小节 / 第 1 拍','blue',w)
    c.field(x,yy+36,w/2-6,'录入方式','单拍编辑' if single else '连续录入',select=True)
    c.field(x+w/2+6,yy+36,w/2-6,'歌词段号','第 1 段',select=True)
    if single:c.txt(x,yy+110,'歌词文本',12,'muted')
    else:lyric_label(c,x,yy+110,rules_open)
    c.box(x,yy+130,w,64,'white',7,'blue' if not error else 'red')
    c.wrap(x+12,yy+147,'风' if single else '轻 轻 唱 _ 山 谷 风' if error else '轻 轻 唱 _ 山 谷',w-24,14,'text',24)
    c.txt(x,yy+208,'第 3 项起超出谱尾，整批未写入。' if error else 'Enter 应用并下一拍 · Shift+Enter 仅应用' if single else '空格分拍 · _ 跳过一拍 · 休止拍占一格',11,'red' if error else 'muted',maxw=w)
    if not single:
        c.txt(x,yy+236,'☑ 允许替换已有歌词（1 项）',12,'amber')
        preview_table(c,x,yy+266,w,error=error,compact=True)
    else:
        c.notice(x,yy+242,w,'仅修改当前拍','单拍可以输入包含空格的短句。')
        c.button(x,yy+326,w,'删除当前歌词','danger')
    c.line(x-20,bottom-65,x+w+20,bottom-65)
    if single and not numbered:
        c.button(x,bottom-49,58,'取消');c.button(x+66,bottom-49,58,'应用');c.button(x+132,bottom-49,w-132,'应用并下一拍','primary')
    else:c.button(x,bottom-49,74,'取消');c.button(x+84,bottom-49,w-84,'应用全部' if not single else '应用','disabled' if error or numbered and not single else 'primary')
    if rules_open:lyric_rules_popover(c,x,yy+110,w)

def modal(c,title,subtitle='',w=560,h=500):
    # 模态遮罩只作用于背景，弹窗标题、内容与底部操作保持明确层级。
    shade=Image.new('RGBA',c.im.size,(22,34,55,72));c.im=Image.alpha_composite(c.im.convert('RGBA'),shade).convert('RGB');c.d=ImageDraw.Draw(c.im)
    x=(c.w-w)/2;y=(c.h-h)/2;c.shadow(x,y,w,h);c.box(x,y,w,h,'white',8)
    c.txt(x+28,y+26,title,20,'text',True);c.icon('CloseOutlined',x+w-40,y+27,16,'muted')
    if subtitle:c.wrap(x+28,y+66,subtitle,w-56,12,'muted')
    return x+28,y+110,w-56,y+h-28

SCREENS=[]
def save(c,category,name,desc,flow):
    folder=ROOT/category;folder.mkdir(exist_ok=True,parents=True)
    path=folder/(name+'.png')
    if RENDER_CATEGORIES is None or category in RENDER_CATEGORIES:c.im.save(path,optimize=True)
    SCREENS.append(dict(category=category,name=name,file=str(path.relative_to(ROOT)),description=desc,flow=flow,width=c.w*S,height=c.h*S))

def build():
    # 每组画面沿同一视觉规范展开；状态改变不隐藏领域限制和危险操作。
    cat='01_曲谱管理'
    for mode,name,desc in [('grid','01_曲谱管理_卡片视图','分类、搜索、排序、收藏及打开曲谱'),('list','02_曲谱管理_列表视图','按名称、分类、调性拍号与修改时间查看'),('empty','03_曲谱管理_空曲谱库','首次进入的创建引导'),('search','04_曲谱管理_搜索无结果','清除关键词及筛选恢复列表')]:
        c=Canvas();library(c,mode if mode in ['grid','list'] else 'grid',mode=='empty',mode=='search');save(c,cat,name,desc,'管理 → 新建 / 打开 → 编辑')
    c=Canvas();library(c,selected=True);c.box(465,514,177,168,'white',10,'border')
    for i,l in enumerate(['打开曲谱','重命名','复制曲谱','删除曲谱']):c.txt(485,535+i*35,l,13,'red' if i==3 else 'text')
    save(c,cat,'05_曲谱管理_更多操作','复制生成独立作品；删除前确认','更多 → 重命名 / 复制 / 删除')
    c=Canvas();library(c);x,y,w,b=modal(c,'删除这份曲谱？','这会从曲谱库移除该作品。删除策略由后续持久化实现确定。',480,300)
    c.box(x,y,w,58,'bg',7);c.txt(x+15,y+14,'风吹过山谷',16,'text',True);c.txt(x+15,y+37,'歌曲编配 · 12 小节',11,'muted')
    c.button(x+w-214,b-37,100,'取消');c.button(x+w-104,b-37,104,'确认删除','danger')
    save(c,cat,'06_曲谱管理_删除确认','明确删除对象与取消入口','确认删除 → 管理结果提示')
    c=Canvas();library(c);c.notice(556,80,442,'已创建曲谱副本','“风吹过山谷（副本）”与原作品独立。','green');save(c,cat,'07_曲谱管理_复制成功','复制后的独立作品与结果反馈','复制 → 新副本 → 打开编辑')
    c=Canvas();library(c,empty=True);c.box(505,435,595,254,'white',12);c.section(598,461,'曲谱库加载失败');c.wrap(598,503,'没有修改你的曲谱。检查保存介质的可用状态后重试。',400,13);c.button(701,583,152,'重新加载','primary');save(c,cat,'08_曲谱管理_加载失败','失败不伪装成空库；提供重试入口','管理加载 → 失败 → 重试')
    cat='02_新建与保存'
    c=Canvas();library(c);x,y,w,b=modal(c,'新建曲谱','先设定基础信息，创建后即可输入音符。',620,640)
    c.field(x,y,w,'曲谱名称','风吹过山谷');c.field(x,y+92,w,'编谱作者','六线猫')
    for i,(l,v) in enumerate([('调性','C'),('基础拍号','4/4'),('Capo','0'),('初始小节数','8')]):c.field(x+(i%2)*(w/2+8),y+184+(i//2)*86,w/2-8,l,v,select=i<2)
    c.notice(x,y+367,w,'标准六弦吉他','默认 E–A–D–G–B–E。创建不代表已经保存。')
    c.button(x+w-221,b-38,94,'取消');c.button(x+w-115,b-38,115,'创建并编辑','primary')
    save(c,cat,'01_新建曲谱','名称、作者、调性、拍号、Capo与初始小节数','管理 → 新建 → 未保存编辑器')
    c=Canvas();x,y,w,b=editor(c,blank=True);selection_panel(c,x,y,w,b,'default')
    save(c,cat,'02_新曲谱_尚未保存','新曲谱进入空白谱面；显示尚未保存','新建 → 输入 → 首次保存')
    for conflict,name in [(False,'03_首次保存曲谱'),(True,'04_保存曲谱_名称冲突')]:
        c=Canvas();editor(c);x,y,w,b=modal(c,'保存曲谱','把当前已应用的音乐内容保存到曲谱库。',520,470)
        c.field(x,y,w,'曲谱名称','风吹过山谷','此分类已有同名曲谱，请修改名称。' if conflict else None)
        c.field(x,y+113,w,'分类','歌曲编配',select=True)
        c.notice(x,y+211,w,'保存到当前浏览器的曲谱库','包含音乐内容与歌曲信息。保存后可在曲谱管理再次打开。')
        c.button(x+w-220,b-37,100,'取消');c.button(x+w-108,b-37,108,'保存曲谱','disabled' if conflict else 'primary')
        save(c,cat,name,'首次保存确认名称与分类；冲突时不覆盖现有作品','首次保存 → 成功 / 名称冲突')
    c=Canvas();x,y,w,b=editor(c,saved=True);selection_panel(c,x,y,w,b,'single');c.notice(359,123,434,'曲谱已保存','可在曲谱管理中再次打开。','green')
    save(c,cat,'05_保存成功','顶栏已保存状态与结果消息','保存 → 管理 → 再次打开')
    c=Canvas();editor(c);x,y,w,b=modal(c,'保存失败','你的编辑仍保留在当前会话，请重试保存。',500,322)
    c.notice(x,y,w,'暂时无法写入曲谱库','未执行离开操作，请继续留在编辑器。','red');c.button(x+w-234,b-37,112,'继续编辑');c.button(x+w-110,b-37,110,'重试保存','primary')
    save(c,cat,'06_保存失败_重试','失败时保留内容且不执行原定跳转','失败 → 重试 / 继续编辑')
    c=Canvas();editor(c);x,y,w,b=modal(c,'离开前保存修改？','“风吹过山谷”有尚未保存的修改。',580,322)
    c.notice(x,y,w,'当前修改还没有进入曲谱库','选择保存并继续后，保存成功才返回曲谱管理。','amber')
    c.button(x,b-37,114,'放弃修改','danger');c.button(x+w-246,b-37,110,'继续编辑');c.button(x+w-124,b-37,124,'保存并继续','primary')
    save(c,cat,'07_未保存离开确认','保存、放弃与继续编辑三条路径','返回管理 → 离开确认 → 保存后离开')
    c=Canvas();library(c);x,y,w,b=modal(c,'重命名曲谱','修改曲谱库中的显示名称。',480,310);c.field(x,y,w,'曲谱名称','山谷里的风');c.button(x+w-220,b-37,100,'取消');c.button(x+w-108,b-37,108,'确认重命名','primary')
    save(c,cat,'08_曲谱重命名','管理中修改名称，输入有效后确认','管理 → 更多 → 重命名')
    c=Canvas();editor(c);x,y,w,b=modal(c,'正在保存曲谱','写入完成前，请保留当前编辑会话。',500,290);c.box(x,y+9,w,7,'bg',3);c.box(x,y+9,w*.64,7,'blue',3);c.txt(x,y+45,'风吹过山谷 · 歌曲编配',13,'muted');c.button(x+w-124,b-37,124,'正在保存…','disabled');save(c,cat,'09_保存进行中','避免重复保存与未完成写入时离开','保存 → 写入中 → 成功 / 失败')
    cat='03_编辑工作台'
    for state,name in [('default','01_编辑工作台_默认态'),('input','02_单格输入_两位品位草稿'),('range','03_范围选择_多弦多拍')]:
        c=Canvas();x,y,w,b=editor(c,state);selection_panel(c,x,y,w,b,state)
        if state=='input':c.pill(128,315,'正在输入 1…','blue',116)
        save(c,cat,name,'位置反馈、高频时值工具与关联属性分层','选格 → 输入 / 拖动范围 → 操作')
    c=Canvas();editor(c);x,y,w,b=modal(c,'当前草稿尚未应用','先处理段落编辑中的修改，再保存曲谱或切换目标。',580,322)
    c.notice(x,y,w,'未应用的歌词不会直接写入保存结果','应用失败时保持当前界面；输入法组合期间不提交。','amber')
    c.button(x,b-37,130,'放弃草稿并继续','danger');c.button(x+w-248,b-37,110,'继续编辑');c.button(x+w-126,b-37,126,'应用并继续','primary')
    save(c,cat,'04_未应用草稿保护','与作品未保存保护分开；先应用草稿再保存文档','草稿 → 切目标 / 保存 → 三选项保护')
    c=Canvas();x,y,w,b=editor(c,'single',panel='song');c.section(x,y,'歌曲设置')
    for i,(l,v) in enumerate([('歌曲名称','风吹过山谷'),('编谱作者','六线猫'),('调性','C'),('基础拍号','4/4'),('Capo','0')]):c.field(x,y+44+i*91,w,l,v,select=i in [2,3])
    c.notice(x,y+509,w,'基础拍号作用于第 1–8 小节','局部拍号变化请在“小节”工具中操作。');c.button(x,b-49,w,'应用歌曲设置','primary')
    save(c,cat,'05_歌曲设置','歌曲级信息与局部小节属性分离','歌曲 → 修改 → 应用 → 保存曲谱')
    c=Canvas();editor(c);c.box(938,58,300,302,'white',10,'border');c.section(958,80,'视图与排版')
    for i,l in enumerate(['紧凑排版  ✓','舒适排版','显示和弦指法图  ✓','查看快捷键']):c.button(958,120+i*47,258,l,'selected' if i in [0,2] else 'ghost')
    c.txt(958,323,'隐藏指法图保留数据，导出同步。',11,'muted')
    save(c,cat,'06_视图与排版','视图状态不混入内容历史；不增加未实现缩放','视图 → 密度 / 指法图显示')
    c=Canvas();editor(c);x,y,w,b=modal(c,'快捷键','聚焦表单时，数字与删除操作遵循原生输入行为。',650,630)
    for i,(key,l) in enumerate([('0–24','输入品位'),('X','闷音音符'),('R / Shift+R','设为休止 / 取消休止'),('← ↑ ↓ →','移动编辑位置'),('Shift + 方向键','扩展选区'),('Delete / Backspace','删除所选音符'),('⌘ Z / ⌘ Shift Z','撤销 / 重做'),('Esc','收拢选区 / 关闭弹层')]):
        yy=y+i*47;c.box(x,yy,191,31,'bg',5);c.txt(x+12,yy+9,key,12,'navy',latin=True);c.txt(x+212,yy+9,l,13);c.line(x,yy+39,x+w,yy+39)
    c.button(x+w-100,b-37,100,'知道了','primary')
    save(c,cat,'07_快捷键帮助','集中帮助替代常驻长段说明','工作台 → 帮助 → 回到编辑位置')
    cat='04_歌词简谱与和弦'
    for numbered,single,error,name in [(False,True,False,'01_歌词_单拍编辑'),(False,False,False,'02_歌词_连续填词与对应预览'),(False,False,True,'03_歌词_超出谱尾错误'),(True,True,False,'04_简谱_单拍多音'),(True,False,False,'05_简谱_连续录入与覆盖保护')]:
        # 紧凑简谱表单恢复标准窗口，主流程在首屏呈现，高级操作按需展开。
        c=Canvas()
        x,y,w,b=editor(c,'tail' if error else 'single',panel='numbered' if numbered else 'lyric');text_panel(c,x,y,w,b,numbered,single,error)
        desc=('紧凑单音组：定位、内容、节奏、预览与提交' if single else '紧凑连续录入：高频表单前置，范围与高级操作按需展开') if numbered else '输入 → 逐拍预览 → 应用；保留各自覆盖默认规则'
        save(c,cat,name,desc,'简谱音符或窗口 → 段落 → 简谱 → 输入与预览 → 应用' if numbered else '选拍 → 段落 → 输入 → 预览定位 → 应用')
    c=Canvas();x,y,w,b=editor(c,'single',panel='chord');c.section(x,y,'和弦编辑');c.pill(x,y+35,'第 1 小节 · 第 1 拍','blue',w)
    c.field(x,y+79,w/2-6,'和弦名称','C');c.field(x+w/2+6,y+79,w/2-6,'常用预设','C',select=True)
    c.box(x,y+167,w,142,'bg',8);chord(c,x+w/2-30,y+212,1.22,'C');c.txt(x+13,y+278,'起始品位 1 · 自动显示 3 格',11,'muted')
    c.txt(x,y+331,'弦',11,'muted');c.txt(x+75,y+331,'品位',11,'muted');c.txt(x+199,y+331,'手指',11,'muted')
    for i,v in enumerate(['空弦','1','空弦','2','3','禁奏 ×']):
        yy=y+350+i*34;c.txt(x+6,yy+9,str(i+1),13,'muted',latin=True);c.button(x+50,yy,113,v,h=29);c.button(x+181,yy,123,['—','1','—','2','3','—'][i],h=29)
    c.button(x,y+558,w,'横按设置（0 / 4）  ＋','ghost',22);c.line(x-20,b-65,x+w+20,b-65);c.button(x,b-49,84,'取消');c.button(x+95,b-49,w-95,'应用和弦','primary')
    save(c,cat,'06_和弦_预设与六弦指法编辑','指法预览、弦表与横按入口','选拍 → 和弦 → 预设 / 指法 → 应用')
    c=Canvas();editor(c,'single',panel='chord');x,y,w,b=modal(c,'横按设置','最多 4 组；指法跨度超限时阻止应用。',560,470)
    chord(c,x+30,y+30,1.7,'F');c.field(x+160,y,w-160,'起始品位','1');c.field(x+160,y+91,w-160,'横按品位','1')
    c.field(x,y+196,w/3-10,'起弦','1',select=True);c.field(x+w/3+3,y+196,w/3-10,'止弦','6',select=True);c.field(x+2*w/3+6,y+196,w/3-10,'手指','1',select=True)
    c.button(x,b-37,102,'删除横按','danger');c.button(x+w-102,b-37,102,'完成设置','primary')
    save(c,cat,'07_和弦_横按设置','横按作为渐进展开的指法属性','和弦 → 横按 → 完成 → 应用')
    c=Canvas();x,y,w,b=editor(c,'single',panel='lyric');text_panel(c,x,y,w,b,rules_open=True)
    save(c,cat,'12_歌词_连续填词规则浮层','连续歌词标签右侧问号入口；点击展开规则，保留草稿和预览','连续歌词 → 问号图标 → 查看规则 → 关闭继续编辑')
    cat='05_技巧与小节结构'
    c=Canvas();x,y,w,b=editor(c,'measure');c.section(x,y,'小节属性');c.pill(x,y+35,'第 1 小节','blue',w)
    c.field(x,y+84,w,'当前小节拍号','4/4',select=True);c.field(x,y+179,w,'右边界','单小节线',select=True)
    c.button(x,y+273,w,'谱首开始反复  □');c.line(x,y+329,x+w,y+329);c.section(x,y+354,'小节复用')
    c.field(x,y+390,w/2-6,'来源起始','第 1 小节',select=True);c.field(x+w/2+6,y+390,w/2-6,'来源结束','第 4 小节',select=True)
    c.field(x,y+483,w,'插入位置','第 8 小节后',select=True);c.notice(x,y+552,w,'复制第 1–4 小节至第 8 小节后');c.button(x,b-49,w,'复制小节范围','primary')
    save(c,cat,'01_小节属性与范围复制','局部拍号、右边界、谱首反复与小节复用','小节 → 范围 → 插入位置 → 复制')
    c=Canvas();editor(c,'paste');x,y,w,b=modal(c,'拍点粘贴预览','剪贴板：3 拍 · 包含全部六弦与关联内容。',660,570)
    c.button(x,y,w/2-5,'在目标拍前插入','ghost');c.button(x+w/2+5,y,w/2-5,'从目标拍覆盖','selected')
    c.notice(x,y+65,w,'目标 · 第 2 小节 / 第 1 拍','覆盖 3 拍，时值合计 3/8。','blue')
    for i,(a,bv) in enumerate([('将替换拍点','3 拍'),('已有歌词 / 简谱','2 项 / 1 项'),('已有和弦','1 个'),('将清理失效技巧','1 个')]):
        yy=y+166+i*40;c.txt(x,yy,a,13,'muted');c.txt(x+w-106,yy,bv,13,'text',True);c.line(x,yy+27,x+w,yy+27)
    c.txt(x,y+345,'☑ 我已核对并确认覆盖以上内容',13,'amber');c.button(x+w-228,b-37,100,'取消预览');c.button(x+w-116,b-37,116,'应用粘贴','primary')
    save(c,cat,'02_拍点覆盖粘贴预览','列出音乐内容替换与技巧清理，显式确认','复制拍点 → 覆盖预览 → 确认 → 应用')
    c=Canvas();x,y,w,b=editor(c,'tuplet');c.section(x,y,'连音组');c.pill(x,y+35,'同小节内已选 3 拍','blue',w)
    c.wrap(x,y+84,'选中连续、相同时值和附点的拍点。成员数必须与连音比例一致。',w)
    for i,label in enumerate(['2:3','3:2','4:3','5:4','5:3','6:4']):c.button(x+i%2*(w/2+5),y+170+i//2*54,w/2-5,label,'selected' if i==1 else 'disabled',42)
    c.notice(x,y+369,w,'3 个八分音符占 2 个音符的时间','不支持混合时值、跨小节、嵌套或重叠。');c.button(x,y+473,w,'删除当前连音组','danger');c.button(x,b-49,w,'应用 3:2 连音','primary')
    save(c,cat,'03_连音组_比例与禁用条件','完整六比例与当前选区合法性说明','选择三拍 → 连音 → 应用 / 删除')
    c=Canvas();editor(c,'technique');x,y,w,b=modal(c,'添加弹奏技巧','按当前音符、拍点或范围选择可用技巧。',720,640)
    groups=[('音符连接',['击弦 H','勾弦 P','上滑音','下滑音','延音线']),('音高与修饰',['推弦','颤音','自然泛音','人工泛音','点弦 T','颤音奏 tr']),('演奏方向与范围',['扫弦','琶音','拨片方向','手掌闷音 P.M.','Let Ring'])]
    yy=y
    for title,items in groups:
        c.txt(x,yy,title,13,'muted');yy+=31
        for i,l in enumerate(items):c.button(x+i%3*(w/3+4),yy+i//3*49,w/3-8,l,'selected' if l=='推弦' else 'secondary',39)
        yy+=math.ceil(len(items)/3)*49+24
    c.button(x+w-122,b-37,122,'下一步：参数','primary')
    save(c,cat,'04_技巧选择器_完整16类','技巧分类与音符/拍点/范围作用域','技巧 → 分类 → 参数 → 添加')
    c=Canvas();x,y,w,b=editor(c,'technique');c.section(x,y,'推弦属性');c.pill(x,y+35,'已选技巧 · 第 1 小节 / 第 1 拍','blue',w)
    c.field(x,y+86,w,'技巧类型','推弦',select=True);c.txt(x,y+188,'推弦幅度',12,'muted');c.button(x,y+219,w/2-5,'半音（1/2）','selected',42);c.button(x+w/2+5,y+219,w/2-5,'全音（Full）',h=42)
    c.box(x,y+294,w,107,'bg',8);c.line(x+36,y+362,x+108,y+362,'text',1);c.line(x+108,y+362,x+169,y+320,'blue',2);c.txt(x+174,y+312,'1/2',14,'blue',latin=True);c.txt(x+22,y+322,'3',14,'text',latin=True)
    c.notice(x,y+425,w,'作用于当前音符','仅更新选中的推弦；更新后可以撤销。');c.button(x,b-49,104,'删除技巧','danger');c.button(x+116,b-49,w-116,'更新技巧','primary')
    save(c,cat,'05_技巧属性_半音与全音推弦','已有技巧更新/删除与参数渐进展示','点选技巧 → 更新参数 → 撤销')
    c=Canvas();editor(c,'range');c.notice(310,124,510,'已粘贴 3 拍 · 可撤销','本次影响：调整 2 个拍起点，移除 1 个失效技巧。','green')
    c.box(310,204,510,162,'white',9,'border');c.section(329,222,'编辑影响详情');c.txt(329,265,'第 2 小节：拍点起点随粘贴调整',12,'muted');c.txt(329,295,'第 2 小节：技巧关系不再有效，已移除',12,'muted');c.button(670,321,130,'撤销本次编辑')
    save(c,cat,'06_编辑影响反馈与撤销','不静默隐藏时值调整或技巧清理','提交 → 查看影响 → 撤销')
    c=Canvas();x,y,w,b=editor(c,'technique');c.section(x,y,'击弦 H');c.pill(x,y+35,'关系技巧 · 同弦音符','blue',w);c.field(x,y+85,w,'起始音符','第 1 小节 / 第 1 拍 / 第 2 弦');c.field(x,y+183,w,'目标音符','下一同弦音符');c.notice(x,y+295,w,'需要一个同弦目标音符','无法确定合法目标时，阻止添加并说明条件。','amber');c.button(x,b-49,w,'添加击弦','primary');save(c,cat,'07_关系技巧_目标音符','击勾弦、滑音、延音类目标规则','技巧 → 同弦目标 → 添加')
    c=Canvas();x,y,w,b=editor(c,'range');c.section(x,y,'手掌闷音 P.M.');c.pill(x,y+35,'范围技巧 · 3 拍','blue',w);c.field(x,y+85,w,'起点','第 1 小节 / 第 1 拍');c.field(x,y+183,w,'终点','第 1 小节 / 第 3 拍');c.notice(x,y+295,w,'与闷音音符 x 不同','P.M. 标注演奏方式；x 是独立的闷音音符。');c.button(x,b-49,w,'添加范围技巧','primary');save(c,cat,'08_范围技巧_起止与语义','P.M.、Let Ring 的范围属性','范围选择 → 技巧 → 起止 → 应用')
    cat='06_图片导出与异常'
    for state,name in [('ready','01_A4多页图片预览'),('busy','02_图片生成进度与取消'),('done','03_图片生成成功与下载'),('error','04_导出失败_字体或超宽')]:
        c=Canvas();c.box(0,0,1440,77,'white');c.txt(32,24,'A4 图片预览',23,'navy',True);c.txt(245,31,'纵向 · 300 DPI · 白底 PNG',12,'muted');c.button(1308,21,100,'关闭预览')
        c.box(0,78,237,822,'white');c.line(237,78,237,900);c.section(24,110,'页面 · 共 3 页')
        for i in range(3):
            yy=160+i*211;c.box(37,yy,158,173,'bg',6,'blue' if i==0 else 'border')
            for r in range(3):
                for st in range(6):c.line(55,yy+40+r*36+st*4,176,yy+40+r*36+st*4,'#B9C2D2',.5)
            c.txt(77,yy+182,f'第 {i+1} 页',11,'muted')
        score(c,411,104,520,pageheight=736,pageindex='1 / 3')
        c.box(1104,78,336,822,'white');c.section(1128,111,'输出设置');c.field(1128,157,288,'输出范围','全部 3 页',select=True)
        c.notice(1128,250,288,'2480 × 3508 像素 / 页','单页 PNG，多页打包为 ZIP。')
        if state=='busy':
            c.section(1128,368,'正在生成第 2 / 3 页');c.box(1128,414,288,7,'bg',3);c.box(1128,414,192,7,'blue',3);c.txt(1128,444,'请保持此窗口打开。',12,'muted');c.button(1128,487,288,'取消生成')
        elif state=='done':
            c.notice(1128,368,288,'全部图片已生成','风吹过山谷_A4图片.zip','green');c.button(1128,473,288,'下载图片包','primary',42);c.button(1128,528,288,'重新生成')
        elif state=='error':
            c.notice(1128,368,288,'预览已失效','字体发生变化，请重新准备预览。','red');c.button(1128,473,288,'重新准备预览','primary');c.notice(1128,557,288,'超出 A4 宽度时阻止生成','返回编辑器调整内容后再试。','amber')
        else:
            c.button(1128,368,288,'生成全部图片','primary',42);c.button(1128,423,288,'仅生成当前页');c.txt(1128,494,'预览采用当前已提交内容。',12,'muted');c.txt(1128,522,'未应用的草稿不会进入输出。',12,'muted')
        save(c,cat,name,'预览、生成、下载分阶段；保持快照与字体一致','导出 → 预览 → 生成 → 下载 / 取消 / 重试')
    cat='07_窄窗口适配'
    c=Canvas(1280,800);x,y,w,b=editor(c,'single',panel='lyric');text_panel(c,x,y,w,b,single=True);save(c,cat,'01_笔记本1280_谱面与属性并列','常规笔记本保留右侧属性，谱面区域可滚动','笔记本 → 编辑 → 应用')
    c=Canvas(1024,768);x,y,w,b=editor(c,'single',panel='lyric');c.section(x,y,'歌词 · 单拍编辑');c.pill(x+198,y-4,'第 1 小节 / 第 1 拍','blue',179)
    content_row_actions(c,x+w-304,y-4,304)
    c.field(x,y+49,570,'歌词文本','风吹过山谷');c.button(x+594,y+73,106,'取消');c.button(x+712,y+73,222,'应用并下一拍','primary',40);c.txt(x,y+145,'底部属性分区 · 谱面与字段同时可见 · 可独立滚动',12,'muted')
    save(c,cat,'02_窄窗口1024_底部属性分区','窄窗口切上下分区，避免属性遮挡全部谱面','窄窗口 → 选拍 → 底部编辑')

def overview():
    # 总览按分类分页，每张 PNG 缩略图附带可检索名称。
    groups={}
    for item in SCREENS:groups.setdefault(item['category'],[]).append(item)
    for cat,items in groups.items():
        if RENDER_CATEGORIES is not None and cat not in RENDER_CATEGORIES:continue
        items=sorted(items,key=lambda item:item['name'])
        cols=3;rows=math.ceil(len(items)/cols);c=Canvas(1440,126+rows*298)
        c.txt(36,29,'六线猫 / '+cat.replace('_',' · '),28,'navy',True);c.txt(36,77,'视觉与交互评审稿 · 2026.10.19 修订 · 2× PNG',13,'muted')
        for i,it in enumerate(items):
            x=36+i%cols*468;y=124+i//cols*298
            image=Image.open(ROOT/it['file']);image.thumbnail((438*S,240*S),Image.Resampling.LANCZOS)
            c.box(x,y,438,242,'white',9,'border');c.im.paste(image,(round(x*S),round(y*S)))
            c.d=ImageDraw.Draw(c.im);c.txt(x,y+250,it['name'],12,'text',maxw=438)
        c.im.save(ROOT/(cat+'_总览.png'),optimize=True)
    c=Canvas(1440,1040);c.box(0,0,1440,1040,'white');brand(c,48,40)
    c.txt(48,113,'从灵感到曲谱，形成完整工作流。',36,'navy',True);c.txt(48,176,'Ant Design 6.4.4 · 新建 / 编辑 / 保存 / 管理',18,'muted')
    c.pill(48,221,f'{len(SCREENS)} 张设计稿','blue',136);c.pill(200,221,'7 类界面','green',104);c.pill(321,221,'2× PNG','muted',110)
    for i,(title,detail) in enumerate([('曲谱管理','查找、整理、继续上一次编配'),('新建与保存','首次创建、手动保存、离开保护'),('编辑工作台','音符、节奏、选区与歌曲设置'),('文本与和弦','歌词、简谱、指法与横按'),('技巧与结构','连音、技巧、小节与拍点复用'),('导出与适配','A4 图片、多页 ZIP、窄窗口')]):
        x=48+(i%3)*449;y=318+(i//3)*137;c.box(x,y,421,113,'bg',12);c.pill(x+20,y+18,f'0{i+1}','blue',40);c.txt(x+76,y+23,title,19,'navy',True);c.txt(x+20,y+76,detail,13,'muted')
    hero=Image.open(ROOT/'03_编辑工作台/02_单格输入_两位品位草稿.png');hero.thumbnail((905*S,400*S),Image.Resampling.LANCZOS);c.im.paste(hero,(48*S,630*S));c.d=ImageDraw.Draw(c.im)
    c.txt(1010,659,'内容优先的工作台',21,'navy',True);c.wrap(1010,709,'固定高频输入工具，按选区呈现属性；输入、预览、提交形成一致的视觉顺序。',350,15,'muted',28)
    c.txt(1010,843,'交互规则与实现边界',17,'navy',True);c.wrap(1010,881,'这些是静态评审稿。曲谱保存介质、自动保存与云同步不作实现承诺。',350,13,'muted',24)
    c.im.save(ROOT/'00_设计稿总览.png',optimize=True)
    if RENDER_CATEGORIES is not None:return
    c=Canvas(1440,980);c.box(0,0,1440,980,'white');c.txt(40,38,'视觉规范 / 编辑器工作台',30,'navy',True);c.txt(40,92,'Ant Design 6.4.4 · 品牌 token · 官方 Icons · 通用控件优先复用',14,'muted')
    for i,(label,key) in enumerate([('主操作','blue'),('主文字','text'),('次级文字','muted'),('背景','bg'),('边框','border'),('成功','green'),('警告','amber'),('危险','red')]):
        xx=40+i*170;c.box(xx,155,148,72,key,10);c.txt(xx,244,label,13);c.txt(xx,270,C[key],12,'muted',latin=True)
    c.section(40,344,'字阶与间距');c.txt(40,397,'页面标题 28 / 36',28,'navy');c.txt(40,451,'模块标题 18 / 26',18);c.txt(40,495,'正文与字段 14 / 22',14);c.txt(40,532,'辅助说明 12 / 20',12,'muted');c.txt(40,574,'间距：4 · 8 · 12 · 16 · 24 · 32',13,'muted')
    c.section(561,344,'按钮与状态')
    for i,(l,k) in enumerate([('主操作','primary'),('取消','secondary'),('当前选中','selected'),('危险操作','danger'),('不可用','disabled'),('键盘焦点','secondary'),('悬停状态','selected'),('按下状态','primary')]):
        xx=561+(i%3)*160;yy=393+(i//3)*58;c.button(xx,yy,146,l,k,40)
        if i==5:c.box(xx-3,yy-3,152,46,fill=None,radius=10,stroke='blue')
    c.field(561,579,309,'普通字段','风吹过山谷');c.field(902,579,309,'错误字段','风吹过山谷','已有同名曲谱，请修改名称。')
    c.notice(561,700,650,'作用范围始终可读','字段错误靠近字段，整体操作结果可展开影响详情。')
    c.section(40,727,'设计约束');c.wrap(40,775,'高频音符工具保持一行；属性区动作固定在底部；当前对象与位置可见；歌词与简谱预览结构一致；未应用草稿与未保存作品分层保护。',1230,15,'muted',30)
    c.txt(40,887,'字体：Hiragino Sans GB / Arial。谱面为布局示意，正式记谱继续使用项目布局引擎与音乐资产。',13,'muted')
    c.im.save(ROOT/'00_视觉规范.png',optimize=True)
    c=Canvas(1440,1080);c.box(0,0,1440,1080,'white');c.txt(40,35,'Ant Design / 组件与图标映射',30,'navy',True);c.txt(40,89,'antd 6.4.4 · @ant-design/icons 6.2.5 · 本轮以现有安装版本为准',14,'muted')
    for i,(title,names) in enumerate([('表单输入','Form · Input · InputNumber · Select'),('导航与模式','Tabs · Segmented · Menu · Dropdown'),('反馈与输出','Modal · Alert · Progress · Tag'),('数据与操作','Table · Card · Button · Tooltip')]):
        xx=40+i%2*685;yy=151+i//2*123;c.box(xx,yy,652,99,'bg',8);c.txt(xx+20,yy+18,title,18,'text');c.txt(xx+20,yy+59,names,14,'muted',latin=True)
    c.section(40,435,'通用图标：官方 SVG 路径，统一 14 / 16 px')
    names=['SaveOutlined','PlusOutlined','SearchOutlined','DownOutlined','UndoOutlined','RedoOutlined','AppstoreOutlined','BarsOutlined','DeleteOutlined','CopyOutlined','EditOutlined','StarOutlined','SettingOutlined','FileTextOutlined','FolderOutlined','DownloadOutlined','CloseOutlined','MoreOutlined','InfoCircleFilled','CheckCircleFilled','ExclamationCircleFilled','CloseCircleFilled','EyeOutlined','PictureOutlined']
    for i,name in enumerate(names):
        xx=40+i%6*228;yy=490+i//6*94;c.box(xx,yy,207,74,'bg',6);c.icon(name,xx+18,yy+16,20,'blue');c.txt(xx+16,yy+48,name,11,'muted',maxw=176,latin=True)
    c.notice(40,904,1348,'音乐记谱符号保留领域资产','全音符、连音、附点、TAB、休止、技巧和指法图不使用通用图标代替。')
    c.txt(40,1012,'PNG 是 Ant Design 规范与品牌 token 的设计表达；正式控件行为必须在 React 实现中核对。',13,'muted')
    c.im.save(ROOT/'00_AntDesign组件与图标映射.png',optimize=True)

def build_precision_sheet():
    # 放大展示几何规则与选取层级，供设计评审核对，不改变编辑器实现。
    c=Canvas();c.box(0,0,1440,900,'white')
    c.txt(40,30,'六线谱 / 对齐与选区细节',28,'navy')
    c.txt(40,82,'数字墨迹中心 = 弦线交点 = 符干中心轴；白描边沿字形，选区不重复绘制音符',14,'muted')
    cases=[('单、双位品位对齐','3 / 12 / x 共用中心轴，数字在弦线上垂直居中。'),('单格选中','细蓝色轮廓 + 蓝色数字；边框保留字形四周留白。'),('悬停反馈','更淡的局部蓝色提示，不显示控制柄或强选中边框。'),('多弦、多拍选区','范围覆盖 3 拍 × 4 弦；透明底色、轮廓与短端点柄。'),('键盘焦点','当前格保持清晰轮廓；方向键移动，Shift 扩展范围。'),('导出与预览','输出音乐内容，隐藏悬停、选区、焦点和控制柄。')]
    for i,(title,detail) in enumerate(cases):
        xx=40+i%2*695;yy=136+i//2*226;c.box(xx,yy,650,203,'bg',8);c.txt(xx+20,yy+18,title,17)
        sy=yy+64;axes=[xx+130,xx+265,xx+400];strings=[1,3,2]
        if i==2:c.score_highlight(axes[1]-11,sy+30-8,22,16,12)
        if i==3:c.score_highlight(axes[0]-12,sy+4,axes[-1]-axes[0]+24,42)
        for st in range(6):c.line(xx+44,sy+st*10,xx+594,sy+st*10,'text',.8)
        for axis,string,value in zip(axes,strings,['3','12','x']):
            tab_stem(c,axis,sy+string*10,sy+78,value)
            note(c,axis,sy+string*10,value,False,color='blue' if i==3 or (i in [1,4] and value=='12') else 'text')
        c.line(axes[1],sy+78,axes[2],sy+78,'text',3)
        if i in [1,4]:score_selection(c,axes[1],sy+30,w=25)
        if i==3:
            score_selection(c,(axes[0]+axes[2])/2,sy+25,axes[2]-axes[0]+24,42,True)
            score_selection(c,axes[0],sy+10)
        c.txt(xx+20,yy+166,detail,13,'muted')
    c.txt(40,851,'符干向上伸入 TAB，靠近该拍最下方品位数字；描边外留 2px，连梁基线保持一致。',13,'muted')
    save(c,'03_编辑工作台','09_TAB对齐与选区细节','数字与符干居中、单格/范围/悬停/键盘焦点和导出边界','放大对齐与选区视觉参考')

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--category',action='append',help='仅重绘指定分类及全局封面；清单仍包含全部画面')
    args=parser.parse_args()
    RENDER_CATEGORIES=set(args.category) if args.category else None
    # 保留既有交付清单的顺序，新增状态追加，避免定向修订重排历史资料。
    manifest_path=ROOT/'制作源文件/manifest.json'
    existing_items=json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    existing_order={item['file']:index for index,item in enumerate(existing_items)}
    from review_additions import build_review
    from notation_design import build_notation_sheets
    build();build_review(globals());build_notation_sheets(globals());build_precision_sheet();overview()
    SCREENS.sort(key=lambda item:existing_order.get(item['file'],len(existing_order)))
    manifest_path.write_text(json.dumps(SCREENS,ensure_ascii=False,indent=2))
    print(json.dumps({'screens':len(SCREENS),'categories':len(set(i['category'] for i in SCREENS)),'root':str(ROOT)},ensure_ascii=False))
