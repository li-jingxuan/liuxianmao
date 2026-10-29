import source from "./technique-rhythm-score.json";
import { loadDocument } from "../src/core/loader";
/** Fixture 直接保存当前简谱歌词锚点，并通过正式 loader 校验。 */
const loaded = loadDocument(JSON.stringify(source));
if (!loaded.ok) throw new Error(loaded.errors.join("；"));
export default loaded.document;
