import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const filePattern = /^(INSGuitarSteel_String(?:HighE|B|G|D|A|LowE)_Vel0[123])_([A-G])(s?)(\d)_01\.wav$/;
const pitchClasses = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;

/** 沿用原音源的 6 弦及 3 个力度层。每层选低、中、高 3 个音高作转调锚点。 */
function selectAudioAnchors(entries: Array<{ file: string }>) {
  const groups = new Map<string, Array<{ file: string; pitch: number }>>();
  for (const { file } of entries) {
    const match = filePattern.exec(file);
    if (!match) continue;
    const [, group, pitchClass, sharp, octave] = match;
    const notes = groups.get(group!) ?? [];
    notes.push({ file, pitch: Number(octave) * 12 + pitchClasses[pitchClass as keyof typeof pitchClasses] + Number(!!sharp) });
    groups.set(group!, notes);
  }
  if (groups.size !== 18 || [...groups.values()].some((notes) => notes.length < 3))
    throw new Error("木吉他音源必须包含 6 弦、3 个力度层，每层至少 3 个音高。");

  return [...groups.values()].flatMap((notes) => {
    notes.sort((a, b) => a.pitch - b.pitch);
    return [notes[0]!, notes[Math.floor(notes.length / 2)]!, notes.at(-1)!].map(({ file }) => ({ file }));
  });
}

/** 从仓库的同一份素材打包，浏览器进入和弦库或开始试听时才请求资源代码块。 */
function editorAssets(): Plugin {
  const assets = new URL("../../apps/website/public/assets/", import.meta.url);
  const audio = new URL("audio/meta-steel-guitar-v1/", assets);
  const chords = new URL("chords/", assets);
  const bundledSource = fileURLToPath(new URL("./src/resources/bundled-assets.ts", import.meta.url));
  const virtualPrefix = "lxm-editor-resource:";
  const resources = new Map<string, URL>();
  const read = (url: URL) => readFileSync(url, "utf8");
  const manifest = read(new URL("manifest.json", chords));
  const catalogUrl = (JSON.parse(manifest) as { catalogUrl: string }).catalogUrl.replace(/^\.\//, "");
  if (!/^catalog-\d{4}\.\d{2}\.\d{2}\.\d+\.json$/.test(catalogUrl))
    throw new Error("和弦库清单需要引用同目录的版本文件。");
  resources.set("chord-catalog", new URL(catalogUrl, chords));

  const audioManifest = JSON.parse(read(new URL("manifest.json", audio))) as { samples: Array<{ file: string }> };
  const samples = selectAudioAnchors(audioManifest.samples);
  for (const { file } of samples) {
    for (const codec of ["ogg", "m4a"]) {
      const key = `${file.slice(0, -4)}.${codec}`;
      resources.set(key, new URL(`${codec}/${key}`, audio));
    }
  }

  const importResource = (key: string) => `import(${JSON.stringify(`${virtualPrefix}${key}`)}).then(module => module.default)`;
  return {
    name: "lxm-editor-assets",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith(virtualPrefix)) return `\0${id}`;
    },
    load(id) {
      if (!id.startsWith(`\0${virtualPrefix}`)) return;
      const key = id.slice(virtualPrefix.length + 1);
      const url = resources.get(key);
      if (!url) throw new Error(`未注册的编辑器资源 ${key}`);
      if (key === "chord-catalog") return `export default ${JSON.stringify(JSON.parse(read(url)))};`;
      // 每段音频使用独立的动态模块。静态入口只保存加载函数，宿主首屏不会加载音源字节。
      return `export default ${JSON.stringify(readFileSync(url).toString("base64"))};`;
    },
    transform(_source, id) {
      if (id !== bundledSource) return;
      const loaders = [...resources.keys()].filter((key) => key !== "chord-catalog")
        .map(key => `${JSON.stringify(key)}: () => ${importResource(key)}`).join(",\n");
      return `const loaders = {${loaders}};
export const bundledGuitarSamples = {
  manifest: ${JSON.stringify({ samples })},
  load(file, codec) { return loaders[file + "." + codec](); },
};
export const loadBundledChordCatalog = () => ${importResource("chord-catalog")};`;
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "styles.css.d.ts", source: "export {};\n" });
      this.emitFile({ type: "asset", fileName: "assets/chords/manifest.json", source: manifest });
      this.emitFile({ type: "asset", fileName: `assets/chords/${catalogUrl}`, source: read(new URL(catalogUrl, chords)) });
      for (const file of ["LICENSE", "SOURCE.md"]) {
        this.emitFile({ type: "asset", fileName: `assets/meta-steel-guitar/${file}`, source: read(new URL(file, audio)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [editorAssets()],
  css: {
    modules: { generateScopedName: "lxm_[name]_[local]_[hash:base64:5]" },
  },
  build: {
    target: "es2022",
    lib: {
      entry: fileURLToPath(new URL("./src/bundle.ts", import.meta.url)),
      formats: ["es"],
      fileName: "index",
      cssFileName: "styles",
    },
    rollupOptions: {
      // React、ReactDOM 和 Core 由宿主解析并复用，不能把框架或文档命令再打包一份。
      external: /^(?:react(?:-dom)?|@liuxianmao\/lxm-editor|@ant-design\/icons|fflate|lucide-react|zustand)(?:\/|$)|^antd$/,
      output: { banner: '"use client";', inlineDynamicImports: false },
      onwarn(warning, warn) {
        // 所有内部入口已经由产物首行统一声明。Rollup 不再为被折叠的客户端指令报告位置。
        if (warning.code === "MODULE_LEVEL_DIRECTIVE" ||
          (warning.code === "SOURCEMAP_ERROR" && warning.pos === 0)) return;
        warn(warning);
      },
    },
  },
});
