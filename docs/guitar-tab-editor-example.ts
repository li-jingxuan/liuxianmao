/**
 * 六线谱完整示例的唯一实现已迁入核心包测试夹具。
 * 文档、页面和单元测试均从同一份强类型数据读取，避免模型演进后出现重复 mock。
 */
export {
  createExampleDocument,
  guitarTabEditorExample,
} from "../packages/lxm-tabeditor/src/testing/example-document";

export type { LxmScoreDocument } from "../packages/lxm-tabeditor/src/core/schema";
