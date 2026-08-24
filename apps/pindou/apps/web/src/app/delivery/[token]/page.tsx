import type { Metadata } from "next";

import { ImageDeliveryPreview } from "@/components/image-delivery-preview";

export const metadata: Metadata = {
  title: "查看拼豆图纸 | 拼豆图片转换器",
  description: "缩放查看并保存完整拼豆施工图",
};

type DeliveryPageProps = {
  params: Promise<{ token: string }>;
};

/** 公开交付页只传递随机 token，不读取或暴露任何管理员密钥。 */
export default async function DeliveryPage({ params }: DeliveryPageProps) {
  const { token } = await params;
  return <ImageDeliveryPreview token={token} />;
}
