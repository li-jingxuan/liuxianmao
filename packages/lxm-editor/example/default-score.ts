import source from "./default-score.lxm.json";
import { loadDocument } from "../src/core/document/loader";

/** 默认 mock 使用导出的完整谱面，并通过正式 loader 校验。 */
const loaded = loadDocument(JSON.stringify(source));
if (!loaded.ok) throw new Error(loaded.errors.join("；"));

export default loaded.document;
