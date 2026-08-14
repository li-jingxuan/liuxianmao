import type { Metadata } from "next";

import { AccessKeyIssuer } from "@/components/access-key-issuer";

export const metadata: Metadata = {
  title: "签发访问密钥 | 拼豆图片转换器",
  description: "通过管理密钥签发指定使用次数的访问密钥",
};

type AccessKeyPageProps = {
  params: Promise<{ prefix: string }>;
};

/** prefix 由 /gk/[prefix] 路由段提供，不允许在表单中临时修改。 */
export default async function AccessKeyPage({ params }: AccessKeyPageProps) {
  const { prefix } = await params;
  return <AccessKeyIssuer prefix={prefix} />;
}
