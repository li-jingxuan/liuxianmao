import type { GuitarAdvancedData } from "../../lib/guitar-advanced/model";
/** 静态教学数据；不包含用户状态或运行时副作用。 */
export const GUITAR_ADVANCED_COURSES = {
  modules: [
    {
      id: "rhythm-and-beat",
      title: "节奏与拍点",
      summary: "确认拍单位，分辨时值、切分与三连音",
      order: 1,
      availability: "available",
      lessonIds: ["rhythm-eighth-sixteenth", "rhythm-syncopation-triplets"],
      exerciseIds: [
        "rhythm-identify-eighth-notes",
        "rhythm-identify-beat-structure",
      ],
    },
    {
      id: "chords-and-progressions",
      title: "和弦与进行",
      summary: "理解三和弦与 C 大调 I-IV-V 进行",
      order: 2,
      availability: "available",
      lessonIds: ["chords-triad-construction", "chords-common-progressions"],
      exerciseIds: ["chords-select-triad-tones", "chords-order-progression"],
    },
    {
      id: "scales-and-fretboard",
      title: "音阶与指板",
      summary: "A 小调五声音阶及根音定位",
      order: 3,
      availability: "available",
      lessonIds: ["scales-a-minor-pentatonic", "scales-root-note-locations"],
      exerciseIds: ["scales-find-root-notes"],
    },
    {
      id: "playing-techniques",
      title: "弹奏技巧",
      summary: "击勾弦、滑音、推弦和闷音的读谱",
      order: 4,
      availability: "available",
      lessonIds: [
        "techniques-hammer-pull-slide",
        "techniques-bend-muted-notes",
      ],
      exerciseIds: ["techniques-identify-notation"],
    },
  ],
  lessons: [
    {
      id: "rhythm-eighth-sixteenth",
      moduleId: "rhythm-and-beat",
      title: "八分音符与十六分音符",
      durationMinutes: 8,
      order: 1,
      objectives: [
        "在 4/4 拍中确认四分音符为一拍",
        "识别每拍二等分与四等分",
        "用均匀口数对应谱面位置",
      ],
      blocks: [
        {
          type: "paragraph",
          title: "先确认拍单位",
          content:
            "本课使用 4/4 拍，四分音符占一拍。每小节四拍，先保持一、二、三、四的稳定脉冲，再看每拍如何分割。",
        },
        {
          type: "paragraph",
          title: "把一拍分成两份",
          content:
            "一个八分音符占半拍。连续两个八分音符填满一拍，可以数“一、和；二、和”。不要因为音符数量增加就加快每一拍。",
        },
        {
          type: "paragraph",
          title: "把一拍分成四份",
          content:
            "一个十六分音符占四分之一拍。每拍四个等长音，先慢数四个均匀位置，再观察两条连梁。速度由拍子的快慢决定，时值由谱面决定。",
        },
        {
          type: "scoreExample",
          documentId: "rhythm-basic-score",
          caption: "4/4，每拍两个八分音符。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content:
            "不要把一拍两次用于所有拍号；本课以四分音符为一拍，6/8 的复合拍感需另行说明。",
        },
      ],
      exerciseIds: ["rhythm-identify-eighth-notes"],
      previousLessonId: null,
      nextLessonId: "rhythm-syncopation-triplets",
    },
    {
      id: "rhythm-syncopation-triplets",
      moduleId: "rhythm-and-beat",
      title: "切分与三连音",
      durationMinutes: 8,
      order: 2,
      objectives: [
        "找到强拍与后半拍",
        "区分跨强位延音和均分三连音",
        "读懂谱面 3 标记",
      ],
      blocks: [
        {
          type: "paragraph",
          title: "切分改变重音感",
          content:
            "切分常从较弱的拍点发音，并延续越过较强拍点。先数出原有强拍，再确认音的起点，不要把延续位置当成再次拨弦。",
        },
        {
          type: "paragraph",
          title: "连线延续同一个音",
          content:
            "谱例中第一拍后半的音通过连线延续到第二拍前半。第二拍仍然存在，只是这里不重新发音，手脚可继续保持拍点。",
        },
        {
          type: "paragraph",
          title: "三连音改变分割方式",
          content:
            "本课的八分三连音把一拍均分为三份，三个音合占一个四分音符的时间。它与普通八分音符的一拍两份不同，也不等于切分。",
        },
        {
          type: "scoreExample",
          documentId: "triplet-score",
          caption: "第一拍上方有 3 标记，后续每拍一个四分音符。",
        },
        {
          type: "scoreExample",
          documentId: "syncopation-score",
          caption: "对比跨拍延音与一拍三等分。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content: "三连音要均匀分成三份；不能把前两个压快、最后一个拖长。",
        },
      ],
      exerciseIds: ["rhythm-identify-beat-structure"],
      previousLessonId: "rhythm-eighth-sixteenth",
      nextLessonId: "chords-triad-construction",
    },
    {
      id: "chords-triad-construction",
      moduleId: "chords-and-progressions",
      title: "三和弦构成",
      durationMinutes: 8,
      order: 1,
      objectives: [
        "识别根音、三音、五音",
        "选出 C 大三和弦的音",
        "区分音名组成与指法",
      ],
      blocks: [
        {
          type: "paragraph",
          title: "三和弦的三个角色",
          content:
            "三和弦以根音、三音、五音构成。角色说的是音与根音的关系，不是吉他第几根弦，也不是和弦指法里的第几个手指。",
        },
        {
          type: "paragraph",
          title: "C 大三和弦",
          content:
            "在 C 大调的音名序列 C、D、E、F、G、A、B 中，从 C 起隔一个音取一个音，得到 C、E、G。三个音的顺序改变或重复出现，仍可形成 C 和弦。",
        },
        {
          type: "paragraph",
          title: "指法与和弦组成",
          content:
            "六弦指法可同时包含重复的 C、E 或 G。识别和弦先看组成音，不把拨弦顺序、最低音或按弦数量当作和弦音数。",
        },
        {
          type: "scoreExample",
          documentId: "chords-score",
          caption: "按 C、F、G、C 顺序阅读和弦名称。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content: "D、F 虽属于 C 大调，也不是 C 大三和弦的组成音。",
        },
      ],
      exerciseIds: ["chords-select-triad-tones"],
      previousLessonId: "rhythm-syncopation-triplets",
      nextLessonId: "chords-common-progressions",
    },
    {
      id: "chords-common-progressions",
      moduleId: "chords-and-progressions",
      title: "常见 I-IV-V 进行",
      durationMinutes: 8,
      order: 2,
      objectives: [
        "把调内级数映射到和弦",
        "读懂 C 大调 I-IV-V",
        "按明确顺序排列和弦",
      ],
      blocks: [
        {
          type: "paragraph",
          title: "先确定调性",
          content:
            "本课固定在 C 大调，I 对应 C、IV 对应 F、V 对应 G。换调后级数关系保留，和弦音名会改变，不能把 I 永远解释成 C。",
        },
        {
          type: "paragraph",
          title: "进行是一条顺序",
          content:
            "I → IV → V 在本课表示 C → F → G。谱例再回到 C，帮助观察回到主和弦的稳定感；练习只排列题干要求的前三项。",
        },
        {
          type: "paragraph",
          title: "按拍点切换和弦",
          content:
            "和弦名称标在相应的拍点上。先用稳定拍子读出和弦顺序，再练切换，暂不追求快速扫弦，也不凭主观好听与否替代指定顺序。",
        },
        {
          type: "scoreExample",
          documentId: "chords-score",
          caption: "按 C、F、G、C 顺序阅读和弦名称。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content:
            "排列任务有指定答案；C-F-G 与 G-C-F 都可能出现在音乐里，但不是同一条指定进行。",
        },
      ],
      exerciseIds: ["chords-order-progression"],
      previousLessonId: "chords-triad-construction",
      nextLessonId: "scales-a-minor-pentatonic",
    },
    {
      id: "scales-a-minor-pentatonic",
      moduleId: "scales-and-fretboard",
      title: "A 小调五声音阶",
      durationMinutes: 8,
      order: 1,
      objectives: [
        "说出 A/C/D/E/G 五个音名",
        "在有限区域识别音阶内音",
        "区分音名与指板位置",
      ],
      blocks: [
        {
          type: "paragraph",
          title: "五声音阶的五个音名",
          content:
            "本课 A 小调五声音阶由 A、C、D、E、G 构成。五声音阶说的是五种音名，不是整个指板只能弹五个位置。",
        },
        {
          type: "paragraph",
          title: "同一音名可出现多次",
          content:
            "标准调弦中，同一个 A 可出现在不同弦和品位上。观察指板时同时记录弦号、品位和音名，避免把一个位置当成一个独立音阶。",
        },
        {
          type: "paragraph",
          title: "从有限范围开始",
          content:
            "本课只练第 6 弦和第 5 弦的 0–5 品。先找出属于 A、C、D、E、G 的位置，再将它们按弦与品位串起来，不把所有相邻半音都加入音阶。",
        },
        {
          type: "diagram",
          diagramId: "a-minor-fretboard",
          caption: "标准调弦，第 6/5 弦，0–5 品；格内显示音名。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content: "音阶练习要求选出所有音阶内位置，不是只选根音 A。",
        },
      ],
      exerciseIds: ["scales-find-root-notes"],
      previousLessonId: "chords-common-progressions",
      nextLessonId: "scales-root-note-locations",
    },
    {
      id: "scales-root-note-locations",
      moduleId: "scales-and-fretboard",
      title: "根音定位",
      durationMinutes: 8,
      order: 2,
      objectives: [
        "读懂标准调弦与空弦",
        "定位两个低音区域的 A 根音",
        "用根音检查音阶位置",
      ],
      blocks: [
        {
          type: "paragraph",
          title: "弦号与空弦",
          content:
            "第 1 弦是最高音弦，第 6 弦是最低音弦。标准调弦的第 6 弦空弦是 E，第 5 弦空弦是 A；0 品表示空弦，不是琴颈上的额外一格。",
        },
        {
          type: "paragraph",
          title: "沿品位寻找 A",
          content:
            "每升一品音高上升半音。在本课区域，第 6 弦第 5 品和第 5 弦空弦都是 A，两个位置的音高相同，可以帮助核对定位。",
        },
        {
          type: "paragraph",
          title: "根音与音阶的关系",
          content:
            "A 是本课音阶的根音，C、D、E、G 是其余音阶音。完整练习先选出全部音阶内位置，再在解析里确认其中哪些是根音，不能把根音与全部音阶音混同。",
        },
        {
          type: "diagram",
          diagramId: "a-minor-fretboard",
          caption: "标准调弦，第 6/5 弦，0–5 品；格内显示音名。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content:
            "图示只包含两根弦；按图例读弦号，不能把屏幕上方默认当成第 1 弦。",
        },
      ],
      exerciseIds: ["scales-find-root-notes"],
      previousLessonId: "scales-a-minor-pentatonic",
      nextLessonId: "techniques-hammer-pull-slide",
    },
    {
      id: "techniques-hammer-pull-slide",
      moduleId: "playing-techniques",
      title: "击弦、勾弦与滑音",
      durationMinutes: 8,
      order: 1,
      objectives: ["识别 H 与 P", "区分滑动换品与击勾弦", "理解连接音的起止点"],
      blocks: [
        {
          type: "paragraph",
          title: "H：击弦上行",
          content:
            "H 连接同一弦上较低品与较高品。先拨出起音，再用左手手指击向目标品位，使第二个音发声；不要把每个连接音都理解为一次右手拨弦。",
        },
        {
          type: "paragraph",
          title: "P：勾弦下行",
          content:
            "P 从较高品连接到较低品。先准备目标低品，再以勾离动作使弦继续发声。单纯把手指竖直抬起可能让声音中断。",
        },
        {
          type: "paragraph",
          title: "滑音：保持接触换位置",
          content:
            "向上或向下的斜线表示按弦手指在保持接触时滑到目标品。滑音改变按弦位置，击勾弦则用不同手指动作连接两音；本练习仅验证读谱。",
        },
        {
          type: "scoreExample",
          documentId: "techniques-score",
          caption: "依次观察 H、P、向上滑线、推弦箭头与最后的 x 音符。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content:
            "H/P 和滑音必须读出同弦的起止音；看到连接线不等于都使用滑音。",
        },
      ],
      exerciseIds: ["techniques-identify-notation"],
      previousLessonId: "scales-root-note-locations",
      nextLessonId: "techniques-bend-muted-notes",
    },
    {
      id: "techniques-bend-muted-notes",
      moduleId: "playing-techniques",
      title: "推弦与闷音",
      durationMinutes: 8,
      order: 2,
      objectives: [
        "识别推弦箭头与音程标注",
        "区分推弦和滑音",
        "区分 x 闷音与休止",
      ],
      blocks: [
        {
          type: "paragraph",
          title: "推弦改变弦的张力",
          content:
            "推弦箭头从一个音出发，手指横向推弦使音高上升。谱例标注半音推弦，读谱时要同时看起音品位与目标音程，不把箭头当成滑到更高品。",
        },
        {
          type: "paragraph",
          title: "x 是有时值的闷音",
          content:
            "x 表示没有确定音高的闷音，仍需在指定拍点拨出打击性的声音。它不是空弦 0，也不是完全不发声的休止符。",
        },
        {
          type: "paragraph",
          title: "读记号，再选动作",
          content:
            "H 用击弦、P 用勾弦、斜线用滑音、箭头用推弦、x 用闷音。先明确每个符号的起止与拍点，真实演奏的音准与力度需要另外练习。",
        },
        {
          type: "scoreExample",
          documentId: "techniques-score",
          caption: "依次观察 H、P、向上滑线、推弦箭头与最后的 x 音符。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content:
            "半音推弦与全音推弦不同；闷音不等于休止，也不能据此练习成绩推断演奏已达标。",
        },
      ],
      exerciseIds: ["techniques-identify-notation"],
      previousLessonId: "techniques-hammer-pull-slide",
      nextLessonId: null,
    },
  ],
  exercises: [
    {
      id: "rhythm-identify-eighth-notes",
      moduleId: "rhythm-and-beat",
      lessonId: "rhythm-eighth-sixteenth",
      relatedLessonId: "rhythm-eighth-sixteenth",
      reviewLessonIds: ["rhythm-eighth-sixteenth"],
      type: "singleChoice",
      title: "从谱例中选出八分音符节奏",
      prompt: "在 4/4 拍、四分音符为一拍时，哪个选项是一拍两次的八分音符节奏？",
      explanation:
        "每拍两次对应两个八分音符；每拍一次是四分节奏，每拍四次是十六分节奏。改变音符时值不等于改变每拍速度。",
      options: [
        {
          id: "once-per-beat",
          label: "每拍一次",
          stimulusId: "quarter-stimulus",
        },
        {
          id: "twice-per-beat",
          label: "每拍两次",
          stimulusId: "eighth-stimulus",
        },
        {
          id: "four-times-per-beat",
          label: "每拍四次",
          stimulusId: "sixteenth-stimulus",
        },
      ],
      answer: {
        type: "singleChoice",
        optionId: "twice-per-beat",
      },
    },
    {
      id: "rhythm-identify-beat-structure",
      moduleId: "rhythm-and-beat",
      lessonId: "rhythm-syncopation-triplets",
      relatedLessonId: "rhythm-syncopation-triplets",
      reviewLessonIds: ["rhythm-syncopation-triplets"],
      type: "singleChoice",
      title: "判断三连音的拍点结构",
      prompt: "谱例第一拍的三个八分音符上方有 3 标记，它们怎样分配这一拍？",
      explanation:
        "这里的八分三连音把一拍均分成三份。切分是弱位起音延续越过较强拍点，并不是三等分本身。",
      stimulusId: "triplet-stimulus",
      options: [
        {
          id: "two-parts",
          label: "均分为两份，最后一个音移到下一拍",
        },
        {
          id: "three-parts",
          label: "三个音将这一拍均分成三份",
        },
        {
          id: "four-parts",
          label: "均分成四份，最后一份留空",
        },
      ],
      answer: {
        type: "singleChoice",
        optionId: "three-parts",
      },
    },
    {
      id: "chords-select-triad-tones",
      moduleId: "chords-and-progressions",
      lessonId: "chords-triad-construction",
      relatedLessonId: "chords-triad-construction",
      reviewLessonIds: ["chords-triad-construction"],
      type: "multipleChoice",
      title: "选出 C 大三和弦构成音",
      prompt: "从下面五个音名中选择 C 大三和弦的全部组成音。",
      explanation:
        "C 大三和弦由根音 C、三音 E、五音 G 构成。D、F 虽在 C 大调音阶中，但不属于这个三和弦。多选须集合完全一致。",
      options: [
        {
          id: "c",
          label: "C",
        },
        {
          id: "d",
          label: "D",
        },
        {
          id: "e",
          label: "E",
        },
        {
          id: "f",
          label: "F",
        },
        {
          id: "g",
          label: "G",
        },
      ],
      answer: {
        type: "multipleChoice",
        optionIds: ["c", "e", "g"],
      },
    },
    {
      id: "chords-order-progression",
      moduleId: "chords-and-progressions",
      lessonId: "chords-common-progressions",
      relatedLessonId: "chords-common-progressions",
      reviewLessonIds: ["chords-common-progressions"],
      type: "ordering",
      title: "排列 C 大调 I-IV-V",
      prompt: "将 C、F、G 排成 C 大调 I → IV → V 的指定顺序。",
      explanation:
        "C 大调的 I 是 C、IV 是 F、V 是 G，所以应为 C → F → G。题目要求指定级数顺序，不以哪种排列更好听为评分依据。",
      items: [
        {
          id: "c",
          label: "C",
        },
        {
          id: "f",
          label: "F",
        },
        {
          id: "g",
          label: "G",
        },
      ],
      initialOrderIds: ["g", "c", "f"],
      answer: {
        type: "ordering",
        orderedIds: ["c", "f", "g"],
      },
    },
    {
      id: "scales-find-root-notes",
      moduleId: "scales-and-fretboard",
      lessonId: "scales-root-note-locations",
      relatedLessonId: "scales-root-note-locations",
      reviewLessonIds: [
        "scales-a-minor-pentatonic",
        "scales-root-note-locations",
      ],
      type: "targetSelection",
      title: "在指板上找出音阶位置",
      prompt:
        "标准调弦：请选择第 6/5 弦、0–5 品范围内全部 A 小调五声音阶位置（可多选，含空弦）。",
      explanation:
        "A 小调五声音阶为 A、C、D、E、G。此处两根弦的 0、3、5 品均属于音阶；第 6 弦 5 品与第 5 弦 0 品是根音 A。不要只选择根音。",
      diagramId: "a-minor-fretboard",
      targetIds: [
        "string-6-fret-0",
        "string-6-fret-1",
        "string-6-fret-2",
        "string-6-fret-3",
        "string-6-fret-4",
        "string-6-fret-5",
        "string-5-fret-0",
        "string-5-fret-1",
        "string-5-fret-2",
        "string-5-fret-3",
        "string-5-fret-4",
        "string-5-fret-5",
      ],
      answer: {
        type: "targetSelection",
        targetIds: [
          "string-6-fret-0",
          "string-6-fret-3",
          "string-6-fret-5",
          "string-5-fret-0",
          "string-5-fret-3",
          "string-5-fret-5",
        ],
      },
    },
    {
      id: "techniques-identify-notation",
      moduleId: "playing-techniques",
      lessonId: "techniques-bend-muted-notes",
      relatedLessonId: "techniques-bend-muted-notes",
      reviewLessonIds: [
        "techniques-hammer-pull-slide",
        "techniques-bend-muted-notes",
      ],
      type: "singleChoice",
      title: "识别常用技巧记号与用途",
      prompt: "观察谱例，选择 H、P、斜线、推弦箭头、x 的整组正确解释。",
      explanation:
        "H 从低品击向高品，P 从高品勾向低品；斜线表示保持接触滑到目标品，推弦箭头表示增大弦张力升高音高；x 是有拍点的闷音，不是休止。",
      stimulusId: "techniques-stimulus",
      options: [
        {
          id: "correct-techniques",
          label: "H 击弦上行；P 勾弦下行；斜线滑音；箭头推弦；x 闷音",
        },
        {
          id: "reversed-hp",
          label: "H 勾弦下行；P 击弦上行；斜线滑音；箭头推弦；x 闷音",
        },
        {
          id: "swapped-slide-bend",
          label: "H 击弦；P 勾弦；斜线推弦；箭头滑音；x 闷音",
        },
        {
          id: "muted-is-rest",
          label: "H 击弦；P 勾弦；斜线滑音；箭头推弦；x 休止",
        },
      ],
      answer: {
        type: "singleChoice",
        optionId: "correct-techniques",
      },
    },
  ],
} as const satisfies Pick<
  GuitarAdvancedData,
  "modules" | "lessons" | "exercises"
>;
