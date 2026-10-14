import source from "./technique-rhythm-score.json";
import { upgradeDocumentToCurrent } from "../src/core/loader";
/** 旧规范谱例经过显式升级，拒绝用类型断言掩盖版本差异。 */
const upgraded = upgradeDocumentToCurrent(source);
if (!upgraded.ok) throw new Error(upgraded.errors.join("；"));
export default upgraded.document;
