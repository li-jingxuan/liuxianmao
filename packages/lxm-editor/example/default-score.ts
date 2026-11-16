import source from "./ideal-score.lxm.json";
import { loadDocument } from "../src/core/document/loader";

/** 默认 mock 使用截图复刻的《理想》谱面，并通过正式 loader 校验。 */
const loaded = loadDocument(JSON.stringify(source));
if (!loaded.ok) throw new Error(loaded.errors.join("；"));

export default loaded.document;
