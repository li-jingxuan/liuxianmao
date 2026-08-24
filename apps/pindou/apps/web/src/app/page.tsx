import { PindouConverter } from "@/components/pindou-converter";

type HomeProps = {
  searchParams: Promise<{
    k?: string | string[];
    user?: string | string[];
  }>;
};

/** MVP1 为单页工具，交互状态全部封装在客户端 PindouConverter 中。 */
export default async function Home({ searchParams }: HomeProps) {
  const { k, user: suppliedUser } = await searchParams;
  const apiKey = Array.isArray(k) ? k[0] : k;
  const user = Array.isArray(suppliedUser) ? suppliedUser[0] : suppliedUser;
  // Web 只根据 user 是否非空展示按钮，并把原值交给 API 做最终密钥校验。
  const deliveryAdminKey = user?.trim() ? user : undefined;

  return <PindouConverter apiKey={apiKey} deliveryAdminKey={deliveryAdminKey} />;
}
