import { PindouConverter } from "@/components/pindou-converter";

type HomeProps = {
  searchParams: Promise<{ k?: string | string[] }>;
};

/** MVP1 为单页工具，交互状态全部封装在客户端 PindouConverter 中。 */
export default async function Home({ searchParams }: HomeProps) {
  const { k } = await searchParams;
  const apiKey = Array.isArray(k) ? k[0] : k;

  return <PindouConverter apiKey={apiKey} />;
}
