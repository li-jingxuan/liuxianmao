import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optimize } from "svgo";

const PACKAGE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(PACKAGE_DIRECTORY, "../../..");
const SOURCE_DIRECTORY = path.join(REPOSITORY_ROOT, "docs/extracted-svg-icons");
const OUTPUT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "apps/website/assets/svg/music-controls",
);
const PUBLIC_OUTPUT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "apps/website/public/assets/svg/music-controls",
);

const SVG_FILE_NAMES = [
  "note-whole.svg",
  "note-half.svg",
  "note-quarter.svg",
  "note-eighth.svg",
  "note-sixteenth.svg",
  "note-thirty-second.svg",
  "note-dot.svg",
  "note-double-dotted.svg",
  "note-tie.svg",
  "duplet.svg",
  "triplet.svg",
  "quadruplet.svg",
  "quintuplet-5-4.svg",
  "quintuplet-5-3.svg",
  "sextuplet.svg",
  "measure-add24.svg",
  "measure-remove24.svg",
  "actions-copy24.svg",
];

/** 将固定黑色及其他单色属性统一转换为主题可控的 currentColor。 */
const currentColorPlugin = {
  name: "lxm-current-color",
  fn: () => ({
    element: {
      enter: (node) => {
        if (node.name === "svg") {
          delete node.attributes.width;
          delete node.attributes.height;
        }
        for (const attribute of ["fill", "stroke"]) {
          const value = node.attributes[attribute];
          if (value && value !== "none" && !value.startsWith("url(")) {
            node.attributes[attribute] = "currentColor";
          }
        }
        for (const attributeName of Object.keys(node.attributes)) {
          const value = node.attributes[attributeName] ?? "";
          if (
            attributeName.toLowerCase().startsWith("on") ||
            ((attributeName === "href" || attributeName === "xlink:href") &&
              /^(?:https?:|data:|javascript:)/i.test(value))
          ) {
            delete node.attributes[attributeName];
          }
        }
      },
    },
  }),
};

const standardizeSvg = (source, fileName) => {
  if (/<(?:script|image)\b/i.test(source)) {
    throw new Error(`${fileName} 包含禁止的 script 或 image 元素`);
  }
  const result = optimize(source, {
    path: fileName,
    multipass: true,
    plugins: ["preset-default", "removeDimensions", currentColorPlugin],
  });
  if (!result.data.includes("viewBox=")) {
    throw new Error(`${fileName} 缺少 viewBox，无法作为响应式图标使用`);
  }
  return `${result.data.trim()}\n`;
};

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await mkdir(PUBLIC_OUTPUT_DIRECTORY, { recursive: true });

// 文件按固定清单逐个处理，目录中意外出现的素材不会被静默发布。
for (const fileName of SVG_FILE_NAMES) {
  const source = await readFile(path.join(SOURCE_DIRECTORY, fileName), "utf8");
  const output = standardizeSvg(source, fileName);
  await writeFile(path.join(OUTPUT_DIRECTORY, fileName), output, "utf8");
  // public 目录提供与 manifest.runtimePath 一致的浏览器访问地址。
  await writeFile(path.join(PUBLIC_OUTPUT_DIRECTORY, fileName), output, "utf8");
}

console.log(`已标准化 ${SVG_FILE_NAMES.length} 个 SVG 资源。`);
