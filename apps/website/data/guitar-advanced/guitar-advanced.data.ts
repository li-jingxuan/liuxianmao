import type { GuitarAdvancedData } from "../../lib/guitar-advanced/model";

/** 课程、理论和练习统一维护为 JSON 形状，后续可直接映射为服务端响应。 */
export const GUITAR_ADVANCED_DATA = {
  modules: [
    {
      id: "rhythm-and-beat",
      title: "节奏与拍点",
      summary: "八分音符、十六分音符、切分与三连音",
      order: 1,
      availability: "available",
      lessonIds: ["rhythm-eighth-sixteenth"],
      exerciseIds: ["rhythm-identify-eighth-notes"],
    },
    {
      id: "chords-and-progressions",
      title: "和弦与进行",
      summary: "三和弦构成与常见 I-IV-V 进行",
      order: 2,
      availability: "comingSoon",
      lessonIds: [],
      exerciseIds: [],
    },
    {
      id: "scales-and-fretboard",
      title: "音阶与指板",
      summary: "A 小调五声音阶与根音定位",
      order: 3,
      availability: "comingSoon",
      lessonIds: [],
      exerciseIds: [],
    },
    {
      id: "playing-techniques",
      title: "弹奏技巧",
      summary: "击勾弦、滑音、推弦和闷音的读谱",
      order: 4,
      availability: "comingSoon",
      lessonIds: [],
      exerciseIds: [],
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
        "理解每拍两次与每拍四次的时值关系",
        "能在谱面中识别八分音符和十六分音符",
        "建立稳定的数拍方式，为后续节奏练习做准备",
      ],
      blocks: [
        {
          type: "paragraph",
          title: "先确认一拍里的分割数量",
          content:
            "八分音符把一拍分成两份，十六分音符把一拍分成四份。练习时先用稳定的口数确认拍点，再把右手动作放到对应位置。",
        },
        {
          type: "scoreExample",
          documentId: "rhythm-basic-score",
          caption: "谱例：连续的八分音符，每拍包含两个音符位置。",
        },
        {
          type: "callout",
          tone: "warning",
          title: "易错点",
          content:
            "不要把十六分音符误读成更快的八分音符；先确认一拍内的分割数量，再判断演奏速度。",
        },
      ],
      exerciseIds: ["rhythm-identify-eighth-notes"],
      previousLessonId: null,
      nextLessonId: null,
    },
  ],
  exercises: [
    {
      id: "rhythm-identify-eighth-notes",
      lessonId: "rhythm-eighth-sixteenth",
      moduleId: "rhythm-and-beat",
      type: "singleChoice",
      title: "从谱例中选出八分音符节奏",
      prompt: "下面哪一个描述表示“一拍两次”的八分音符节奏？",
      options: [
        { id: "once-per-beat", label: "每拍一次" },
        { id: "twice-per-beat", label: "每拍两次" },
        { id: "four-times-per-beat", label: "每拍四次" },
      ],
      answer: { optionId: "twice-per-beat" },
      explanation:
        "八分音符把一拍分成两份，因此“一拍两次”对应八分音符。十六分音符则是一拍四次。",
      relatedLessonId: "rhythm-eighth-sixteenth",
    },
  ],
} as const satisfies GuitarAdvancedData;
