import Image from "next/image";
import { sitePath } from "../lib/site-path";

export const BrandIcon = ({ size }: { size: number }) => (
  <Image
    src={sitePath("/assets/brand/liuxianmao-128.png")}
    alt=""
    width={size}
    height={size}
    unoptimized
  />
);
