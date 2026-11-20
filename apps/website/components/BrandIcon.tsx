import Image from "next/image";

export const BrandIcon = ({ size }: { size: number }) => (
  <Image
    src="/assets/brand/liuxianmao-128.png"
    alt=""
    width={size}
    height={size}
    unoptimized
  />
);
