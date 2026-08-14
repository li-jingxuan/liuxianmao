import type { Metadata } from "next";

import { MardColorCatalog } from "@/components/mard-color-catalog";

export const metadata: Metadata = {
  title: "MARD 全量色卡 | 拼豆图片转换器",
  description: "按系列查看完整 MARD 拼豆色卡",
};

/** 独立 PC 测试页，不介入图片转换器的业务状态。 */
export default function ColorsPage() {
  return <MardColorCatalog />;
}
