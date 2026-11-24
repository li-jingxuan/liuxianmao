import { useEditorResources } from "./editor-resources";
import defaultBrand from "./liuxianmao-128.png";

/** 使用可由普通 Web 页面和 Electron 标准协议加载的图片，尺寸与原顶栏一致。 */
export function BrandIcon({ size }: { size: number }) {
  const { paths } = useEditorResources();
  // Vite 返回 URL，Next 源码消费者可能把同一导入识别为静态图片元数据。
  const url = typeof defaultBrand === "string" ? defaultBrand : (defaultBrand as { src: string }).src;
  return <img src={paths?.brandIconUrl ?? url} alt="" width={size} height={size} />;
}
