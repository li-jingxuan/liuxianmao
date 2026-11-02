import { FnosAlbumTest } from "@/components/fnos-album-test";
import { PindouConverter } from "@/components/pindou-converter";
import { IS_FNOS } from "@/lib/paths";

type HomeProps = {
  searchParams: Promise<{
    k?: string | string[];
    user?: string | string[];
  }>;
};

/** MVP1 为单页工具，交互状态全部封装在客户端 PindouConverter 中。 */
export default async function Home({ searchParams }: HomeProps) {
  if (IS_FNOS && process.env.NEXT_PUBLIC_FNOS_ALBUM_TEST_MODE === "true") {
    return <FnosAlbumTest />;
  }
  const { k, user: suppliedUser } = await searchParams;
  const apiKey = Array.isArray(k) ? k[0] : k;
  const user = Array.isArray(suppliedUser) ? suppliedUser[0] : suppliedUser;
  // Web 只根据 user 是否非空展示按钮，并把原值交给 API 做最终密钥校验。
  const deliveryAdminKey = !IS_FNOS && user?.trim() ? user : undefined;

  return <PindouConverter apiKey={apiKey} deliveryAdminKey={deliveryAdminKey} isFnos={IS_FNOS} />;
}
