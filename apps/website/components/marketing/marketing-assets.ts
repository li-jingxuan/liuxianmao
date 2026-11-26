import { sitePath } from "../../lib/site-path";

export function marketingAsset(file: string) {
  return sitePath(`/assets/marketing/${file}`);
}

export function scoreMedia(ideal: boolean) {
  // 评审保持原稿截图。生产默认展示本仓库的自有样谱、实际编辑器及实际 A4 导出。
  const image = (file: string, extension = "webp") => ideal
    ? sitePath(`/previews/ideal/${file}.${extension}`)
    : marketingAsset(`${file}.webp`);

  return {
    title: ideal ? "《理想》" : "《风吹过山谷》",
    workbench: image("editor", "png"),
    tablature: { src: image("tab", "png"), width: 203, height: ideal ? 65 : 75 },
    chords: { src: image("chords", "png"), width: ideal ? 261 : 218, height: 51 },
    lyrics: { src: image("numbered", "png"), width: ideal ? 270 : 305, height: ideal ? 64 : 61 },
    galleryTab: image("gallery-tab"),
    print: image("printed-page"),
  };
}
