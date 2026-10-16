import type { ScoreExampleRef } from "../../lib/guitar-advanced/model";

/** 谱例只保存稳定引用；实际文档由 score-example-adapter 通过正式 loader 提供。 */
export const GUITAR_ADVANCED_SCORE_EXAMPLES = [
  {
    id: "rhythm-basic-score",
    title: "八分音符节奏谱例",
    caption: "连续的八分音符，每拍包含两个音符位置。",
    source: "lxm-editor-example",
    sourceDocument: "mvp-7-2",
  },
] as const satisfies readonly ScoreExampleRef[];
